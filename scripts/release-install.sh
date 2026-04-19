#!/usr/bin/env bash
set -euo pipefail

DOWNLOAD_URL="${FLOW_RELEASE_DOWNLOAD_URL:-https://github.com/ddv1982/flow-opencode/releases/latest/download/flow.js}"

CANONICAL_PLUGIN_PATH="${HOME}/.config/opencode/plugins/flow.js"

mkdir -p "$(dirname "$CANONICAL_PLUGIN_PATH")"
curl -fsSL "$DOWNLOAD_URL" -o "$CANONICAL_PLUGIN_PATH"
echo "Flow installed to ${CANONICAL_PLUGIN_PATH}"
