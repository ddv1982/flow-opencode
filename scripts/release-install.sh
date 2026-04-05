#!/usr/bin/env bash
set -euo pipefail

DOWNLOAD_URL="${FLOW_RELEASE_DOWNLOAD_URL:-https://github.com/ddv1982/flow-opencode/releases/latest/download/flow.js}"

PLUGIN_PATH="${HOME}/.opencode/plugins/flow.js"

mkdir -p "$(dirname "$PLUGIN_PATH")"
curl -fsSL "$DOWNLOAD_URL" -o "$PLUGIN_PATH"
echo "Flow installed to ${PLUGIN_PATH}"
