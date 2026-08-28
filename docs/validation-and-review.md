# Validation and Review

This document defines the validation, review, and closure invariants Flow must
preserve. It is part of [the maintainer contract](maintainer-contract.md), split out
because it is over a third of it.

Before implementation, the manager inventories every exact and
behavior-oriented evidence requirement, its required environment, and its
authorized execution path. It also prepares an adversarial acceptance and risk
checklist covering failure ordering, adjacent state transitions, repeated and
interrupted operations, overlapping feature invariants, and relevant
platform/file-mode risks. That checklist is supplied to every worker before
editing and later to review. Concurrency and state-machine work expresses the
bounded checklist as a matrix of state/interleaving, event, expected outcome,
cleanup/invariant, and evidence. Race-heavy lifecycle invariants are planned
separately from independently acceptable UI, persistence, or accessibility
outcomes.

The manager reuses one conversational baseline inventory across a run and
refreshes changed facts. A feature review receives only baseline facts it
changes or depends on; final review receives the full inventory. Its bounded
packet maps IDs to current-source evidence, carries the feature risk checklist
represented as a transition matrix when applicable, and preserves prior finding
dispositions. Empty optional sections are omitted rather than repeated as a text
manifest.

When resuming attempt 2 or later without prior findings in conversation, the
manager reads detail once and recovers their IDs from superseded runs before
preflight.

When required behavior or environment evidence is knowingly skipped,
unavailable, or inapplicable, manager workflow policy forbids calling
`flow_review_start` even when a substitute broad command passes. If such a gap
reaches review, the reviewer records proof required to approve the outcome as a
precise blocker. Beyond the declared entries below, the runtime persists no
skipped-evidence field and keeps no parallel blocker ledger: missing evidence
checkpoints for user direction, and the existing reset or explicit closure path
handles the decision.

`flow_validation_start` prepares the active run, exact next Bash command, scope,
current workspace-content digest, and the host platform, which infrastructure reads
rather than the caller claiming it. The OpenCode after-hook accepts only a structured
exit code, records output completeness and digests the output. The observation is
persisted directly on the run.

Validation commands are durable and must not contain inline secrets. Raw output
is neither persisted nor projected; the command, exit code, completeness,
output digest, and source binding are the evidence. `broad` means an observation of
the plan's gate command: `savePlan` requires exactly one `scope: "gate"` evidence
entry and refuses a gate that selects its own tests. `recordValidation` refuses a
broad claim on any other command. Nothing decides whether the declared command is
a test; [ADR 0010](adr/0010-declared-canonical-gate.md) records why that stays a
caller declaration made at planning time.

`savePlan` requires `evidence`: one gate plus optional extra observations. Every
entry names its command, `platform`, and `assertions`. One satisfaction rule
applies to all entries: an eligible exact-command observation on the declared
platform with every declared case `passed`. Case outcomes come from a JUnit
report named by `resultsPath` that changes during the observed command window
([ADR 0012](adr/0012-named-results-over-exit-codes.md)). Final review and
`completed` closure refuse any unsatisfied entry. The gate also requires broad
scope and remains subject to command vetoes. Feature reviews are not vetoed, so a
goal can split into the half this host can prove and the half it cannot.
[ADR 0014](adr/0014-one-evidence-record.md) records the collapse of `gate` and
`externalEvidence` into this one field.

A failed, incomplete, or source-drifted observation creates a freshness boundary
for its command across attempts. Prospectively, review remains unavailable until
the active run holds a complete exit-zero observation of that same command which
matches the review's current source and is newer than the latest relevant
failure or drift. Returning to an older source digest does not revive a pass
from before that boundary, and no other passing command discharges it — neither
a substitute broad gate nor a narrower command relabelled `broad`. Three command
sets are vetoed this way: any command whose stored bytes equal an entry in the
active feature's validation list, since Flow does not parse validation prose
into commands; the plan's gate command; and any command an observation recorded
at `broad` scope.
Accepted same-schema Session v5 reviews remain valid for submission and feature
completion. Completed closure still rechecks immutable plan evidence.
[ADR 0009](adr/0009-scope-keyed-validation-veto.md) records why the label binds.

An armed capture waits at most 15 minutes for its exact Bash command to begin.
An unrelated Bash command cancels it. Once the exact command begins, the
after-hook remains eligible even if the command finishes after that original
waiting deadline. Session, run, source, exit-code, and output-completeness gates
still apply.

Final review additionally requires broad scope. If the workspace digest
recomputed at persistence differs
from the digest recorded when validation was armed, the observation is recorded
as source-drifted and permanently ineligible. This endpoint comparison does not
detect a transient edit that returns to the armed bytes before persistence.
Review completion likewise fails when its recomputed current digest differs
from the assignment digest.

Each run has at most one review assignment. The runtime derives `feature` or
`final`; callers do not choose it. The hidden reviewer receives approved plan
context — including `plan.evidence`, so the commands it
is asked about are in hand rather than inferred — its full assignment, declared
artifacts, assignment-linked validation with each observation's recorded host, and
completed feature IDs. It is workspace-read-only; its allowed Flow tools are
`flow_status` and `flow_feature_complete`, while its guidance restricts status
use to the assigned reviewer view. The platform accepts a new completion only
from the reserved reviewer identity. While that Session v5 workflow remains
active, every caller with tool access may receive the read-only result of an
exact previously accepted completion request without validation cancellation or
a session write. A failed verdict requires an evidence-backed blocking finding;
a passed verdict cannot contain one.

Reviewer guidance explicitly covers before/during/after state transitions,
failure and cleanup ordering, repeated/retried/interrupted/concurrent
operations, invariants shared with overlapping features, changed artifacts, and
the manager-supplied base-diff inventory including deletions, renames, file
types, and executable modes. The reviewer treats that inventory as evidence,
not a verdict, and does not fail merely because its isolated role has no shell.
When the packet omits a relevant fact, conflicts with inspectable artifacts, or
cannot prove a material claim, the reviewer fails with a precise
missing-evidence finding naming the manager-owned reproduction, environment,
and expected observable result. It does not pass conditionally.

A finding carries an optional `scopeBlocker` boolean, valid only on a blocking
finding, set when satisfying it would require material work outside the approved
plan. The projection surfaces it as `blockedFeature.scopeBlocker` and `nextAction`
accounts for it, so routing is enforced rather than inferred from prose.

Every finding carries a stable identity in its own `findingId` field, as
`<feature-id>.R<assignment-createdRevision>-<NN>`. The reviewer sets it to a
prior ID for recurrence and omits it for a new issue, which the runtime numbers;
that composition prevents reuse after a qualifying pass drops history. The
reviewer projection supplies the still-live set as `priorFindings` with
`nextFindingIdPrefix`, each carrying its latest severity, summary, and evidence,
so carry-forward never depends on packet prose, and `flow_feature_complete`
rejects a failed result that drops a live prior ID. A passing review clears every
ID it does not repeat. The reviewer checks each claim
against current source and evidence and completes the supplied risk checklist
through its bounded matrix when applicable so independently detectable issues can
arrive in one cohort. An ordinary-review summary preserves only plan/source IDs
mapped to the active feature or explicitly supplied in its packet; a final-review
summary preserves every approved requirement or feature ID. Both report each
still-live prior finding's severity and disposition. Only a passing verdict with
current evidence may state terminal `fixed`. On a failed verdict, if repair F1 is
proven but blocker F2 fails the review, F1 remains `repair proven; terminal fixed
pending pass` with a concise evidence reference. An unproven fixed claim is marked unverified; `recurring` requires
current recurrence and `residual` a confirmed nonblocker. The summary becomes
the latest `outcomeSummary`; terminal findings retain unresolved blockers. Only
IDs fixed by a passing review leave the live carry-forward set.

A fresh close constructs its request from the compact-projected session id and
revision, a fresh operation id, the selected closure kind, and an optional
summary. An `archiveRetry` instead replays only its compact-projected request
byte-for-byte. Both run first without a prerequisite detail read. The accepted
response returns terminal data through the existing concise
`workflowData.delivery`; its latest `outcomeSummary` and terminal findings
supply only the plan-bounded, terminal-only conversational disposition map. If
delivery is absent, the manager reports the exact recovery and claims no map. A
close revision conflict requires a compact refresh. Retry only after confirming
the same session and goal while
status still permits the selected closure kind; it never closes a replacement.
`fixed` requires later passing independent review and current-source evidence;
`residual` means a confirmed nonblocking issue remains; `deferred` requires
explicit user authority for non-completed closure; and `abandoned` remains the
actual closure kind. This adds no historical-finding manifest or second ledger.

`artifactsChanged` is a caller declaration associated with the review
assignment. Flow validates bounded normalized workspace-relative paths, but it
does not prove that each path exists or changed and does not infer an exhaustive
Git delta. The rendered delivery `report` therefore labels them Flow-reported and
separates latest-attempt paths from superseded-only paths.

Result submission is the reviewer's sole lifecycle mutation. `flow_status` may
fail-closed quarantine unreadable active state; that is recovery maintenance,
not a lifecycle transition.

The manager creates and dispatches the assignment, then reads compact status;
it never copies or submits the verdict. A pending assignment may be redispatched
after interruption or an unconfirmed reviewer return. A source-binding failure
instead requires reset, fresh validation, and a new review.
Manager status rechecks workspace content only while a review is pending and
projects `flow_feature_reset` when that assignment's source binding is stale.
If fingerprinting is unavailable, status fails closed with repair guidance and
does not recommend redispatch.
Observed-but-unsubmitted work fails closed. [ADR
0007](adr/0007-reviewer-owned-submission.md) records the rationale.

Every host-observed validation advances the revision indirectly through the
after-hook. An accepted `[flow-validation]` marker returns `passed` and the
observation's `recordedRevision`. That revision is only a concurrency token. A
`passed: true` marker may supply it for `flow_review_start` only while all
runtime review gates still hold; it may also arm another validation. Failed,
incomplete, and ineligible markers report `passed: false` and their revision
may arm only fresh validation, never review. An ineligible marker exposes
`ineligibleReason`: `source-drift`, or `exit-code-unavailable` and
`output-completeness-unknown` when the host reports no structured exit code or
truncation flag. Those two record a durable never-passing observation rather than
failing the capture, so Flow stays usable on any host; `exitCode` is `null` for
the first. No compact refresh is needed solely to recover an
eligible token; missing, malformed, or rejected capture and uncertain routing
still require one. The revision used to arm the completed command is no longer
current.
