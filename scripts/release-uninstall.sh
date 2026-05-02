#!/usr/bin/env bash
set -euo pipefail

CANONICAL_PLUGIN_PATH="${HOME}/.config/opencode/plugins/flow.js"
FLOW_OWNERSHIP_HEADER='// Managed by flow-opencode install/uninstall'

is_flow_managed_plugin() {
  local file="$1"
  head -n 1 "$file" | grep -Fq "$FLOW_OWNERSHIP_HEADER"
}

if [[ -f "$CANONICAL_PLUGIN_PATH" ]]; then
  if ! is_flow_managed_plugin "$CANONICAL_PLUGIN_PATH"; then
    echo "Refusing to remove unowned plugin at ${CANONICAL_PLUGIN_PATH}." >&2
    exit 1
  fi
  rm -f "$CANONICAL_PLUGIN_PATH"
  echo "Flow removed from ${CANONICAL_PLUGIN_PATH}"
else
  echo "Flow uninstall complete: no plugin found at ${CANONICAL_PLUGIN_PATH}"
fi
