#!/usr/bin/env bash
set -euo pipefail

DOWNLOAD_URL="${FLOW_RELEASE_DOWNLOAD_URL:-https://github.com/ddv1982/flow-opencode/releases/latest/download/flow.js}"

CANONICAL_PLUGIN_PATH="${HOME}/.config/opencode/plugins/flow.js"
LEGACY_PLUGIN_PATH="${HOME}/.opencode/plugins/flow.js"
PLUGIN_PATH="$CANONICAL_PLUGIN_PATH"

if [[ -f "$LEGACY_PLUGIN_PATH" ]]; then
  PLUGIN_PATH="$LEGACY_PLUGIN_PATH"
fi

mkdir -p "$(dirname "$PLUGIN_PATH")"
curl -fsSL "$DOWNLOAD_URL" -o "$PLUGIN_PATH"
echo "Flow installed to ${PLUGIN_PATH}"
