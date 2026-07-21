---
name: flow-run
description: Implement, validate, independently review, and record one approved Flow feature. Use after plan approval as an advanced or recovery control; flow-auto is the normal end-to-end driver.
---

# Flow Run

Work on exactly one approved feature. The root manager owns the session,
integration, validation, review dispatch, reset, closure, and every
manager-owned lifecycle mutation. Bounded `flow-worker`
instances may contribute disjoint work; the reserved `flow-reviewer` owns the
independent review and submits its own result.

## Start and scope

1. Call `flow_status { request: { view: "compact" } }` first. Treat
   `nextAction` as the durable default workflow direction, not as a permission
   grant.
2. If compact status contains `archiveRetry`, call `flow_session_close` once
   with that projected request byte-for-byte. Report `workflowData.delivery`;
   if archive publication still fails, refresh compact status. This exact
   cleanup grants no new work, so it precedes goal alignment. Stop after the
   cleanup outcome either way.
3. Before any other manager-owned lifecycle mutation, align the compact-projected
   goal with the current direct `/flow-run` request. Continue only for the same
   goal or a compatible narrowing. Compatible narrowing changes method or
   emphasis only; it must not add, drop, reorder, or weaken an approved
   requirement or feature outcome. A completed-but-unclosed session must close
   as completed before a new request proceeds. Otherwise, for materially new
   or expanded work, perform no mutation, say the request has not started, and
   offer to continue the active goal, defer it, or abandon it. Keep this
   comparison conversational; create no classifier or state.
4. If compact status is `completed`, call `flow_session_close` once with its
   session id and revision, a fresh operation id, and `kind: "completed"`.
   Report `workflowData.delivery`. If archive publication is unconfirmed,
   follow the projected `archiveRetry` once byte-for-byte and stop on any
   remaining failure. Then stop. A materially new request can enter the
   appropriate Flow planning route afterward; do not fabricate a run.
5. If compact status is already `blocked`, load
   `flow_status { request: { view: "detail" } }` exactly once before any reset.
   Apply the retry and checkpoint rule under **Review and record**. If it permits
   a fresh run, call `flow_feature_reset`, refresh compact status, and continue
   this invocation. Otherwise report the checkpoint and stop.
6. If compact status is `running` and `nextAction` is `flow_feature_reset`, the
   pending review is source-stale. Call `flow_feature_reset`, refresh compact
   status, and continue with a fresh run. Do not redispatch that assignment.
7. If compact status is `running` and `nextAction` is
   `dispatch-flow-reviewer`, skip run start, implementation, and validation;
   continue at **Review and record** with the existing pending assignment.
8. A durable `nextAction` can still be rejected after status by an
   environment-sensitive guard. On rejection, refresh compact status and
   handle the exact error instead of forcing a stale action.
9. Call `flow_run_start` when a ready feature is not already running.
10. Read `flow_status { request: { view: "execution" } }` and use that
   projection as the active scope and source of revision guards.
11. Read the feature summary, targets, validation, dependencies, requirements,
   and decisions before editing.

Preserve unrelated worktree changes and stay inside the active feature. Leave
changes owned by another planned feature for that feature. If implementation
needs material scope outside the approved plan, stop editing. Finish the
approved plan or have the user explicitly choose deferred or abandoned closure
before starting a new plan; never replan the active approved session in place.
Use `flow_feature_reset` when a wrong design or invalid assumption requires a
fresh run within the active feature; do not layer a retry onto a bad execution.

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
dependencies, and a stop condition. Edit scopes must be exact and
non-overlapping. Shared contracts, lockfiles, and generated outputs remain
manager-owned unless one worker receives the whole relevant scope.

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
A known failed exact plan-listed gate
cannot be discharged by substitute broad validation before new review
admission. If that gate cannot pass, the normal completed path remains
unavailable; fix the gate or ask the user to choose deferred or abandoned
closure. An already accepted review is grandfathered: do not reopen it or add a
retroactive close-time veto. Plan-listed validation prose that has never run as
an exact command remains reviewer judgment, not a fabricated pass or failure.

Every host-observed validation advances the session revision through the
after-hook. Immediately refresh
`flow_status { request: { view: "compact" } }` after the command and before the
next `flow_validation_start` or `flow_review_start` mutation; the revision used
to arm the command is stale.

Use focused validation for ordinary features. For the final feature, run the
repository's broad applicable gate after the last relevant edit. A source edit
invalidates earlier applicability. Failed or unavailable checks are blockers,
not passing evidence. If the canonical gate cannot run, explain why the chosen
equivalent is broad enough; otherwise record the narrower evidence as focused.

## Review and record

After successful applicable validation, call `flow_review_start` with a fresh
operation id, current revision, feature id, every changed workspace-relative
artifact path, and a
bounded packet summary plus risk lenses. Pass `artifactsChanged` as a top-level
request field, not inside the packet; use an empty array only when the feature
changed no repository artifact. Flow selects current applicable validation
automatically and derives `feature` versus `final` review from plan progress;
callers do not supply the review kind.

Dispatch the returned assignment only to the reserved `flow-reviewer`. Do not
perform the independent review in manager context and never copy or submit its
verdict. The reviewer reads its assignment, inspects the workspace, and calls
`flow_feature_complete` directly; the runtime verifies the calling agent. The
reviewer remains workspace-read-only and may make only this exact result
submission as its sole lifecycle mutation.

After the reviewer returns, read compact status rather than treating prose as
the outcome. If it records a blocked outcome, immediately load
`flow_status { request: { view: "detail" } }` exactly once for the handoff or
checkpoint. Redispatch the same pending assignment after interruption or an
unconfirmed reviewer return only while compact status is `running` and
`nextAction` is `dispatch-flow-reviewer`. If status remains `running` with that
pending assignment and `nextAction` is `flow_feature_reset`, or submission
reports `Workspace content changed after review started`, call
`flow_feature_reset` and do not redispatch the source-stale assignment; start a
fresh run and repeat full validation and review. Never fabricate a verdict. A
submitted pass completes the feature; a submitted blocking finding records a
blocked outcome.

Use compact `blockedFeature.failedReviewCount` and that one detail projection
together. A `[scope-blocker]` checkpoints immediately and must not reset
automatically. Otherwise treat the first recorded failed review as in-scope;
when implementation is already authorized, it may receive one automatic
`flow_feature_reset`. Fix only its blocking findings, then repeat full
validation and full review in a fresh run. A second recorded failed review
awaits explicit user direction; report recurring and new blockers, possible
feature mis-sizing, and any repair that would exceed approved scope while
remaining inside Flow. A current aligned request counts as direction only when
it explicitly authorizes one additional attempt. If that review fails,
checkpoint again.

Read compact status after every recorded outcome. When invoked directly through
`/flow-run`, report that one feature's outcome and `nextAction`, then stop. When
the active driver is `/flow-auto`, return to its loop so it can start the next
feature, report a blocker, or close the completed session.
