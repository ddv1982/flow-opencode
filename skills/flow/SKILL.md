---
name: flow
description: Manage the end-to-end Flow loop for OpenCode work. Use when a user asks for Flow-guided delivery from goal to completion, resumable autonomous delivery, or resuming or closing a Flow session. For plan-only work use flow-plan; for executing one approved feature use flow-run.
---

# Flow

Use Flow as a minimal state ledger, not as a framework. Package-owned guidance provides judgment; the runtime only records the approved plan, active feature, validation evidence, review evidence, and closure.

Routing: the root manager owns the whole loop and every state-changing `flow_*` call. Public commands embed the core `flow-plan`, `flow-run`, and `flow-review` guidance. Answer status-only questions with `flow_status`. Load optional helpers through `flow_guidance`: `flow-test`, `flow-deslop`, and `flow-ui-quality` may be used inside the loop; `flow-commit` is user-triggered only and never part of the autonomous loop.

## Loop

1. Call `flow_status` first. Trust its active session and next action over conversation memory.
   If `workflowData.session.closure` is present, do not run, reset, approve, or
   replan. Retry `flow_session_close` with the recorded closure kind to finish
   archiving the session.
2. If there is no active session and the user gave a goal, load `flow-plan`, save a plan with `flow_plan_save`, then approve it with `flow_plan_approve` only after explicit user approval or prior authorization for autonomous implementation. If there is no goal, ask for one.
3. Use the compiled `flow-run` guidance, call `flow_run_start`, implement exactly one feature, validate it, and prepare a `flow_feature_complete` payload. For validation-heavy, regression-sensitive, browser QA, route QA, or failure-prone work, call `flow_guidance` with `id: "flow-test"` to choose and summarize evidence before completion.
4. Load `flow-review` for the required feature review. Send a bounded review
   packet, not the accumulated root transcript. The reviewer reports
   `featureReviewDepth` and `featureReview`; the manager records both inside
   `flow_feature_complete`.
5. On the final feature, run broad validation and include `finalReview` in the same `flow_feature_complete` call. Its `reviewDepth` must match the plan's `finalReviewPolicy`.
6. After all features are complete, archive the session with `flow_session_close` using `kind: "completed"`.

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
- `flow_status`: read the active session.
- `flow_plan_save`: create a session and/or save a draft plan.
- `flow_plan_approve`: lock the draft plan.
- `flow_run_start`: start one runnable feature.
- `flow_feature_complete`: record completion or a real blocker with validation and review evidence.
- `flow_feature_reset`: reset one feature and its dependents.
- `flow_session_close`: archive the active session as `completed`, `deferred`, or `abandoned`.

There is no `flow_context`, no separate review-record tool, and no multi-session activation surface. The single active source of truth is `.flow/session.json`; closed sessions are archived under `.flow/history/`.

Planning and running require loaded Flow tools; do not simulate plan approval or feature completion when the runtime is unavailable. Review may still return advisory output when tools, guidance, or required evidence is unavailable, but the manager must not record it as Flow-gated evidence.

## Hard Gates

- Approved plans are immutable. To change direction, reset affected features or close the session and start a new goal.
- Only one feature can be active at a time.
- Each feature's planned `reviewDepth` is the minimum accepted
  `featureReviewDepth` for completion.
- Completion requires at least one passing `validationRun` entry.
- Non-final completion requires `validationScope: "targeted"`.
- Final completion requires `validationScope: "broad"` and a passing `finalReview`.
- Every completed feature requires a passing `featureReview` with no blocking findings.
- Failed reviews pause the loop by default. Autonomous repair may make at most
  one repair plus one retry review before stopping.
- A stored closure makes the session archive-only; retry `flow_session_close`
  until archival succeeds.
- `flow_session_close` accepts `kind: "completed"` only after an approved plan has passed final completion.

## Recovery

- Confused state: call `flow_status` and follow `nextAction`.
- Wrong assumption or failed implementation path: use `flow_feature_reset` for the feature and dependents, then rerun from the corrected plan.
- Missing validation or review evidence: gather real evidence, then call `flow_feature_complete`.
- Approved plan is materially wrong: reset the affected features, save a revised plan if the session is back in planning; otherwise close and start a new goal.
- Unknown runtime error: read `summary` and `recovery`; request `flow/references/recovery-playbook.md` from `flow_guidance` for common cases.

Never fabricate validation output, backfill review approval you did not perform, or close as `deferred`/`abandoned` merely to avoid an unfinished-work blocker.
