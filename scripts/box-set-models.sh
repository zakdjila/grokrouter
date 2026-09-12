#!/bin/bash
# Run INSIDE the Bot computer (as user box). Updates the installed GrokRouter runtime so
# /model accepts short names, and loads the model list + aliases from runtime/models.custom.json.
#   curl -fsSL https://raw.githubusercontent.com/zakdjila/grokrouter/support-0.47.0/scripts/box-set-models.sh | bash
set -euo pipefail
BASE="https://raw.githubusercontent.com/zakdjila/grokrouter/support-0.47.0"
ROOT="/home/box/sand-data/grokbot-router"
[ -f "$ROOT/provider.json" ] || { echo "router config not found at $ROOT"; exit 1; }
TMP="$(mktemp -d)"
curl -fsSL "$BASE/runtime/run-provider.mjs" -o "$TMP/run-provider.mjs"
curl -fsSL "$BASE/runtime/models.custom.json" -o "$TMP/models.custom.json"
node --check "$TMP/run-provider.mjs"
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$TMP/models.custom.json"
grep -q "configuredAliases" "$TMP/run-provider.mjs" || { echo "downloaded runtime lacks alias support"; exit 1; }
STAMP="$(date +%Y%m%d-%H%M%S)"
cp "$ROOT/run-provider.mjs" "$ROOT/run-provider.mjs.bak-$STAMP"
cp "$ROOT/provider.json" "$ROOT/provider.json.bak-$STAMP"
cp "$TMP/run-provider.mjs" "$ROOT/run-provider.mjs"
python3 - "$ROOT/provider.json" "$TMP/models.custom.json" <<'PY'
import json, sys
cfg_path, custom_path = sys.argv[1], sys.argv[2]
cfg = json.load(open(cfg_path)); custom = json.load(open(custom_path))
# Every catalog key the file actually carries, so a provider added later is
# not silently left on whatever the installer shipped.
for key in ("openRouterModels", "openRouterAliases", "codexModels", "codexAliases",
            "claudeModels", "claudeAliases"):
    if key in custom:
        cfg[key] = custom[key]
json.dump(cfg, open(cfg_path, "w"), indent=2); open(cfg_path, "a").write("\n")
print("openrouter:", len(cfg.get("openRouterModels", [])), "models,", len(cfg.get("openRouterAliases", {})), "aliases")
print("claude:", len(cfg.get("claudeModels", [])), "models,", len(cfg.get("claudeAliases", {})), "aliases")
PY
echo "GROKROUTER_MODELS_UPDATED $STAMP"
