#!/usr/bin/env bash
# Builds the two Secrets the chart expects from apps/api/.env, without ever
# writing a secret to a file in the repo.
set -euo pipefail
NS=${NS:-claimpilot}
ENV_FILE=${ENV_FILE:-apps/api/.env}
PG_PASSWORD=${PG_PASSWORD:-$(openssl rand -hex 16)}

kubectl -n "$NS" create secret generic claimpilot-postgres \
  --from-literal=POSTGRES_PASSWORD="$PG_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -

# Everything from .env, but DATABASE_URL points at the in-cluster Postgres.
grep -v '^\s*#' "$ENV_FILE" | grep -v '^\s*$' | grep -v '^DATABASE_URL=' > /tmp/cp-env.$$
echo "DATABASE_URL=postgresql://claimpilot:${PG_PASSWORD}@postgres:5432/claimpilot" >> /tmp/cp-env.$$
kubectl -n "$NS" create secret generic claimpilot-api --from-env-file=/tmp/cp-env.$$ \
  --dry-run=client -o yaml | kubectl apply -f -
rm -f /tmp/cp-env.$$
echo "secrets created in $NS"
