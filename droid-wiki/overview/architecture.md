# Architecture

Flow is split into a small runtime and a larger skills bundle. OpenCode calls the plugin in `src/index.ts`, the adapter wires Flow into OpenCode in `src/adapters/opencode/plugin.ts`, and runtime state changes pass through `src/runtime/api.ts` before reaching pure transitions in `src/runtime/transitions.ts`.

## Component map

```mermaid
graph LR
    User[OpenCode user] -->|slash command| Adapter[OpenCode adapter]
    Adapter -->|injects commands and agents| Config[src/config-shared.ts]
    Adapter -->|registers tools| Tools[src/adapters/opencode/tools.ts]
    Tools -->|calls| API[src/runtime/api.ts]
    API -->|locks and loads| Workspace[src/runtime/workspace.ts]
    API -->|applies rules| Transitions[src/runtime/transitions.ts]
    Transitions -->|validates model| Schema[src/runtime/schema.ts]
    Workspace -->|writes| FlowDir[.flow/session.json and history]
    Adapter -->|syncs| Skills[skills copied to OpenCode]
```

## Runtime boundary

The runtime is host-neutral. `src/runtime/schema.ts` defines the persisted session, plan, feature, validation, and review shapes. `src/runtime/transitions.ts` enforces approval, dependency, active-feature, validation, review, reset, and close rules without importing OpenCode code. `src/runtime/workspace.ts` handles filesystem safety and generated instruction projection.

## OpenCode boundary

The adapter in `src/adapters/opencode/plugin.ts` is the only runtime-facing OpenCode plugin entrypoint. It:

- runs managed skill sync through `runFlowSkillSync` from `src/distribution/sync.ts`,
- registers the config hook from `src/adapters/opencode/config.ts`,
- registers tools from `src/adapters/opencode/tools.ts`,
- expands Flow slash commands through `command.execute.before`,

## Data flow for a feature run

```mermaid
sequenceDiagram
    participant Agent as Flow skill or command
    participant Tool as flow_run_start / flow_feature_complete
    participant API as src/runtime/api.ts
    participant Lock as src/runtime/workspace.ts
    participant State as .flow/session.json
    participant Rules as src/runtime/transitions.ts

    Agent->>Tool: call with feature or result payload
    Tool->>API: parse input with Zod schema
    API->>Lock: acquire session lock and load state
    Lock->>State: read active session
    API->>Rules: start or complete feature
    Rules-->>API: next session or failure with recovery
    API->>State: save session and instruction projection
    API-->>Agent: JSON summary and next action
```

## Size snapshot

As of 2026-07-02, the repo has about 6,503 TypeScript lines across 23 files and 4,120 Markdown lines across 38 files, excluding `node_modules`, `dist`, and Git internals. The codebase is small enough that the architecture relies on import boundaries documented in `docs/architecture/allowed-cross-layer-dependencies.md` rather than a custom seam checker.

## Key source files

| File | Purpose |
| --- | --- |
| `src/index.ts` | Exports the OpenCode plugin. |
| `src/adapters/opencode/plugin.ts` | Stable plugin hooks and command preflight. |
| `src/config-shared.ts` | Public commands, hidden workers, and config mutation. |
| `src/runtime/api.ts` | Runtime tool handlers and input schemas. |
| `src/runtime/transitions.ts` | State machine and completion gates. |
| `src/runtime/workspace.ts` | Persistence, lock, archive, and recovery layer. |
| `src/distribution/sync.ts` | Skill installation, doctor reports, and uninstall logic. |

Related pages: [Runtime state machine](../systems/runtime-state-machine.md), [OpenCode adapter](../systems/opencode-adapter.md), and [Workspace persistence](../systems/workspace-persistence.md).
