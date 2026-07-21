---
name: flow
description: Manage a Flow goal from planning through implementation, validation, independent review, and closure. Use for end-to-end or resumed Flow work; use flow-plan for plan-only work and flow-run for one approved feature.
---

# Flow

Flow is a small state ledger around ordinary coding work. The root manager owns
the session, integration, validation, review dispatch, reset, closure, and every
lifecycle mutation except review submission. Bounded `flow-worker`
instances may contribute disjoint work inside the active feature. The reserved
`flow-reviewer` independently reviews and submits its own result through
`flow_feature_complete`; it cannot edit the workspace or make any other
lifecycle mutation.

## Route from status

1. Call `flow_status { request: { view: "compact" } }` first. Trust its
   projection over conversation memory.
2. If there is no session or the plan is still a draft, call
   `flow_guidance { id: "flow-plan" }` and follow that contract. Stop after
   planning when the user asked for a plan only.
3. If an approved feature is ready or already running, call
   `flow_guidance { id: "flow-run" }` and follow that contract for exactly that
   feature.
4. After the feature outcome, read compact status again. Start the next ready
   feature, report the real blocker, or close a completed session with one
   `flow_session_close` request.

Core contracts are bundled in the plugin; load them through `flow_guidance` and
do not depend on native skill discovery. If a required Flow tool is unavailable,
report that the plugin is not fully loaded instead of simulating state changes.

## Invariants

- Approved plans do not change. Reset affected work or close the session before
  changing direction.
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
