---
name: flow-run
description: Implement, validate, independently review, and record one approved Flow feature. Use after plan approval as an advanced or recovery control; flow-auto is the normal end-to-end driver.
---

# Flow Run

Work on exactly one approved feature. The root manager owns the session,
integration, validation, review dispatch, reset, closure, and every
manager-owned lifecycle mutation. Bounded `flow-worker`
instances may contribute disjoint work; the reserved `flow-reviewer` owns the
independent review and submits its own result. Never use generic or
general-purpose agents for active Flow work.

## Start and scope

1. Call `flow_status { request: { view: "compact" } }` first. Treat
   `nextAction` as the durable default workflow direction, not as permission.
2. If the top-level response status is `error`, report its exact summary and
   recovery when present. State that this initial read made no lifecycle, Git,
   or release mutation, and stop. Do not route an error projection's
   `nextAction` as feature recovery.
3. If compact status contains `archiveRetry`, call `flow_session_close` once
   with that projected request byte-for-byte and report
   `workflowData.delivery`. If archive publication remains unconfirmed, refresh
   compact status. Stop after this cleanup outcome either way; it grants no new
   work and therefore precedes goal alignment.
4. When the projection contains an active goal, align it with the current
   direct `/flow-run` request before any other manager-owned lifecycle mutation.
   Continue only for the same goal or a compatible narrowing. Compatible
   narrowing may change method or emphasis, but must not add, drop, reorder, or
   weaken an approved requirement or feature outcome. A completed-but-unclosed
   session must close as completed before a new request proceeds. For other
   materially new or expanded work, make no mutation, say the request has not
   started, and offer to continue the active goal, defer it, or abandon it.
   Keep this comparison conversational; add no classifier or state.
5. If status is `idle` or `planning`, report its projected planning action,
   explain that `/flow-run` requires an approved feature, and stop without
   mutation.

Route every compact projection in this order:

- `flow_session_close`: close a completed session with its projected session id
  and revision, a fresh operation id, and `kind: "completed"`. Report
  `workflowData.delivery`, follow one projected exact `archiveRetry` if needed,
  and stop. A materially new request can enter Flow planning afterward; do not
  fabricate a run.
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

Use execution status as the active scope and source of revision guards. Read
the feature summary, targets, validation, dependencies, requirements, and
decisions before editing. A projected action may still fail an
environment-sensitive guard; refresh compact status and handle that exact
rejection instead of forcing the stale action.

Preserve unrelated worktree changes and stay inside the active feature. Leave
changes owned by another planned feature for that feature. If implementation
needs material scope outside the approved plan, stop editing. Finish the
approved plan or have the user explicitly choose deferred or abandoned closure
before starting a new plan; never replan the active approved session in place.
Use `flow_feature_reset` when a wrong design or invalid assumption requires a
fresh run within the active feature; do not layer a retry onto a bad execution.

## Evidence and risk preflight

Before editing or dispatching a worker, perform one preflight from the approved
feature and current worktree:

- Preserve every named finding or requirement ID from the feature prose and
  map it to an observable acceptance outcome.
- Inventory exact commands and behavior evidence, including any required
  operating system, architecture, tool, service, credential, external setting,
  or hardware. Confirm an available, authorized path for each.
- Inspect the baseline and unrelated work, including deletions, renames, file
  types, and executable modes.
- Write one concise adversarial checklist covering the outcome, failure and
  cleanup ordering, adjacent states, repetition/retry/interruption/concurrency,
  overlapping invariants, and other relevant platform or persistence risks.

Use the checklist and named IDs in every worker assignment and the review
packet. If required evidence needs user or external authority, stop before
implementation and ask. While required behavior or environment evidence is
knowingly skipped or unavailable, manager policy forbids calling
`flow_review_start`; a substitute pass does not cure the gap. Flow persists no
skipped-evidence ledger, and the reviewer treats missing proof as blocking if
the gap reaches its packet.

## Implement

Prefer the smallest change that satisfies the approved outcome. Follow the
repository's existing boundaries and conventions. Do not create lifecycle,
validation, audit, or handoff sidecars. Durable user-requested reports should
normally be one stable Markdown artifact; JSON requires an explicit request.

Do not stage, commit, push, publish, or mutate releases unless the user asks for
that separate action.

## Bounded worker waves

Work serially by default. Existing implementation authority covers a qualifying
worker wave; do not ask for separate approval. After manager orientation, fan
out only when two or three genuinely independent, non-overlapping slices can be
named and parallel execution has clear benefit. Run one cohort of two or three
`flow-worker` instances at a time. Issue every cohort Task call in the same
assistant tool-use turn before consuming any result. If the host or model
serializes those calls, treat and report that execution as serial instead of
claiming parallelism. Each prompt must name a stable slice id, the exact outcome
and read or write scope, expected coverage, recommended manager checks,
dependencies, a stop condition, and the applicable adversarial acceptance and
risk checklist from preflight. A worker must receive the checklist before it
codes. Edit scopes must be exact and non-overlapping. Shared contracts,
lockfiles, and generated outputs remain manager-owned unless one worker
receives the whole relevant scope. Never substitute a generic agent for
`flow-worker`, including for read-only evidence gathering.

Workers cannot call Flow tools or spawn children. Each returns one concise
handoff containing status, scope and coverage, evidence or changed paths,
recommended manager checks, gaps and risks, and integration notes. Workers do
not run Bash; all executable checks remain manager-owned. Missing, partial, or
blocked output remains an explicit coverage gap.

After all workers stop, compare actual changed paths with every assigned scope,
then inspect the combined diff and evidence and reconcile unexpected paths or
conflicts before validation. At most one targeted follow-up wave may address a
failed slice, newly unlocked dependency, or material claim verification. Do
not start an automatic third wave. Coordination stays in the conversation:
create no manifest, sidecar, Session field, durable handoff, or recovery ledger.
After an interruption, inspect Flow status and the worktree and treat partial
worker edits as untrusted.

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

Immediately before each Bash command used as evidence, call
`flow_validation_start` with the current revision, feature id, the exact
command, and `scope` (`focused` or `broad`). Run that byte-for-byte command next
and inspect its complete outcome. Flow records the host-observed result directly
in the session; do not copy host-observed fields into a later request. The exact
command is durable, so never inline tokens, passwords, credentials, or other
secrets. Raw output is deliberately neither persisted nor projected: the
durable evidence is the command, exit code, output completeness, and output
digest, while the manager must inspect the live output.

Exact plan-listed gate commands are recorded byte-for-byte.
A failed, incomplete, or source-drifted exact plan-listed observation creates a
freshness boundary. Before new review admission, that gate needs a complete
exit-zero observation for current source recorded after its latest relevant
failure or drift; returning to an older digest does not revive an earlier pass,
and substitute broad validation cannot discharge it. If that gate cannot pass,
the normal completed path remains unavailable; fix the gate or ask the user to
choose deferred or abandoned closure. An already accepted review is
grandfathered: do not reopen it or add a retroactive close-time veto. Plan-listed
validation prose that has never run as an exact command remains reviewer
judgment, not a fabricated pass or failure.

Every host-observed validation advances the session revision through the
after-hook. The `[flow-validation]` marker for an accepted observation includes
`passed` and `recordedRevision`; the revision is only a concurrency token. When
`passed: true`, use that exact revision for `flow_review_start` only if all
runtime review gates still hold, or use it for the next
`flow_validation_start`. When `passed: false` because validation failed, output
was incomplete, or the source digest drifted, use its revision only to arm fresh
validation, never review. Do not refresh compact status solely to rediscover an
eligible token. If the marker is absent or malformed, capture was rejected, or
routing state must be reconfirmed, refresh compact status before mutating. In
every case, the revision used to arm the completed command is stale.

Use focused validation for ordinary features. For the final feature, run the
repository's broad applicable gate after the last relevant edit. A source edit
invalidates earlier applicability. Failed or unavailable checks are blockers,
not passing evidence. If the canonical gate cannot run, explain why the chosen
equivalent is broad enough; otherwise record the narrower evidence as focused.

Immediately before review admission, reconcile the preflight inventory against
the recorded current-source observations. Do not call `flow_review_start` while
known required behavior or environment evidence is skipped or unavailable,
including requirements that are not exact stored commands. This is manager
workflow policy rather than a persisted runtime gate.

## Review and record

After successful applicable validation, call `flow_review_start` with a fresh
operation id, current revision, feature id, every changed workspace-relative
artifact path, and a
bounded packet summary plus risk lenses. Pass `artifactsChanged` as a top-level
request field, not inside the packet; use an empty array only when the feature
changed no repository artifact. Flow selects current applicable validation
automatically and derives `feature` versus `final` review from plan progress;
callers do not supply the review kind.

The packet must preserve the feature's named finding and requirement IDs and
summarize the preflight checklist, adjacent state transitions, repeated and
failure-path behavior, overlapping feature invariants, and the inspected base
diff including deletions, renames, file types, and executable-mode changes.
Call out any item that needs independent reviewer scrutiny; do not hide a known
evidence gap in prose.

Dispatch the returned assignment only to the reserved `flow-reviewer`. Do not
perform the independent review in manager context and never copy or submit its
verdict. The reviewer reads its assignment, inspects the workspace, and calls
`flow_feature_complete` directly; the runtime verifies the calling agent. The
reviewer remains workspace-read-only and may make only this exact result
submission as its sole lifecycle mutation.

After dispatch, read compact status rather than trusting reviewer prose. If the
top-level response is an error, report its exact summary and recovery when
present, say the latest lifecycle state could not be confirmed, and stop
without further mutation. Do not claim this invocation made no lifecycle
mutation: it may already have started review or recorded a reviewer result.
Never invent or submit a verdict. If status remains running, apply the
`dispatch-flow-reviewer` or running `flow_feature_reset` route above. If status
is blocked, load detail through the single blocked route above. A recorded pass
completes the feature.

### Blocked review

Use compact `blockedFeature.failedReviewCount` with the one detail projection.

- A `[scope-blocker]` checkpoints immediately. Do not reset automatically.
- On the first ordinary failed review, existing implementation authority
  permits one automatic `flow_feature_reset` with the blocked `featureId` as
  `nextFeatureId`. That call atomically starts the fresh full retry. Fix only its
  blocking findings, then run full validation and full independent review.
- A feature whose latest relevant reviewed outcome remains failed is never
  selected implicitly. `/flow-auto` may still continue an untouched,
  dependency-independent feature. When every runnable candidate requires a
  retry, compact status is `ready` with `await-user-direction`. The failed run
  has already been superseded: after explicit direction, read detail once and
  call `flow_run_start` with the exact retry feature ID. Do not reset from that
  ready checkpoint.
- After the second failed review, retry only when the current aligned request
  explicitly authorizes one additional attempt. Pass the blocked feature as
  `nextFeatureId` on `flow_feature_reset`; if that attempt fails, checkpoint
  again.
- If explicit direction instead selects another planned,
  dependency-independent feature, pass that feature's exact `featureId` as
  `nextFeatureId` on `flow_feature_reset`. Reset supersedes the affected
  attempts and starts that exact run in one transaction. Do not reset first,
  call `flow_run_start` separately, or rely on default selection.

When stopping blocked, label the result overall incomplete. Report what the
latest repair fixed; recurring and new blocking findings; the goal and progress;
the blocked feature, attempt, and failure count; completed and untouched
features; latest validations and `artifactsChanged` as Flow-reported artifact
evidence; Git and release mutation status; whether the current request started
and matched the active goal; the exact `nextAction`; and whether another attempt
requires explicit authorization.

Use that already-loaded compact status after every recorded outcome. Direct
`/flow-run` reports this one feature's cumulative outcome and `nextAction`, then
stops. Under `/flow-auto`, return to its lifecycle loop.
