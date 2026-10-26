# syntax=docker/dockerfile:1
# Build context: repo root.  Static SPA served by nginx.
#   docker build -f apps/web/Dockerfile --build-arg VITE_SUPABASE_URL=... -t claimpilot-web .
FROM node:22.18-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "web..."
COPY packages/shared packages/shared
COPY apps/web apps/web
# Vite inlines VITE_* at BUILD time (they're public by design: the anon key
# is meant for browsers). "/api" = same-origin behind the k8s ingress, so
# no CORS inside the cluster.
ARG VITE_API_URL=/api
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_API_URL=$VITE_API_URL VITE_SUPABASE_URL=$VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN pnpm --filter @claimpilot/shared build && pnpm --filter web build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
