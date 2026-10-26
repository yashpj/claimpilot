#!/usr/bin/env bash
# Deploy a specific commit. Locally: build, push to the k3d registry, helm.
# In a real env: images come from GHCR (pushed by CI) and only helm runs.
# Extra args go to helm, e.g.  infra/k8s/deploy.sh --set api.config.STORAGE_DRIVER=local
set -euo pipefail
NS=${NS:-claimpilot}
CLUSTER=${CLUSTER:-claimpilot}
TAG=${TAG:-$(git rev-parse HEAD)}
PUSH_REG=${PUSH_REG:-localhost:5050}            # as seen from this Mac
PULL_REG=${PULL_REG:-$CLUSTER-registry:5050}    # as seen from cluster nodes

if [[ "${BUILD:-1}" == "1" ]]; then
  docker build -f apps/api/Dockerfile -t "$PUSH_REG/claimpilot-api:$TAG" .
  docker build -f apps/web/Dockerfile -t "$PUSH_REG/claimpilot-web:$TAG" \
    --build-arg VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-}" --build-arg VITE_SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-}" .
  docker build -t "$PUSH_REG/claimpilot-ml-service:$TAG" apps/ml-service
  for app in api web ml-service; do docker push -q "$PUSH_REG/claimpilot-$app:$TAG"; done
fi

helm upgrade --install claimpilot infra/helm/claimpilot -n "$NS" \
  --set image.registry="$PULL_REG" \
  --set image.tag="$TAG" \
  --set monitoring.enabled="${MONITORING:-false}" \
  --wait --timeout 10m "$@"
kubectl -n "$NS" get pods,hpa,pdb
