#!/usr/bin/env bash
# EINMALIGE Anlage des Ziti-Dienstes "simonhaus" (intercept + host + Bind/Dial-Policies).
# Danach genügt k8s/deploy.sh für jede Aktualisierung.
#
#   ZITI_PW='…' ./k8s/ziti-setup.sh
#
# Das Skript ist idempotent: Was schon existiert, bleibt unangetastet.
#
# Ausgeführt wird im Pod ziti-active-exporter — der hat python3 und kommt an den
# Ziti-Controller. Vom Arbeitsrechner aus ginge es nicht: `ziti edge login`
# scheitert am OIDC-Ablauf, weil der Controller auf seinen advertised Host
# besteht.
#
# ACHTUNG zum Passwort: Das Kubernetes-Secret ziti-controller-admin-secret
# enthält ein VERALTETES Passwort und liefert 401. Das gültige steht in Anthonys
# Vault (openziti-overlay). Deshalb hier über die Umgebung, nicht aus dem Secret.
set -euo pipefail
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/new-cluster.yaml}"

: "${ZITI_PW:?ZITI_PW setzen — das Admin-Passwort des Ziti-Controllers}"

POD="$(kubectl -n monitoring get pods -o name | grep ziti-active-exporter | head -1 | cut -d/ -f2)"
[ -n "$POD" ] || { echo "ziti-active-exporter nicht gefunden." >&2; exit 1; }

SCRIPT="$HOME/Documents/Programmierung/NextCloud-Cluster/manifests/ziti_add_service.py"
[ -f "$SCRIPT" ] || { echo "Anlegeskript fehlt: $SCRIPT" >&2; exit 1; }

kubectl -n monitoring exec -i "$POD" -- env \
  ZITI_USER=admin ZITI_PW="$ZITI_PW" \
  SVC_NAME=simonhaus \
  SVC_ADDRESS=simonhaus.benz-sw.de \
  SVC_HOST=simonhaus-web.simonhaus.svc.cluster.local \
  SVC_PORT=443 \
  BIND_IDENTITY='KDHTBVzr.' \
  DIAL_ROLE='#simonhaus.clients' \
  GRANT_IDS='openziti-tony-arch,tony-handy,win-esko-anthony,anthony.benz,simon-pc' \
  python3 - < "$SCRIPT"

cat <<'HINWEIS'

Der Dienst ist angelegt. Der Tunneler auf diesem Rechner holt den neuen Namen von
selbst — ziti-dns-sync liest die abgefangenen Hostnamen direkt aus dem laufenden
Tunneler und setzt die Routing-Domains nach; der Timer heilt das auch dann, wenn
der Tunneler seine DNS-Einstellung zwischendurch überschreibt. Die Namensliste
muss also nicht mehr von Hand gepflegt werden.

Prüfen:  getent hosts simonhaus.benz-sw.de
  100.64.x.x     → Intercept greift, alles gut
  öffentliche IP → die Tunnelsitzung fehlt: sudo systemctl restart ziti-edge-tunnel
  gar nichts     → der Dienst ist noch nicht beim Tunneler angekommen, kurz warten
                   oder: sudo /usr/local/bin/ziti-dns-sync && resolvectl flush-caches
HINWEIS
