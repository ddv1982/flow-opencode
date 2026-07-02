# Workspace persistence

Active contributors: ddv1982

## Purpose

Workspace persistence owns `.flow/` state on disk. `src/runtime/workspace.ts` validates workspace roots, serializes writes, reads strict sessions, writes generated instruction projections, archives sessions, and quarantines unreadable active state.

## Directory layout

```text
.flow/
├── session.json
├── opencode-instructions.md
├── session.lock/
│   └── owner.json
├── history/
│   └── <session-id>.json
└── .gitignore
```

## Key abstractions

| Abstraction | File | Description |
| --- | --- | --- |
| `assertMutableWorkspaceRoot` | `src/runtime/workspace.ts` | Rejects root and `$HOME` as mutable roots. |
| `withSessionLock` | `src/runtime/workspace.ts` | Serializes in-process and filesystem writes. |
| `loadSession` | `src/runtime/workspace.ts` | Reads strict JSON and validates `SessionSchema`. |
| `saveSession` | `src/runtime/workspace.ts` | Atomically writes session and instructions. |
| `archiveAndClearSession` | `src/runtime/workspace.ts` | Moves closed sessions to history and clears active state. |
| `quarantineUnreadableSession` | `src/runtime/workspace.ts` | Preserves bad session files for inspection. |

## How it works

Writes use a temporary file, file sync, rename, and directory sync on non-Windows platforms. Locks use a `session.lock` directory with owner metadata and stale-lock detection based on process liveness or age. Generated instructions are rebuilt from the active session and registered through the OpenCode config hook in `src/adapters/opencode/config.ts`.

## Integration points

`src/runtime/api.ts` calls `withSessionLock` before state mutations. `src/adapters/opencode/config.ts` calls `refreshFlowInstructionFile` when OpenCode config loads. `tests/workspace-persistence.test.ts` covers unsafe roots, malformed JSON, duplicate keys, archive/close, stale locks, and quarantine.

## Key source files

| File | Purpose |
| --- | --- |
| `src/runtime/workspace.ts` | Persistence and recovery implementation. |
| `src/runtime/json/strict-object.ts` | Strict JSON parser used by `loadSession`. |
| `src/adapters/opencode/config.ts` | Registers generated instruction projection. |
| `tests/workspace-persistence.test.ts` | Persistence safety tests. |

## Entry points for modification

Change `src/runtime/workspace.ts` for `.flow/` layout or persistence behavior. Update `tests/workspace-persistence.test.ts` for every filesystem behavior change, especially lock, archive, quarantine, and generated instruction cases.

Related pages: [Schema and JSON](schema-and-json.md), [Debugging](../how-to-contribute/debugging.md), and [Security](../security.md).
