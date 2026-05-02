#!/usr/bin/env bash
set -euo pipefail

CANONICAL_PLUGIN_PATH="${HOME}/.config/opencode/plugins/flow.js"

if [[ -f "$CANONICAL_PLUGIN_PATH" ]]; then
  rm -f "$CANONICAL_PLUGIN_PATH"
  echo "Flow removed from ${CANONICAL_PLUGIN_PATH}"
else
  echo "Flow uninstall complete: no plugin found at ${CANONICAL_PLUGIN_PATH}"
fi
