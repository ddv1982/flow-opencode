# Recovery playbook: structured errors and how to get unstuck

Flow tools fail with a structured envelope, not free text. Read it before improvising: `status: "error"`, a `summary`, and usually an `errorCode`, a `resolutionHint`, and a `nextCommand` (sometimes `nextRuntimeTool` + `nextRuntimeArgs` you can call directly). The hint is written for the exact failure — follow it first; the catalog below adds context.

## Session close blocked: `unfinished_features`

`flow_session` with `action: "close", kind: "completed"` while planned features are below the completion target returns `status: "error"` with `blocker: "unfinished_features"` and the offending `unfinishedFeatureIds`.

Recover by one of:

1. Finish the listed features (`flow_run_start` → implement → `flow_feature_complete`) and close again.
2. If the plan's delivery policy genuinely allows deferring them, get them out of the target honestly (a real plan revision the user agrees to), then close.
3. Close as `kind: "deferred"` (work parked, intent to resume) or `kind: "abandoned"` (work dropped) with a `summary` saying what is left and why.

Never pick option 3 just to silence the blocker on work the user expects completed — that is bypassing a review/completion gate, and the closure summary you write will say otherwise.

## Feature completion rejected by `flow_feature_complete`

All of these are persisted-state-safe: nothing was recorded, fix the input and retry.

- `missing_validation_evidence` — `validationRun` was empty. Run real checks, record `{command, status, summary}` per run, retry.
- `missing_targeted_validation` / `missing_broad_validation` — wrong or missing `validationScope`. Non-final features need `validationScope: "targeted"`; the feature that completes the session needs `"broad"` (the repo's full standard gate), run and recorded.
- `failing_validation` — a `validationRun` entry is not `passed`. Fix the failure, re-run, and reset the feature first if the recovery says so (`nextRuntimeArgs: { reset: true, featureId }`). Do not relabel a failing run as passed.
- `missing_feature_reviewer_decision` / `missing_final_reviewer_decision` — strict review policy: record an approved decision via `flow_review_record` (`scope: "feature"` with the matching `featureId`, or `scope: "final"` with `reviewDepth` matching the plan's `deliveryPolicy.finalReviewPolicy`), then retry completion.
- `failing_feature_review` / `failing_final_review` — the runtime-required review payload has `status` ≠ `passed` or blocking findings. Fix the findings through execution, re-validate, re-review; reset the feature when the recovery directs it.
- `missing_final_review_payload` — last feature of the session: include a passing `finalReview` (with `reviewDepth` matching the policy) in the completion payload.

If the same feature fails completion twice for the same `errorCode`, stop and ask the user instead of looping (the runtime tracks `sameCategoryFailureCount` for exactly this).

## Corrupted or missing session state: failing `session_artifacts` check

`flow_status` (detailed view) runs readiness checks. A failing `session_artifacts` check means an active session exists but its persisted artifacts are missing or its id is malformed — the runtime cannot load it.

1. Read the check's `summary`, `remediation`, and `details` (they name the exact path and which artifact is unreadable).
2. Inspect `.flow/active/<session-id>/` — this is the one situation where looking inside `.flow/**` is right; repairing still follows the remediation text, and never hand-edit state speculatively.
3. If the session is unsalvageable, remove the corrupted directory per the remediation, then `flow_session` `history` to find a prior good session to `activate`, or start fresh with `flow_plan_save`.

## Approved-plan mutation rejected

The approved plan is immutable by design. To change course: reset the affected features (`flow_feature_complete` with `reset: true`), save the revised plan with `flow_plan_save`, get it re-approved with `flow_plan_approve`, and tell the user what changed and why. Do not try to sneak scope in through an unrelated feature.

## General rules

- After any error, re-anchor with `flow_status` before acting — never on conversation memory of what the state "should" be.
- Errors marked `retryable: true` are safe to retry once the named prerequisite is fixed; an immediate identical retry without fixing anything is never the answer.
- When a `resolutionHint` and this playbook disagree, the hint wins — it was generated from the actual session state.
