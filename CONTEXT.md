# Flow Runtime Context

Flow coordinates one approved plan through serial execution, observed
validation, independent review, and explicit closure.

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
Flow has no lanes or concurrent execution state.

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

The root manager owns planning, implementation, validation dispatch, state
changes, reset, and closure. `flow-reviewer` is the only hidden agent and is
read-only. Guidance supplies judgment; the runtime enforces lifecycle safety.
