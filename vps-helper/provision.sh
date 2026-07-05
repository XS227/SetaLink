#!/usr/bin/env bash
# ReaLink VPS Helper — OPERATOR provisioning tool.
#
# Provisions a dedicated client UUID on a ReaLink exit node for one VPS, then
# emits (a) the base64 profile, (b) the one-line install command, and (c) a
# machine-readable JSON block so a future admin endpoint/app can wrap this with
# NO manual work. Also revokes.
#
# This is the reusable seam: the mobile app / admin panel will later call the
# same two operations (provision, revoke) behind an authenticated endpoint. The
# node-side identity model, profile format and install command are all defined
# here so that wrapper only has to shell out (or reimplement the same node call).
#
# Runs from any machine with SSH access to the node keys (this operator env, or
# later a backend host holding the node key).
#
#   Provision:  ./provision.sh --node finland --label f877790f
#   Revoke:     ./provision.sh --node finland --revoke --label f877790f
#   Custom ports: --socks 10808 --http 10809
#   JSON only (for admin wrapper): --json
#
# Node identities are namespaced 'vpsh-<label>' in the node access log so VPS
# Helper traffic is attributable and never collides with phone client tags.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
. "$HERE/nodes.env"

INSTALLER_URL="${REALINK_INSTALLER_URL:-https://setalink.no/download/vps-helper}"
NODE=finland LABEL="" ACTION=provision SOCKS=10808 HTTP=10809 JSON_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --node)   NODE="$2"; shift 2 ;;
    --label)  LABEL="$2"; shift 2 ;;
    --revoke) ACTION=revoke; shift ;;
    --socks)  SOCKS="$2"; shift 2 ;;
    --http)   HTTP="$2"; shift 2 ;;
    --json)   JSON_ONLY=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$LABEL" ] || { echo "--label <name> required" >&2; exit 2; }

up="$(printf '%s' "$NODE" | tr '[:lower:]' '[:upper:]')"
eval "SSH=\${${up}_SSH:-}"; eval "ADDR=\${${up}_ADDRESS:-}"; eval "PORT=\${${up}_PORT:-}"
eval "PBK=\${${up}_PBK:-}"; eval "SID=\${${up}_SID:-}"; eval "SNI=\${${up}_SNI:-}"
eval "FLOW=\${${up}_FLOW:-}"; eval "FP=\${${up}_FP:-chrome}"; eval "EXIT=\${${up}_EXIT:-}"
eval "CFG=\${${up}_CONFIG:-}"; eval "ITAG=\${${up}_INBOUND_TAG:-}"; eval "RESTART=\${${up}_RESTART:-}"
[ -n "$SSH" ] && [ -n "$ADDR" ] || { echo "unknown/unsupported node '$NODE'" >&2; exit 2; }
[ -n "$CFG" ] || { echo "node '$NODE' has no automated provisioning path (see nodes.env)" >&2; exit 2; }

EMAIL="vpsh-${LABEL}"
SSHO="-o StrictHostKeyChecking=no -o ConnectTimeout=15"

gen_uuid() {
  if command -v uuidgen >/dev/null 2>&1; then uuidgen | tr 'A-Z' 'a-z'
  else python3 -c 'import uuid;print(uuid.uuid4())'; fi
}

# Add/remove a client on the node's Reality inbound. Idempotent, backed up,
# config-tested before restart. Prints the effective UUID on provision.
node_apply() {   # $1=add|remove  $2=uuid(add)
  local mode="$1" uuid="${2:-}"
  # Ship the values as shell-safe assignments on stdin BEFORE the (quoted, so
  # unexpanded) remote script — avoids ssh arg-concatenation splitting values
  # that contain spaces (e.g. RESTART="systemctl restart xray").
  { printf 'MODE=%q\nEMAIL=%q\nUUID=%q\nFLOW=%q\nCFG=%q\nITAG=%q\nRESTART=%q\n' \
      "$mode" "$EMAIL" "$uuid" "$FLOW" "$CFG" "$ITAG" "$RESTART"
    cat <<'REMOTE'
set -euo pipefail
ts=$(date +%Y%m%d%H%M%S)
cp -a "$CFG" "${CFG}.bak-vpsh-$ts"
python3 - "$CFG" "$ITAG" "$EMAIL" "$UUID" "$FLOW" "$MODE" <<'PY'
import json,sys
cfg,itag,email,uuid,flow,mode=sys.argv[1:7]
c=json.load(open(cfg))
ib=next((i for i in c["inbounds"] if i.get("tag")==itag), None) \
   or next(i for i in c["inbounds"] if (i.get("streamSettings") or {}).get("realitySettings"))
cl=ib["settings"].setdefault("clients",[])
if mode=="add":
    cl[:]=[x for x in cl if x.get("email")!=email]      # replace if exists
    u={"id":uuid,"email":email}
    if flow: u["flow"]=flow
    cl.append(u)
elif mode=="remove":
    cl[:]=[x for x in cl if x.get("email")!=email]
json.dump(c,open(cfg,"w"),indent=2)
print("clients now:", [x.get("email") for x in cl])
PY
# validate then restart (fail closed: restore backup on bad config)
if command -v xray >/dev/null 2>&1; then XB=xray; else XB=/usr/local/bin/xray; fi
if ! XRAY_LOCATION_ASSET="$(dirname "$CFG")" "$XB" run -test -c "$CFG" >/dev/null 2>&1 \
   && ! "$XB" -test -c "$CFG" >/dev/null 2>&1; then
  echo "config test FAILED — restoring backup" >&2; cp -a "${CFG}.bak-vpsh-$ts" "$CFG"; exit 1
fi
eval "$RESTART"
sleep 1
echo "node updated ($MODE $EMAIL); backup ${CFG}.bak-vpsh-$ts"
REMOTE
  } | ssh $SSHO "$SSH" 'bash -s'
}

make_profile_b64() {   # $1=uuid
  local content
  content=$(cat <<EOF
RVH_TAG=$EMAIL
RVH_NODE=$NODE
RVH_UUID=$1
RVH_ADDRESS=$ADDR
RVH_PORT=$PORT
RVH_PBK=$PBK
RVH_SID=$SID
RVH_SNI=$SNI
RVH_FLOW=$FLOW
RVH_FP=$FP
RVH_SOCKS=$SOCKS
RVH_HTTP=$HTTP
RVH_EXIT=$EXIT
EOF
)
  printf '%s' "$content" | { base64 -w0 2>/dev/null || base64; }
}

if [ "$ACTION" = revoke ]; then
  node_apply remove >&2
  [ "$JSON_ONLY" = 1 ] && printf '{"revoked":"%s","node":"%s"}\n' "$EMAIL" "$NODE" \
                       || echo "Revoked $EMAIL on $NODE. The VPS should also run: bash realink-vps-helper.sh --uninstall"
  exit 0
fi

UUID="$(gen_uuid)"
node_apply add "$UUID" >&2
B64="$(make_profile_b64 "$UUID" | tr -d '\n')"
ONELINE="curl -fsSL $INSTALLER_URL | REALINK_PROFILE='$B64' sudo -E bash"

if [ "$JSON_ONLY" = 1 ]; then
  printf '{"label":"%s","email":"%s","node":"%s","uuid":"%s","exit_ip":"%s","profile_b64":"%s","install_oneliner":%s}\n' \
    "$LABEL" "$EMAIL" "$NODE" "$UUID" "$EXIT" "$B64" "$(printf '%s' "$ONELINE" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')"
  exit 0
fi

cat <<EOF

============================================================================
 ReaLink VPS Helper — provisioned  (node: $NODE · exit $EXIT · tag $EMAIL)
============================================================================

ONE-LINE INSTALL (run on the VPS, e.g. paste into the Termius SSH session):

$ONELINE

After it finishes:
  source /usr/local/realink-vps-helper/proxy.env
  claude        # now reaches api.anthropic.com via $NODE ($EXIT)

REVOKE later (operator):
  ./provision.sh --node $NODE --revoke --label $LABEL
  and on the VPS:  bash realink-vps-helper.sh --uninstall

Profile is a bearer secret (contains the node UUID). Treat the command like a
password; revoke if it leaks.
============================================================================
EOF
