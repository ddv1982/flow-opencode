#!/usr/bin/env bash
set -euo pipefail

CANONICAL_PLUGIN_PATH="${HOME}/.config/opencode/plugins/flow.js"
LEGACY_PLUGIN_PATH="${HOME}/.opencode/plugins/flow.js"
removed_any=0

if [[ -f "$CANONICAL_PLUGIN_PATH" ]]; then
  rm -f "$CANONICAL_PLUGIN_PATH"
  echo "Flow removed from ${CANONICAL_PLUGIN_PATH}"
  removed_any=1
fi

if [[ -f "$LEGACY_PLUGIN_PATH" ]]; then
  rm -f "$LEGACY_PLUGIN_PATH"
  echo "Flow removed from ${LEGACY_PLUGIN_PATH}"
  removed_any=1
fi

if [[ "$removed_any" -eq 0 ]]; then
  echo "Flow uninstall complete: no plugin found at ${CANONICAL_PLUGIN_PATH} or ${LEGACY_PLUGIN_PATH}"
fi
