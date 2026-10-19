# CLAIMPILOT — PROJECT STATE

> Paste this + `PROJECT_SPEC_Understand_insurance.md` into a new chat to resume with full context.

## Working agreement (how to teach me)

- I have intern/junior experience, targeting **senior** roles. Explain concepts (2–4 sentences) before code. Never just hand me working code.
- Define jargon on first use. Name the rejected alternative for any 2+ way decision.
- Flag "intern does X vs. senior does Y" distinctions.
- For every component I must be able to answer: **what breaks, how would I know, what would I do.**
- **Keep responses concise.** Work in small checkpoints — my attention drops on long messages.
- **Always specify the directory** for every command (e.g. `# run from: .../packages/db`).
- End each phase with 3–5 interview-style questions.
- I'm comfortable with TypeScript/React. New to NestJS, K8s, production agent systems.
- Goal: deep **backend + AI/agent** depth. That's the resume centerpiece — not UI polish.

## Deviations from the original spec (deliberate, recorded)

| Spec said | We chose | Why |
|---|---|---|
| Next.js | **Vite + React SPA** (+ React Router) | Spec used Next as a dumb client (`"use client"` everywhere, no server components/actions/API routes). That's a SPA in a costume. Deep Next.js is the *next* project. |
| Fastify adapter | **Express** (Nest default) | Learning focus is agent + architecture, not HTTP throughput. Broader docs/ecosystem. Nest's adapter abstraction made the swap a one-file change and reversible. |
| React Query from day one | **Plain `useEffect` + `useState`** for now | Deliberate: learn the problem before the solution. Hand-roll loading/error/cancelled state so React Query is a understood tradeoff, not magic. **Migrate in Phase 3** — see below. |

## Environment quirks (hard-won)

- Repo root: `/Users/yash/Desktop/Gen AI/claimpilot` — **contains a space**, quote paths.
- **Postgres port is 5433, not 5432.** A native Mac Postgres already binds `localhost:5432`; Docker binds `*:5432`, so localhost resolved to the *native* server. Diagnosed with `lsof -i :5432`. Container mapped `5433:5432`.
  - Debugging lesson worth keeping: *contradictory symptoms (container healthy AND empty, client hangs) → you're observing two different systems.*
- `DATABASE_URL=postgresql://claimpilot:localdev@localhost:5433/claimpilot`
- Two `.env` files (`packages/db/.env`, `apps/api/.env`) — each process loads env from its own cwd. Known drift risk; accepted for now.
- `dotenv` must be imported **first** in `drizzle.config.ts`. Nothing loads `.env` automatically.

## Stack as actually built

- **Monorepo:** pnpm workspaces. `apps/{web,api,ml-service}`, `packages/{db,shared}`. No Nx (build-graph caching doesn't earn its complexity at 5 packages).
- **API:** NestJS on **Express**. Modules: `DatabaseModule` (`@Global()`), `PoliciesModule`, `AuthGuard`. `@nestjs/config` loads env.
- **DB:** Postgres 16 (Docker), **Drizzle** ORM. Migrations committed as SQL files (never `drizzle-kit push`).
- **Auth:** Supabase Auth. `AuthGuard` implements `CanActivate`, validates JWT via `supabase.auth.getUser(token)`.
- **Web:** Vite + React (not yet scaffolded).

## Progress

### Phase 1 (Days 1–2) — COMPLETE ✅

Full chain live and verified over the public internet: Vercel (`claimpilot-web.vercel.app`) → Render API (`claimpilot-qdkx.onrender.com`) → Supabase Postgres. Auth guard enforcing; browser shows clean 401.

- [x] **1.1 Monorepo skeleton** — pnpm workspaces, `apps/*` + `packages/*` globs, `.nvmrc`, `packageManager` pin.
- [x] **1.2 DB schema + Drizzle migrations** — all core tables. `claim_events` append-only; `processed_webhook_events` uses `event_id` as PK so a duplicate insert = unique violation = atomic dedup. Money stored as **integer cents**. `agent_checkpoints` deliberately NOT hand-written — LangGraph's Postgres checkpointer owns it (Phase 3).
  - **TODO (deferred):** enforce append-only at the DB level — revoke UPDATE/DELETE on `claim_events` from the app role, or add a Postgres trigger. Currently only a convention.
- [x] **1.3 NestJS scaffolding** — Express bootstrap, domain modules, DI, Drizzle wrapped as a **factory provider** under a `DRIZZLE` symbol token, `@Global()`.
- [x] **1.4 Supabase Auth + guard** — `AuthGuard` on `GET /policies`, returns 401 without a token.
  - **Known tradeoff:** uses `supabase.auth.getUser(token)` (network round-trip). At scale: verify JWT signature locally with `SUPABASE_JWT_SECRET` + `jose`. Trades revocation freshness for latency.
  - **Not built yet:** `RolesGuard` (customer vs reviewer) — needed when `/admin` routes land (Phase 5).
- [x] **1.5 Docker Compose** — Postgres 16-alpine, named volume, healthcheck (`pg_isready`). Migrations applied; tables verified with `\dt`.
- [x] **1.6 Web scaffold** — Vite + React (TS), `react-router-dom`, `@supabase/supabase-js`. `lib/supabase.ts` + `lib/api.ts` (centralized `apiFetch` attaches `Authorization: Bearer <token>`). CORS enabled on API for `http://localhost:5173` (explicit origin, not `true`).
  - Data fetching: **plain `useEffect` + `useState`** with a `cancelled` flag in cleanup. No React Query yet (deliberate — see deviations).
  - Success signal: browser shows **`Error: 401 Unauthorized`** — proves Vite → CORS → Nest → AuthGuard chain works end to end.
  - `VITE_` prefix = exposed to the browser bundle. Anon key OK there (protected by RLS); Stripe/Gemini/service-role keys **never**.
- [x] **1.7 Deploy skeleton** — API live on Render, web live on Vercel, Supabase Postgres. 401 verified end-to-end over public internet.
- [ ] **Phase 1 interview questions** (owed to me).
- [ ] **Revisit 1.6** — user wants `useEffect` / cleanup / race conditions explained properly. **DO THIS NEXT.**

### CORS debugging lesson (Phase 1 close)
- A CORS failure shows in the browser as **"Failed to fetch"** — the request succeeds and the response returns, but the browser hides it from JS. Misreads as "server down."
- `WEB_ORIGIN` on Render must be the **stable production** Vercel URL (`claimpilot-web.vercel.app`), not the per-deploy **preview** URL (has a random hash, changes every deploy). CORS allow-lists point at stable origins.
- Origin = scheme + host, **no trailing slash, no path**. Must match byte-for-byte.
- `console.log` in `main.ts` prints to **Render logs (server)**, never the browser console — two runtimes, two log streams.
- If a debug log never prints, the new build isn't running: check Events tab for a deploy after the push; `git log origin/main -1` to confirm the push landed; Manual Deploy → Clear build cache to force it.

### Phase 1 hard-won lessons

- **Supabase connection modes are not interchangeable:**
  | Purpose | Port | Why |
  |---|---|---|
  | Migrations (drizzle-kit) | 5432 **session pooler** | advisory locks need session state |
  | App runtime (Render) | 6543 **transaction pooler** | many short-lived connections |

  Transaction mode releases the backend connection per-transaction, so Drizzle's migration advisory lock can never be held → **silent infinite hang**, not an error. True direct connection (`db.[ref].supabase.co`) is IPv6-only and unreachable from an IPv4 network (`ENOTFOUND`).
- **`packages/db` must emit `dist/` before `api` builds.** Nest's compiler won't compile `.ts` outside its `rootDir`, so pointing `main`/`types` at source works in dev (ts-node) and breaks in `nest build`. Added `packages/db/tsconfig.build.json` with `declaration: true`. Render build command: `pnpm install --frozen-lockfile && pnpm --filter @claimpilot/db build && pnpm --filter api build`
  - Lesson: local machine had stale `dist/` that CI didn't. "Works on my machine" = uncommitted or unbuilt state. Test with `rm -rf packages/db/dist` before trusting a build.
- **`ConfigService.getOrThrow()` paid off** — Render failed with `Configuration key "SUPABASE_URL" does not exist`, naming the exact key, instead of a cryptic error from Supabase internals. Fail fast, fail legibly.
- **Render binding:** must use `process.env.PORT` and `0.0.0.0`, else the platform health check never reaches the app.
- **Render free tier spins down after inactivity** (~30s cold start). Warm it before any demo.
- **Credential hygiene:** user pasted a live DB password into chat; rotated. Reflex to build now.

### TODO surfaced, not yet built

- **Sign-out button** — no way to log out currently. `supabase.auth.signOut()` + redirect to `/`. Also needed for testing multiple accounts. (Surfaced end of Phase 2.)
- **Auth → public.users sync** — DONE via Postgres trigger `on_auth_user_created` (mirrors `auth.users` → `public.users` with role `customer`). ⚠️ Trigger lives in the DB, not the repo — MUST be added to the seed/migration SQL (Phase 12) or a fresh DB silently breaks signup with a `23503` FK violation on `vehicles.owner_id`. Backfill for existing users: `insert into public.users (id,email,role) select id,email,'customer' from auth.users on conflict do nothing`.
- `/health` endpoint returning 200 — needed for k8s readiness probes (Phase 9), useful now.
- `WEB_ORIGIN` env var on Render, once the Vercel URL exists.
- Automate migrations in CI (Phase 8). Currently run by hand. "Who runs migrations, and when" is a real production question.
- `RolesGuard` (customer vs reviewer) — needed when `/admin` routes land (Phase 5).

### ⚠️ Scheduled migration: React Query in Phase 3

When building the claims chat (polling), **start** with `useEffect` + `setInterval`, feel the friction, then migrate to `@tanstack/react-query` (`refetchInterval` = polling in one line).

Why this can't be left to "wait for errors": hand-rolled polling fails **silently**, not loudly. Watch for:
- stale closures inside `setInterval` capturing old state
- intervals not cleaned up on unmount
- out-of-order responses (slow old request lands after fast new one, overwrites fresh data)
- the same loading/error/cancelled triplet copy-pasted across 3+ components

Claude should raise this proactively at Phase 3, not wait for the user to hit a bug.

### Phase 2 (Day 3) — COMPLETE ✅

Full purchase loop working end to end: create policy (`pending_payment`) → Stripe Checkout → webhook → signature verified → idempotent activation → `active`. Verified with test card 4242.

- [x] **2.1 Payment flow concept** — two channels: redirect (UX, untrusted) vs webhook (truth, server-to-server). Policy activated by webhook only. Stripe guarantees at-least-once delivery → handler must be idempotent.
- [x] **2.2 Seed plans + create policy** — `PLANS` config in `packages/shared` (config-in-code, not a DB table, for fixed plans). Zod validation pipe. Policy created BEFORE payment. `userId` from JWT never body; `premium` from config never client. Vehicle+policy inserts in a transaction (atomicity).
- [x] **2.3 Stripe Checkout session** — Stripe wrapped as a provider (`STRIPE` symbol, factory with `inject: [ConfigService]`). `metadata.policyId` threads session → webhook. Ownership check in WHERE clause (IDOR prevention). `unit_amount` from DB.
- [x] **2.4 Webhook + idempotency** — `rawBody: true` in main.ts (signature verifies over raw bytes). No AuthGuard (signature IS the auth). Insert-first dedup on `processed_webhook_events.event_id`; `23505` = duplicate, logged at `log` not `error`. Dedup + activation in ONE transaction.
- [x] **2.5 Frontend flow** — React Router, Login/Buy/PolicyDetail pages, `vercel.json` SPA rewrite, `apiPost` attaches bearer token, `justPaid` message papers over webhook lag.

### Phase 2 hard-won lessons

- **Drizzle wraps driver errors.** The Postgres error code (`23505`, `23503`) is on `err.cause.code`, NOT `err.code`. Catch must check both: `err?.code === "23505" || err?.cause?.code === "23505"`. Returning 500 to Stripe on a duplicate = Stripe retries for days.
- **Stripe CLI vs dashboard webhook secrets differ.** `stripe listen` prints its own `whsec_` for local; production uses the dashboard endpoint's secret.
- **`stripe events resend evt_xxx`** re-delivers the SAME event id — the idempotency test. `stripe trigger` makes NEW ids each time.
- **Local Docker DB vs Supabase are two databases.** API's `apps/api/.env` `DATABASE_URL` points at LOCAL Docker (5433). Running SQL in the Supabase dashboard fixed the WRONG database. (Third "two systems" trap — port collision, pooler modes, now this.)
- **Auth/user-table sync is env-specific:**
  - Supabase (deployed): trigger `on_auth_user_created` mirrors `auth.users` → `public.users`.
  - Local Docker (dev): NO `auth.users` schema, so trigger doesn't apply. Insert users into local `public.users` via seed script. Login (Supabase Auth) and data (local Postgres) are separate systems both claiming to own users.
- **Email confirmation off** for demo: Supabase → Auth → Providers → Email → "Confirm email" off, else `signUp()` returns no session → no token → 401.

### Decided: local dev uses Docker Postgres (Option A)

API points at local Docker (5433) for dev; Supabase is the deployed DB. Consequence: **seed script (Phase 12) MUST insert dev users into local `public.users`** matching logged-in Supabase Auth ids, or FKs on `owner_id`/`user_id` break.

### Phase 3 (Days 4–6) — COMPLETE ✅

LangGraph claims agent working end to end in the browser: type message → agent runs intake node → Gemini extracts fields → coverage validation → intake→documents transition → reply appears via polling, no refresh. Resume centerpiece, done.

- [x] **3.1 Concept** — agent as state machine (graph drives, LLM is a tool inside nodes). Checkpoint to Postgres so state survives restarts + scales horizontally. `thread_id` = conversation identity = checkpoint lookup key.
- [x] **3.2 State + skeleton** — `ClaimState` annotation (messages append via reducer, incident/documents merge, phase replaces). Checkpointer as `@Global` async factory provider. NOTE: this LangGraph version uses `value` (not `reducer`) for the reducer key.
- [x] **3.3 Intake node** — LLM behind provider-agnostic `LlmProvider` interface (`LLM` symbol, `useClass: GeminiProvider`). Extract → Zod-validate → merge → decide.
- [x] **3.4 Documents node + conditional edges** — `addConditionalEdges` routes on state. Coverage validation (business rejection → `phase: done`). Nodes take `AgentDeps`. "Ask user = return END, resume from checkpoint next message."
- [x] **3.5 Chat API** — `POST /claims`, `POST /claims/:id/messages`, `GET /claims/:id`. Hydrate documents from DB each run. `claim_events` written by SERVICE not nodes. Chat transcript = projection of append-only log.
- [x] **3.6 Frontend chat UI + React Query migration** — built polling by hand first (felt the pain), then migrated. `refetchInterval: 2000` replaced useEffect+setInterval+clearInterval+cancelled-flag. `invalidateQueries` for instant post-send refresh. THE scheduled migration from 1.6, done the honest way.

### Phase 3 hard-won lessons

- **Gemini model names churn constantly.** `gemini-1.5-flash` (404 retired), `gemini-2.0-flash` (429 `limit:0`), `gemini-2.5-flash` (404 "not available to new users"). Fixed with `gemini-flash-latest` (stable alias). Made it CONFIG: `GEMINI_MODEL` env var, not hardcoded — "hardcoded vs config" §7 lesson lived firsthand.
- **LLM output shape drifts.** Model returned `incident_date`; Zod schema expected `date` → safeParse failed → null fallback → agent asked again forever. Fix: pin exact key names in the prompt AND validate with Zod (belt + suspenders). The validation working is what surfaced the bug instead of garbage entering state.
- **Debug LLM issues by logging RAW output first.** `console.log` the raw completion before parsing — instantly showed extraction was fine and the bug was field-name mismatch, not the model.
- **`stripe listen` must run during local payment**, or the webhook never arrives and policy stays `pending_payment` → agent rejects claim on coverage. Prod doesn't need it (webhook registered to Render URL). Dev checklist: 3 terminals (API, stripe listen, web) before testing payments.
- **Coverage window is real:** manually flipping a policy to active sets `coverage_start=now()`, so a past incident date fails the window check. Test with an in-window incident date.
- **Circular import gotcha:** `CHECKPOINTER` symbol moved to its own `agent.tokens.ts` — module↔service circular import left it undefined at injection (`?` at index 0 in Nest error). Injection tokens (Symbols) must be VALUE imports, never `import type`.

### Phases 4–12 — BUILT on branch `feat/phase4-to-12` (2026-10-19) ✅

Full detail: `DECISIONS.md` (every choice + why). Summary:

- **4 Agent:** START router by `phase`; nodes intake → collect_documents → consistency (VLM ∥ ml-service, cross-check) → fraud_checks → triage_claim; followup (dispute ⇒ priority), reopen (more info ⇒ re-analysis), closed. Triage rules as data in `packages/shared/src/triage.ts`. Uploads endpoint (sha256, EXIF). Per-claim advisory lock. Append-only trigger. Assessment idempotent via runId PK.
- **5 Reviews:** `/admin` API + UI (queue, detail, decide, metrics), RolesGuard, overturn flag, FOR UPDATE double-decision guard, reconcile phase from claims.status.
- **6 ml-service:** FastAPI + YOLO11n detector (no licensed YOLOv8 detector exists, DECISIONS ⚠️). Port **8010** locally.
- **7 Observability + evals:** Langfuse tracer (no-op without keys), Prometheus on internal :9464, golden set (22 cases), record/replay eval gate, LLM-as-judge (4/4 pass).
- **8 CI:** `.github/workflows/ci.yml` (lint → typecheck → unit → int → eval gate → GHCR by SHA), `live-evals.yml`.
- **9–11:** raw manifests, Helm chart (HPA, PDB, probes, startupProbe, migrations hook, Traefik), kube-prometheus values + dashboard + alerts, k6, rollback drill script, Slack bot (Bolt custom receiver).
- **12:** `pnpm seed` (real graph via cassettes), DECISIONS.md, README.

### Not yet verified (do next)
- [ ] Run CI on GitHub (push branch, open PR) — workflow never executed.
- [ ] k3d live deploy + rollback drill + k6/HPA demo + kube-prometheus-stack (blocked 2026-10-19: Mac disk was 100% full).
- [ ] Build ml-service + web images locally (ml image ~2 GB; free disk first).
- [ ] Slack app in a real workspace (bot token, signing secret, `SLACK_REVIEWER_MAP`, interactivity URL → `/slack/events`).
- [ ] Langfuse cloud keys → see traces.
- [ ] Supabase: `SUPABASE_SERVICE_ROLE_KEY` + bucket `claim-documents` for STORAGE_DRIVER=supabase; run migrations 0001/0002 on Supabase (session pooler).
- [ ] Redeploy Render/Vercel (new env vars: GEMINI_VISION_MODEL, STORAGE_DRIVER, ML_SERVICE_URL…).
- [ ] Demo video. Phase 4–12 interview questions.

### Hard-won lessons (Phases 4–12)
- **LangGraph node names can't equal state channel names** (`documents`, `triage`) — the reason the old graph only wired intake.
- **Gemini free tier:** `gemini-flash-latest` = **20 requests/DAY**; flash-lite = 15/min. Latency 10–20s/call. ⇒ flash-lite for everything, chosen by eval; evals pace live calls; cassettes make CI independent of quota.
- **zsh:** `$m:generateContent` is a variable *modifier* (`:g`) — use `${m}`.
- **Port collisions again:** Docker Desktop holds `*:8000` → ml-service on 8010 (same trap as Postgres 5432).
- **pnpm honours `packageManager`** inside the repo (9.0.0) — the lockfile is pnpm 9's; don't bump casually.
- **`@nestjs/event-emitter` v12 is ESM-only** → breaks Jest/CJS; pinned v3.
- **Disk full ⇒ Docker hangs** (I/O errors, daemon unresponsive). A torch image build is ~2–3 GB. Check `df -h` before building ML images.
- **Evals found a wrong golden label** (left vs right headlight) — fix data, not the model.

## Concepts covered (don't re-teach unless asked)

Monorepo rationale · pnpm vs Nx (linking vs orchestration) · package manifests vs containers · append-only audit log · idempotency (Stripe webhooks, `__drizzle_migrations`) · integer cents · migrations vs `push` · NestJS modules · **dependency injection** (why it makes services unit-testable) · factory providers & symbol tokens · `@Global()` and its risk · authn vs authz · guards vs middleware · declarative vs imperative application · Docker named volumes · healthchecks → k8s readiness/liveness/startup probes · secret classification by blast radius · `useEffect` cleanup & the stale-response race · Vite `VITE_` prefix as a leak guard · CORS explicit origin

Also noted: HIPAA does **not** apply (motor insurance, no PHI). Would apply to the sprint-2 health vertical.

## DECISIONS.md backlog (write these up)

- Vite over Next.js
- Express over Fastify
- pnpm without Nx
- Drizzle over Prisma; migrations over `push`
- `getUser()` over local JWT verification
- Postgres on 5433 (port collision)
- Two `.env` files (accepted drift risk)
- Plain `useEffect` before React Query (learn the problem first; migrate at Phase 3)
- Explicit CORS origin over `origin: true`
- Session pooler (5432) for migrations, transaction pooler (6543) for app runtime
- `packages/db` builds to `dist/` before `api` compiles