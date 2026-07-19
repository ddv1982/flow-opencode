# Recovery playbook

Use this when a Flow tool returns `status: "error"`, a blocker, or a `nextAction` that conflicts with memory.

## First response

1. Re-anchor with `flow_status { request: { view: "compact" } }`.
2. Read top-level `summary` and `recovery`, then
   `workflowData.projection.feature`, `blockers`, and `nextAction`.
3. Fix the cause, then retry the smallest valid Flow action.

## Common cases

- `missing_session`: start with `flow_plan_save` using the user's goal.
- Different goal while any session is unclosed: do not let `flow_plan_save`
  replace it. Close unfinished work explicitly as `deferred` or `abandoned`
  with current causal guards, finish archive publication, then save the new
  goal. Completed progress requires a `completed` close instead.
- `missing_goal`: ask for a concrete goal before planning.
- `Approved plans cannot be changed`: use `flow_feature_reset` when only affected features need another pass; otherwise close and start a new goal.
- `No feature is currently running`: call `flow_run_start` before completing.
- `already in progress`: record an outcome, reset, or block the active execution before starting another.
- `Review assignment requires source-bound validation receipt refs`: call
  `flow_validation_start` immediately before the exact Bash command, collect
  the appended immutable ref after a passing outcome, and place it unchanged in
  `flow_review_start.request.validationRefs`.
- Review validation is failed, stale, mismatched, or missing: fix failures,
  capture a new receipt after the last source edit, and create a fresh assignment.
- `Feature review requires targeted validation`: use `validationScope:
  "targeted"` for the feature assignment.
- `Final review requires broad validation`: run the project-level gate after
  the last source edit and create a final assignment with `validationScope:
  "broad"` plus the exact passing feature-assignment result.
- `Review assignment ... is still pending`: recover it with
  `flow_status { "request": { "view": "reviewer", "assignmentId": "..." } }`;
  do not mint a
  second identity or rerun unchanged validation.
- `Completed results require one passing feature-review assignment`: submit the
  exact passing assignment result returned by the reviewer.
- Missing or unsubmitted reviewer response: keep the assignment pending while
  recoverable. If the host observed failed work that could not submit, record a
  failed `observed_unsubmitted` result with a blocking finding.
- Final feature awaiting review: keep it `in_progress`; awaiting review is not a blocker.
- `Review assignment ... is stale for the current source state`: do not submit
  it. Rerun validation and call `flow_review_start`; Flow invalidates the stale
  pending assignment and creates its replacement atomically.
- A failed review returns operation status `ok`: this is an accepted blocker,
  not a tool failure. With authorization, repair once and start one retry
  assignment with `correctionOfAssignmentId` equal to the immediately preceding
  failed assignment. After the second failure, stop; never start a third review.
- `Final completion requires one passing final-review assignment`: complete the
  feature assignment first in economy order, run broad validation, create the
  final assignment with that exact feature result, and submit only the final
  assignment result. Flow consumes the durable bound prerequisite and records
  both atomically.
- Final-review retry lost its feature result: for the same source, call
  `flow_status { request: { view: "detail" } }` and copy
  `workflowData.projection.finalReviewRetry.prerequisite.result` unchanged into
  the next final assignment request's `featureReview`. Compact and reviewer
  status omit the binding. A mismatch consumes no operation id, so correct and
  reuse it. After a source edit, rerun targeted feature review before a new
  broad/final sequence.
- Completed status with null closure: call a new guarded
  `flow_session_close { request: { mode: "start", kind: "completed", ...guards } }`;
  the final feature outcome itself does not close.
- Stored closure after archive failure: read the complete
  `closure.retryOperationId` from compact status and call only
  `flow_session_close { request: { mode: "retry", operationId } }`. Do not
  reconstruct or resubmit summary, causal guards, or a new close operation.
- Close operation id already exists in workspace history: if the close was not
  accepted for this session, choose a fresh operation id. Any mutation in any
  canonical Session v4 archive reserves the id; quarantine files do not. If
  canonical history is corrupt, unsupported, filename-mismatched, or
  ambiguous, preserve it and repair the history before retrying. A closureless
  Session v4 archive is invalid canonical history and must fail closed.
- Invalid chronology: validation receipt time is runtime-attested, so capture a
  new receipt in the correct order rather than editing metadata. Broad final
  validation starts no earlier than the passing feature-assignment result;
  review completion remains truthful reported time.
- Invalid completion payload: correct the nested `result` shape and reuse the
  same unconsumed operation id. Invalid input appends no partial review state.
- `Cannot close ... unfinished features`: complete, reset, defer, or abandon honestly. Do not mark completed while work remains.

## Reset guidance

Use `flow_feature_reset` when the active or completed work was built on the wrong assumption, validation revealed a design issue, dependencies need to be rerun, or dependent features must be invalidated. Resetting a feature also resets its dependents.

## Closure guidance

Use `flow_session_close`:

- `completed`: only after all planned features are complete.
- `deferred`: the user intentionally postpones unfinished work.
- `abandoned`: the session should be archived without claiming delivery.

After closure, the active `.flow/session.json` is removed and the archived JSON is stored under `.flow/history/`.
Every closure is quiescent before publication: no active execution or pending
assignment remains. Deferred and abandoned closure preserve unfinished progress
only as forensic history.
