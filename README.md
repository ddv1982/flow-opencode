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
opencode plugin opencode-plugin-flow@6.9.0 --global --force
```

Omit `--global` for project scope. Exact version pins do not update
automatically. To update, replace `6.9.0` with the new release and rerun the
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
  "plugin": ["opencode-plugin-flow@6.9.0"]
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
independent review, and repeats until it can close the session. While
implementation remains authorized, `ready` and `completed` are internal loop
states: `/flow-auto` does not hand back “ready for the next feature” or wait for
another command between passing features. From idle, auto-routing first requires
a same-host accepted non-replayed `flow_plan_save` for the created Flow session;
an active baseline that already has a pending reviewer retains a narrow temporal
exception for that completion.

Send `/flow-auto stop` or `/flow-auto cancel` in the same OpenCode session to
revoke only the process-local continuation lease. This does not close, defer,
abandon, or otherwise mutate the durable Flow session.

Before every manager-owned Flow mutation, including direct `/flow-plan` and
`/flow-run` use, the manager compares the current request with the active goal.
A projected `archiveRetry` is the one exception: it finishes an already-accepted
close before that comparison and grants no authority for new work.
A continuation or compatible narrowing may proceed. A materially new or
expanded request does not start or mutate the active session; Flow offers to
continue, defer, or abandon the active work. If that work is completed but not
closed, Flow closes it as completed before starting the new request.

Existing implementation authority carries across approval and feature outcomes.
Flow automatically resets and atomically starts one fresh full retry only when
the projected `nextAction` is `flow_feature_reset`, which the runtime derives
from `failedReviewCount` and `blockedFeature.scopeBlocker`. A
feature whose latest relevant reviewed outcome remains failed is never selected
implicitly. `/flow-auto` may continue untouched, dependency-independent
features, but when only retry-required candidates remain it projects
`await-user-direction`. Flow then reports the blocker and waits for an explicit
retry or independent-feature choice. While the failed run is still blocked, the
chosen feature is attached to `flow_feature_reset` as `nextFeatureId`, so reset
and the next run are one operation. If independent work later finishes and only
the superseded failed feature remains, status is ready with
`await-user-direction`; explicit retry then uses `flow_run_start` with that
feature's exact `featureId`, because there is no blocked run left to reset. The
active session remains authoritative while it waits. Ordinary blocking findings
are in-scope by default; a reviewer sets `scopeBlocker: true` on a finding only
when the required repair would materially exceed the approved plan. Each finding
also carries a runtime-issued `findingId`, and a failed result must carry every
still-live prior ID forward, which `flow_feature_complete` enforces. After a user checkpoint, the
process-local continuation resumes only after that same OpenCode session observes
an accepted non-replayed Flow mutation whose tool assistant ID resolves, through
the cached `message.updated` `parentID`, to the authoritative user reply. A
missing or mismatched origin fails closed. Another host cannot establish that
authority. The mechanical projection must match the credited revision exactly;
the sole successor allowance is one revision after an authenticated
`flow_review_start`, where the state machine admits the reserved reviewer result.
Compaction transfers the reply authority only across an authenticated trigger
assistant, automatic compaction marker, summary assistant, and successor user
lineage while the authority is unchanged; an incomplete or unrelated lineage
fails closed.

Before coding each feature, Flow inventories required evidence and its
environment, then applies an adversarial risk checklist covering failure
ordering, repeated and interrupted operations, adjacent state transitions,
overlapping invariants, and relevant file-mode or platform risks. While required
behavior or environment evidence is knowingly skipped, manager policy forbids
requesting review; the reviewer treats proof required to approve the outcome as
blocking if it is missing from the packet. Flow persists no skipped-evidence
ledger. Asking the user remains the default when external evidence or authority
is missing. At a blocked checkpoint, atomic reset-and-start can discard that
attempt and continue the
exact authorized retry or dependency-independent feature. At a ready retry
checkpoint, explicit feature start resumes the already superseded failure.
Neither route adds a hold or second blocker ledger.

Flow guidance represents the checklist for concurrency and state-machine work
as one compact transition matrix shared by workers and the reviewer. Review
packets reuse a refreshed run baseline, carry only feature-relevant file facts
until final review, and preserve source IDs, current-source evidence, risk
coverage, and prior finding dispositions in existing text fields—no new audit
schema.

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
`/flow-status` reports the durable state and next action. After `/flow-auto` has
run in the current plugin process, status also reports a non-authoritative timer
for the latest invocation. `activeMs` is process-local wall time classified as
active by the coordinator, not CPU time or pure coding time.
`waitingForUserMs` counts only projected `flow_plan_approve` and
`await-user-direction` checkpoints. Plugin restart resets the timer; paused,
inactive, errored, and unprojected waits are excluded.

## How Flow works

1. Planning saves a small feature DAG. Approval locks it.
2. `/flow-run` starts one feature whose dependencies are complete.
3. Before editing, the manager preflights required evidence and gives any
   bounded workers an explicit adversarial acceptance and risk checklist.
4. The manager implements it serially or integrates an optional bounded worker
   wave.
5. Flow observes the exact armed validation command against the current
   workspace, then creates one independent review assignment. At new review
   admission, a relevant failure or source-drift observation invalidates older
   passes; the qualifying pass must be newer and match current source. Separately,
   the manager must not call `flow_review_start` while known required behavior or
   environment evidence is skipped; this is workflow policy, not persisted
   admission state. Already accepted Session v5 pending or completed reviews are
   not reopened or vetoed later at close.
6. The reviewer inspects adjacent and repeated state transitions, overlapping
   feature invariants, the changed artifacts, and the packet's base-diff and
   file-mode inventory. Stable finding IDs survive retries; reviewer guidance
   requires checking prior dispositions and completing the supplied risk
   checklist, represented as a bounded matrix when applicable. Missing proof is
   a precise blocker only when it is required to approve the outcome.
7. A passing feature advances the plan. A failed feature is not selected again
   by default. From blocked status, reset atomically starts the exact authorized
   retry or independent feature through optional `nextFeatureId`. From ready
   `await-user-direction`, the failed run is already superseded and explicit
   `flow_run_start(featureId)` begins its retry. The final passing feature allows
   explicit closure. Every accepted close returns a concise delivery summary
   with each feature's attempt count, latest outcome, and terminal findings,
   derived from Flow's recorded state. Ordinary reviewer summaries carry IDs
   mapped to the active feature or explicitly supplied in its packet; final
   review carries every approved requirement or feature ID. Both carry each
   still-live prior finding with its severity and disposition into the latest
   `outcomeSummary`. Terminal
   `fixed` requires a later passing review and current evidence. If a failed
   retry proves one repair but finds another blocker, it carries that ID and a
   concise evidence reference forward as terminal fixed pending pass; it cannot
   drop the ID or call it fixed. Unproven fixes stay unverified, `recurring`
   confirms recurrence, and `residual` requires a confirmed nonblocker. Only a
   passing review may remove fixed history from the live carry-forward set.
   Terminal findings retain unresolved blockers and the handoff stays bounded.

State lives in `.flow/session.json`, so `/flow-status` can recover the next
action after a restart or context change.

## Bounded parallelism

Parallel contribution is optional and local to one active feature. The manager
may launch two or three `flow-worker` instances only for exact,
non-overlapping slices, then inspect and integrate their work. At most one
targeted follow-up wave may address a concrete gap. Once implementation is
authorized, a qualifying wave needs no separate approval.

Workers cannot delegate, call Flow lifecycle tools, or approve their own work.
Generic or general-purpose agents are not used for active Flow work: bounded
implementation uses `flow-worker`, and independent review uses
`flow-reviewer`.
Flow persists no wave state: the manager remains responsible for the combined
diff, authoritative validation, and the one independent review. Small or
integration-heavy tasks stay serial.

## Commands

| Command | Purpose |
| --- | --- |
| `/flow-auto <goal>` | Normal end-to-end driver; it stops after planning without implementation authority, otherwise loops through every runnable feature and closure without an intermediate handoff. |
| `/flow-plan <goal>` | Plan-only/advanced creation, revision, and approval. |
| `/flow-run` | Advanced/recovery execution of one approved feature. |
| `/flow-review` | Internal/recovery dispatch for a runtime-created reviewer assignment. |
| `/flow-status` | Advanced/recovery inspection of the active session and next action. |

Use `/flow-auto` for the ordinary end-to-end workflow. The other commands expose
plan-only, advanced, internal, or recovery controls.

## Recovery

Start with `/flow-status`; its next action is durable default workflow
direction, not permission to exceed the user's authority. For a first failed
review, read detail once before reset to see the findings the retry must fix.
Pass the exact retry or dependency-independent choice as
`nextFeatureId` so reset and run start are atomic; do not reset and then rely on
default selection. If status is ready with `await-user-direction`, read detail
once and pass the explicitly authorized retry's exact `featureId` to
`flow_run_start`; reset is invalid because the failed run was already
superseded. Environment-sensitive transition guards remain authoritative when a
mutation is attempted. Do not hand-edit
`.flow/session.json` to bypass a gate. If validation, review, locking,
fingerprinting, or archive publication fails, follow the focused steps in
[troubleshooting](docs/troubleshooting.md).

For an interrupted accepted close, compact `/flow-status` supplies
`archiveRetry.request`. Replay that request exactly once before any additional
or detail recovery read. Flow confirms the existing bytes without rewriting
Session v5, re-confirms archive cleanup, and returns the existing concise
`workflowData.delivery`. Relay its `report` lines verbatim, and reconstruct only
the plan-bounded, terminal disposition
map from its latest `outcomeSummary` and terminal findings. If delivery is absent,
report the exact recovery and claim no map. On a close revision conflict,
refresh compact status and retry only after confirming the same session and goal
and that status still permits the selected
closure kind; never close a replacement. A real archive collision removes the
automatic retry instruction and requires manual inspection; preserve both
documents and do not overwrite, delete, or loop the request.

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
