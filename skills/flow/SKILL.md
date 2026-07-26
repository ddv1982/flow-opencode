---
name: flow
description: Drive a Flow goal from planning through implementation, validation, independent review, and explicit closure. Use flow-auto as the normal end-to-end interface; use flow-plan for plan-only work and flow-run or flow-status for advanced recovery.
---

# Flow

Flow's active goal is authoritative until completed, deferred, or abandoned;
never silently fall back.

## Route from status

1. Call `flow_status { request: { view: "compact" } }` first. Trust its
   `nextAction` as the durable default, not added authority.
   If the top-level response is an error, report its exact summary and recovery;
   when delivery is present, handle its bounded map under **Recovery**. Stop
   without another mutation.
   For `archiveRetry`, call the projected `flow_session_close` request
   byte-for-byte and handle its delivery under **Recovery**. Refresh compact status;
   stop if publication remains unconfirmed, otherwise continue from the
   refreshed projection. This cleanup precedes goal alignment and grants no work.
   Before another manager mutation, align the compact-projected goal with the
   request. Continue only for the same goal or a narrowing that preserves every
   outcome. Close a completed session as completed before new work. If the user
   explicitly chooses deferred or abandoned closure for a non-completed session,
   call `flow_session_close` with compact session id/revision, fresh operation
   id, that kind, and optional summary; handle **Recovery**, follow a projected
   exact `archiveRetry`, and stop. Otherwise new or expanded work makes no
   mutation: say it has not started and offer continue, defer, or abandon. Keep
   alignment conversational. On revision conflict, refresh compact status and
   retry only after confirming the same session and goal and that status still
   permits the selected closure kind; never close a replacement.
2. For a plan-only request with an approved same-goal session, read detail once,
   report the immutable plan and progress, and stop.
3. With no session or a draft, load `flow_guidance { id: "flow-plan" }`; stop
   after planning if implementation was not authorized.
4. For an approved ready, running, or blocked feature, load
   `flow_guidance { id: "flow-run" }` and follow it for exactly that feature.
5. After `flow-run`, reload compact status. Route blocked outcomes through the
   loaded retry and checkpoint contract; otherwise continue **End-to-end loop**.

## End-to-end loop

The runtime decides when `/flow-auto` continues automatically; never assume a
further turn, and finish the authorized work in this one.

For `ready`, apply `flow-run`; after every recorded result reload compact. For `completed`,
close and handle **Recovery** plus exact `archiveRetry`.
`flow_run_start` and intermediate progress are not terminal: never return “ready
for the next feature” or wait while an action is authorized. Return only after closure
or a checkpoint. Direct `/flow-run` stops after one feature.

For blocked work, follow `flow-run` routing. Never implicitly select a feature
whose latest relevant reviewed outcome remains failed.
Untouched independent features may continue; if only retries remain, wait at
`await-user-direction`. Otherwise pause only for a material
choice, missing Git/release authority, hard failure, or user-chosen closure.
If a Flow tool is absent, report an incomplete plugin load; never simulate state.

## Invariants

- Plans are immutable. Out-of-plan work stops; finish or explicitly close, never
  replan in place.
- One durable feature run exists at a time; worker waves add no Flow state.
- Preserve unrelated work and stay inside the active feature.
- Passing requires current-source validation and one independent review; the
  final feature uses broad validation, not another review.
- Record failures honestly; retries are fresh full runs.
- Use runtime revisions, fresh operation ids, and current-schema fields.
- Do not create reports/sidecars, Git changes, or release mutations unless
  requested; reports default to Markdown and JSON is opt-in.

## Recovery

On interruption, read compact status; load `flow-run` for an active or blocked feature
and use execution or reviewer status, never prose, for lifecycle truth.

Summaries keep plan/source IDs `verified` or `incomplete`. A prior finding is
terminally `fixed` only when review passes with current evidence. A failed
verdict carries every prior ID forward: report a proven repair as `terminal
fixed pending pass` with concise evidence, an
unproven repair as unverified-fixed, a recurrence as `recurring`, or a confirmed
nonblocker as `residual`. Blockers stay terminal.

For an accepted close, map only `workflowData.delivery`
`outcomeSummary`/`terminalFindings`.
Requirements are proven `verified`, otherwise `incomplete` or explicit
`deferred`. Apply the finding rules above, using `incomplete` for an unproven
terminal claim; `abandoned` stays the kind. Missing IDs are unavailable: never
invent or read detail solely for closure. Without delivery, report exact
recovery and no map.

Unresolved blockers forbid completed closure. Fresh close: projected session
id/revision, fresh operation id, kind, optional summary. Replay byte-for-byte
only the `archiveRetry` of a durably accepted close. Rejected revision conflict:
refresh compact, confirm the same session/goal, then build a fresh request.
Report `workflowData.delivery.report` verbatim. Report external prerequisites only
from terminal text; otherwise mark them unavailable. Create no other ledger or
report.
