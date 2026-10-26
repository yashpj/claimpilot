#!/usr/bin/env bash
# Builds the two Secrets the chart expects from apps/api/.env, without ever
# writing a secret to a file in the repo.
set -euo pipefail
NS=${NS:-claimpilot}
ENV_FILE=${ENV_FILE:-apps/api/.env}
# Reuse the existing password: Postgres only reads POSTGRES_PASSWORD when its
# volume is first initialised, so rotating it here would lock the API out.
EXISTING=$(kubectl -n "$NS" get secret claimpilot-postgres -o jsonpath='{.data.POSTGRES_PASSWORD}' 2>/dev/null | base64 -d || true)
PG_PASSWORD=${PG_PASSWORD:-${EXISTING:-$(openssl rand -hex 16)}}

kubectl -n "$NS" create secret generic claimpilot-postgres \
  --from-literal=POSTGRES_PASSWORD="$PG_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -

# Everything from .env, but DATABASE_URL points at the in-cluster Postgres.
# Non-secret config (the chart's ConfigMap) is skipped: the pod loads the
# Secret after the ConfigMap, so a laptop value like WEB_ORIGIN=localhost
# would silently override the cluster's.
CONFIG_KEYS='^(DATABASE_URL|WEB_ORIGIN|STORAGE_DRIVER|LOCAL_STORAGE_DIR|GEMINI_MODEL|GEMINI_VISION_MODEL|ML_SERVICE_URL|METRICS_PORT|DB_POOL_MAX|PORT)='
grep -v '^\s*#' "$ENV_FILE" | grep -v '^\s*$' | grep -Ev "$CONFIG_KEYS" > /tmp/cp-env.$$
echo "DATABASE_URL=postgresql://claimpilot:${PG_PASSWORD}@postgres:5432/claimpilot" >> /tmp/cp-env.$$
kubectl -n "$NS" create secret generic claimpilot-api --from-env-file=/tmp/cp-env.$$ \
  --dry-run=client -o yaml | kubectl apply -f -
rm -f /tmp/cp-env.$$
echo "secrets created in $NS"
