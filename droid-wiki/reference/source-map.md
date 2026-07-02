# Source map

This page maps repository paths to purpose. It is useful when choosing where to start a change.

## Top-level paths

| Path | Purpose |
| --- | --- |
| `src/` | TypeScript source for the OpenCode plugin, runtime, distribution, CLI, and config. |
| `skills/` | Managed Flow skill source files and reference markdown. |
| `tests/` | Bun tests for runtime gates, persistence, distribution surface, package shape, and live OpenCode smoke. |
| `docs/` | Maintainer contracts, architecture notes, troubleshooting, ADRs, and historical plans. |
| `.github/` | CI, release, Dependabot, and CODEOWNERS. |
| `dist/` | Build output, not a source of truth. |

## `src/` map

| Path | Purpose |
| --- | --- |
| `src/index.ts` | Package default export for the plugin. |
| `src/cli.ts` | Skill doctor, sync, and uninstall CLI. |
| `src/config.ts` | Re-export for config helpers. |
| `src/config-shared.ts` | Flow commands, hidden workers, and OpenCode config entries. |
| `src/adapters/opencode/` | OpenCode plugin hooks, tools, config, logging, and SDK types. |
| `src/runtime/` | Session schema, API, transitions, persistence, strict JSON, and test time helper. |
| `src/distribution/` | Bundled skill manifest, markdown module declaration, sync, doctor, and uninstall. |

## `skills/` map

| Skill | Purpose |
| --- | --- |
| `skills/flow/` | End-to-end manager loop and orchestration references. |
| `skills/flow-plan/` | Planning and approval behavior. |
| `skills/flow-run/` | One-feature execution and completion behavior. |
| `skills/flow-test/` | Validation selection and evidence guidance. |
| `skills/flow-review/` | Review payload guidance. |
| `skills/flow-deslop/` | Cleanup and refactor guidance. |
| `skills/flow-ui-quality/` | UI quality and visual verification guidance. |
| `skills/flow-commit/` | Explicit user-triggered commit preparation guidance. |

Related pages: [Systems](../systems/index.md), [Managed skills](../features/managed-skills.md), and [Development workflow](../how-to-contribute/development-workflow.md).
