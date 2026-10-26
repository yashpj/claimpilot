# syntax=docker/dockerfile:1
# Build context: repo root (the API depends on packages/db and packages/shared).
#   docker build -f apps/api/Dockerfile -t claimpilot-api .

FROM node:22.18-alpine AS base
RUN corepack enable
WORKDIR /repo

# ---- deps: only manifests, so this layer is cached until a lockfile changes ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "api..."

# ---- build: compile workspace packages first (api imports their dist/) ----
FROM deps AS build
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @claimpilot/shared build \
 && pnpm --filter @claimpilot/db build \
 && pnpm --filter api build
# Self-contained prod node_modules (+ built workspace deps) in /out.
RUN pnpm --filter api deploy --prod /out

# ---- runtime: no compiler, no dev deps, no pnpm, non-root ----
FROM node:22.18-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules node_modules
COPY --from=build /out/package.json package.json
COPY --from=build /repo/apps/api/dist dist
# Numeric UID (= the image's "node" user): k8s runAsNonRoot can only verify
# a number, and refuses to start a container whose USER is a name.
USER 1000
EXPOSE 3000
# exec form: node is PID 1 and receives SIGTERM directly (graceful shutdown).
CMD ["node", "dist/main.js"]
