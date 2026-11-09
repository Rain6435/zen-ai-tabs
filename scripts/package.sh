#!/usr/bin/env bash
# Builds dist/zen-ai-tabs.xpi (zip with manifest.json at root). Self-distribution: sign via AMO unlisted or about:debugging for dev only.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
rm -f dist/zen-ai-tabs.xpi
zip -r -X -q dist/zen-ai-tabs.xpi manifest.json src -x '*.DS_Store'
node -e 'JSON.parse(require("fs").readFileSync("manifest.json","utf8"))' && echo "built dist/zen-ai-tabs.xpi"
