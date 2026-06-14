# Recovery Playbook

Flow errors are structured: `status: "error"` plus `summary`, usually
`errorCode`, `resolutionHint`, `nextCommand`, or `nextRuntimeTool` /
`nextRuntimeArgs`. Follow the live hint first.

## Close blocked: `unfinished_features`

Recover by finishing the listed features, revising the plan if delivery policy
truly allows deferral, or closing as `deferred`/`abandoned` only when work is
honestly parked or dropped. Never use alternate closure kinds to dodge work the
user still expects completed.

## Completion rejected

No state was recorded; fix input and retry. Codes:

- `missing_validation_evidence`: run real checks; include command, status,
  summary.
- `missing_targeted_validation` / `missing_broad_validation`: set
  `validationScope` to `targeted` for normal features or `broad` for the final
  target feature.
- `failing_validation`: fix, rerun, and reset first when recovery says so.
- `missing_feature_reviewer_decision` / `missing_final_reviewer_decision`:
  record the required approved `flow_review_record`.
- `failing_feature_review` / `failing_final_review`: fix findings, revalidate,
  rereview, and reset when directed.
- `missing_final_review_payload`: include a passing `finalReview` on the final
  target feature.

Do not relabel failures as passes. Same feature, same `errorCode` twice: stop.

## `session_artifacts` check failed

Detailed `flow_status` could not load active artifacts. Read the check's
`summary`, `remediation`, and `details`; inspect `.flow/active/<session-id>/`
only for this repair case; if unsalvageable, follow remediation, then use
`flow_session` history/show or start fresh.

## Approved-plan mutation rejected

Reset affected features, save a revised plan with `flow_plan_save`, reapprove,
and tell the user what changed.

## General rules

- After any error, re-anchor with `flow_status`.
- Retry only after fixing the named prerequisite.
- If this playbook and `resolutionHint` disagree, the hint wins.
