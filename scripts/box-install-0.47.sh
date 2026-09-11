#!/usr/bin/env bash
# Run inside the Grok Bot computer terminal after box-dryrun-0.47.sh passed.
# Installs the router runtime and applies the 0.47.0 host adapter (backup kept).
set -euo pipefail
cd /tmp/grokbot-router-installer
PROVIDER="${1:-openrouter}"
MODEL="${2:-anthropic/claude-sonnet-4.6}"
ROUTER_INSTALL_ATTEMPT=FORK047 bash payload/remote/install.sh --grok-version 0.47.0 --provider "$PROVIDER" --providers "$PROVIDER" --openrouter-model "$MODEL" 2>&1 | tail -40
