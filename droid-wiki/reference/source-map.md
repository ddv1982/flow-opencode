# Source map

This page maps repository paths to purpose. It is useful when choosing where to start a change.

## Top-level paths

| Path | Purpose |
| --- | --- |
| `src/` | TypeScript source for the layered Flow core, OpenCode platform, embedded guidance, CLI, and config. |
| `skills/` | Authored Flow guidance and reference Markdown. |
| `tests/` | Bun tests for runtime gates, persistence, distribution surface, package shape, and live OpenCode smoke. |
| `docs/` | Maintainer contracts, architecture notes, troubleshooting, ADRs, and historical plans. |
| `.github/` | CI, release, Dependabot, and CODEOWNERS. |
| `dist/` | Build output, not a source of truth. |

## `src/` map

| Path | Purpose |
| --- | --- |
| `src/index.ts` | Package default export for the plugin. |
| `src/cli.ts` | Explicit legacy-cleanup CLI. |
| `src/config.ts` | Re-export for config helpers. |
| `src/config-shared.ts` | Flow commands, hidden workers, and OpenCode config entries. |
| `src/domain/` | Branded values, orchestration policy, session types, and pure immutable transitions. |
| `src/application/` | Flow use cases, typed results, direct-Zod schemas, errors, and repository ports. |
| `src/infrastructure/` | Filesystem repository, strict JSON, and system time/ID services. |
| `src/platform/opencode/` | OpenCode plugin hooks, private host schemas, tools, config, logging, and SDK types. |
| `src/guidance/` | Stable ids and Markdown text embedded in the plugin. |
| `src/distribution/` | Recoverable cleanup for old global Flow folders. |
| `src/prompt-*.ts` | Prompt compilation, quality fixtures, and optional model evaluation. |

## `skills/` map

| Skill | Purpose |
| --- | --- |
| `skills/flow/` | End-to-end manager loop and orchestration references. |
| `skills/flow-plan/` | Planning and approval behavior. |
| `skills/flow-run/` | One-feature execution and completion behavior. |
| `skills/flow-test/` | Validation selection and evidence guidance. |
| `skills/flow-review/` | Assignment-result guidance. |
| `skills/flow-deslop/` | Cleanup and refactor guidance. |
| `skills/flow-ui-quality/` | UI quality and visual verification guidance. |
| `skills/flow-commit/` | Explicit user-triggered commit preparation guidance. |

Related pages: [Systems](../systems/index.md), [Embedded guidance](../features/embedded-guidance.md), and [Development workflow](../how-to-contribute/development-workflow.md).
