# ClaimPilot — Spec (minimal)

Motor-insurance platform where an AI agent **triages** claims for human reviewers.
It never auto-approves or auto-denies. Full spec: `PROJECT_SPEC_insurance.md` (outside the repo). Deviations: `DECISIONS.md`.

## Users
- **Customer**: buys a policy and files a claim by chatting with the agent.
- **Reviewer**: works the review queue in `/admin` or in Slack, and approves, denies or asks for more info.

## Core flows
1. **Buy**: vehicle details → choose 1 of 3 plans → Stripe Checkout (test mode) → a signed webhook activates the policy. The webhook is idempotent (`processed_webhook_events`).
2. **File a claim (FNOL)** — LangGraph agent, checkpointed to Postgres:
   `intake` (date, location, description, estimated amount; checks the coverage window)
   → `documents` (damage photos + license + registration; VLM extracts fields)
   → `consistency` (VLM verdict + YOLOv8 ml-service, cross-checked)
   → `fraud` (sha256 duplicate, EXIF date gap, stock/screenshot)
   → `triage` (explicit rules from config → `priority` or `standard`, plus an advisory recommendation).
   If the VLM or ML call fails, the claim never blocks. It goes to review with `analysis_incomplete`.
3. **Review**: reviewer decides in `/admin` or in Slack → `reviews` row (with an overturn flag) → claim status changes → the customer is told in chat.

## Non-negotiables
- `claim_events` is append-only (a DB trigger blocks UPDATE and DELETE).
- Zod on every API input and every LLM output.
- Triage rules are data (`triage.config.ts`), not prose in a prompt.
- Cost (tokens → micro-USD) and latency are recorded per assessment.
- Evals run in CI. A drop below `evals/baseline.json` fails the build.

## Components
| Path | What |
|---|---|
| `apps/web` | Vite + React SPA, React Query, polling chat, `/admin` |
| `apps/api` | NestJS: Policies, Claims, Agent, Reviews, Slack, Metrics |
| `apps/ml-service` | FastAPI + YOLOv8 damage detection |
| `packages/db` | Drizzle schema + SQL migrations |
| `packages/shared` | Plans, Zod schemas, triage config |
| `evals/` | Golden set, eval runner, LLM-as-judge |
| `infra/` | Dockerfiles, raw k8s, Helm chart, monitoring, k6 |

## Metrics
Overturn rate (primary), escalation rate, time to resolution, LLM cost per claim, claims funnel, API latency and error rate.

## Out of scope
RAG over policy docs, auto-approval, email/queues, health vertical, i18n, GitOps, service mesh.
