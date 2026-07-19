---
name: flow
description: Manage the end-to-end Flow loop for OpenCode work. Use when a user asks for Flow-guided delivery from goal to closure, resumable autonomous delivery, or resuming or closing a Flow session. For plan-only work use flow-plan; for executing one approved feature use flow-run.
---

# Flow

Use Flow as a minimal state ledger, not as a framework. Package-owned guidance provides judgment; the runtime only records the approved plan, active execution, validation evidence, recorded review executions, and closure.

Routing: the root manager owns the whole loop and every state-changing `flow_*` call. Public commands embed the core `flow-plan`, `flow-run`, and `flow-review` guidance. Answer status-only questions with `flow_status`. Load optional helpers through `flow_guidance`: `flow-test`, `flow-deslop`, and `flow-ui-quality` may be used inside the loop; `flow-commit` is user-triggered only and never part of the autonomous loop.

## Loop

1. Call `flow_status { request: { view: "compact" } }`; read state only from
   `workflowData.projection`. If `projection.closure.retryOperationId` exists,
   call `flow_session_close { request: { mode: "retry", operationId } }` with
   that complete value and stop ordinary mutation.
2. Without a session, use `flow-plan` to save and, after explicit approval or
   prior autonomous authorization, approve the user's goal. Ask when no goal exists.
   If the user explicitly requested planning only or said not to implement,
   stop after the saved approval summary even when this guide was invoked by
   `/flow-auto`. That request does not authorize `flow_run_start`.
3. When ready, call `flow_run_start`; its receipt only acknowledges the start.
   For fresh or resumed running work, load `flow_status` with
   `{ request: { view: "execution" } }` and use its active-execution scope and
   causal guards.
4. Implement and validate exactly that scope. Call `flow_review_start` with one
   strict `request` containing the current execution guards and validation
   observations, dispatch the returned
   assignment to the reviewer, then submit its terminal result through
   `flow_feature_complete`. Load `flow-test` for complex or failure-prone validation.
5. On the final feature, economy mode is exactly `targeted validation -> feature
   review -> one authorized bounded repair/retry if needed -> broad validation
   after the last functional edit -> final flow_review_start bound to the exact
   passing feature-assignment result -> final review -> one atomic
   flow_feature_complete` carrying only the final-assignment result. Flow reads
   the feature result from the durable bound prerequisite. Final review depth matches
   `finalReviewPolicy`.
6. Immediately call `flow_status { request: { view: "compact" } }` after the
   feature outcome.
   If status is `completed` and closure is null, call a new guarded
   `flow_session_close { request: { mode: "start", kind: "completed", ...guards } }`.
   If closure exists, retry only by `closure.retryOperationId`. Otherwise start
   the next ready feature and load
   execution, or report the blocker. Never route from a receipt.

For broad discovery, audit, validation, review, verification, or candidate work,
request `flow/references/parallel-orchestration.md` from `flow_guidance` as the
routing index, then request the exact reference ids it selects. Request
`flow/references/parallel-decision.md` first. Load `flow/references/parallel-manifest.md`
and `flow/references/parallel-execution.md` only after selecting fan-out, then load
`flow/references/parallel-synthesis.md` when handoffs return. Paste the matching template from
`flow/references/handoff-format.md` into each worker prompt. Hidden Flow workers
are injected by plugin config; invoke the named worker when available. The
manager owns every `flow_*` state change.

Do not commit, push, amend, rebase, publish, or mutate releases during the
autonomous Flow loop. Call `flow_guidance` with `id: "flow-commit"` only when
the user explicitly asks for commit preparation or commit creation.

## Guidance Availability

Core command guidance is compiled into the plugin and optional documents are
returned directly by `flow_guidance`; neither path depends on native skill
discovery or files under the user's OpenCode configuration directory. Use the
exact stable id named by the current guide. If the tool itself is unavailable,
the Flow plugin is not fully loaded: continue only with explicit coverage gaps
and do not claim helper checks were completed.

## Runtime Surface

- `flow_guidance`: load exact package-owned guidance by stable id; it never changes Flow state.
- `flow_status`: read a bounded projection; compact is routing-only, execution
  is the full active-feature working scope, detail is diagnostic, and reviewer
  is narrow review assignment context.
- `flow_plan_save`: create a session or update the active same-goal draft; it
  never replaces a different unclosed goal.
- `flow_plan_approve`: lock the draft plan.
- `flow_run_start`: start one runnable feature.
- `flow_review_start`: bind current-source validation to one runtime-owned
  reviewer assignment; only the root manager may call it.
- `flow_feature_complete`: atomically record one completed or blocked result
  using the returned assignment id. Broad final outcome submits only the
  final-assignment result.
- `flow_feature_reset`: reset one feature and its dependents.
- `flow_session_close`: archive the active session as `completed`, `deferred`, or `abandoned`.

There is no `flow_context`, no reviewer-owned mutation tool, and no multi-session
activation surface. `flow_review_start` creates identity before dispatch; it
does not record a verdict. The single active source of truth is
`.flow/session.json`; closed sessions are archived under `.flow/history/`.

Planning and running require loaded Flow tools; do not simulate plan approval
or a feature outcome when the runtime is unavailable. Review may still return
advisory output when tools, guidance, or required evidence is unavailable, but
the manager must not record it as a Flow-gated assignment result.

## Hard Gates

- Approved plans are immutable. To change direction, reset affected features or close the session and start a new goal.
- A different-goal plan save never archives or replaces the current session,
  including an unapproved draft. Explicitly close unfinished work as `deferred`
  or `abandoned`, converge archive publication, then save the new goal.
- Only one feature can be active at a time.
- Each run has runtime-owned feature-run and reviewer-assignment identity.
- `flow_review_start` requires passing, source-bound validation: targeted for a
  feature assignment and broad for a final assignment. Starting again after a
  source edit invalidates the stale pending assignment and returns a replacement.
- A non-final feature outcome requires `validationScope: "targeted"` plus one passing
  feature-assignment result.
- Final feature outcome requires `validationScope: "broad"` plus one passing
  final-assignment result in economy order. Final assignment start durably binds
  the passing feature-assignment result; Flow consumes that binding atomically.
- Review depth comes from the approved plan; callers and reviewers do not
  author it in the feature outcome.
- Failed reviews pause the loop by default. Autonomous repair may make at most
  one repair plus one retry review before stopping.
- A passing final feature outcome leaves closure null; `flow_session_close`
  alone records and
  archives the closure.
- A stored closure makes the session archive-only; retry `flow_session_close`
  only with `{ request: { mode: "retry", operationId: closure.retryOperationId } }`
  until archive publication succeeds.
- Every closure is quiescent: no active execution or pending assignment remains.
- Reported validation and review times must follow lifecycle order and cannot
  postdate the runtime acceptance time.
- The `flow_session_close.request` start branch accepts `kind: "completed"`
  only after an approved plan has passed its final feature outcome.

## Recovery

- Confused state: call `flow_status { request: { view: "compact" } }` and follow
  `nextAction`.
- Wrong assumption or failed implementation path: use `flow_feature_reset` for the feature and dependents, then rerun from the corrected plan.
- Missing validation or an assignment result: gather real validation, create a fresh
  assignment with `flow_review_start`, then submit its terminal result.
- Source changed after assignment: rerun validation and call `flow_review_start`;
  Flow invalidates the stale pending assignment while creating its replacement.
- Same-source final-review retry after context loss: load detail status and copy
  the exact `.finalReviewRetry.prerequisite.result` value unchanged into the new
  final assignment request. Compact and reviewer status omit the binding. If
  source changed, restart targeted feature review first.
- Plan or goal is materially wrong: revise only a same-goal planning draft.
  Otherwise reset affected approved work or explicitly close the session before
  starting a new goal.
- Unknown runtime error: read `summary` and `recovery`; request `flow/references/recovery-playbook.md` from `flow_guidance` for common cases.

Never fabricate validation output, backfill review approval you did not perform, or close as `deferred`/`abandoned` merely to avoid an unfinished-work blocker.
