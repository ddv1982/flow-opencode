#!/usr/bin/env bash
set -euo pipefail

CANONICAL_PLUGIN_PATH="${HOME}/.config/opencode/plugins/flow.js"
LEGACY_PLUGIN_PATH="${HOME}/.opencode/plugins/flow.js"

if [[ -f "$CANONICAL_PLUGIN_PATH" ]]; then
  rm -f "$CANONICAL_PLUGIN_PATH"
  echo "Flow removed from ${CANONICAL_PLUGIN_PATH}"
fi

if [[ -f "$LEGACY_PLUGIN_PATH" ]]; then
  rm -f "$LEGACY_PLUGIN_PATH"
  echo "Flow removed from ${LEGACY_PLUGIN_PATH}"
fi
