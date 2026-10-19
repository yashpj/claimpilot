#!/usr/bin/env bash
# Deploy a specific commit. Locally: build images, import them into k3d.
# In a real env: images come from GHCR (pushed by CI) and only helm runs.
set -euo pipefail
NS=${NS:-claimpilot}
CLUSTER=${CLUSTER:-claimpilot}
TAG=${TAG:-$(git rev-parse HEAD)}
REG=ghcr.io/yashpj

if [[ "${BUILD:-1}" == "1" ]]; then
  docker build -f apps/api/Dockerfile -t "$REG/claimpilot-api:$TAG" .
  docker build -f apps/web/Dockerfile -t "$REG/claimpilot-web:$TAG" \
    --build-arg VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-}" --build-arg VITE_SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-}" .
  docker build -t "$REG/claimpilot-ml-service:$TAG" apps/ml-service
  k3d image import -c "$CLUSTER" "$REG/claimpilot-api:$TAG" "$REG/claimpilot-web:$TAG" "$REG/claimpilot-ml-service:$TAG"
fi

helm upgrade --install claimpilot infra/helm/claimpilot -n "$NS" \
  --set image.tag="$TAG" \
  --set monitoring.enabled="${MONITORING:-false}" \
  --wait --timeout 10m
kubectl -n "$NS" get pods,hpa,pdb
