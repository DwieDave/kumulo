#!/usr/bin/env bash
# M0 — does an MKS Service adopt a load balancer the CCM did not create?
#
# Answers Q1–Q4 and either confirms or invalidates D2, the assumption under
# R9–R16: that kumulo can own an Octavia LB's lifecycle while the
# cloud-controller-manager owns its listeners, pools and members.
#
# A negative result means R9–R16 need rework, not a release.
#
# Requires: an MKS cluster >= 1.31, a kubeconfig for it, and OpenStack
# credentials for the SAME project (OS_AUTH_URL, OS_USERNAME/OS_PASSWORD or
# OS_APPLICATION_CREDENTIAL_*, OS_PROJECT_NAME, OS_REGION_NAME). Needs the
# `openstack` CLI and `kubectl`.
#
# Creates one Octavia LB and one Service. Cleans both up unless KEEP=1.
set -euo pipefail

NS="${NS:-kumulo-m0}"
LB_NAME="${LB_NAME:-kumulo-m0-spike}"
SUBNET="${SUBNET:?set SUBNET to the load-balancer subnet id of the cluster}"

_note() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
_verdict() { printf '\033[1m%-12s %s\033[0m\n' "$1" "$2"; }

cleanup() {
  [[ "${KEEP:-0}" == "1" ]] && { echo "KEEP=1, leaving ns/$NS and LB $LB_NAME"; return; }
  kubectl delete ns "$NS" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  openstack loadbalancer delete "$LB_NAME" --cascade >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ---------------------------------------------------------------- T0.4 + T0.3
_note "T0.4 — Octavia tag support (upstream gates shared-LB on it)"
if openstack loadbalancer list --tags kumulo-m0-probe >/dev/null 2>&1; then
  _verdict "Q3 TAGS:" "supported"
else
  _verdict "Q3 TAGS:" "NOT supported — upstream shared-LB may be unavailable"
fi

_note "T0.3 — flavor vocabulary this project actually accepts"
openstack loadbalancer flavor list 2>/dev/null || echo "(no flavors listed — MKS Free likely sizes via loadbalancer.ovhcloud.com/flavor instead)"
echo "^ Q1: if these are UUIDs, ingress.flavor_id fits; if names, ingress.flavor does."

# ------------------------------------------------------------------ T0.1 prep
_note "T0.1 — create an LB the CCM did NOT create"
openstack loadbalancer create --name "$LB_NAME" --vip-subnet-id "$SUBNET" -f value -c id >/tmp/m0-lb-id
LB_ID="$(cat /tmp/m0-lb-id)"
echo "LB_ID=$LB_ID"
until [[ "$(openstack loadbalancer show "$LB_ID" -f value -c provisioning_status)" == "ACTIVE" ]]; do
  echo "  waiting for ACTIVE..."; sleep 10
done

BEFORE_LISTENERS="$(openstack loadbalancer listener list --loadbalancer "$LB_ID" -f value -c id | wc -l | tr -d ' ')"
BEFORE_LBS="$(openstack loadbalancer list -f value -c id | wc -l | tr -d ' ')"

# ----------------------------------------------------------------- T0.1 adopt
_note "T0.1 — a Service adopts it by id"
kubectl create ns "$NS" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "$NS" apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: m0-adopt
  annotations:
    loadbalancer.openstack.org/load-balancer-id: "$LB_ID"
spec:
  type: LoadBalancer
  selector: { app: m0-none }
  ports: [{ name: http, port: 80, targetPort: 8080 }]
EOF

echo "waiting up to 5m for the CCM to act..."
for _ in $(seq 1 30); do
  EXTERNAL="$(kubectl -n "$NS" get svc m0-adopt -o jsonpath='{.status.loadBalancer.ingress[0].ip}{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
  [[ -n "$EXTERNAL" ]] && break
  sleep 10
done

AFTER_LISTENERS="$(openstack loadbalancer listener list --loadbalancer "$LB_ID" -f value -c id | wc -l | tr -d ' ')"
AFTER_LBS="$(openstack loadbalancer list -f value -c id | wc -l | tr -d ' ')"

_note "T0.1 RESULT"
echo "listeners on our LB: $BEFORE_LISTENERS -> $AFTER_LISTENERS"
echo "total LBs in project: $BEFORE_LBS -> $AFTER_LBS"
echo "Service EXTERNAL-IP: ${EXTERNAL:-<none>}"
kubectl -n "$NS" describe svc m0-adopt | tail -20

if [[ "$AFTER_LISTENERS" -gt "$BEFORE_LISTENERS" && "$AFTER_LBS" -eq "$BEFORE_LBS" ]]; then
  _verdict "Q4/D2:" "CONFIRMED — the CCM attached listeners to our LB, made no new one"
elif [[ "$AFTER_LBS" -gt "$BEFORE_LBS" ]]; then
  _verdict "Q4/D2:" "INVALIDATED — the CCM provisioned a SECOND LB; adoption ignored"
else
  _verdict "Q4/D2:" "INCONCLUSIVE — no listeners and no new LB; read the describe output above"
fi

# ------------------------------------------------------------------ T0.2
_note "T0.2 — deleting the Service must leave the LB alive"
kubectl -n "$NS" delete svc m0-adopt --wait=true
sleep 20
if openstack loadbalancer show "$LB_ID" -f value -c id >/dev/null 2>&1; then
  _verdict "R14:" "CONFIRMED — externally-created LB survived Service deletion"
else
  _verdict "R14:" "INVALIDATED — the CCM deleted an LB it did not create"
fi

_note "Record these verdicts in memories.md and fold them into requirements.md"
