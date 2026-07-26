# Flow Runtime Context

Flow coordinates one approved plan through a serial durable lifecycle, observed
validation, independent review, and explicit closure. Implementation inside one
active feature may use an ephemeral bounded worker wave.

An active Flow session is authoritative for its goal until a completed,
deferred, or abandoned close is recorded. Work on that goal must not silently
fall back to an ordinary non-Flow workflow. Before every manager-owned lifecycle
mutation, including direct planning or execution, the root manager compares the
compact-projected goal with the current request. This is a semantic manager
judgment, not a persisted intent classifier: a continuation or compatible
narrowing may proceed, while a materially new or expanded request makes no
mutation and has not started. The manager offers to continue, defer, or abandon
the active work; completed-but-unclosed work is closed as completed before a new
request begins. Exact projected recovery of an already-accepted close runs
before this comparison because it authorizes no new work.

## Versions

**Flow v6** is the plugin and product generation.

**Session v5** is its sole active persisted-state contract. Older active
documents are not migrated. Historical archives are inert and are never used to
resume work.

Compatibility is forward-reading within v5: newer Flow builds accept state
written by earlier v6 builds. Rolling an active session back is unsupported once
a newer writer has used a widened bounded collection, such as the 65-observation
ceiling needed for 64 exact planned gates plus separate broad evidence. This is
an explicit no-migration boundary, not a capability-negotiation subsystem.

## Core terms

**Plan**: An approved directed acyclic graph of features. Approval makes it
immutable. A same-goal approved plan-only request reports that plan and current
progress, then stops without another mutation or implementation.

**Feature run**: The canonical aggregate for one attempt. It owns its feature,
attempt number, validation observations, review assignment, result, artifacts,
and state. Avoid separate “history entry” or copied feature-status concepts.

**Active run**: The one run currently allowed to receive validation or review.
Flow has no lanes, concurrent active features, or durable worker execution
state.

**Next action**: The runtime's durable default workflow direction at the current
revision. It neither grants new user permission nor revokes authority already
given. Environment-sensitive transition guards remain authoritative when that
direction is attempted.

**Bounded wave**: An optional ephemeral cohort of two or three `flow-worker`
instances contributing exact, non-overlapping slices inside one active run. One
targeted follow-up cohort may close a concrete gap, retry, or verification need.
A wave is not Session state and cannot approve, validate, review, or complete a
feature.

**Validation observation**: Host-observed command, scope, source digest, exit
code, output digest, and completeness stored directly on the active run. It is
not a detached receipt or caller-authored success claim.

**Broad validation**: A coverage claim that the command is the repository's
canonical applicable gate or a justified equivalent for the delivered state. The
string `broad` does not make a narrow check comprehensive, and claiming it binds
the claimant: a `broad` observation that does not pass vetoes review until that
same command passes.

**Vetoed command**: A command whose latest evidence blocks review until it passes
again for the current source — one an observation claimed at `broad` scope, or one
whose bytes equal an entry in the active feature's validation list. Reset does not
erase the failure and no other passing command discharges it. The veto is
prospective; the maintainer contract owns the exact admission rule.

**Review assignment**: The durable identity and bounded packet for the run's
one independent review. The hidden `flow-reviewer` reads it through reviewer
status and submits its verdict plus findings directly through
`flow_feature_complete`. The host checks the reserved reviewer identity for new
submissions; exact accepted requests remain read-only replays while the Session
v5 workflow is active.

**Feature review**: The one review derived for a non-final run.

**Final review**: The one review derived for the final runnable feature. It
requires broad passing validation and replaces, rather than follows, a feature
review.

**Blocked run**: A run whose review failed or was observed but not submitted. Old
run data is superseded, not reused. Automatic convergence is bounded: the first
in-scope failed review may retry as one fresh full run, while a scope blocker or a
second failure checkpoints for user direction. The count is derived from recorded
failed review results, never from a persisted retry counter.

**Workspace-content digest**: A SHA-256 fingerprint of effective tracked and
nonignored workspace content. It binds validation and review to source without
claiming Git-history or staging semantics.

**Revision**: The causal order of accepted state changes. Correctness depends on
revision and record order, not wall-clock time.

**Operation ID**: A stable idempotency identity for one mutation. Exact input
replays; different input under the same ID conflicts.

**Closure**: The explicit completed, deferred, or abandoned terminal state.
Completed closure requires every planned feature to have a passing run.
Deferred and abandoned closure require an explicit user choice.

**Delivery projection**: The concise deterministic handoff returned after a close
is durably accepted, recomputed from the closed Session rather than persisted as
another state model. Its artifact paths are declarations supplied to Flow, not an
exact Git delta. It also carries `report`: the same fields already formatted, so
the handoff shape is a runtime guarantee rather than formatting instructions
restated on every surface that can report a close.

**Archive publication**: No-overwrite publication of closed state into
`.flow/history/`, followed by active-state cleanup. Repeating the exact close
converges after interruption by session and operation identity, and a conflicting
document is preserved for manual recovery rather than overwritten. These rules add
no Session field or retry ledger.

## Ownership

The root manager owns slice selection, integration, evidence acceptance,
authoritative validation, review dispatch, reset, closure, and every lifecycle
mutation except reviewer-result submission. It may delegate exact disjoint
contributions to `flow-worker`, then audits assigned versus changed paths.
Workers cannot run Bash, edit `.flow` or `.git` metadata paths, use Flow tools,
delegate again, or approve work. `flow-reviewer` remains independent and
workspace-read-only; its sole lifecycle mutation is submitting its own pending
result. Status may quarantine unreadable Flow state as fail-closed recovery
maintenance, not as a lifecycle transition. The manager reads compact status
afterward and never copies or fabricates that verdict. Exact accepted completion
requests remain read-only replays for same-major active-session compatibility.

Wave coordination is conversational and disposable. After interruption, status
and worktree inspection replace a manifest, ledger, or worker-recovery system.
