# Systems

Active contributors: ddv1982

The main internal systems are the OpenCode adapter, runtime state machine, workspace persistence, schema and JSON validation, skill distribution, and CLI/package surface. They map closely to top-level `src/` directories and files.

## System map

| System | Paths |
| --- | --- |
| [OpenCode adapter](opencode-adapter.md) | `src/platform/opencode/**` |
| [Runtime state machine](runtime-state-machine.md) | `src/application/flow-service.ts`, `src/domain/transitions.ts` |
| [Workspace persistence](workspace-persistence.md) | `src/infrastructure/fs/workspace.ts` |
| [Schema and JSON](schema-and-json.md) | `src/application/schema.ts`, `src/infrastructure/fs/strict-json-object.ts` |
| [Guidance distribution](guidance-distribution.md) | `src/guidance/**`, `skills/**` |
| [CLI and package](cli-and-package.md) | `src/cli.ts`, `package.json`, `tests/package-smoke.test.ts` |

## Directory coverage

| Source directory | Decision |
| --- | --- |
| `src/domain/` | Session vocabulary, orchestration invariants, and pure state machine. |
| `src/application/` | Use cases, ports, typed results, and direct-Zod schemas. |
| `src/infrastructure/` | Workspace persistence and system service implementations. |
| `src/platform/` | OpenCode composition and transport boundary. |
| `src/guidance/` | Stable ids and build-time embedded Markdown. |
| `src/distribution/` | Explicit legacy cleanup, never plugin startup. |
| `skills/` | Covered by [Embedded guidance](../features/embedded-guidance.md) and [Guidance distribution](guidance-distribution.md). |
| `tests/` | Covered by [Testing](../how-to-contribute/testing.md). |
| `docs/` | Used as background and contribution references, not a standalone system. |

Related pages: [Features](../features/index.md), [Architecture](../overview/architecture.md), and [Source map](../reference/source-map.md).
