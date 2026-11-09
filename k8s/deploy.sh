#!/usr/bin/env bash
# Rollt index.html nach simonhaus.benz-sw.de aus (ns simonhaus, Zugang über Ziti).
#   ./k8s/deploy.sh
set -euo pipefail
WURZEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$WURZEL"
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/new-cluster.yaml}"
NS=simonhaus

kubectl apply -f k8s/namespace.yaml -f k8s/certificate.yaml
kubectl -n "$NS" wait --for=condition=Ready certificate/simonhaus-le --timeout=300s

kubectl -n "$NS" create configmap simonhaus-seite --from-file=index.html \
  --dry-run=client -o yaml | kubectl apply -f -

PRUEF="$(cat index.html k8s/web.yaml | sha256sum | cut -c1-16)"
sed "s|pruefsumme/seite: PLATZHALTER|pruefsumme/seite: \"${PRUEF}\"|" k8s/web.yaml | kubectl apply -f -
kubectl -n "$NS" rollout status deploy/simonhaus-web --timeout=180s

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://simonhaus.benz-sw.de/ || echo 000)"
echo "https://simonhaus.benz-sw.de/ -> $code   (000 = Ziti-Dienst fehlt, siehe k8s/ziti-setup.sh)"
