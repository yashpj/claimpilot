# DECISIONS

One line per decision: what we chose, what we rejected, why. Newest phases last.

## ⚠️ Deviations from the spec (need an explicit OK)

| Spec said | We did | Why | Reversible by |
|---|---|---|---|
| Next.js | Vite + React SPA | The spec used Next only as a client (`"use client"` everywhere, no server features). That's a SPA with extra machinery. Deep Next.js is sprint 2. | — (decided in Phase 1) |
| Fastify adapter | Express (Nest default) | Learning focus is the agent, not HTTP throughput; broader docs. Nest's adapter makes it a one-file swap. | `@nestjs/platform-fastify` in `main.ts` |
| YOLOv8 | **YOLO11n** (`vineetsarpal/yolov11n-car-damage`, Apache-2.0) | No licensed, pretrained YOLOv8 *detector* for car damage was available. The only YOLOv8 candidate (`nezahatkorkmaz/...`) is a whole-image *classifier* (minor/moderate/severe) with no regions. YOLO11 is the same Ultralytics library and API, trained on the Roboflow Universe dataset the spec points to. | `MODEL_URL` / `MODEL_SHA256` / `MODEL_VERSION` env in ml-service |
| Supabase Storage | Supabase Storage **plus** a `local` driver | Dev, CI and evals run without a cloud bucket. Prod/k8s still use Supabase (`STORAGE_DRIVER=supabase`). | Already config |
| Intake: date, location, description | + **claimed amount** | The spec's own triage rule ("claimed amount above threshold") needs it. | Remove the field in `nodes/intake.ts` |

## Phase 1–3 (backlog written up)

- **pnpm workspaces, no Nx.** pnpm does linking; Nx does orchestration and caching. Two build commands don't need a build graph yet.
- **Drizzle over Prisma.** SQL-shaped API, no engine binary (smaller containers). Migrations are committed SQL, never `drizzle-kit push` (push skips review and history).
- **Money as integer cents. LLM cost as integer micro-USD.** Floats drift when summed.
- **`getUser()` over local JWT verification.** One network hop per request, but no way to misconfigure. Scale path: verify locally with `jose` (trades revocation freshness for latency).
- **Postgres on host port 5433.** A native Mac Postgres owns 5432; two servers on one port gave contradictory symptoms.
- **Two `.env` files** (db, api). Each process loads its own; drift risk accepted.
- **Plain `useEffect` before React Query.** Learn the problem (cleanup, races, stale closures) before the abstraction. Migrated in Phase 3.
- **Explicit CORS origin list, never `origin: true`.** `true` reflects any origin.
- **Supabase session pooler (5432) for migrations, transaction pooler (6543) for runtime.** Migrations need a session advisory lock; transaction mode silently hangs. Runtime on 6543 sets `DB_PREPARE=false` (no prepared statements in transaction mode).
- **`packages/db` builds to `dist/` before the API.** Nest won't compile `.ts` outside its rootDir.

## Phase 4 — analysis, fraud, triage

- **Router at START, not a resumable interrupt.** Every customer turn starts at START, and a router picks the node from the checkpointed `phase`. It's simpler to reason about than `interrupt()`, and crash recovery is the same code path (phase `analysis` just reruns the analysis).
- **Node names ≠ state channel names.** LangGraph forbids it (`documents` → `collect_documents`, `triage` → `triage_claim`). This is likely why the original graph only wired intake.
- **Reducers: `reducer:` key, not `value:`.** `value` is the deprecated alias (the Phase 3 note had it backwards).
- **`analysis` and `triage` state REPLACE, not merge.** A re-analysis must not inherit stale fields from the previous run.
- **Stall = N customer turns with no progress**, not a raw turn count. Uploading photos one at a time is progress, not a stall.
- **Triage rules are data** (`packages/shared/src/triage.ts`): thresholds, `escalateOn`, recommendation rules. A pure `evaluateTriage()` is shared by the API, the evals and the UI labels.
- **The agent recommends; it never decides.** The recommendation exists so an "overturn" (human disagrees) can be measured.
- **VLM and ML run in parallel with `Promise.allSettled`.** One failing must not throw away the other's result. Any failure means `analysis_incomplete` plus priority review, never a 500.
- **Cross-check compares damage *presence* only.** The detector has no idea what a "rear bumper" is; comparing locations would compare words to bounding boxes.
- **Missing EXIF is not a fraud flag.** Messaging apps strip it, so flagging it would flag nearly everyone, and reviewers would learn to ignore flags.
- **Assessment + audit event + priority in one transaction, with `runId` as the PK.** A replay after a crash is a no-op (`ON CONFLICT DO NOTHING`), not a duplicate.
- **The customer is never told which flag fired.** Telling a fraudster which check fired teaches them to beat it.
- **Per-claim `pg_advisory_xact_lock`.** Concurrent uploads would otherwise race on one checkpoint thread. It works across API replicas (an in-memory mutex wouldn't) and releases itself when the transaction ends.
- **Coverage-window rejection sets status `draft`, not `denied`.** The agent declines to *file*; only humans *deny*.
- **Ownership lives in the WHERE clause; someone else's claim is a 404, not a 403.** Don't confirm the id exists (IDOR).
- **`claim_events` append-only is enforced by a trigger**, not convention. `REVOKE` can't restrict the table owner, and both local Docker and Supabase connect as the owner.
- **The auth → users trigger is a migration** guarded on the `auth` schema existing. Before, a fresh DB silently broke signup.

## Phase 4 — models

- **flash-lite for everything (text and vision), chosen by the eval.** On the golden set flash-lite scored 100% description-match with 0% false flags, at ~1/3 the cost and ~1s vs ~15s per call. Flash was stricter but noisier, and its free tier is **20 requests/day**, which is unusable. Measured, not assumed.
- **One LLM call per intake turn** (fields + reply in one JSON). Free-tier calls take 10–20s; two calls per turn doubled chat latency.
- **JSON mode** (`responseMimeType: application/json`) instead of regex-stripping fences. Shape is still Zod-validated.
- **One retry on 429/5xx, then fail into `analysis_incomplete`.** Retry loops belong to queues, which are out of scope.
- **`LlmProvider` returns `unknown` for JSON.** That forces every caller to Zod-parse.

## Phase 5 — reviews

- **Role from our `users` table (RolesGuard), not from the JWT.** Supabase tokens don't carry app roles, and a DB lookup makes demotion instant.
- **`SELECT … FOR UPDATE` + status check in `decide()`.** The admin UI and a Slack button clicked at the same moment: one wins, the other gets a 409.
- **The decision commits to the DB first, then re-enters the graph** (`updateState`). If the checkpoint write fails, the next customer turn reconciles phase from `claims.status`. The DB is the source of truth.
- **Protected images go through the API as blobs.** `<img>` can't send a bearer token; signed URLs are only used for Slack.

## Phase 6 — ml-service

- **Model loaded once at startup → k8s `startupProbe`.** Without it, liveness kills the pod mid-load, forever.
- **Sync `def` endpoint + a lock around predict.** Inference runs in FastAPI's threadpool (probes stay responsive), one inference per process. Scale with replicas, not threads.
- **Weights baked into the image at build time, SHA-256 pinned.** No downloads at pod start, and the image digest pins the model.
- **CPU-only torch wheel.** The default linux/amd64 wheel bundles ~2 GB of CUDA.
- **Service reports raw detections (conf ≥ 0.15); the API decides what counts** (`mlMinConfidence`).

## Phase 7 — observability & evals

- **Langfuse classic SDK (`langfuse` v3) behind a `Tracer` interface.** No-op without keys. It's a decorator around `LlmProvider`, so nodes don't know tracing exists.
- **`@prometheus-io/client`** (the official rename of `prom-client`).
- **Metrics on a separate port (9464), not `/metrics` on the API port.** The ingress only routes :3000, so there's nothing to leak and no auth to get wrong.
- **Route *template* labels (`/claims/:id`), never raw URLs.** One series per claim id would blow up Prometheus memory.
- **`claims_by_status` gauge computed from the DB at scrape time.** Correct across restarts and replicas; counters reset when a pod restarts.
- **Evals use record/replay cassettes.** CI is deterministic, free and secret-free. A prompt/model change changes the cache key, so CI fails until someone records a fresh live eval. Prompt changes can't merge un-evaluated.
- **Evals run the *production* graph**, with only storage/LLM/ML swapped (that's what DI buys).
- **The golden set is honest.** The VLM found a wrong label (left vs right headlight), and we fixed the label, not the model. Flash-lite's real miss (mosaic-blurred faces not flagged as edited) stays in the baseline.
- **`mlMinConfidence` 0.4 → 0.25, from eval data.** The detector found real dents at 0.25–0.37; the undamaged control peaks at 0.19.
- **The LLM-as-judge is separate from the gate.** It's live, slower and noisier. Weekly/manual, next to a deterministic "fields in state" check, so a wrong judge is visible.

## Phase 8–11 — delivery

- **Images tagged by git SHA, never `latest`; the Helm chart *requires* the tag.** A deploy names exactly what it runs; a rollback names what it ran before.
- **Migrations as a Helm pre-upgrade hook Job from the same image.** If the migration fails, the upgrade stops and the old version keeps serving. Migrations must be backward compatible (expand → deploy → contract).
- **`maxUnavailable: 0`.** A broken image stalls the rollout instead of taking capacity down (see the rollback drill).
- **Liveness has no dependencies; readiness checks the DB.** A DB blip must not restart every pod.
- **No `replicas` on the Deployment when an HPA is on.** Otherwise `helm upgrade` fights the HPA.
- **PDB `minAvailable: 1`** on api and web: drains can't take them to zero.
- **Traefik strips `/api`; the SPA is built with `VITE_API_URL=/api`.** Same origin in the cluster, so no CORS.
- **Secrets are created from `.env` by a script, never in values or git.** K8s Secrets are base64, not encryption; real clusters add encryption at rest + RBAC or an external secret manager.
- **Slack via Bolt with a custom `Receiver`.** Nest already owns HTTP and has consumed the body stream; the receiver verifies the signature (+ timestamp, against replay) over Nest's raw body. Button clicks are authz too: only mapped reviewers can decide.
- **In-process EventEmitter for "claim triaged/decided".** Decouples Slack/metrics from claims. Not durable: a lost Slack ping is acceptable because the admin queue (the DB) is the source of truth. Durable queues are sprint 2.
- **`pnpm@9.0.0` stays pinned.** pnpm honours `packageManager` inside the repo, so the lockfile really is pnpm 9's.

## First live k3d deploy (2026-10-23) — what only a real cluster caught

- **Image `USER` must be numeric.** `runAsNonRoot` can't verify a user *name*, so the kubelet refused to start the api container (`USER node` → `USER 1000`). Lint and schema validation both passed.
- **Migrations: `post-install,pre-upgrade`, not `pre-install`.** A pre-install hook runs before *any* chart resource exists, including the in-chart Postgres.
- **Retry `PostgresSaver.setup()` at boot (~45s).** API pods started before Postgres; one attempt meant CrashLoopBackOff with growing restart delays. Verified: DB down during boot → 0 restarts.
- **Secrets script skips config keys and keeps the Postgres password.** The Secret loads after the ConfigMap, so a laptop `WEB_ORIGIN` silently won. And Postgres reads its password only when the volume is first created.
- **Local registry, not `k3d image import`.** Import copies every image into every node: 2.5 GB ml image × 3 nodes × 2 SHAs filled Docker's disk and hung the daemon.
- **One ServiceMonitor per service.** Endpoints apply to every selected service; the shared one scraped api:3000 and nginx as permanently-down targets.
- **API CPU request (100m) is below real load use (~350m), so the HPA saturated at 6.** Not retuned: k6 hits `/health/ready`, and real claim traffic mostly waits on Gemini (I/O, not CPU). Size requests from production metrics, not a synthetic test.
- **Local k3d runs `STORAGE_DRIVER=local`** (no `SUPABASE_SERVICE_ROLE_KEY` yet). Uploads land in one pod's `/tmp`, so with 2+ replicas a photo may 404 from another pod. Use Supabase storage for anything beyond a demo.

## Daily log

- Days 1–3: monorepo, schema, auth, deploy; Stripe + idempotent webhook.
- Days 4–6: LangGraph intake + documents, chat UI, React Query.
- 2026-10-19: Phases 4–12 on `feat/phase4-to-12`: analysis/fraud/triage graph, reviews + admin UI, ml-service, Langfuse/metrics, golden set + eval gate + judge, CI, Dockerfiles, Helm/k8s/monitoring, Slack bot, seed script. Found and fixed: unwired graph (node/channel name clash), a missing zod dependency, flash's 20/day quota (switched vision to flash-lite on eval evidence), and a wrong golden label.
- 2026-10-23: first live k3d deploy, rollback drill, DB-outage test, k6/HPA run and kube-prometheus-stack. Six bugs found and fixed (section above).
