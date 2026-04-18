#!/usr/bin/env bash
# Mission init script for opencode-plugin-flow.
# Idempotent: safe to run on every worker session start.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d node_modules ] || [ ! -f bun.lock ] || [ bun.lock -nt node_modules ]; then
  bun install
fi

mkdir -p bench
mkdir -p tests/__fixtures__

echo "Flow plugin init complete."
