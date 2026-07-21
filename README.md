# Flow Plugin for OpenCode

`opencode-plugin-flow` gives OpenCode a small, durable workflow for coding work
that benefits from an approved plan and an independent review:

```text
plan → approve → run one feature → validate → review → repeat or close
```

Flow keeps one durable active feature run at a time. When implementation divides
cleanly, the manager may ask a small host-native worker cohort to contribute in
parallel before it validates and reviews the combined result.

Once a Flow session starts, it remains the workflow for that goal until Flow
records completed, deferred, or abandoned closure. It never silently falls back
to ordinary non-Flow coding.

## Install

Install the exact npm release through OpenCode:

```bash
opencode plugin opencode-plugin-flow@6.4.0 --global --force
```

Omit `--global` for project scope. Exact version pins do not update
automatically. To update, replace `6.4.0` with the new release and rerun the
command.

Before upgrading from Flow v5 or earlier, finish or explicitly close any active
session with its original Flow version. Flow v6 opens only Session v5 active
state; older archives remain inert history.

The equivalent manual project configuration is:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-plugin-flow@6.4.0"]
}
```

Restart OpenCode after changing configuration. OpenCode owns package
installation and configuration; see its
[plugin documentation](https://opencode.ai/docs/plugins/). Flow has no installer
or activation CLI. Removing the plugin entry disables it. If two Flow copies
load for one project, both fail closed until the duplicate is removed.

## Quick start

Start a complete workflow:

```text
/flow-auto add rate limiting to the public API
```

Flow inspects the worktree, proposes a feature plan, and asks for approval
unless your request already authorized implementation. It then runs one
runnable feature at a time, validates the actual workspace, obtains an
independent review, and repeats until it can close the session. Existing
implementation authority carries across approval, feature outcomes, and
in-scope failed-review repairs; Flow does not ask for the same permission again.

For plan-only or advanced use, plan first:

```text
/flow-plan add rate limiting to the public API
```

Review the proposed plan and approve it conversationally. `/flow-plan` does not
silently grant permission to implement, commit, push, or publish. After
approval of a plan-only request, `/flow-run` can run or recover one feature.

`/flow-run` and `/flow-status` are advanced/recovery controls. At any point,
`/flow-status` reports the durable state and next action.

## How Flow works

1. Planning saves a small feature DAG. Approval locks it.
2. `/flow-run` starts one feature whose dependencies are complete.
3. The manager implements it serially or integrates an optional bounded worker
   wave.
4. Flow observes the exact armed validation command against the current
   workspace, then creates one independent review assignment.
5. A passing feature advances the plan. A blocked feature is reset as a fresh
   full attempt. The final passing feature allows explicit closure.

State lives in `.flow/session.json`, so `/flow-status` can recover the next
action after a restart or context change.

## Bounded parallelism

Parallel contribution is optional and local to one active feature. The manager
may launch two or three `flow-worker` instances only for exact,
non-overlapping slices, then inspect and integrate their work. At most one
targeted follow-up wave may address a concrete gap. Once implementation is
authorized, a qualifying wave needs no separate approval.

Workers cannot delegate, call Flow lifecycle tools, or approve their own work.
Flow persists no wave state: the manager remains responsible for the combined
diff, authoritative validation, and the one independent review. Small or
integration-heavy tasks stay serial.

## Commands

| Command | Purpose |
| --- | --- |
| `/flow-auto <goal>` | Normal end-to-end driver for the authorized lifecycle; stop after planning if implementation was not authorized. |
| `/flow-plan <goal>` | Plan-only/advanced creation, revision, and approval. |
| `/flow-run` | Advanced/recovery execution of one approved feature. |
| `/flow-review` | Internal/recovery dispatch for a runtime-created reviewer assignment. |
| `/flow-status` | Advanced/recovery inspection of the active session and next action. |

Use `/flow-auto` for the ordinary end-to-end workflow. The other commands expose
plan-only, advanced, internal, or recovery controls.

## Recovery

Start with `/flow-status`; its next action is authoritative workflow state, not
permission to exceed the user's authority. Do not hand-edit `.flow/session.json`
to bypass a gate. If validation, review, locking,
fingerprinting, or archive publication fails, follow the focused steps in
[troubleshooting](docs/troubleshooting.md).

## Development

Requirements: Git, Node.js 24 or newer, Bun 1.3.14, and the versions pinned in
`package.json`.

```bash
bun install --frozen-lockfile
bun run check
```

The normal check runs typechecking, formatting/lint checks, build verification,
tests, and package smoke. Release CI also exercises the packed plugin in a real
OpenCode host.

Maintained documentation starts at [docs/index.md](docs/index.md). See
[development](docs/development.md) for repository structure,
[troubleshooting](docs/troubleshooting.md) for recovery,
[the maintainer contract](docs/maintainer-contract.md) for tools and runtime
invariants, and [ADR 0006](docs/adr/0006-bounded-intra-feature-waves.md) for the
bounded-wave rationale.

## License

MIT
