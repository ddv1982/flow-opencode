# Flow Runtime Context

Flow coordinates one approved plan through a serial durable lifecycle, observed
validation, independent review, and explicit closure. Implementation inside one
active feature may use an ephemeral bounded worker wave.

An active session owns its goal until completed, deferred, or abandoned closure.
Before each manager mutation, including direct planning or execution, compare the
request with the compact-projected goal. The [authority and goal-alignment
rules](docs/maintainer-contract.md#product-boundary) govern continuation,
narrowing, new scope, and exact accepted-close recovery. Work must not silently
fall back to a non-Flow workflow.

## Versions

**Flow** is the plugin and product generation.

**Session v5** is its sole active persisted-state contract. Older active
documents are not migrated. Historical archives are inert and are never used to
resume work.

Newer Flow builds read older v5 state. Downgrade is unsupported after a writer
uses widened bounds, such as 65 observations for 64 planned gates and separate
broad evidence. Flow provides neither migration nor capability negotiation.

New nonterminal mutations reserve terminal capacity without pruning operations.
Previously valid full v5 documents remain readable. Extended closed documents
require this reader, including archive replay after downgrade. See [terminal
capacity](docs/maintainer-contract.md#terminal-capacity) for byte, operation, and
revision limits.

## Core terms

**Plan**: An approved directed acyclic graph of features. Approval makes it
immutable. A same-goal approved plan-only request reports that plan and current
progress, then stops without another mutation or implementation.

**Feature run**: One attempt's canonical aggregate, containing its feature,
attempt number, validation, review, result, artifacts, and state. No separate
history entry or copied feature status exists.

**Active run**: The one run currently allowed to receive validation or review.
Flow has no lanes, concurrent active features, or durable worker execution
state.

**Next action**: The runtime's durable default workflow direction at the current
revision. It neither grants new user permission nor revokes authority already
given. Environment-sensitive transition guards remain authoritative when that
direction is attempted.

**Status report**: Deterministic human text derived from the typed status
projection. It repeats the exact next action and recovery direction without
adding persisted state or authority.

**Reviewer configuration**: A process-local model and step selection resolved
once when the plugin loads. Native tuple options override environment fallbacks.
Status reports the requested selection but cannot prove model availability.

**Bounded wave**: An optional ephemeral cohort of two or three `flow-worker`
instances contributing exact, non-overlapping slices inside one active run. One
targeted follow-up cohort may close a concrete gap, retry, or verification need.
A wave is not Session state and cannot approve, validate, review, or complete a
feature.

**Validation observation**: Host-observed command, scope, source digest, exit
code, output digest, and completeness stored directly on the active run. It is
not a detached receipt or caller-authored success claim.

**Declared gate**: The `scope: "gate"` entry in `plan.evidence`, the exact
canonical command that validates the whole repository. It is named before
implementation and locked by approval.

**Broad validation**: An observation of the declared gate. Any other command is
refused the claim, as is one that selects which tests it runs. Claiming it binds the
claimant: a `broad` observation that does not pass vetoes review until that same
command passes.

**Vetoed command**: A command whose latest evidence blocks review until it passes
again for the current source — one an observation claimed at `broad` scope, the
plan's declared gate, or one whose bytes equal an entry in the active feature's
validation list. Reset does not
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

**Blocked run**: A run whose review was observed but not submitted, or a change
run whose submitted review failed. Retry uses a fresh full run. Only the first
in-scope failed review may retry automatically. A scope blocker or second
failure requires user direction. Recorded failed reviews determine the count.

**Workspace-content digest**: A SHA-256 fingerprint of effective tracked and
nonignored workspace content. It binds validation and review to source without
claiming Git-history or staging semantics.

**Revision**: The causal order of accepted state changes. Correctness depends on
revision and record order, not wall-clock time.

**Operation ID**: A stable idempotency identity for one mutation. Exact input
replays; different input under the same ID conflicts.

**Closure**: The explicit completed, deferred, or abandoned terminal state.
Completed closure requires every planned feature's current run to be completed.
Inspections may complete with blocking findings without accepting the inspected
code. Deferred and abandoned closure require an explicit user choice.

**Delivery projection**: A deterministic handoff derived from durably closed
Session state, never persisted separately. Artifact paths are caller declarations,
not an exact Git delta. Its `report` contains the same fields formatted by the
runtime.

**Delivery handoff**: The versioned marker inside a delivery projection.
`externalActionAuthority: "not-granted"` means the handoff never authorizes Git,
PR, merge, publication, or release work.

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
