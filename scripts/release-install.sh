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
FLOW_OWNERSHIP_HEADER='// Managed by flow-opencode install/uninstall'

is_flow_managed_plugin() {
  local file="$1"
  head -n 1 "$file" | grep -Fq "$FLOW_OWNERSHIP_HEADER"
}

mkdir -p "$(dirname "$CANONICAL_PLUGIN_PATH")"
if [[ -f "$CANONICAL_PLUGIN_PATH" ]] && ! is_flow_managed_plugin "$CANONICAL_PLUGIN_PATH"; then
  echo "Refusing to overwrite existing non-Flow plugin at ${CANONICAL_PLUGIN_PATH}. Remove it manually first." >&2
  exit 1
fi

download_path="$(mktemp "${CANONICAL_PLUGIN_PATH}.download.XXXXXX")"
managed_path="$(mktemp "${CANONICAL_PLUGIN_PATH}.managed.XXXXXX")"
cleanup() {
  rm -f "$download_path" "$managed_path"
}
trap cleanup EXIT

curl -fsSL "$DOWNLOAD_URL" -o "$download_path"
if head -n 1 "$download_path" | grep -Fq "$FLOW_OWNERSHIP_HEADER"; then
  mv "$download_path" "$CANONICAL_PLUGIN_PATH"
else
  {
    printf '%s\n' "$FLOW_OWNERSHIP_HEADER"
    cat "$download_path"
  } > "$managed_path"
  mv "$managed_path" "$CANONICAL_PLUGIN_PATH"
fi
cleanup
trap - EXIT

echo "Flow installed to ${CANONICAL_PLUGIN_PATH}"
