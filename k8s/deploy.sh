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

# index.html + haus3d.js > 256 KB: clientseitiges apply scheitert an der Annotation last-applied-configuration
kubectl -n "$NS" create configmap simonhaus-seite --from-file=index.html --from-file=haus3d.js \
  --dry-run=client -o yaml | kubectl apply --server-side --force-conflicts -f -

PRUEF="$(cat index.html haus3d.js k8s/web.yaml | sha256sum | cut -c1-16)"
sed "s|pruefsumme/seite: PLATZHALTER|pruefsumme/seite: \"${PRUEF}\"|" k8s/web.yaml | kubectl apply -f -
kubectl -n "$NS" rollout status deploy/simonhaus-web --timeout=180s

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://simonhaus.benz-sw.de/ || echo 000)"
echo "https://simonhaus.benz-sw.de/ -> $code   (000 = Ziti-Dienst fehlt, siehe k8s/ziti-setup.sh)"
js="$(curl -s -o /dev/null -w '%{http_code} %{content_type}' --max-time 15 https://simonhaus.benz-sw.de/haus3d.js || echo 000)"
echo "https://simonhaus.benz-sw.de/haus3d.js -> $js   (erwartet: 200 application/javascript)"
case "$js" in
  "200 application/javascript"*) ;;
  *) echo "FEHLER: haus3d.js wird nicht als JavaScript ausgeliefert – Ansicht „Echt“ fiele aus." >&2; exit 1 ;;
esac
