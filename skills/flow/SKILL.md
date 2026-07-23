---
name: flow
description: Drive a Flow goal from planning through implementation, validation, independent review, and explicit closure. Use flow-auto as the normal end-to-end interface; use flow-plan for plan-only work and flow-run or flow-status for advanced recovery.
---

# Flow

Flow is a small state ledger around coding work. An active Flow session is
authoritative for its goal until completed, deferred, or abandoned closure.
Do not silently fall back to ordinary non-Flow coding. The root manager owns
the session, integration, validation, review dispatch, reset, closure, and every
manager-owned lifecycle mutation. Bounded `flow-worker`
instances may contribute disjoint work inside the active feature. The reserved
`flow-reviewer` independently reviews and submits its own result through
`flow_feature_complete`; it cannot edit the workspace or make any other
lifecycle mutation. Do not dispatch generic or general-purpose agents for
active Flow planning, implementation, evidence gathering, or review. Use only
the root manager and the two reserved Flow roles.

## Route from status

1. Call `flow_status { request: { view: "compact" } }` first. Trust its
   projection over conversation memory. Treat `nextAction` as the durable
   default workflow direction, not permission to exceed or a reason to discard
   existing user authority.
   If compact status contains `archiveRetry`, the close was already accepted:
   call `flow_session_close` once with that projected request byte-for-byte,
   then refresh compact status. Stop if archive publication remains
   unconfirmed; otherwise continue from the refreshed projection. This exact
   cleanup grants no new work, so it precedes goal alignment.
   Before any other manager-owned lifecycle mutation, align the compact-projected
   goal with the current user request. Continuation and compatible narrowing
   proceed inside the approved goal. Compatible narrowing changes method or
   emphasis only; it must not add, drop, reorder, or weaken an approved
   requirement or feature outcome. For materially new or expanded work,
   perform no mutation. Say the new request has not started, and offer to
   continue the active goal, defer it, or abandon it. A completed-but-unclosed
   session must close as completed before the new request proceeds. This
   comparison is conversational only: create no queue, classifier, or new
   state. A durable `nextAction` can still be rejected after status by an
   environment-sensitive guard; refresh compact status and handle the exact
   rejection instead of forcing a stale action.
2. If the user asked only for a plan and an approved same-goal session already
   exists, load `flow_status { request: { view: "detail" } }` once. Report the
   immutable active plan and current progress, then stop. Do not call
   `flow-plan` or `flow-run`.
3. If there is no session or the plan is still a draft, call
   `flow_guidance { id: "flow-plan" }` and follow that contract. Stop after
   planning when the user asked for a plan only.
4. If an approved feature is ready, running, or blocked, call
   `flow_guidance { id: "flow-run" }` and follow that contract for exactly that
   feature, including its retry and checkpoint routing.
5. After applying `flow-run` to one feature, read compact status again. Reuse
   its one detail projection for any blocked checkpoint. Under `/flow-auto`,
   a passing feature and a compact status of `ready` or `completed` are loop
   states, not handoff states: immediately apply `flow-run` to the next ready
   feature, or close the completed session with one `flow_session_close`
   request. Do not return “ready for the next feature,” offer `/flow-run`, or
   wait for another user turn while an authorized next action is runnable. For
   a blocked outcome, follow the loaded `flow-run` retry and checkpoint
   contract.

## End-to-end loop

Once implementation is authorized, `/flow-auto` treats compact `ready` and
`completed` as mechanical loop states. A host-triggered continuation begins
from a provisional compact baseline: it may route only after the initiating
turn creates a Flow session from idle or advances that same Flow session.
Command entry alone does not authorize an unchanged pre-existing ready session,
and a replacement session fails closed. Conversational `flow_plan_approve` and
blocked or ready `await-user-direction` replies remain part of the same Flow
interaction, but auto-routing resumes only after the reply advances that same
session to a mechanical state.

1. For `ready`, load or reuse `flow-run` and run the projected feature.
2. After every recorded result, reload compact status and route again.
3. For `completed`, close and finish any exact `archiveRetry`.

Intermediate progress and `nextAction: "flow_run_start"` are not terminal.
Return only after closure or a required checkpoint. Direct `/flow-run` still
stops after one feature.

Within existing implementation authority, continue after approval and every
passing feature outcome without asking again. For a blocked outcome, follow the
loaded `flow-run` retry and checkpoint contract. The session remains
authoritative while blocked. Never implicitly select a feature whose latest
relevant reviewed outcome remains failed. Untouched dependency-independent
features may continue; if only retry-required candidates remain, wait at
`await-user-direction` for the exact choice. If status is blocked, carry the
authorized retry or independent choice atomically as `nextFeatureId` on
`flow_feature_reset`. If status is ready, the failed run is already superseded:
load detail once and use `flow_run_start` with the explicitly authorized
retry's exact `featureId`. Never reset from ready status, and add no hold or
retry ledger.

Pause only for a convergence checkpoint, a material product or scope choice,
missing authority for an external Git or release action,
a hard operational failure, or the user's explicit choice of deferred or
abandoned closure. Only the user may choose either non-completed kind.

Core contracts are bundled in the plugin; load them through `flow_guidance` and
do not depend on native skill discovery. If a required Flow tool is unavailable,
report that the plugin is not fully loaded instead of simulating state changes.

## Invariants

- Approved plans do not change. If implementation requires material scope
  outside the plan, stop editing. Finish the approved plan or have the user
  explicitly choose deferred or abandoned closure before starting a new plan;
  do not replan in place.
- Only one durable feature run is active at a time. Conversation-local worker
  waves do not create additional runs or Flow state.
- Work stays inside the active feature and preserves unrelated user changes.
- A passing feature needs successful current-source validation and one result
  submitted directly by the assigned independent reviewer. The final feature
  uses broad validation and a final review; it does not add a second review
  pass.
- A failed review is recorded honestly. Any retry is a fresh run with full
  validation and review.
- Use runtime revisions and operation ids for ordering and idempotency. Supply
  only fields requested by the current tool schema.
- Do not create reports or sidecars outside `.flow/**` unless the user asks for
  a durable artifact. Prefer one readable Markdown file; JSON is opt-in.
- Do not stage, commit, push, publish, or mutate releases unless the user
  explicitly asks for that Git or release action.

## Blocked handoff

A blocked handoff must be self-contained and label the result overall
incomplete. Use the one detail projection for a failed-review block. Report the
goal and progress; blocked feature, attempt, failure count, findings; completed
and untouched features; validation and artifact evidence; Git and release
mutation status; and whether the newest request started and matched the active
goal.

## Recovery

On confusion or interruption, read compact status and route with the rules
above; load `flow-run` for an active or blocked feature and apply its exact
review-recovery path. Use execution status for active work and reviewer status
for a returned assignment id. Never invent or submit a verdict, or infer
completion, retry count, or closure from prose.

For a newly completed session, close with one request containing the
status-projected session id, a fresh operation id, current revision, closure
kind, and optional summary. Repeating that exact request converges; there is no
separate retry mode.

After a durably accepted close, build the final handoff from
`workflowData.delivery`. For each feature, report its attempt count, latest
outcome, and terminal findings. Label its artifact groups Flow-reported
artifacts from latest attempts and Flow-reported artifacts from superseded
attempts only. Never describe them as an exact Git delta. Do not create a
report unless the user asks for one.
