#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Install the Flow OpenCode plugin and generated project-local Flow skills.

Usage:
  install.sh [--project <path>] [--help]

Options:
  --project <path> Install generated Flow skills into this workspace (default: cwd)
  --help           Show this message
USAGE
}

FLOW_RELEASE_TAG="${FLOW_RELEASE_TAG:-__FLOW_RELEASE_TAG__}"
UNPINNED_RELEASE_TAG_SENTINEL="__FLOW_RELEASE_TAG_""_"
if [[ "$FLOW_RELEASE_TAG" == "$UNPINNED_RELEASE_TAG_SENTINEL" ]]; then
  DEFAULT_DOWNLOAD_URL="https://github.com/ddv1982/flow-opencode/releases/latest/download/flow.js"
  DEFAULT_SKILL_BUNDLE_URL="https://github.com/ddv1982/flow-opencode/releases/latest/download/flow-skills.tar.gz"
else
  DEFAULT_DOWNLOAD_URL="https://github.com/ddv1982/flow-opencode/releases/download/${FLOW_RELEASE_TAG}/flow.js"
  DEFAULT_SKILL_BUNDLE_URL="https://github.com/ddv1982/flow-opencode/releases/download/${FLOW_RELEASE_TAG}/flow-skills.tar.gz"
fi
DOWNLOAD_URL="${FLOW_RELEASE_DOWNLOAD_URL:-$DEFAULT_DOWNLOAD_URL}"
SKILL_BUNDLE_URL="${FLOW_RELEASE_SKILL_BUNDLE_URL:-$DEFAULT_SKILL_BUNDLE_URL}"

PROJECT_ROOT="$PWD"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --help)
      usage
      exit 0
      ;;
    --project)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "Missing value for --project" >&2
        usage >&2
        exit 1
      fi
      PROJECT_ROOT="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

mkdir -p "$PROJECT_ROOT"
PROJECT_ROOT="$(cd "$PROJECT_ROOT" && pwd)"

CANONICAL_PLUGIN_PATH="${HOME}/.config/opencode/plugins/flow.js"
FLOW_OWNERSHIP_HEADER='// Managed by flow-opencode install/uninstall'
FLOW_SKILL_MARKER='flow-opencode-generated-skill'
FLOW_SKILLS=(flow-plan flow-run flow-review)

skill_path() {
  printf '%s/.opencode/skills/%s/SKILL.md' "$PROJECT_ROOT" "$1"
}

is_intact_flow_skill() {
  local file="$1"
  local marker_line
  marker_line="$(grep -E -m 1 '^<!-- flow-opencode-generated-skill name=[a-z0-9]+(-[a-z0-9]+)* version=[0-9]+ hash=sha256:[a-f0-9]{64} -->$' "$file" || true)"
  if [[ -z "$marker_line" ]]; then
    return 1
  fi

  local expected_hash="${marker_line##*hash=sha256:}"
  expected_hash="${expected_hash% -->}"
  local payload_path
  payload_path="$(mktemp)"
  awk 'BEGIN { removed = 0 } /^<!-- flow-opencode-generated-skill name=[a-z0-9]+(-[a-z0-9]+)* version=[0-9]+ hash=sha256:[a-f0-9]{64} -->$/ && removed == 0 { removed = 1; next } { print }' "$file" > "$payload_path"
  local actual_hash
  actual_hash="$(shasum -a 256 "$payload_path" | awk '{print $1}')"
  rm -f "$payload_path"
  [[ "$actual_hash" == "$expected_hash" ]]
}

preflight_skill_install() {
  local skill file
  for skill in "${FLOW_SKILLS[@]}"; do
    file="$(skill_path "$skill")"
    if [[ -e "$file" ]] && ! is_intact_flow_skill "$file"; then
      echo "Refusing to overwrite user-managed OpenCode skill at ${file}." >&2
      exit 1
    fi
  done
}

mkdir -p "$(dirname "$CANONICAL_PLUGIN_PATH")"
download_path="$(mktemp "${CANONICAL_PLUGIN_PATH}.download.XXXXXX")"
managed_path="$(mktemp "${CANONICAL_PLUGIN_PATH}.managed.XXXXXX")"
skill_bundle_path="$(mktemp "${TMPDIR:-/tmp}/flow-skills.XXXXXX.tar.gz")"
cleanup() {
  rm -f "$download_path" "$managed_path" "$skill_bundle_path"
}
trap cleanup EXIT

curl -fsSL "$DOWNLOAD_URL" -o "$download_path"
curl -fsSL "$SKILL_BUNDLE_URL" -o "$skill_bundle_path"
tar -tzf "$skill_bundle_path" >/dev/null
preflight_skill_install

if head -n 1 "$download_path" | grep -Fq "$FLOW_OWNERSHIP_HEADER"; then
  mv "$download_path" "$CANONICAL_PLUGIN_PATH"
else
  {
    printf '%s\n' "$FLOW_OWNERSHIP_HEADER"
    cat "$download_path"
  } > "$managed_path"
  mv "$managed_path" "$CANONICAL_PLUGIN_PATH"
fi

tar -xzf "$skill_bundle_path" -C "$PROJECT_ROOT"
cleanup
trap - EXIT

echo "Flow installed to ${CANONICAL_PLUGIN_PATH}"
echo "Flow skills installed to ${PROJECT_ROOT}/.opencode/skills"
