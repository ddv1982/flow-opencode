---
name: flow-run
description: Implement, validate, independently review, and record one approved Flow feature. Use after plan approval as an advanced or recovery control; flow-auto is the normal end-to-end driver.
---

# Flow Run

Work on exactly one approved feature.

## Start and scope

1. Call `flow_status { request: { view: "compact" } }` first. Treat
   `nextAction` as the durable default workflow direction, not as permission.
2. If the top-level response status is `error`, report its exact summary and
   recovery when present and, if `workflowData.delivery` exists, the handoff
   below. State this initial read made no lifecycle, Git, or release mutation;
   stop and never route its `nextAction`.
3. If compact status contains `archiveRetry`, call `flow_session_close` once
   with the projected request byte-for-byte. Report delivery under the contract
   below. Refresh only if publication is unconfirmed. Stop after this cleanup
   either way; it grants no work.
4. When the projection contains an active goal, align it with the current
   `/flow-run` request before another manager lifecycle mutation. Continue only
   for the same goal or a method/emphasis narrowing that preserves all outcomes;
   close completed work. Unless step 5 applies, new/expanded work makes no
   mutation: report that it has not started and offer continue, defer, or
   abandon.
5. If the aligned request explicitly chooses deferred or abandoned closure for
   a non-completed session, call `flow_session_close` with compact session id and
   revision, fresh operation id, that kind, and optional summary. Report delivery
   under the contract below, follow a projected exact `archiveRetry`, and stop.
6. If status is `idle` or `planning`, report its projected planning action,
   explain that `/flow-run` requires an approved feature, and stop without
   mutation.

Route every compact projection in this order:

- `flow_session_close`: close completed work with its projected session
  id/revision, fresh operation id, and `kind: "completed"`. Report delivery
  under the contract below, follow one exact `archiveRetry` if needed, and stop.
  New work may enter planning afterward; do not fabricate a run.
- `await-user-direction` or blocked `flow_feature_reset`: call
  `flow_status { request: { view: "detail" } }` exactly once, then distinguish
  the projected status:
  - Ready `await-user-direction` has no blocked run left to reset. Identify the
    planned feature whose latest relevant reviewed outcome remains failed and
    checkpoint unless the current aligned request explicitly authorizes its
    retry. When authorized, call `flow_run_start` with that exact `featureId`;
    never call `flow_feature_reset` from ready status or rely on default
    selection.
  - For blocked status, apply **Blocked review** below. If it permits another
    feature run, pass that exact choice as `nextFeatureId` to
    `flow_feature_reset` so reset and run start are atomic, then route its
    returned projection; otherwise report the checkpoint and stop.
- Running `flow_feature_reset`: the pending review is source-stale. Reset with
  the same feature as `nextFeatureId` when continuing it, then route the returned
  projection. Never redispatch that assignment.
- `dispatch-flow-reviewer`: read execution status. If that read errors, report
  its exact summary and recovery when present and stop without dispatching; do
  not infer a projection. Otherwise route that refreshed projection before
  acting. Dispatch the recovered pending assignment under **Review and record**
  only if `nextAction` is still `dispatch-flow-reviewer`. If it is now running
  `flow_feature_reset`, follow the source-stale reset route and never dispatch
  that assignment. Skip run start, implementation, and validation.
- `flow_run_start`: start the ready feature, refresh compact status, and read
  execution status.
- `flow_validation_start`: read execution status and resume integration or
  validation from the current worktree.
- `flow_review_start`: read execution status and continue at **Review and
  record** without fabricating another validation.
- Any other action: report it and stop unless the runtime explicitly identifies
  an active execution path.

Use execution status for active scope/revision guards. Before editing, read the
feature summary, targets, validation, dependencies, requirements, and decisions.
If a projected action fails an environment-sensitive guard, refresh compact and
handle that rejection; never force it.

Summaries keep plan/source IDs `verified` or `incomplete`.
Delivery handoff: report `workflowData.delivery.report` verbatim. Map IDs only from
delivery `outcomeSummary`/`terminalFindings`; requirements are `verified`,
`incomplete`, or explicitly `deferred`, and `abandoned` remains the kind.
If delivery is absent, report exact recovery and no map; never invent or read
detail solely for closure. On revision conflict, refresh compact; retry only for
the same session and goal while status still permits the selected closure kind;
never close a replacement.

Preserve unrelated work and stay inside the feature. Out-of-plan work stops;
finish or obtain explicit deferred/abandoned closure before a new plan. Never
replan in place. Use `flow_feature_reset` for a wrong design or assumption; do
not layer retries.

## Evidence and risk preflight

Before editing or dispatching a worker, perform one preflight from the approved
feature and current worktree:

- Preserve every named finding/requirement; map each to an observable acceptance
  outcome.
- Inventory exact commands, behavior evidence, required operating system,
  architecture, service, credential, external setting, or hardware, and an
  authorized path for each.
- Reuse one conversational run baseline of unrelated work, deletions, renames,
  file types, and executable modes. Refresh changed facts; give each review only
  facts the feature changes or depends on, and give final review the full
  inventory.
- Write one concise adversarial checklist covering failure and cleanup ordering,
  adjacent states, repetition, retry, interruption, concurrency, overlapping
  invariants, and relevant platform or persistence risks. For concurrency or
  state-machine work, express it as a compact matrix with `state/interleaving`,
  `event`, `expected outcome`, `cleanup/invariant`, and `evidence` columns.

Carry the checklist/IDs through workers and review. Required evidence needing
user or external authority stops before implementation. If skipped or unavailable, it forbids
`flow_review_start`; a substitute pass cannot cure it.

## Implement

Make the smallest change satisfying the approved outcome and repository
boundaries. Create no lifecycle, validation, audit, or handoff sidecars. A
durable user-requested report is normally one stable Markdown artifact; JSON
requires an explicit request.

Do not stage, commit, push, publish, or mutate releases unless asked separately.

## Bounded worker waves

Work serially by default; existing authority covers a qualifying worker wave.
After manager orientation, fan out only two or three genuinely independent,
non-overlapping slices with clear benefit. Dispatch one cohort together if the
host runs concurrent tasks, otherwise sequentially; report serial either way. Each
assignment names a stable id, exact outcome/read-write scope, coverage, manager
checks, dependencies, stop condition, and preflight risk checklist. The worker
must receive the checklist before it codes. Shared contracts, lockfiles, and generated
output stay manager-owned unless wholly assigned to one worker.

Workers call no Flow tools, spawn no children, and run no Bash. Each returns
status, scope/coverage, evidence/changed paths, manager checks, gaps/risks, and
integration notes; missing or blocked output is a coverage gap.

After workers stop, reconcile paths/scopes and inspect combined diff/evidence
before validation. At most one targeted follow-up wave may repair a slice,
unlock a dependency, or verify a material claim; never a third. Create no
coordination ledger/sidecar. After interruption, inspect status/worktree and
treat partial worker edits as untrusted.

## Validate

Only validate after every worker has stopped and integration is settled. Choose
checks from the changed behavior and risk:

- Prefer focused behavioral tests that would fail without the change.
- Cover persistence, integration, API, browser, accessibility, package, or
  build paths when the feature touches them.
- Typecheck, lint, build, and static inspection are indirect evidence; they are
  sufficient alone only for genuinely mechanical or documentation-only work.
- UI claims need visual inspection when a runnable target is available.
- Cleanup claims need behavior-preservation evidence, not formatting alone.
- `scope: "broad"` is a claim about coverage, not a stronger label. Use it only
  for the repository's canonical applicable gate or a justified equivalent
  that covers the delivered repository state.

Immediately before each evidence Bash command, call `flow_validation_start`
with current revision, feature id, exact command, and `scope` (`focused` or
`broad`). Run it byte-for-byte next and inspect the complete outcome. Flow
records the host observation; copy no host-observed fields into a later request.
The command is durable, so include no secrets.

Exact plan-listed gate commands are recorded byte-for-byte.
A failed, incomplete, or source-drifted exact plan-listed observation creates a
freshness boundary. Before new review admission, that gate needs a complete
exit-zero observation for current source recorded after its latest relevant
failure or drift; returning to an older digest does not revive an earlier pass,
and substitute broad validation cannot discharge it. If that gate cannot pass,
the normal completed path remains unavailable; fix the gate or ask the user to
choose deferred or abandoned closure. Plan-listed validation prose that has never
run as an exact command remains reviewer judgment, not a fabricated pass or
failure.

Every host-observed validation advances the session revision, so the revision
that armed a completed command is stale. The `[flow-validation]` marker reports
`passed` and `recordedRevision`. Use `recordedRevision` for the next
`flow_validation_start`, or for `flow_review_start` only when `passed: true`. If
the marker is absent or malformed, refresh compact status before mutating.

Use focused validation for ordinary features. For the final feature, run the
repository's broad applicable gate after the last relevant edit. A source edit
invalidates earlier applicability. Failed or unavailable checks are blockers,
not passing evidence. If the canonical gate cannot run, explain why the chosen
equivalent is broad enough; otherwise record the narrower evidence as focused.

Immediately before review admission, reconcile the preflight inventory against
the recorded current-source observations. Do not call `flow_review_start` while
known required behavior or environment evidence is skipped or unavailable,
including requirements that are not exact stored commands.

## Review and record

After successful applicable validation, call `flow_review_start` with a fresh
operation id, current revision, feature id, `artifactsChanged` listing every
changed workspace-relative artifact path, and a bounded packet summary plus risk
lenses.

Keep the packet bounded. Map IDs to current-source commands or scenarios,
environment, and results. Put the feature-specific risk checklist under
`Risks/Matrix:`, representing it as a transition matrix for concurrency or
state-machine work. Include `Baseline:` facts only when this feature changes or
depends on them, except that final review receives the full inventory.
Ordinary-review plan/source IDs are limited to active-feature mappings or IDs
explicitly supplied for its packet; final review includes every approved
requirement/feature ID. Omit empty optional sections; state `none` only for a relevant
inspected absence. Never hide a gap.

Dispatch only to reserved `flow-reviewer`; never review, copy, or submit its
verdict in manager context. It reads the assignment/workspace and calls
`flow_feature_complete` directly; runtime verifies the caller. It stays
workspace-read-only, with that result submission as its sole lifecycle mutation.

After dispatch, read compact status. On top-level error, report exact
summary/recovery, say the latest lifecycle state could not be confirmed, and
stop without further mutation. Do not claim this invocation made no lifecycle
mutation: review may have started or recorded a result. Never invent or submit a
verdict. If status remains running, apply the
`dispatch-flow-reviewer` or running `flow_feature_reset` route above. If status
is blocked, load detail through the single blocked route above. A recorded pass
completes the feature.

### Blocked review

Follow `nextAction` with the one detail projection. The runtime already weighs
`failedReviewCount` and `blockedFeature.scopeBlocker`.

- `await-user-direction` means checkpoint. Do not reset.
- `flow_feature_reset` permits one automatic reset under existing
  implementation authority, with the blocked `featureId` as `nextFeatureId`.
  That call atomically starts the fresh full retry. Fix only its blocking
  findings, then run full validation and full independent review.
- A feature whose latest relevant reviewed outcome remains failed is never
  selected implicitly. `/flow-auto` may still continue an untouched,
  dependency-independent feature. When every runnable candidate requires a
  retry, compact status is `ready` with `await-user-direction`, handled by the
  ready route above.
- When `failedReviewCount >= 2`, retry only when the current aligned request
  explicitly authorizes one additional attempt. Pass the blocked feature as
  `nextFeatureId` on `flow_feature_reset`; if that attempt fails, checkpoint
  again.
- If explicit direction instead selects another planned,
  dependency-independent feature, pass that feature's exact `featureId` as
  `nextFeatureId` on `flow_feature_reset`. Reset supersedes the affected
  attempts and starts that exact run in one transaction. Do not reset first,
  call `flow_run_start` separately, or rely on default selection.

When stopping blocked, label overall incomplete. Report the latest repair proved
pending a passing review; recurring and new blockers; goal/progress; blocked
feature, attempt, and failure count; completed/untouched features; latest
validations and `artifactsChanged` as Flow-reported artifact evidence; Git/release
mutation status; whether this request started and matched the goal; exact
`nextAction`; and whether another attempt requires explicit authorization.

Use that already-loaded compact status after every recorded outcome. Direct
`/flow-run` reports this one feature's cumulative outcome and `nextAction`, then
stops. Under `/flow-auto`, return to its lifecycle loop.
