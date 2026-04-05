#!/usr/bin/env bash
set -euo pipefail

PLUGIN_PATH="${HOME}/.opencode/plugins/flow.js"

rm -f "$PLUGIN_PATH"
echo "Flow removed from ${PLUGIN_PATH}"
