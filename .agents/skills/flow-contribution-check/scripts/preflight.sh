#!/usr/bin/env bash
set -euo pipefail

mode="${1:-commit}"
case "$mode" in
  commit|push) ;;
  *)
    echo "usage: $0 [commit|push]" >&2
    exit 2
    ;;
esac

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

tmp_root=""
cleanup() {
  if [[ -n "${tmp_root:-}" ]]; then
    rm -rf -- "$tmp_root"
  fi
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

log() { printf '\n==> %s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

ensure_tmp_root() {
  if [[ -z "$tmp_root" ]]; then
    tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/flow-preflight.XXXXXX")"
  fi
}

scan_staged_index_blobs() {
  if ! command -v gitleaks >/dev/null 2>&1; then
    echo "gitleaks not installed; skipping optional staged secret scan."
    return
  fi
  local files snapshot
  ensure_tmp_root
  files="$tmp_root/staged-files.z"
  snapshot="$tmp_root/staged-index"
  git diff --cached --name-only --diff-filter=d -z -- > "$files"
  if [[ ! -s "$files" ]]; then
    echo "No non-deleted staged index blobs to scan."
    return
  fi
  mkdir -p "$snapshot"
  git checkout-index --stdin -z --prefix="$snapshot/" < "$files"
  gitleaks dir --no-banner --redact "$snapshot"
}

require_clean_worktree() {
  local status_file
  ensure_tmp_root
  status_file="$tmp_root/status.z"
  git status --porcelain=v1 -z --untracked-files=all > "$status_file"
  if [[ -s "$status_file" ]]; then
    git status --short
    fail "working tree is not clean; commit, stash, or discard changes before pushing"
  fi
}

resolve_outgoing_base() {
  current_branch="$(git symbolic-ref --quiet --short HEAD)" \
    || fail "push mode requires a current branch; detached HEAD is not supported"
  if upstream_ref="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)" \
    && git rev-parse --verify --quiet "${upstream_ref}^{commit}" >/dev/null; then
    base_ref="$upstream_ref"
    base_reason="configured upstream"
  elif [[ "$current_branch" != "main" ]] \
    && git rev-parse --verify --quiet 'refs/remotes/origin/main^{commit}' >/dev/null; then
    base_ref="refs/remotes/origin/main"
    base_reason="origin/main fallback for a current branch without configured upstream"
  else
    fail "cannot determine outgoing base for '$current_branch'; configure its upstream or fetch origin/main for a non-main topic branch"
  fi
  range_spec="$base_ref..HEAD"
}

write_range_files() {
  local output="$1"
  git diff --name-only -z "$base_ref"...HEAD -- > "$output"
}

range_contains() {
  local files="$1"
  local pattern="$2"
  local file
  while IFS= read -r -d '' file; do
    if [[ "$file" =~ $pattern ]]; then
      return 0
    fi
  done < "$files"
  return 1
}

scan_outgoing_range() {
  if ! command -v gitleaks >/dev/null 2>&1; then
    echo "gitleaks not installed; skipping optional outgoing secret scan."
    return
  fi
  gitleaks git --no-banner --redact --log-opts="$range_spec" .
}

require_tool() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required tool '$1'"
}

require_tool git
require_tool bun

log "Check whitespace"
git diff --check
git diff --cached --check

log "Review staged diff summary"
git diff --cached --stat

log "Scan staged index blobs for secrets"
scan_staged_index_blobs

log "Run full project check"
bun run check

if [[ "$mode" == "commit" ]]; then
  cat <<'EOF'

Commit preflight passed.
Review `git diff --cached` before committing, and rerun this preflight after any staging change.
Use `push` mode before pushing committed work.
EOF
  exit 0
fi

log "Require a clean working tree before push"
require_clean_worktree

resolve_outgoing_base
log "Review current-branch outgoing range"
printf 'Current branch: %s\nComparison base (%s): %s\nComputed outgoing range: %s\n' \
  "$current_branch" "$base_reason" "$base_ref" "$range_spec"
git log --oneline "$range_spec"

outgoing_count="$(git rev-list --count "$range_spec")"
if [[ "$outgoing_count" == "0" ]]; then
  echo "No outgoing commits in $range_spec."
  exit 0
fi

log "Scan outgoing commit range for secrets"
scan_outgoing_range

ensure_tmp_root
files="$tmp_root/range-files.z"
write_range_files "$files"

if range_contains "$files" '^(src/runtime/|tests/runtime|tests/completion|tests/.*runtime.*\.test\.ts)'; then
  log "Run runtime focused checks"
  bun test tests/runtime-gates.test.ts tests/workspace-persistence.test.ts
fi

if range_contains "$files" '^(src/adapters/opencode/|src/config-shared\.ts|src/config\.ts|tests/config/|skills/)'; then
  log "Run distribution and surface focused checks"
  bun test tests/distribution-and-surface.test.ts
fi

if range_contains "$files" '^(src/distribution/|src/cli\.ts|package\.json|README\.md|scripts/cross-area/(opencode-smoke|release-smoke|pack-invariants)\.mjs)'; then
	log "Run build for distribution-sensitive changes"
	bun run build
fi

cat <<'EOF'

Push preflight passed.
Any validation-matrix evidence is still required before push; read `.agents/skills/flow-contribution-check/references/validation-matrix.md`.
Push mode validated only the current branch against the computed range above. It does not validate tags, mirrors, or arbitrary refspecs.
EOF
