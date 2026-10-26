#!/usr/bin/env bash
# Local cluster: k3d (k3s in Docker) with Traefik + metrics-server built in.
#  - host :8081 -> Traefik :80 (8080/80 are often taken)
#  - a local registry on host :5050. Images are pushed there ONCE and each
#    node pulls only what its pods need. `k3d image import` instead copies
#    every image into every node: with the ~2.5 GB ml image that filled
#    Docker's disk and hung the daemon.
#  - 1 server + 1 agent: enough to see pods spread, HPA and PDBs.
set -euo pipefail
CLUSTER=${CLUSTER:-claimpilot}
REGISTRY_PORT=${REGISTRY_PORT:-5050}
k3d cluster create "$CLUSTER" --agents 1 -p "8081:80@loadbalancer" \
  --registry-create "$CLUSTER-registry:0.0.0.0:$REGISTRY_PORT" --wait
kubectl config use-context "k3d-$CLUSTER"
kubectl create namespace claimpilot --dry-run=client -o yaml | kubectl apply -f -
echo "cluster ready. next: infra/k8s/create-secrets.sh && infra/k8s/deploy.sh"
