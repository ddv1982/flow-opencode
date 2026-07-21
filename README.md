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
to ordinary non-Flow coding, and it does not fold a materially different request
into the active goal.

## Install

Install the exact npm release through OpenCode:

```bash
opencode plugin opencode-plugin-flow@6.5.0 --global --force
```

Omit `--global` for project scope. Exact version pins do not update
automatically. To update, replace `6.5.0` with the new release and rerun the
command.

Before upgrading from Flow v5 or earlier, finish or explicitly close any active
session with its original Flow version. Flow v6 opens only Session v5 active
state; older archives remain inert history.

Do not roll an active session back to an older Flow build after a newer build
has written it. Newer v6 builds read earlier Session v5 state, but Session v5 is
not a promise that older readers understand later widened safety bounds. Finish
or close the active session before downgrading; Flow adds no capability or
migration layer for rollback.

The equivalent manual project configuration is:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-plugin-flow@6.5.0"]
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
independent review, and repeats until it can close the session.

Before every manager-owned Flow mutation, including direct `/flow-plan` and
`/flow-run` use, the manager compares the current request with the active goal.
A projected `archiveRetry` is the one exception: it finishes an already-accepted
close before that comparison and grants no authority for new work.
A continuation or compatible narrowing may proceed. A materially new or
expanded request does not start or mutate the active session; Flow offers to
continue, defer, or abandon the active work. If that work is completed but not
closed, Flow closes it as completed before starting the new request.

Existing implementation authority carries across approval and feature outcomes.
Only the first in-scope failed review automatically resets for one fresh full
retry; a `[scope-blocker]` checkpoints immediately. A second failed review
projects `await-user-direction`, so Flow reports the blocker and waits for
explicit direction before one additional attempt. The active session remains
authoritative while it waits. Ordinary blocking findings are in-scope by
default; a reviewer uses `[scope-blocker]` only when the required repair would
materially exceed the approved plan.

For plan-only or advanced use, plan first:

```text
/flow-plan add rate limiting to the public API
```

Review the proposed plan and approve it conversationally. `/flow-plan` does not
silently grant permission to implement, commit, push, or publish. After
approval of a plan-only request, `/flow-run` can run or recover one feature.
Repeating a same-goal plan-only request after approval reports the immutable plan
and current progress, then stops without rewriting the plan or starting work.

`/flow-run` and `/flow-status` are advanced/recovery controls. At any point,
`/flow-status` reports the durable state and next action.

## How Flow works

1. Planning saves a small feature DAG. Approval locks it.
2. `/flow-run` starts one feature whose dependencies are complete.
3. The manager implements it serially or integrates an optional bounded worker
   wave.
4. Flow observes the exact armed validation command against the current
   workspace, then creates one independent review assignment. At new review
   admission, a known-failed exact planned gate needs a current-source pass;
   already accepted Session v5 pending or completed reviews are not reopened or
   vetoed later at close.
5. A passing feature advances the plan. A blocked feature is reset as a fresh
   full attempt within the retry boundary above. The final passing feature
   allows explicit closure. Every accepted close returns a concise delivery
   summary with each feature's attempt count, latest outcome, and terminal
   findings, derived from Flow's recorded state.

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

Start with `/flow-status`; its next action is durable default workflow
direction, not permission to exceed the user's authority. For a first failed
review, read detail once before reset because scope-blocker findings refine the
compact default. Environment-sensitive transition guards remain authoritative
when a mutation is attempted. Do not hand-edit
`.flow/session.json` to bypass a gate. If validation, review, locking,
fingerprinting, or archive publication fails, follow the focused steps in
[troubleshooting](docs/troubleshooting.md).

For an interrupted accepted close, replay the projected `archiveRetry.request`
exactly once. Flow confirms the existing bytes without rewriting Session v5 and
re-confirms archive cleanup. A real archive collision removes the automatic
retry instruction and requires manual inspection; preserve both documents and
do not overwrite, delete, or loop the request.

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
