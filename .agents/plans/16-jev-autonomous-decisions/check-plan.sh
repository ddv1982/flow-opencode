#!/usr/bin/env bash
set -euo pipefail
plan_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
poteto_dir="${1:?Pass the installed poteto-mode skill directory}"
node "$poteto_dir/scripts/check-plan.mjs" "$plan_dir/README.md"
