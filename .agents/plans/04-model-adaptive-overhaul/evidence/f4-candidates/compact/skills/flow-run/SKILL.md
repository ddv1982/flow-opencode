---
name: flow-run
description: Implement, validate, independently review, and record one approved Flow feature. Use after plan approval as an advanced or recovery control; flow-auto is the normal end-to-end driver.
---

# Flow Run

Work on exactly one approved feature.

## Start

1. Call `flow_status { request: { view: "compact" } }` first. Treat `nextAction` as the durable default, not permission.
2. On top-level error, report exact summary, available recovery, and the available delivery handoff below. State that this read made no lifecycle, Git, or release mutation. Stop without routing `nextAction`.
3. For `archiveRetry`, replay its projected `flow_session_close` request once, byte-for-byte. Report the handoff below. Refresh only if publication is unconfirmed, then stop either way. Cleanup grants no work authority.
4. If an active goal is projected, align it with `/flow-run` before mutation. Continue only for the same goal or a method or emphasis narrowing preserving every outcome. Close completed work. Except for the next step, new or expanded work makes no mutation. Report it unstarted and offer continue, defer, or abandon.
5. For an aligned explicit deferred or abandoned choice on a non-completed session, use the closure protocol below with that kind. Follow exact `archiveRetry` and stop.
6. For `idle` or `planning`, report the projected planning action. Explain that `/flow-run` requires an approved feature, then stop without mutation.

For fresh closure, call `flow_session_close` with compact session id and revision, fresh operation id, chosen kind, and optional summary. Report the handoff.

Handoff: report `workflowData.delivery.report` verbatim. Map IDs only from `outcomeSummary` and `terminalFindings`. Requirements are `verified`, `incomplete`, or explicitly `deferred`. Keep `abandoned` as the kind. Without delivery, report exact recovery and no map.

On revision conflict, refresh compact. Retry only the same session and goal while status permits the selected closure kind. Never close a replacement.

## Route the projection

Follow compact `nextAction` in this order:

- `flow_session_close`: use the closure protocol with `kind: "completed"` for completed work. Follow one exact `archiveRetry` if needed, then stop.
- `await-user-direction` or blocked `flow_feature_reset`: call `flow_status { request: { view: "detail" } }` exactly once, then apply **Blocked review**.
- Running `flow_feature_reset`: the pending review is source-stale. Reset with the same feature as `nextFeatureId` when continuing it. Never redispatch that assignment.
- `dispatch-flow-reviewer`: read execution status. On error, report exact summary and available recovery, then stop. Route the refreshed projection. Dispatch under **Review** only if `nextAction` remains `dispatch-flow-reviewer`. Use the source-stale reset route if it becomes running `flow_feature_reset`.
- `flow_run_start`: start the ready feature, refresh compact status, then read execution status.
- `flow_validation_start`: read execution status and resume from the current worktree.
- `flow_review_start`: read execution status and continue at **Review**.
- Any other action: report it and stop.

Use execution status for scope and revision. Stay within the feature. Reset a wrong design instead of layering retries.

## Implement

Make the smallest change that satisfies the approved outcome. Create no lifecycle or handoff sidecars. Do not stage, commit, push, publish, or mutate releases unless asked separately.

Work serially unless two or three independent slices offer clear benefit. For those implementation slices, dispatch `flow-worker` only after the run is active. Workers call no Flow tools, spawn no children, and run no Bash. Integrate and inspect the combined diff before validation.

## Validate

Arm `flow_validation_start` with current revision, feature id, exact command, and `scope` immediately before running that command byte-for-byte. Flow records the host observation. Copy no host-observed fields.

For nonempty planned assertions, run the exact command writing JUnit to plan-bound `.flow/results.xml`. Omit `resultsPath` or repeat `.flow/results.xml` exactly. Never substitute another path. For legacy approved plans whose command lacks the managed path, pass one normalized workspace-relative `resultsPath`.

`scope: "broad"` runs only the plan's gate command. Failed or stale planned commands block review until those exact commands pass for current source. For the final feature, run the plan's gate at broad scope after the last relevant edit.

If the gate cannot pass, name the failing case or output first. Before returning, give this exact handoff:

`Environment: <declared environment>`
`Command: <exact planned command>`
`Next step: Run this command there and resume Flow, or choose defer/abandon.`

Every host-observed validation advances revision. The `[flow-validation]` marker reports `passed`, `recordedRevision`, and declared `assertions`. Use `recordedRevision` for the next `flow_validation_start`, or for `flow_review_start` only when `passed: true`. Without the marker, refresh compact before mutating.

## Review

After successful applicable validation, call `flow_review_start` with fresh operation id, current revision, feature id, `artifactsChanged`, and bounded packet.

For persistence, schema, migration, replay, or recovery work, include only relevant full questions in `riskLenses`. Can interruption leave partial state? Are retry and replay idempotent? Can older state or readers fail visibly? Does rollback preserve data?

For public API, config, command, package, or documented-contract work, ask whether existing callers keep defaults, invalid inputs fail at the boundary, and the packed artifact exposes the approved contract. Leave `riskLenses` empty for ordinary low-risk changes.

Dispatch only the reserved `flow-reviewer`. Never review or submit its verdict in manager context.

After dispatch, read compact. On top-level error, report exact summary and available recovery, then stop without mutation. If running, use the `dispatch-flow-reviewer` or running `flow_feature_reset` route. If blocked, apply **Blocked review**. A recorded pass completes the feature.

### Blocked review

Route from `nextAction` and the one detail projection. Print compact `findingsDigest` as the user-facing list. The runtime weighs `failedReviewCount` and `blockedFeature.scopeBlocker`.

- Running `await-user-direction`: plan evidence is unsatisfied. Offer its command byte-for-byte and environment, defer, or abandon. Do not review or reset.
- Ready `await-user-direction`: no blocked run remains. Identify the planned feature whose latest relevant reviewed outcome remains failed. Checkpoint unless the current aligned request explicitly authorizes retry. If authorized, call `flow_run_start` with that exact `featureId`. Never reset from ready status.
- Blocked `await-user-direction`: checkpoint without reset.
- Blocked `flow_feature_reset`: under existing implementation authority, reset once automatically with blocked `featureId` as `nextFeatureId`. This starts the new run atomically. Fix only its blocking findings, then run full validation and full independent review.
- For `failedReviewCount >= 2`, retry only when the current aligned request explicitly authorizes one additional attempt.
- For explicit direction selecting another planned, dependency-independent feature, pass its exact `featureId` as `nextFeatureId` on `flow_feature_reset`.

Direct `/flow-run` reports compact `findingsDigest` and `nextAction`, then stops. Under `/flow-auto`, return to its lifecycle loop.
