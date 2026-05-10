#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Remove the Flow OpenCode plugin and intact generated global Flow skills.

Usage:
  uninstall.sh [--help]

Options:
  --help           Show this message
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

CANONICAL_PLUGIN_PATH="${HOME}/.config/opencode/plugins/flow.js"
FLOW_SKILLS=(flow-plan flow-run flow-review)

skill_path() {
  printf '%s/.config/opencode/skills/%s/SKILL.md' "$HOME" "$1"
}

has_flow_generated_skill_marker() {
  local file="$1"
  grep -E -q '^<!-- flow-opencode-generated-skill name=[a-z0-9]+(-[a-z0-9]+)* version=[0-9]+ hash=sha256:[a-f0-9]{64} -->$' "$file"
}

is_intact_flow_skill() {
  local file="$1"
  local expected_name="$2"
  local marker_line
  marker_line="$(grep -E -m 1 "^<!-- flow-opencode-generated-skill name=${expected_name} version=[0-9]+ hash=sha256:[a-f0-9]{64} -->$" "$file" || true)"
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

preflight_skill_uninstall() {
  local skill file
  for skill in "${FLOW_SKILLS[@]}"; do
    file="$(skill_path "$skill")"
    if [[ -e "$file" ]] && has_flow_generated_skill_marker "$file" && ! is_intact_flow_skill "$file" "$skill"; then
      echo "Refusing to remove user-edited OpenCode skill at ${file}." >&2
      exit 1
    fi
  done
}

remove_empty_dir() {
  rmdir "$1" 2>/dev/null || true
}

preflight_skill_uninstall

if [[ -f "$CANONICAL_PLUGIN_PATH" ]]; then
  rm -f "$CANONICAL_PLUGIN_PATH"
  echo "Flow removed from ${CANONICAL_PLUGIN_PATH}"
else
  echo "Flow uninstall complete: no plugin found at ${CANONICAL_PLUGIN_PATH}"
fi

removed_skills=0
for skill in "${FLOW_SKILLS[@]}"; do
  file="$(skill_path "$skill")"
  if [[ -f "$file" ]] && is_intact_flow_skill "$file" "$skill"; then
    rm -f "$file"
    remove_empty_dir "$(dirname "$file")"
    removed_skills=1
  fi
done
remove_empty_dir "${HOME}/.config/opencode/skills"
remove_empty_dir "${HOME}/.config/opencode"

if [[ "$removed_skills" == "1" ]]; then
  echo "Flow skills removed from ${HOME}/.config/opencode/skills"
fi
