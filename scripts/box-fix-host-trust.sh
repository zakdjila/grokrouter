#!/usr/bin/env bash
# Run inside a routed Grok Bot's shell tool:
#   curl -fsSL https://raw.githubusercontent.com/zakdjila/grokrouter/claude-agent-sdk-provider/scripts/box-fix-host-trust.sh | bash
# Refreshes the patcher, the 0.47.0 host manifest and the signed host registry
# from the fork, then re-applies the host adapter with `grokbot-router repair`.
set -euo pipefail
BASE="${GROKROUTER_BASE:-https://raw.githubusercontent.com/zakdjila/grokrouter/claude-agent-sdk-provider}"
R="${INSTALL_ROOT:-/home/box/sand-data/grokbot-router}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"
for f in patch/router_patch.py patch/manifests/0.47.0.json compatibility/0.47.0-hosts.json compatibility/0.47.0-hosts.json.sig; do
  mkdir -p "$TMP/$(dirname "$f")"
  curl -fsSL "$BASE/$f" -o "$TMP/$f"
done
python3 -m py_compile "$TMP/patch/router_patch.py"
python3 -c 'import json,sys; json.load(open(sys.argv[1])); json.load(open(sys.argv[2]))' "$TMP/patch/manifests/0.47.0.json" "$TMP/compatibility/0.47.0-hosts.json"
node "$R/bin/verify-host-registry.mjs" "$TMP/compatibility/0.47.0-hosts.json" "$TMP/compatibility/0.47.0-hosts.json.sig" "$R/compatibility/registry-public-key.pem" 0.47.0 >/dev/null
for f in patch/router_patch.py patch/manifests/0.47.0.json compatibility/0.47.0-hosts.json compatibility/0.47.0-hosts.json.sig; do
  cp -p "$R/$f" "$R/$f.bak-$STAMP" 2>/dev/null || true
  cp "$TMP/$f" "$R/$f"
done
rm -f "$R"/compatibility/*.grokrouter-trust.json /home/box/sand-host/*.grokrouter-trust.json /home/box/sand-data/grokbot-router-backup/*.grokrouter-trust.json 2>/dev/null || true
rm -rf "$TMP"
echo "GROKROUTER_TRUST_FILES_UPDATED $STAMP"
"$R/bin/grokbot-router" repair 2>&1 | tail -15
sleep 6
echo "GROKROUTER_MARKERS=$(grep -c GROKBOT_MODEL_ROUTER_V45 /home/box/sand-host/host-main.cjs || true)"
"$R/bin/grokbot-router" status 2>&1 | head -8
