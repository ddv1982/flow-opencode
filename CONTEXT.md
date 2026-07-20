# Flow Runtime Context

Flow coordinates one approved plan through a serial durable lifecycle, observed
validation, independent review, and explicit closure. Implementation inside one
active feature may use an ephemeral bounded worker wave.

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

**Bounded wave**: An optional ephemeral cohort of two or three `flow-worker`
instances contributing exact, non-overlapping slices inside one active run. One
targeted follow-up cohort may close a concrete gap, retry, or verification need.
A wave is not Session state and cannot approve, validate, review, or complete a
feature.

**Validation observation**: Host-observed command, scope, source digest, exit
code, output digest, and completeness stored directly on the active run. It is
not a detached receipt or caller-authored success claim.

**Review assignment**: The durable identity and bounded packet for the run's
one independent review. The hidden `flow-reviewer` reads it through reviewer
status and returns a verdict plus findings.

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

**Archive publication**: No-overwrite publication of closed state into
`.flow/history/`, followed by active-state cleanup. Repeating the exact close
converges after interruption by session and operation identity.

## Ownership

The root manager owns planning, lifecycle state, slice selection, integration,
evidence acceptance, authoritative validation dispatch, reset, and closure. It
implements serially by default and may delegate exact disjoint contributions to
the hidden `flow-worker`; those workers cannot call Flow tools, delegate again,
or approve work. The hidden `flow-reviewer` remains independent and read-only.
Guidance supplies wave and review judgment; the runtime enforces lifecycle
safety.

Wave coordination is conversational and disposable. Flow persists no manifest,
handoff ledger, telemetry, or worker recovery state. After interruption, the
manager uses existing status plus worktree inspection and reruns or completes
uncovered slices before combined validation.
