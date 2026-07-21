# Flow Runtime Context

Flow coordinates one approved plan through a serial durable lifecycle, observed
validation, independent review, and explicit closure. Implementation inside one
active feature may use an ephemeral bounded worker wave.

An active Flow session is authoritative for its goal until a completed,
deferred, or abandoned close is recorded. Work on that goal must not silently
fall back to an ordinary non-Flow workflow.

## Versions

**Flow v6** is the plugin and product generation.

**Session v5** is its sole active persisted-state contract. Older active
documents are not migrated. Historical archives are inert and are never used to
resume work.

## Core terms

**Plan**: An approved directed acyclic graph of features. Approval makes it
immutable.

**Feature run**: The canonical aggregate for one attempt. It owns its feature,
attempt number, validation observations, review assignment, result, artifacts,
and state. Avoid separate “history entry” or copied feature-status concepts.

**Active run**: The one run currently allowed to receive validation or review.
Flow has no lanes, concurrent active features, or durable worker execution
state.

**Next action**: The runtime's authoritative workflow direction at the current
revision. It identifies the next Flow transition; it neither grants new user
permission nor revokes authority already given.

**Bounded wave**: An optional ephemeral cohort of two or three `flow-worker`
instances contributing exact, non-overlapping slices inside one active run. One
targeted follow-up cohort may close a concrete gap, retry, or verification need.
A wave is not Session state and cannot approve, validate, review, or complete a
feature.

**Validation observation**: Host-observed command, scope, source digest, exit
code, output digest, and completeness stored directly on the active run. It is
not a detached receipt or caller-authored success claim. Raw output is
deliberately not persisted or projected, and durable commands must not inline
secrets.

**Broad validation**: A coverage claim that the command is the repository's
canonical applicable gate or a justified equivalent for the delivered state.
The string `broad` does not make a narrow check comprehensive.

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

**Blocked run**: A run whose review failed or was observed but not submitted.
Retry requires an explicit full reset; old run data is superseded, not reused.

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

**Archive publication**: No-overwrite publication of closed state into
`.flow/history/`, followed by active-state cleanup. Repeating the exact close
converges after interruption by session and operation identity.

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
