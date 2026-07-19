# Review lifecycle

Flow separates a planned feature, its active execution, current source
identity, mutable session snapshot, validation evidence, and each review
assignment. Session v4 is the sole supported session contract.

## Runtime-owned identity

Every `flow_run_start` creates one feature-run identity. Reset terminalizes the
active run and leaves its evidence and review records in append-only history.
Pending assignments for that run become explicitly invalidated and cannot be
recovered as active reviewer work. Retry counters and effective review truth
are run-scoped, so a historical failed attempt cannot block repaired work after
reset.

After implementation, the manager runs validation and calls
`flow_review_start` with a strict nested request. Flow records source-bound
validation metadata and one pending review assignment atomically. It derives
and owns:

- feature-run and assignment ids;
- attempt and logical-pass ids;
- current source and immutable packet digests;
- applicable validation evidence references;
- review-assignment start time; and
- required feature or final review depth from the approved plan.

Feature review uses `reviewKind: "feature"` with
`validationScope: "targeted"`. Final review uses `reviewKind: "final"` with
`validationScope: "broad"` and the exact passing feature-assignment result.
Flow persists that result as a bound prerequisite result containing its
assignment id, canonical result, and digest. Binding does not terminalize the
feature assignment or append a recorded review execution.

The first final assignment for one active run and source pins that prerequisite
for same-source final-review retries. After context loss, the manager loads
`flow_status { request: { view: "detail" } }` and copies
`workflowData.projection.finalReviewRetry.prerequisite.result` unchanged into
the new final `flow_review_start.request.featureReview`. The surrounding detail
object also bounds final-assignment, run, source, prerequisite-assignment, and
result-digest identity; the raw result is capped by the persisted 64 KiB limit.
Compact and reviewer status intentionally omit this aggregate. A mismatched
retry records nothing and leaves its operation id reusable. If source changed,
rerun targeted validation and feature review before starting a new broad/final
sequence.

The full reviewer prompt and raw validation output are not persisted in the
ordinary session ledger.

## Reviewer recovery and output

A reviewer recovers one exact assignment with:

```json
{
  "request": {
    "view": "reviewer",
    "assignmentId": "review-assignment:runtime-id"
  }
}
```

The reviewer never reconstructs feature, packet, evidence, revision, snapshot,
attempt, pass, start-time, or depth identity. It returns only:

```json
{
  "assignmentId": "review-assignment:runtime-id",
  "verdict": "passed",
  "findings": [],
  "completedAt": "2026-07-19T10:05:00.000Z",
  "terminalDisposition": "submitted"
}
```

`completedAt` is reported time, not runtime-owned time. Flow accepts it only
when it falls between the assignment start and the accepting mutation time,
inclusive.

`observed_unsubmitted` represents failed work that the host observed but the
reviewer could not submit normally. It must have a failed verdict and a
blocking finding. Findings use the four taxonomies `implementation_defect`,
`regression_coverage_gap`, `evidence_gap`, and `advisory`; Flow derives stable
fingerprints from their normalized semantic locator fields.

## Atomic feature outcome

`flow_feature_complete` accepts one strict nested request whose `result` is
discriminated by outcome and validation scope:

- a targeted `completed` result carries a summary, changed artifacts, and one
  passing feature-assignment result;
- a broad `completed` result carries a summary, changed artifacts, and one
  passing final-assignment result; Flow obtains the feature-assignment result
  from the final assignment's durable bound prerequisite; or
- a `blocked` result carries a summary, one failed assignment result, and an
  optional resolution hint.

Invalid schema, stale guards, missing or reused assignments, source changes,
bad chronology, or inconsistent findings record no mutation and do not consume
the operation id. A corrected request can reuse that id.

A genuine failed review is different: it is an accepted mutation with
operation status `ok`. Flow records the assignment result as a recorded review
execution, marks the assignment terminal, consumes run-scoped retry budget, and
blocks the feature after two failed attempts. An exact accepted replay is
idempotent.

Optional `request.result.orchestrationPasses` telemetry is parsed separately. Malformed
telemetry is ignored with a bounded warning and cannot erase, fabricate, or
change the review result.

## Source applicability and chronology

Validation evidence records capture revision and snapshot for audit, but its
applicability depends on source digest plus feature-run identity. Review-ledger
mutations therefore do not stale unchanged-source validation. Any source edit
or feature reset does. Starting review after a source edit atomically marks a
pending same-run, same-kind assignment `invalidated` with reason
`source_changed` and creates its replacement. Reset uses reason
`feature_reset`. Unchanged-source duplicate starts remain rejected so the
caller recovers the existing assignment instead of minting another.

Flow accepts reported times only in this inclusive order:

```text
feature-run start
  <= validation start
  <= validation completion
  <= review-assignment start
  <= reported assignment-result time
  <= runtime acceptance time
```

The final-feature economy order adds:

```text
bound feature-assignment result time
  <= broad-validation start
  <= broad-validation completion
  <= final-assignment start
```

The full final sequence is targeted validation, feature assignment and review,
at most one authorized repair and retry, broad validation after the last source
edit and the passing feature-assignment result, final assignment and review,
then one atomic broad feature outcome. The manager submits the final-assignment
result only; the runtime records it together with the durable bound prerequisite
result. Review depth remains a runtime-owned projection of approved plan policy.

## Closure and archive recovery

A passing final feature outcome marks workflow progress `completed` and records
its progress timestamp, but leaves `closure` null. Only the `start` branch of
`flow_session_close.request` records closure and the `session_close` causal
mutation.

Closure is quiescent. Completed, deferred, and abandoned closure leave no
active execution or pending review assignment. Deferred or abandoned closure
preserves unfinished plan and workflow progress as forensic state while
terminalizing the active run and invalidating its pending assignments with the
closure reason.

If archive publication stops after closure is durable, compact status exposes
`closure.kind` and the complete `closure.retryOperationId`. Recovery calls only:

```json
{
  "request": {
    "mode": "retry",
    "operationId": "accepted-session-close-operation-id"
  }
}
```

The retry resumes publication and cleanup without another lifecycle mutation.
It does not reconstruct or resubmit summary, guards, or a new close request.
A new close start also requires an operation id absent from every active or
canonical archived mutation in the workspace. Quarantine files do not reserve
or authorize retries. Unreadable, unsupported, filename-mismatched, or
ambiguous canonical history fails closed without changing active bytes. A
Session v4 document with `closure: null` is likewise invalid canonical history;
archive publication rejects it before cleanup.

## Observed worker capability

OpenCode session events do not provide a durable Flow operation, feature-run,
assignment, logical-pass, and packet correlation boundary. Flow therefore does
not infer reviewer truth from generic child-session events. The separate
observed-review-worker ledger distinguishes unavailable observation from a
reconciled numeric count; missing observation is never presented as zero.
