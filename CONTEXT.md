# Flow Runtime Context

Flow coordinates one planned delivery through validation, independent review,
and archival while keeping lifecycle identity explicit and recoverable.

## Versions

**Flow v5**:
The current product and runtime generation. It is distinct from the version of
the session document it operates on.
_Avoid_: Session v5, schema v5

**Session v4**:
The sole supported session-document contract for Flow v5.
_Avoid_: Flow v4, current session, legacy session

## Execution and review

**Active execution**:
The one currently actionable pairing of a planned feature and its execution
epoch. The pairing exists or is absent as a unit.
_Avoid_: Active feature, active run, current work

**Review assignment**:
A durable, runtime-owned identity and bounded scope created before independent
review begins.
_Avoid_: Review request, reviewer task, review packet

**Assignment result**:
The reviewer's reported verdict and findings for one review assignment.
_Avoid_: Review completion, review evidence, review payload

**Bound prerequisite result**:
A passing feature-assignment result retained to authorize a later final review
without yet becoming recorded review history.
_Avoid_: Feature review cache, provisional approval, prerequisite digest

**Recorded review execution**:
An assignment result accepted into durable review history as part of an atomic
feature outcome.
_Avoid_: Submitted assignment, stored verdict, completed review

**Reported time**:
A time claimed by an external validation or reviewer result.
_Avoid_: Trusted time, completion time

**Runtime acceptance time**:
The runtime-owned time at which Flow accepts a lifecycle operation.
_Avoid_: Reported time, client time, current time

**Validation capture**:
The ephemeral binding created by `flow_validation_start` for the active run,
current source, and exact next Bash command. It is not session evidence by
itself.
_Avoid_: Validation declaration, planned check, passing validation

**Validation receipt**:
Canonical, immutable, restricted-artifact metadata attested from one observed
Bash execution: runtime timing, exact command, command class, exit status,
output digest/completeness, environment-key names, run, feature, and source.
_Avoid_: Validation result, caller evidence, test claim

**Validation receipt reference**:
The digest-and-length capability returned after a receipt is published and
passed through `flow_review_start.request.validationRefs`. It is verified and
materialized into Session v4 evidence only during accepted review start.
_Avoid_: Receipt, output artifact, validation object

**Correction review**:
A review assignment explicitly linked by `correctionOfAssignmentId` to the
latest recorded failure in the active logical pass, with source context derived
by the runtime. Narrow correction mode is distinct from conservative full-review
fallback.
_Avoid_: Retry review, incremental review, reviewer continuation

**Correction scope hint**:
The correction-only, replay-bound `public-contract` or `cross-layer` semantic
signal that can elevate a review to full when paths alone are insufficient. It
cannot request or preserve narrow correction mode.
_Avoid_: Review mode, caller fallback, correction override

## Activation and harness

**Canonical activation**:
The one exact `opencode-plugin-flow@<version>` npm pin retained in the selected
global or project scope after `activation-apply` converges recognized sources.
_Avoid_: Preferred version, newest copy, primary install

**Runtime leadership**:
The process-global fail-closed rule that exactly one registered Flow runtime may
operate. With duplicates, no instance is operational.
_Avoid_: Version election, automatic takeover, newest wins

**Diagnostic leader**:
The deterministic highest-semantic-version identity named to help repair a
duplicate activation. It has no operational authority while duplicates exist.
_Avoid_: Active leader, winning version

**Harness profile**:
Trusted runtime policy for optional worker breadth: `control`, `standard`, or
`assurance`. It does not weaken lifecycle validation or review gates.
_Avoid_: Review depth, rollout mode, quality level

**Admission rollout**:
Whether optional-worker policy is disabled (`control`), reported (`observe`),
or enforced (`enforce`).
_Avoid_: Harness profile, release channel

**AuditLedgerV1**:
The bounded typed audit finding ledger accepted by `flow_audit_render`; its
summary and reconciled Markdown are derived, not caller-authored truth.
_Avoid_: Audit report, findings Markdown, remediation list

**Harness promotion gate**:
A same-corpus, same-source, same-model comparison that requires unchanged
finding/refutation decisions, no remediation contradictions, clean closure, and
at least one lower observed-work signal without increasing another comparable
signal. Missing observations are unavailable,
never zero or pass.
_Avoid_: Benchmark score, automatic rollout, token target

## Closure and recovery

**Closure**:
The durable terminal disposition that ends ordinary changes to a session.
_Avoid_: Archive, feature completion, session completion

**Archive publication**:
The act of publishing a closed session into durable history.
_Avoid_: Closure, close request, cleanup

**Archive-recovery session**:
A closed, quiescent session whose archive publication has not yet converged.
_Avoid_: Active session, partially closed session, stuck archive

**Retry handle**:
The durable, workspace-history-unique identity of an accepted operation that
authorizes continuation of its interrupted side effects without creating
another lifecycle mutation.
_Avoid_: Replay envelope, reconstructed request, retry payload
