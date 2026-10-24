#!/usr/bin/env bash
# Rolling update + rollback drill (spec day 18).
# 1. Ship a "release" whose api image can't start.
# 2. Watch: maxUnavailable=0 means old pods keep serving; the new pod never
#    becomes Ready, so the rollout stalls instead of taking the API down.
# 3. helm rollback to the last good revision.
set -euo pipefail
NS=${NS:-claimpilot}
CLUSTER=${CLUSTER:-claimpilot}
GOOD=$(helm -n "$NS" get values claimpilot -o json | python3 -c 'import json,sys; print(json.load(sys.stdin)["image"]["tag"])')
BAD="broken-$(date +%s)"
REG=${PUSH_REG:-localhost:5050}

docker build -f infra/k8s/broken/Dockerfile --build-arg BASE="$REG/claimpilot-api:$GOOD" -t "$REG/claimpilot-api:$BAD" .
# web/ml keep the good image: retag so the chart's single image.tag resolves
# (the registry stores the layers once; a retag costs nothing).
docker tag "$REG/claimpilot-web:$GOOD" "$REG/claimpilot-web:$BAD"
docker tag "$REG/claimpilot-ml-service:$GOOD" "$REG/claimpilot-ml-service:$BAD"
for app in api web ml-service; do docker push -q "$REG/claimpilot-$app:$BAD"; done

echo ">>> deploying broken release $BAD (migrations hook runs first and passes)"
helm upgrade claimpilot infra/helm/claimpilot -n "$NS" --reuse-values \
  --set image.tag="$BAD" --set migrations.enabled=false --timeout 90s --wait || echo ">>> upgrade failed as expected"

kubectl -n "$NS" get pods -l app.kubernetes.io/name=api
echo ">>> old pods are still Ready and serving:"
curl -s -o /dev/null -w "GET /api/health/ready -> %{http_code}\n" http://claimpilot.localhost:8081/api/health/ready || true

helm -n "$NS" history claimpilot | tail -3
echo ">>> rolling back"
helm -n "$NS" rollback claimpilot --wait
kubectl -n "$NS" rollout status deploy/api
kubectl -n "$NS" get pods -l app.kubernetes.io/name=api
