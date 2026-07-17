# Workspace persistence

Active contributors: ddv1982

## Purpose

Workspace persistence owns `.flow/` state on disk. `src/infrastructure/fs/workspace.ts` validates workspace roots, serializes writes, reads strict sessions, archives sessions, and quarantines unreadable active state.

## Directory layout

```text
.flow/
├── session.json
├── session.lock/
│   └── owner.json
├── history/
│   └── <session-id>.json
└── .gitignore
```

## Key abstractions

| Abstraction | File | Description |
| --- | --- | --- |
| `assertMutableWorkspaceRoot` | `src/infrastructure/fs/workspace.ts` | Canonicalizes aliases and rejects root and `$HOME` as mutable roots. |
| `withSessionLock` | `src/infrastructure/fs/workspace.ts` | Serializes in-process and filesystem writes. |
| `loadSession` | `src/infrastructure/fs/workspace.ts` | Reads strict JSON and validates `SessionSchema`. |
| `saveSession` | `src/infrastructure/fs/workspace.ts` | Atomically writes the active session. |
| `archiveAndClearSession` | `src/infrastructure/fs/workspace.ts` | Publishes closed sessions to history without clobbering and clears active state. |
| `quarantineUnreadableSession` | `src/infrastructure/fs/workspace.ts` | Preserves bad session files for inspection. |

## How it works

Writes use a temporary file, exclusive creation, file sync, rename, and
directory sync on non-Windows platforms. Before use, `.flow`, `history`, the
lock, session, and ignore paths must be real directories or regular files
rather than symbolic links; POSIX managed-file reads also use `O_NOFOLLOW`.
Locks use a `session.lock` directory with owner metadata and always fail closed
on contention or invalid metadata. Flow never steals a lock based on age or an
owner-liveness guess; the timeout directs maintainers to inspect an abandoned
lock manually.

Closing first saves the closed session as authoritative active state. Archive
publication then hard-links that exact `session.json` to the fixed history path,
which fails rather than replacing an existing file. An identical existing
archive means a prior close was interrupted after publication, so cleanup
resumes; different contents raise `ArchiveCollisionError` and preserve active
state. Lock owner fields are semantically validated before use. Malformed dates,
non-positive or fractional pids, and blank hostnames fail closed.

## Integration points

`src/infrastructure/fs/session-repository.ts` maps the application repository
port to `withSessionLock` and the workspace primitives.
`src/infrastructure/fs/workspace-flow-service.ts` composes that repository with
the application service and system transition environment. The OpenCode config
hook does not touch workspace state.

## Key source files

| File | Purpose |
| --- | --- |
| `src/infrastructure/fs/workspace.ts` | Persistence and recovery implementation. |
| `src/infrastructure/fs/strict-json-object.ts` | Strict JSON parser used by `loadSession`. |
| `src/platform/opencode/config.ts` | Registers commands and agents without filesystem I/O. |
| `tests/workspace-persistence.test.ts` | Persistence safety tests. |

## Entry points for modification

Change `src/infrastructure/fs/workspace.ts` for `.flow/` layout or persistence behavior. Update `tests/workspace-persistence.test.ts` for every filesystem behavior change, especially lock, archive, and quarantine cases.

Related pages: [Schema and JSON](schema-and-json.md), [Debugging](../how-to-contribute/debugging.md), and [Security](../security.md).
