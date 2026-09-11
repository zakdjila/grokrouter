#!/usr/bin/env bash
# Run inside the Grok Bot computer terminal. Downloads the fork payload and
# performs a read-only dry run of the 0.47.0 host adapter. Nothing is modified.
set -euo pipefail
TAG="grok-0.47.0-beta.47"
FILE="grokbot-router-payload-0.1.0-beta.47.tgz"
BASE="https://github.com/zakdjila/grokrouter/releases/download/$TAG"
cd /tmp && rm -rf grokbot-router-installer && mkdir -p grokbot-router-installer/payload && cd grokbot-router-installer
curl -sSL -o payload.tgz "$BASE/$FILE"
curl -sSL -o payload.tgz.sha256 "$BASE/$FILE.sha256"
expected="$(awk '{print $1}' payload.tgz.sha256)"; actual="$(sha256sum payload.tgz | awk '{print $1}')"
[[ "$expected" == "$actual" ]] || { echo "PAYLOAD SHA MISMATCH"; exit 1; }
tar -xzf payload.tgz -C payload --strip-components=1
echo "payload ok: $actual"
python3 payload/patch/router_patch.py --manifest payload/patch/manifests/0.47.0.json --inspect
echo "--- dry run"
python3 payload/patch/router_patch.py --manifest payload/patch/manifests/0.47.0.json --dry-run --json 2>&1 | tail -20
