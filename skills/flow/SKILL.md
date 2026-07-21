---
name: flow
description: Drive a Flow goal from planning through implementation, validation, independent review, and explicit closure. Use flow-auto as the normal end-to-end interface; use flow-plan for plan-only work and flow-run or flow-status for advanced recovery.
---

# Flow

Flow is a small state ledger around coding work. An active Flow session is
authoritative for its goal until completed, deferred, or abandoned closure; do
not silently fall back to ordinary non-Flow coding. The root manager owns
the session, integration, validation, review dispatch, reset, closure, and every
lifecycle mutation except review submission. Bounded `flow-worker`
instances may contribute disjoint work inside the active feature. The reserved
`flow-reviewer` independently reviews and submits its own result through
`flow_feature_complete`; it cannot edit the workspace or make any other
lifecycle mutation.

## Route from status

1. Call `flow_status { request: { view: "compact" } }` first. Trust its
   projection over conversation memory. Treat `nextAction` as authoritative
   workflow state, not permission to exceed or a reason to discard existing
   user authority.
2. If there is no session or the plan is still a draft, call
   `flow_guidance { id: "flow-plan" }` and follow that contract. Stop after
   planning when the user asked for a plan only.
3. If an approved feature is ready or already running, call
   `flow_guidance { id: "flow-run" }` and follow that contract for exactly that
   feature.
4. After the feature outcome, read compact status again. Start the next ready
   feature, repair an in-scope failed review, report a real blocker, or close a
   completed session with one `flow_session_close` request.

Within existing implementation authority, continue after approval, every
feature outcome, and an in-scope failed-review reset and repair without asking
again. Pause only for a material product or scope choice, missing authority for
an external Git or release action, a hard operational failure, or the user's
explicit selection of deferred or abandoned closure. Only the user may choose
either non-completed closure kind.

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

## Recovery

On confusion or interruption, read compact status and follow its next action.
Use execution status for the active feature and reviewer status for a returned
assignment id. Redispatch a pending assignment after interruption or an
unconfirmed reviewer return; the manager never invents or submits a verdict. If
completion reports `Workspace content changed after review started`, call
`flow_feature_reset`; that source-stale assignment must not be redispatched.
Start a fresh run and repeat full validation and review. After the reviewer
returns, read compact status to learn the durable outcome. If status is closed
with `archiveRetry`, call
`flow_session_close` with that projected request byte-for-byte; do not create a
new operation id or revision. Never infer completion, retry count, or closure
from prose.

For a newly completed session, close with one request containing the
status-projected session id, a fresh operation id, current revision, closure
kind, and optional summary. Repeating that exact request converges; there is no
separate retry mode.
