# Systems

Active contributors: ddv1982

The main internal systems are the OpenCode adapter, runtime state machine, workspace persistence, schema and JSON validation, skill distribution, and CLI/package surface. They map closely to top-level `src/` directories and files.

## System map

| System | Paths |
| --- | --- |
| [OpenCode adapter](opencode-adapter.md) | `src/adapters/opencode/**` |
| [Runtime state machine](runtime-state-machine.md) | `src/runtime/api.ts`, `src/runtime/transitions.ts` |
| [Workspace persistence](workspace-persistence.md) | `src/runtime/workspace.ts` |
| [Schema and JSON](schema-and-json.md) | `src/runtime/schema.ts`, `src/runtime/json/strict-object.ts` |
| [Skill distribution](skill-distribution.md) | `src/distribution/**`, `skills/**` |
| [CLI and package](cli-and-package.md) | `src/cli.ts`, `package.json`, `tests/package-smoke.test.ts` |

## Directory coverage

| Source directory | Decision |
| --- | --- |
| `src/adapters/` | Wiki page, adapter boundary is core. |
| `src/runtime/` | Split into state machine, persistence, and schema pages. |
| `src/distribution/` | Wiki page, skill sync is central to install behavior. |
| `skills/` | Covered by [Managed skills](../features/managed-skills.md) and [Skill distribution](skill-distribution.md). |
| `tests/` | Covered by [Testing](../how-to-contribute/testing.md). |
| `docs/` | Used as background and contribution references, not a standalone system. |

Related pages: [Features](../features/index.md), [Architecture](../overview/architecture.md), and [Source map](../reference/source-map.md).
