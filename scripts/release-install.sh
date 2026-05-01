#!/usr/bin/env bash
set -euo pipefail

FLOW_RELEASE_TAG="${FLOW_RELEASE_TAG:-__FLOW_RELEASE_TAG__}"
UNPINNED_RELEASE_TAG_SENTINEL="__FLOW_RELEASE_TAG_""_"
if [[ "$FLOW_RELEASE_TAG" == "$UNPINNED_RELEASE_TAG_SENTINEL" ]]; then
  DEFAULT_DOWNLOAD_URL="https://github.com/ddv1982/flow-opencode/releases/latest/download/flow.js"
else
  DEFAULT_DOWNLOAD_URL="https://github.com/ddv1982/flow-opencode/releases/download/${FLOW_RELEASE_TAG}/flow.js"
fi
DOWNLOAD_URL="${FLOW_RELEASE_DOWNLOAD_URL:-$DEFAULT_DOWNLOAD_URL}"

CANONICAL_PLUGIN_PATH="${HOME}/.config/opencode/plugins/flow.js"

mkdir -p "$(dirname "$CANONICAL_PLUGIN_PATH")"
curl -fsSL "$DOWNLOAD_URL" -o "$CANONICAL_PLUGIN_PATH"
echo "Flow installed to ${CANONICAL_PLUGIN_PATH}"
