# ADR 0008: Bounded Auto Continuation

Date: 2026-07-23

## Status

Accepted. Amends ADR 0005's prompt-only continuation and source-size decisions
without changing the Session v5 version or public tool surface.

## Context

Prompt guidance alone cannot guarantee that an authorized `/flow-auto` run
crosses every model-turn boundary. A real run stopped with durable status
`ready` and `nextAction: flow_run_start`. Its six-hour wall-clock duration also
included an intentional overnight wait for user direction, so elapsed
conversation time was not a useful measure of active Flow work.

The fix must not turn Flow into a scheduler, blocker ledger, or observability
system.

## Decision

An explicit `/flow-auto` creates one process-local, provisional continuation
lease for the current OpenCode session. At command entry it captures the compact
Flow session and revision as a baseline plus the resolved agent, model, and an
opaque token. The lease becomes eligible to auto-route only when the initiating
turn either creates a Flow session from an idle baseline or advances that same
Flow session beyond the baseline. An unchanged already-ready baseline and a
replacement Flow session fail closed. The lease survives compaction within the
same plugin process but is never reconstructed after restart.

On `session.idle`, the host may enqueue one synthetic continuation only for:

- `ready` with `flow_run_start`; or
- `completed` or recoverable `closed` with `flow_session_close`.

Planning awaiting `flow_plan_approve` and any
`await-user-direction` projection, whether blocked or ready, are conversational
checkpoints rather than mechanical routes. The same lease may remain attached
across the user's reply, but it may resume only after that reply advances the
same Flow session to one of the mechanical states above. Running, other blocked
states, idle state, errors, session deletion, unrelated user turns, Flow session
replacement, and an unchanged repeated revision do not auto-route. Synthetic
messages carry the lease token so stale continuations fail closed.

When the workspace digest recomputed at validation persistence differs from the
digest recorded at arm time, the observation is retained as source-drifted and
ineligible. This endpoint comparison does not observe a transient edit that
returns to the armed bytes before persistence. A drifted observation remains
useful diagnostic history but can never satisfy routing, a planned gate, review
admission, or review invariants. A qualifying pass must be recorded after the
latest relevant failed or source-drifted observation and match the current
source, even if the workspace later returns to an older digest. Reviews accepted
before this admission check are grandfathered and are not reopened.

A feature whose latest relevant reviewed outcome remains failed is never chosen
implicitly for another run. `/flow-auto` may continue an untouched,
dependency-independent feature. When only retry-required candidates remain,
compact status is `ready` with `await-user-direction`. The transition depends on
whether a blocked run still exists. At a blocked checkpoint, an authorized retry
or independent choice is attached to the reset transaction through optional
`nextFeatureId`; reset supersedes the affected attempts and starts that chosen
run atomically. After reset-selected independent work and all other untouched
work finish, the failed run is already superseded. At that ready checkpoint,
explicit direction starts the exact retry with `flow_run_start(featureId)`;
reset is invalid and default selection remains unavailable. Flow adds no durable
hold, retry ledger, or second selection protocol.

`flow_status` may expose `workflowData.autoTiming` for the latest `/flow-auto`
invocation in the current plugin process. `activeMs` is process-local wall time
while the coordinator classifies the lease as active, not CPU time or pure
coding time. `waitingForUserMs` counts only the recognized projected
`flow_plan_approve` and `await-user-direction` checkpoints. Paused, inactive,
errored, and unprojected wait time is excluded. The timer is non-authoritative,
resets on plugin restart, never enters Session v5, and never affects a
transition.

The TypeScript source ceiling rises narrowly from 6,000 to 6,400 lines for the
host lease and diagnostics. The 1,000-line per-file limit and inward dependency
rules remain unchanged.

## Simplicity boundary

This decision adds no tool, status view, persisted blocker state, validation
timer, cumulative performance ledger, scheduler, or compatibility layer.
Existing blocked/reset/closure behavior remains authoritative. In particular,
Flow does not add durable feature holds: the observed overnight wait was a
correct user checkpoint, and derived failed-outcome selection plus atomic
reset-and-start or an explicit ready-state run start is sufficient to continue
after direction.

The public surface remains ten tools, five commands, four guides, and two
hidden roles.

## Consequences

Authorized auto runs recover the observed ready-state stop without crossing
authority or evidence checkpoints. Status can distinguish coordinator-classified
active wall time from recognized user-checkpoint time for the latest
process-local invocation, but it cannot measure CPU or pure coding time,
retroactively measure old runs, or compare durable historical performance.

Once OpenCode accepts an asynchronous continuation, a later user interruption
cannot retract that already-enqueued prompt. Narrow routing, lease identity
checks, and stale-token rejection bound that race.

## Rejected alternatives

- Continuing every projected next action: crosses evidence and authority
  checkpoints.
- Treating command entry alone as continuation authority: can auto-route an
  incompatible pre-existing session before goal alignment.
- Reconstructing authority from message history after restart: can resume stale
  intent.
- Durable feature holds: duplicate the canonical run state for a problem the
  existing reset path already handled.
- Validation timing and cumulative counters: add plumbing while obscuring which
  run a measurement belongs to.
- Persisted clocks: make non-causal time part of canonical lifecycle state.
