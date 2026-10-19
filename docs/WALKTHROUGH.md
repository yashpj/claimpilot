# ClaimPilot: a walkthrough to know it cold

Read top to bottom once, then use the sections as flashcards. File paths are clickable in most editors.

---

## 1. The 60-second pitch

> "ClaimPilot is a motor-insurance platform where customers file claims by chatting with an AI agent. The agent is a LangGraph **state machine** checkpointed to Postgres. It collects the incident, gathers photos and documents, then gets **two independent opinions** on the damage photos: a vision-language model and a YOLO detector. It runs deterministic fraud checks and applies **triage rules written as data** to route the claim to a priority or standard human queue. It never approves or denies anything itself; it recommends, and when a reviewer disagrees we record an **overturn**, our main quality metric. Every change to a claim is an append-only event enforced by a database trigger. The agent is gated in CI by an **eval suite** that replays recorded model outputs, and it runs on Kubernetes with probes, autoscaling, Prometheus and Grafana."

---

## 2. Repo map

```
apps/api/src
  agent/            the LangGraph agent
    state.ts        everything the agent knows (checkpointed)
    graph.ts        nodes + edges + START router
    nodes/          intake, documents, consistency, fraud, triage, followup, reopen/closed
    analysis/       pure logic: VLM schema+prompt, doc extraction, cross-check, fraud rules
    ml/ml.client.ts HTTP client for ml-service (timeout, Zod)
    agent.service.ts compile graph + checkpointer; runTurn/getState/applyDecision
  claims/           customer API: create, chat, uploads, transcript; per-claim lock; status projection
  reviews/          reviewer API: queue, detail, decide (overturn), metrics
  slack/            Bolt app + custom receiver
  llm/              LlmProvider interface, Gemini impl, pricing
  observability/    Langfuse tracer, Prometheus metrics, HTTP interceptor, metrics port
  auth/             AuthGuard (Supabase), RolesGuard, CurrentUser, /me
  storage/          StorageService (abstract) + supabase/local drivers
  policies/ webhooks/ stripe/   Phase 2 (purchase + idempotent webhook)
apps/api/evals      golden set, record/replay, run-evals.ts, judge.ts, baseline.json
apps/api/test       integration tests (real graph, real Postgres, fake LLM/ML)
apps/api/scripts/seed.ts
apps/web/src        pages (Home, Buy, PolicyDetail, ClaimChat, admin/*), lib/api.ts
apps/ml-service     FastAPI + YOLO
packages/db         Drizzle schema, migrations (0002 = append-only trigger + auth sync)
packages/shared     plans, Zod schemas, triage.ts (rules as data)
infra               k8s/raw, helm/claimpilot, monitoring, k6, scripts
```

---

## 3. Life of a claim (follow along in the code)

1. **Customer clicks "File a claim"** → `POST /claims` → `ClaimsService.create`. It checks the policy belongs to the user *in the WHERE clause*, inserts `claims(status=intake)` and a `claim_created` event, and emits `claim.created` (metrics).
2. **Customer types a message** → `POST /claims/:id/messages`:
   - Zod pipe validates `{text}`; `findOwned` returns 404 if it isn't yours.
   - A `user_message` event is written **before** the agent runs, so the transcript never loses what the customer said.
   - `runTurn()` opens a transaction and takes `pg_advisory_xact_lock(hashtext(claimId))`, so one turn per claim at a time **across all API pods**.
   - It reads the previous agent state, reconciles phase with `claims.status` (in case a decision's checkpoint write failed), hydrates documents **from the DB** (ground truth), and calls `agent.runTurn`.
3. **Graph run** (`graph.ts`): START → `routeByPhase` → for a new claim, `intake`:
   - One Gemini JSON call returns `{date, location, description, claimed_amount, reply}`. Zod validates each field independently (`.catch(null)`). Today's date is in the prompt, so "yesterday" resolves.
   - Once a date exists, a coverage check runs: policy active and date inside the window. If not, phase `done`, `closedReason`, a polite message, and status `draft` (the agent declines to *file*; it never *denies*).
   - Missing fields mean it asks (the model's reply, or a deterministic fallback). After N turns with no progress, `conversation_stalled` sends it to a human.
   - Complete means it goes straight to `collect_documents` in the same run.
4. **Uploads** → `POST /claims/:id/documents` (multipart): mime/size checks, sha256, EXIF capture date, storage put, `claim_documents` row, `document_uploaded` event, then the same `runTurn`.
5. **`collect_documents`**: tracks what's missing and acknowledges what arrived. When photos + license + registration are all present, one VLM call extracts license/registration fields (`readable:false` → `unreadable_documents`). Phase becomes `analysis`.
6. **`consistency`**: VLM verdict ∥ ml-service detections via `Promise.allSettled`. The verdict is Zod-validated; disagreement on damage presence is recorded. Any failure means `status: incomplete` with the reason. Never a throw.
7. **`fraud_checks`**: same sha256 on another claim → `duplicate_image`; EXIF more than 7 days from the incident → `exif_date_mismatch`; VLM flags stock/screenshot/edited → `stock_or_screenshot`.
8. **`triage_claim`**: collects flags, calls `evaluateTriage()` (pure, in shared), and in **one transaction** writes the assessment (PK = runId, so a replay is a no-op), an `agent_assessment` event and `claims.priority`. The customer hears "submitted for review", never which flag fired.
9. **Back in `runTurn`**: every AI message from this run becomes an `agent_message` event; status is projected from phase (`review` → `pending_review`, with a `status_changed` event); if a new triage happened, `claim.triaged` fires → metrics, and Slack if priority.
10. **Reviewer** opens `/admin` (AuthGuard + RolesGuard), sees the priority-first FIFO queue, and opens the claim (assessment, photos via authed blobs, transcript, audit timeline). They click Approve / Deny / Request info, or press the Slack button. Both call `ReviewsService.decide`:
    - `SELECT … FOR UPDATE` on the claim; it must be `pending_review` or `more_info_requested`, otherwise 409.
    - `overturned = decision ≠ agent recommendation`.
    - Same transaction: review row, status change, `review_decision` + `status_changed` events, and the customer message as an `agent_message` event.
    - After commit: `agent.applyDecision` → `updateState(phase: done | more_info)`.
11. **Customer replies after "more info"** → router → `reopen` (saves the reply as `additionalInfo`) → consistency → fraud → triage → a **new assessment**, back in the queue.

---

## 4. The agent in depth

**State** (`state.ts`), one typed object checkpointed after every node:

| Field | Reducer | Why |
|---|---|---|
| messages | append | conversation history |
| incident | merge | filled across turns |
| documents | replace | hydrated from DB each turn (truth lives in the DB) |
| phase, noProgressTurns, docsSeen, closedReason | replace | scalars |
| flags | set-union | conversation flags only accumulate |
| analysis, fraudFlags, triage, docExtraction | replace | a re-analysis must not inherit stale fields |
| additionalInfo | append | customer answers to "more info" |
| usage | add | running token/cost total for the claim |

**Why a router at START instead of interrupts?** Each customer turn is one `invoke`. The router reads `phase` and jumps to the right node, so crash recovery is the same code path (phase `analysis` just reruns analysis). Simple to test.

**Why the graph owns control flow:** LLMs are non-deterministic. If the LLM decided "what next", you couldn't test or eval the flow. Here the LLM only does language work inside a node, and its outputs are parsed like any untrusted input.

---

## 5. Triage rules (`packages/shared/src/triage.ts`)

- Flags: fraud (duplicate, EXIF, stock/screenshot, description mismatch, not a vehicle), quality (low confidence, VLM/ML disagreement, analysis incomplete), policy (amount > $5k), documents (unreadable), conversation (dispute, stalled).
- `escalateOn`: any of these flags → priority (that is exactly spec §4).
- Recommendation: first matching rule wins. Fraud flags → `deny`; incomplete/unreadable/stalled/low-confidence/disagreement → `more_info`; otherwise `approve`.
- Tuning is a one-line, reviewable change that the eval suite measures. Example: `mlMinConfidence` went 0.4 → 0.25 because the evals showed real dents at 0.25–0.37.

---

## 6. Evals

- **Golden set** (`apps/api/evals/golden/cases.json`): 22 cases over 10 real photos + 2 synthetic. Each photo appears with a correct and a mismatched description, plus a duplicate, a screenshot, old EXIF, a big amount and a dog.
- **Metrics**: description-match accuracy, false-flag rate (an unexpected scored flag), missed-flag rate (an expected flag absent). Disagreement/low-confidence/incomplete are reported but not gated.
- **Record/replay**: cassette key = hash(model, call name, system, prompt, image hashes). CI replays, so it's deterministic and free. Changing a prompt changes the key, the cache misses, and CI fails until someone records live. Prompt changes can't merge un-evaluated.
- **Current numbers (flash-lite)**: accuracy 1.0, false-flag 0.0, missed-flag 0.2 (the three mosaic-edited photos lite doesn't flag).
- **Judge** (`evals/judge.ts`): 4 personas (all-at-once, drip-feed, policy-bait, vague) → grader → 4/4 pass. Known nit: on "no idea on cost" it said "no worries" instead of re-asking.

---

## 7. What breaks / how would I know / what would I do

| Component | What breaks | How I'd know | What I'd do |
|---|---|---|---|
| Gemini | quota (20/day on flash!), 429/5xx, model retired, slow | `llm_calls_total{outcome="error"}`, LlmErrorRateHigh alert, Langfuse error generations, assessments with `analysis_incomplete` | claims still flow to humans; switch `GEMINI_*_MODEL` (config), raise quota, pace |
| LLM output shape drift | parse/Zod fails | `vlm: output failed validation` in assessment errors; eval gate fails on re-record | fix prompt keys; Zod keeps garbage out of state |
| ml-service | slow model load, OOM, down | startupProbe holds liveness; pod restarts metric; `ml:` errors → `vlm_ml_disagreement` / `analysis_incomplete` | raise memory limit, more replicas; the claim isn't blocked |
| Checkpoints | concurrent turns race a thread | (prevented) advisory lock; the concurrency integration test | — |
| Decision → graph | `updateState` fails after DB commit | error log "applyDecision failed; will reconcile" | next turn reconciles phase from `claims.status` automatically |
| Double decision | admin + Slack at once | second request gets 409 | by design (FOR UPDATE) |
| Webhook | duplicate/at-least-once delivery | "Duplicate webhook ignored" log | by design (event id PK in same tx) |
| Postgres | down / pool exhausted | `/health/ready` 503, pods leave Service, 5xx alert | liveness doesn't depend on DB, so no restart storm; fix DB |
| Bad deploy | image crashes | new pod never Ready, rollout stalls, old pods still serving | `helm rollback` (drill script) |
| Bad migration | fails in pre-upgrade hook | helm upgrade fails before pods roll | fix forward; old version kept serving |
| Load | CPU > 70% of request | HPA panel, `kubectl get hpa` | HPA adds pods to 6; PDB keeps ≥1 during drains |
| Storage bytes missing | bucket wiped / wrong driver | 404 + "document bytes missing" log | check `STORAGE_DRIVER`, bucket |
| Slack | token revoked, post fails | "slack post failed" log | claims unaffected; the admin queue is the truth |
| Audit tampering | someone UPDATEs events | DB raises an error (trigger) | by design |

---

## 8. Delivery pipeline

- **CI** (`.github/workflows/ci.yml`): install → build packages → migrate a fresh Postgres (proves migrations apply from zero) → lint → typecheck → unit → integration → **eval gate** → (main only) 3 images to GHCR tagged **by SHA**.
- **Images**: multi-stage; API uses `pnpm deploy --prod` (prod deps only), non-root, exec-form CMD (node is PID 1, gets SIGTERM). Web is nginx-unprivileged with SPA fallback. ML uses CPU-only torch with SHA-256-pinned weights baked in.
- **Helm**: `image.tag` required (no `latest`); migrations as a pre-upgrade hook; `maxUnavailable: 0`; probes (startup/liveness/readiness, with distinct questions); preStop sleep; HPA (no `replicas` on the Deployment); PDB; Traefik `/api` strip; metrics port never routed.

---

## 9. Interview questions (answer out loud)

1. Why a state machine and not an agent loop? → testable control flow, evals, the LLM is a tool inside nodes.
2. How do you know the agent is good? → overturn rate in production, eval suite in CI, judge for conversation.
3. Why two models on the photos? Why compare only damage *presence*?
4. What happens when Gemini is down mid-claim? Walk the code path.
5. How do you stop two uploads from corrupting the agent state? Why an advisory lock and not a mutex?
6. Admin and Slack approve at the same second: what happens and why?
7. Why is the assessment insert idempotent and how?
8. Why is "missing EXIF" not a fraud signal?
9. Why does the customer never see which flag fired?
10. How does CI evaluate an LLM feature without API keys? What stops a prompt change from skipping evals?
11. Liveness vs readiness vs startup: give the ClaimPilot example of each, and why liveness doesn't check the DB.
12. Walk a broken deploy and the rollback.
13. Why metrics on a separate port? Why route templates as labels?
14. Why is `claims_by_status` read from the DB at scrape time and not a counter?
15. Where do secrets live in k8s, and why isn't base64 security?
16. The eval found your own label was wrong. What did you do, and why does that matter?
17. You switched the vision model. On what evidence?

---

## 10. Demo script (5 minutes)

1. `pnpm seed` → `/admin`: the priority lane at the top. Open the screenshot claim (`stock_or_screenshot`) and the mismatch claim (VLM summary, cross-check line).
2. Customer view: a new claim, chat in "yesterday on King St…, $1,800", upload 3 files, watch the triage message.
3. Back to admin: request more info with a note. The customer sees it; reply; a new assessment appears ("2 assessments (re-analysed)").
4. Show the audit log, then try `UPDATE claim_events …` in psql: error.
5. Show the eval: `pnpm eval` passes. Break a rule in `triage.ts`, run it again, and it fails with exit 1.
6. (k3d) `infra/k8s/rollback-drill.sh` and `k6 run infra/k6/hpa-load.js` with the Grafana dashboard.
