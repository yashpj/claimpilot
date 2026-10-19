#!/usr/bin/env bash
# Local cluster: k3d (k3s in Docker) with Traefik + metrics-server built in.
# Port 8081 on the host -> Traefik :80 (8080/80 are often taken).
set -euo pipefail
CLUSTER=${CLUSTER:-claimpilot}
k3d cluster create "$CLUSTER" --agents 2 -p "8081:80@loadbalancer" --wait
kubectl config use-context "k3d-$CLUSTER"
kubectl create namespace claimpilot --dry-run=client -o yaml | kubectl apply -f -
echo "cluster ready. next: infra/k8s/create-secrets.sh && infra/k8s/deploy.sh"
