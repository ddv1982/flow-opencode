# OpenCode adapter

Active contributors: ddv1982

## Purpose

The OpenCode adapter binds the host plugin API to Flow's runtime and distribution systems. It lives under `src/adapters/opencode/` and is reached through the package entrypoint in `src/index.ts`.

## Directory layout

```text
src/adapters/opencode/
├── plugin.ts
├── tools.ts
├── config.ts
├── logging.ts
└── sdk.ts
```

## Key abstractions

| Abstraction | File | Description |
| --- | --- | --- |
| `FlowPlugin` | `src/adapters/opencode/plugin.ts` | Plugin factory that registers hooks. |
| `createCommandPreflightHook` | `src/adapters/opencode/plugin.ts` | Replaces Flow command parts with bundled current instructions. |
| `createConfigHook` | `src/adapters/opencode/config.ts` | Injects commands, agents, and generated instruction path. |
| `createTools` | `src/adapters/opencode/tools.ts` | Registers seven Flow tools with OpenCode. |
| `createFlowLog` | `src/adapters/opencode/logging.ts` | Host logging wrapper. |

## How it works

`FlowPlugin` runs `runFlowSkillSync`, creates config and tool hooks, and registers command preflight. Command preflight normalizes names like `/flow-run`, renders the current bundled template from `FLOW_CORE_COMMANDS` in `src/config-shared.ts`, prepends setup warnings when needed, and replaces the command parts that OpenCode will execute.

## Integration points

The adapter imports runtime code only through `src/runtime/api.ts` and workspace helpers. It imports distribution code through `src/distribution/sync.ts`. The allowed dependency direction is documented in `docs/architecture/allowed-cross-layer-dependencies.md`.

## Key source files

| File | Purpose |
| --- | --- |
| `src/index.ts` | Package plugin export. |
| `src/adapters/opencode/plugin.ts` | Main OpenCode hook registration. |
| `src/adapters/opencode/tools.ts` | Tool wrappers and JSON error handling. |
| `src/adapters/opencode/config.ts` | Config mutation and instruction projection registration. |
| `tests/distribution-and-surface.test.ts` | Adapter surface tests. |

## Entry points for modification

Change `src/adapters/opencode/plugin.ts` for command preflight or hook selection. Change `src/adapters/opencode/tools.ts` when tool registration changes, and update [Flow tools](../api/flow-tools.md) plus surface tests.

Related pages: [Runtime state machine](runtime-state-machine.md), [OpenCode commands](../api/open-code-commands.md), and [Managed skills](../features/managed-skills.md).
