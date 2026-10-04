---
name: flow-run
description: Implement, validate, independently review, and record one approved Flow feature. Use after plan approval as an advanced or recovery control; flow-auto is the normal end-to-end driver.
---

# Flow Run

Work on exactly one approved feature.

## Start

1. Call `flow_status { request: { view: "compact" } }` first. Treat
   `nextAction` as the durable default, not as permission.
2. If the top-level response status is `error`, report its exact summary and
   recovery when present and, if `workflowData.delivery` exists, the handoff
   below. This read made no lifecycle, Git, or release mutation. Stop. Do not
   route its `nextAction`.
3. If compact status contains `archiveRetry`, call `flow_session_close` once
   with the projected request byte-for-byte. Report delivery under the contract
   below. Refresh only if publication is unconfirmed. Stop after this cleanup
   either way; it grants no work.
 4. When the projection contains an active goal, align it with the current
   `/flow-run` request before another manager lifecycle mutation. Continue only
   for the same goal or a method/emphasis narrowing that preserves all outcomes;
   authority the request adds over those same outcomes is continuation, not
   expansion. Close completed work. Unless the next step applies, new or expanded work
   makes no mutation: report that it has not started and offer continue, defer,
   or abandon. Continue a method or emphasis narrowing, extra evidence, or added
   authority over those same outcomes, including "do the research and save the plan"
   when that plan is already promised. Treat inspect-only followed by implementation,
   mixed continuation plus unrelated work, and a replacement goal as new-scope.
5. If the aligned request explicitly chooses deferred or abandoned closure for
   a non-completed session, call `flow_session_close` with compact session id and
   revision, fresh operation id, that kind, and optional summary. Report delivery
   under the contract below, follow a projected exact `archiveRetry`, and stop.
6. If status is `idle` or `planning`, report its projected planning action,
   explain that `/flow-run` requires an approved feature, and stop without
   mutation.

Delivery handoff: report `workflowData.delivery.summary.lines`. For requested
full detail or a missing summary, use the retained close response's `report`.
Map IDs only
from delivery `outcomeSummary`/`terminalFindings`. Requirements are `verified`,
`incomplete`, or explicitly `deferred`, and `abandoned` remains the kind. If
delivery is absent, report exact recovery and no map. On revision conflict,
refresh compact; retry only for the same session and goal while status still
permits the selected closure kind; never close a replacement.

## Route

Follow compact `nextAction` in this order:

- `flow_session_close`: close completed work with its projected session
  id/revision, fresh operation id, and `kind: "completed"`. Report delivery,
  follow one exact `archiveRetry` if needed, and stop.
- `await-user-direction` or blocked `flow_feature_reset`: call
  `flow_status { request: { view: "detail" } }` exactly once, then apply
  **Blocked review**.
- Running `flow_feature_reset`: the pending review is source-stale. Reset with
  the same feature as `nextFeatureId` when continuing it. Never redispatch that
  assignment.
- `dispatch-flow-reviewer`: read execution status. If that read errors, report
  its exact summary and recovery when present and stop. Otherwise route that
  refreshed projection. Dispatch under **Review** only if `nextAction` is still
  `dispatch-flow-reviewer`. If it is now running `flow_feature_reset`, follow
  the source-stale reset route.
- `flow_run_start`: start the ready feature, refresh compact status, and read
  execution status.
- `flow_validation_start`: read execution status and resume from the current
  worktree.
- `flow_review_start`: read execution status and continue at **Review**.
- Any other action: report it and stop.

Use execution status for scope and revision. Stay in the feature; reset a wrong
design instead of layering retries.

## Implement

New runs capture host-owned baseline evidence before returning. For explicitly
accepted existing work, pass `existingWork` with a full local immutable
`baseCommit` and exact normalized `ownedPaths` to run start or atomic reset.
These paths identify accepted dirty work and grant no new scope. Retries reuse
the original feature baseline. A legacy run without one needs a fresh/reset run
with an explicit existing-work base and inventory, or a preparation blocker.
Never relabel current edits as the original baseline.
For legacy work, recover prior Git facts from retained history and identify any
gap instead of guessing which edits predated the feature. Preserve unrelated work.

Make the smallest change that satisfies the approved outcome. Create no
lifecycle or handoff sidecars. Do not stage, commit, push, publish, or mutate
releases unless asked separately.

Work serially. After a feature run is active, dispatch `flow-worker` only for
two or three genuinely independent slices with clear benefit. Workers call no
Flow tools, spawn no children, and run no Bash. Integrate and inspect the
combined diff before validation.

## Validate

Arm each evidence command immediately before running it byte-for-byte with
`flow_validation_start` (current revision, feature id, exact command, `scope`).
For nonempty planned assertions, execute the exact command that writes the
plan-bound JUnit path `.flow/results.xml`. Omit `resultsPath` from
`flow_validation_start` or repeat that value exactly. Never substitute another
path. Legacy approved plans whose command lacks the managed path must pass one
normalized workspace-relative `resultsPath`.
Flow records the host observation; copy no host-observed fields.

`scope: "broad"` runs the plan's gate evidence command and nothing else.

For a complete failed broad gate that requires `pass` before review, use `flow_plan_amend` for a
reversible same-goal prerequisite. Supply the validation id, reason, repair,
targets, and truthful attestations. Keep the goal and gate fixed. Preserve test
discovery, assertions, and acceptance criteria; never exclude or skip existing
tests. Choose and test a supported reversible compatibility remedy within that
repair scope; keep or revert it from evidence without another approval question.
There is no amendment count limit; continue supported same-goal repairs under
these checks. Later amendments need canonical failure evidence recorded after
the preceding amendment; never reuse its failure to create another repair.
New outcomes, scope blockers, and unavailable declared hosts need direction.

A gate that cannot pass must first name the failing case or output that blocks
it for `scope: "gate"`. If the bounded amendment rule above does not apply, leave this exact
handoff before returning:
`Environment: <declared environment>`, `Command: <exact planned command>`, and
`Next step: Run this command there and resume Flow, or choose defer/abandon.`

Every capture advances revision. Use `[flow-validation].recordedRevision` next.
`pass` needs passing evidence. A complete declared `observe` may exit nonzero;
record its finding and continue the required checks. Never reclassify a required
failure after approval. Inspect-only `gate-observe` follows projected review.
If the marker is absent, refresh status. Observation never grants repair scope.

For the final feature, run the plan's gate command at broad scope after the
last relevant edit.

## Review

After applicable validation is accepted by Flow, call `flow_review_start` with a fresh
operation id, current revision, feature id, `artifactsChanged`, and a bounded
packet. Use the host-prepared diff for original/current content, types, and modes.
Explain unrelated pre-existing work and binary limitations. The reviewer still
judges scope and evidence adequacy.

The host prepares a complete source-bound diff before creating an assignment.
Missing, tampered, stale, oversized, or unsafe evidence blocks preparation
without spending a review attempt. Report the exact preparation error.
The reviewer obtains assigned content through bounded `reviewer-evidence` pages.

For inspect deliverables, rerun focused checks and tool-version commands after
the final document edit when claiming their results as current-source evidence.
Link each resulting validation ID in the review packet. Otherwise qualify the
claim as historical or remove it.

For persistence, schema, migration, replay, or recovery work, add only
the relevant full questions to `riskLenses`: can interruption leave partial
state; are retry and replay idempotent; can older state or readers fail visibly;
does rollback preserve data? For public API, config, command, package, or
documented-contract work, ask whether existing callers keep their defaults,
invalid inputs fail at the boundary, and the packed artifact exposes the
approved contract. Leave `riskLenses` empty for ordinary low-risk changes.
Dispatch only reserved `flow-reviewer`. Never review or submit its verdict in
manager context.

After dispatch, read compact status. On top-level error, report exact
summary/recovery and stop without further mutation. If status remains running,
apply the `dispatch-flow-reviewer` or running `flow_feature_reset` route. If
status is blocked, apply **Blocked review**. A recorded pass completes the
feature.

### Blocked review

Follow `nextAction` with the one detail projection for routing. At
`await-user-direction`, report `workflowData.statusReport` verbatim. Otherwise
print compact `findingsDigest`. The runtime already weighs `failedReviewCount`
and `blockedFeature.scopeBlocker`.

- Running `await-user-direction` means plan evidence is unsatisfied. Offer its
  command byte-for-byte and environment, defer, or abandon. Do not review or reset.

- Ready `await-user-direction` has no blocked run to reset. Retry the exact
  failed feature only with aligned user direction or an exact host-recommended
  `flow_run_start` request. Shadow advice grants no authority. Never reset ready state.
- For blocked `await-user-direction`, checkpoint unless host recovery status
  recommends a mutation. Use its exact request. Shadow grants nothing.
  Revalidate and review.
- For blocked `flow_feature_reset`, one automatic reset is allowed within approved
  feature authority. Use the blocked `featureId` as `nextFeatureId` for atomic
  reset/start. Fix blockers; rerun full validation and independent review.
  Inspections may repair only approved report/evidence targets, not product defects.
- When `failedReviewCount >= 2`, retry only when the current aligned request
  explicitly authorizes one additional attempt or host recovery supplies its exact request.
- If explicit direction selects another planned, dependency-independent
  feature, pass that exact `featureId` as `nextFeatureId` on
  `flow_feature_reset`.

Direct `/flow-run` reports compact `findingsDigest` and `nextAction`, then
stops. Under `/flow-auto`, return to its lifecycle loop.
