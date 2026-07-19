# Workspace persistence

Active contributors: ddv1982

## Purpose

Workspace persistence owns `.flow/` state on disk.
`src/infrastructure/fs/workspace.ts` validates workspace roots, serializes
writes, reads strict Session v4 state, and publishes quiescent closures into
history.

## Directory layout

```text
.flow/
├── session.json
├── session.lock/
│   └── owner.json
├── history/
│   ├── <sha256(session-id)>.json
│   └── quarantine-<content-sha256>.json
└── .gitignore
```

## Key abstractions

| Abstraction | File | Description |
| --- | --- | --- |
| `assertMutableWorkspaceRoot` | `src/infrastructure/fs/workspace.ts` | Canonicalizes aliases and rejects root and `$HOME` as mutable roots. |
| `withSessionLock` | `src/infrastructure/fs/workspace.ts` | Serializes in-process and filesystem writes. |
| `loadSession` | `src/infrastructure/fs/workspace.ts` | Reads strict JSON and validates `SessionSchema`. |
| `saveSession` | `src/infrastructure/fs/workspace.ts` | Atomically writes the active session. |
| `archiveAndClearSession` | `src/infrastructure/fs/workspace.ts` | Publishes closed sessions to history without clobbering, then removes the active session file. |

## How it works

Writes use a temporary file, exclusive creation, file sync, rename, and
directory sync on non-Windows platforms. Before use, `.flow`, `history`, the
lock, session, and ignore paths must be real directories or regular files
rather than symbolic links; POSIX managed-file reads also use `O_NOFOLLOW`.
Locks use a `session.lock` directory with owner metadata and always fail closed
on contention or invalid metadata. Flow never steals a lock based on age or an
owner-liveness guess; the timeout directs maintainers to inspect an abandoned
lock manually.

Closing first saves the closed session as authoritative active state. The exact
case-sensitive session id maps to one lowercase SHA-256 filename. A short-lived
helper whose cwd is pinned to the validated history-directory identity writes
and syncs the expected bytes to a relative temporary file, then hard-links that
file exclusively to the canonical name. A second helper pinned to `.flow`
removes `session.json` only after the history inode, archive spelling, bytes, and
directory topology are revalidated. An identical existing archive means a prior
close was interrupted after publication, so cleanup resumes; different contents
raise `ArchiveCollisionError` and preserve active state. On POSIX, cwd pins the
directory inode across renames; Windows additionally benefits from its directory
sharing rules, while directory fsync remains POSIX-only. These checks prevent
following a swapped parent but do not claim a privilege boundary against a
continuously malicious process running as the same OS user. Lock owner fields
are semantically validated before use. Malformed dates, non-positive or
fractional pids, and blank hostnames fail closed.

Before accepting a new close start, repository history lookup checks its
operation id against every mutation in every canonical Session v4 archive. Any
match is a collision regardless of mutation kind. Quarantine files are not
canonical retry sources. Corrupt, unsupported, filename-mismatched, or
ambiguous canonical history stops the close before active bytes change.
`archiveAndClearSession` also rejects every Session v4 document with
`closure: null`. Canonical archive lookup treats a closureless document as
invalid and fails closed; only explicit closure can publish canonical history.

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

Change `src/infrastructure/fs/workspace.ts` for `.flow/` layout or persistence
behavior. Update `tests/workspace-persistence.test.ts` for every filesystem
behavior change, especially strict input, lock, archive publication, and retry
cases.

Related pages: [Schema and JSON](schema-and-json.md), [Debugging](../how-to-contribute/debugging.md), and [Security](../security.md).
