# OpenCode adapter

Active contributors: ddv1982

## Purpose

The OpenCode platform binds the host plugin API to Flow's application,
filesystem composition, and embedded guidance. It lives under
`src/platform/opencode/` and is reached through `src/index.ts`.

## Directory layout

```text
src/platform/opencode/
├── plugin.ts
├── tools.ts
├── config.ts
├── logging.ts
└── sdk.ts
```

## Key abstractions

| Abstraction | File | Description |
| --- | --- | --- |
| `FlowPlugin` | `src/platform/opencode/plugin.ts` | Plugin factory that registers hooks. |
| `createCommandPreflightHook` | `src/platform/opencode/plugin.ts` | Replaces Flow command parts with bundled current instructions. |
| `createConfigHook` | `src/platform/opencode/config.ts` | Injects commands and agents without workspace I/O. |
| `createTools` | `src/platform/opencode/tools.ts` | Registers `flow_guidance` and seven stateful Flow tools. |
| `createFlowLog` | `src/platform/opencode/logging.ts` | Host logging wrapper. |

## How it works

`FlowPlugin` creates config and tool hooks and registers command preflight. Command preflight normalizes names like `/flow-run`, renders the current bundled template from `FLOW_CORE_COMMANDS` in `src/config-shared.ts`, and replaces the command parts that OpenCode will execute. Manager commands reject unexpected subtask parts. `/flow-review` requires exactly one subtask with the expected command identity and `flow-reviewer` agent, then rewrites only its prompt. Startup performs no global or workspace guidance filesystem work.

## Integration points

The platform invokes filesystem-backed use cases through
`src/infrastructure/fs/workspace-flow-service.ts`, imports public response types
from the application layer, and loads package-owned Markdown through
`src/guidance/catalog.ts`. Private host schemas never cross into application
declarations.

## Key source files

| File | Purpose |
| --- | --- |
| `src/index.ts` | Package plugin export. |
| `src/platform/opencode/plugin.ts` | Main OpenCode hook registration. |
| `src/platform/opencode/tools.ts` | Tool wrappers and JSON error handling. |
| `src/platform/opencode/config.ts` | Filesystem-free config mutation. |
| `tests/distribution-and-surface.test.ts` | Adapter surface tests. |

## Entry points for modification

Change `src/platform/opencode/plugin.ts` for command preflight or hook selection. Change `src/platform/opencode/tools.ts` when tool registration changes, and update [Flow tools](../api/flow-tools.md) plus surface tests.

Related pages: [Runtime state machine](runtime-state-machine.md), [OpenCode commands](../api/open-code-commands.md), and [Embedded guidance](../features/embedded-guidance.md).
