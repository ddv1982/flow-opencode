# Recovery playbook

Use this when a Flow tool returns `status: "error"`, a blocker, or a `nextAction` that conflicts with memory.

## First response

1. Re-anchor with `flow_status`.
2. Read the returned `summary`, `recovery`, `lastError`, and active feature.
3. Fix the cause, then retry the smallest valid Flow action.

## Common cases

- `missing_session`: start with `flow_plan_save` using the user's goal.
- `missing_goal`: ask for a concrete goal before planning.
- `Approved plans cannot be changed`: use `flow_feature_reset` when only affected features need another pass; otherwise close and start a new goal.
- `No feature is currently running`: call `flow_run_start` before completing.
- `already in progress`: finish, reset, or block the active feature before starting another.
- `Completion requires recorded validation evidence`: run real validation and include at least one passing `validationRun`.
- `Completion requires all recorded validation to pass`: fix failures and rerun. Do not relabel failed checks as passed.
- `Non-final feature completion requires targeted validation`: use `validationScope: "targeted"` for ordinary features.
- `Final feature completion requires broad validation`: run the project-level gate and use `validationScope: "broad"`.
- `Feature review depth ... does not meet the plan requirement`: rerun review
  at the feature's planned depth or reset/replan if the depth was chosen
  incorrectly.
- `Completion requires a passing featureReview`: run or request a real review and include a passing `featureReview` only when there are no blocking findings.
- `Review execution evidence is missing`: append every observed attempt to
  `reviewExecutions`, including failed `observed_unsubmitted` attempts; do not
  substitute optional orchestration telemetry.
- Final feature awaiting review: keep it `in_progress`; awaiting review is not a blocker.
- Contradictory verdicts for one review snapshot: stop. Economy mode forbids
  early final-review dispatch, and speculative mode remains disabled.
- `Review retry budget exhausted`: stop and report the remaining blocker. Do
  not keep patching; reset or replan only after explicit user direction.
- `Final feature completion requires a finalReview`: perform final review and include `finalReview`.
- `Final review depth must match the plan policy`: use `reviewDepth` equal to the approved plan's `finalReviewPolicy`; valid final-review values are `broad` and `detailed`.
- `Cannot close ... unfinished features`: complete, reset, defer, or abandon honestly. Do not mark completed while work remains.

## Reset guidance

Use `flow_feature_reset` when the active or completed work was built on the wrong assumption, validation revealed a design issue, dependencies need to be rerun, or dependent features must be invalidated. Resetting a feature also resets its dependents.

## Closure guidance

Use `flow_session_close`:

- `completed`: only after all planned features are complete.
- `deferred`: the user intentionally postpones unfinished work.
- `abandoned`: the session should be archived without claiming delivery.

After closure, the active `.flow/session.json` is removed and the archived JSON is stored under `.flow/history/`.
