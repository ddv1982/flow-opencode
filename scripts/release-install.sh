#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="${HOME}/.config/opencode/plugins"
PLUGIN_PATH="${PLUGIN_DIR}/flow.js"
DOWNLOAD_URL="${FLOW_RELEASE_DOWNLOAD_URL:-https://github.com/ddv1982/flow-opencode/releases/latest/download/flow.js}"

mkdir -p "$PLUGIN_DIR"
curl -fsSL "$DOWNLOAD_URL" -o "$PLUGIN_PATH"

echo "Flow installed to ${PLUGIN_PATH}"
