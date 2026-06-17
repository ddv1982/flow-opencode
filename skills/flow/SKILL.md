---
name: flow
description: Run the end-to-end Flow loop for skills-first OpenCode work. Use when a user asks for Flow-guided planning through implementation, resumable autonomous delivery, session status, or completion with validation and review gates.
---

# Flow

Use Flow as a minimal state ledger, not as a framework. Skills provide judgment; the runtime only records the approved plan, active feature, validation evidence, review evidence, and closure.

## Loop

1. Call `flow_status` first. Trust its active session and next action over conversation memory.
   If the result includes `setup.skills`, report that setup status and do not
   native-load Flow skills in this startup. Public bundled Flow commands may
   continue with their embedded instructions, but a just-synced native skill can
   be on disk while unavailable to the running OpenCode process.
2. If there is no active session and the user gave a goal, load `flow-plan`, save a plan with `flow_plan_save`, then approve it with `flow_plan_approve` only after explicit user approval or prior authorization for autonomous implementation. If there is no goal, ask for one.
3. Load `flow-run`, call `flow_run_start`, implement exactly one feature, validate it, and prepare a `flow_feature_complete` payload. For validation-heavy, regression-sensitive, browser QA, route QA, or failure-prone work, use `flow-test` to choose and summarize evidence before completion.
4. Load `flow-review` for the required feature review. The reviewer reports a `featureReview` payload; the manager records it inside `flow_feature_complete`.
5. On the final feature, run broad validation and include `finalReview` in the same `flow_feature_complete` call. Its `reviewDepth` must match the plan's `finalReviewPolicy`.
6. After all features are complete, archive the session with `flow_session_close` using `kind: "completed"`.

Use `references/parallel-orchestration.md` for broad read-only discovery, audit, validation, review, verification, or candidate implementation waves. Hidden Flow workers are injected by plugin config; invoke the named worker when it is available. Its `references/handoff-format.md` and `references/verification-gates.md` companions define the worker contracts. The manager owns every `flow_*` state change.

Do not commit, push, amend, rebase, publish, or mutate releases during the
autonomous Flow loop. Load `flow-commit` only when the user explicitly asks for
commit preparation or commit creation.

## Skill Availability

If `flow_status` returns `setup.skills`, report that setup status and stop
native-loading Flow skills in the current OpenCode startup. Missing, incomplete,
or outdated managed skills require a sync/restart cycle before their native skill
instructions can be trusted by the running process. Public command bundles are
self-contained and may continue when the command prompt already embeds the
required Flow instructions.

If optional helper skills such as `flow-test`, `flow-deslop`, or
`flow-ui-quality` are unavailable, continue only with explicit coverage gaps. Do
not copy their rubrics into another skill and do not claim their quality checks
were completed.

## Runtime Surface

- `flow_status`: read the active session.
- `flow_plan_save`: create a session and/or save a draft plan.
- `flow_plan_approve`: lock the draft plan.
- `flow_run_start`: start one runnable feature.
- `flow_feature_complete`: record completion or a real blocker with validation and review evidence.
- `flow_feature_reset`: reset one feature and its dependents.
- `flow_session_close`: archive the active session as `completed`, `deferred`, or `abandoned`.

There is no `flow_context`, no separate review-record tool, and no multi-session activation surface. The single active source of truth is `.flow/session.json`; closed sessions are archived under `.flow/history/`.

Planning and running require loaded Flow tools; do not simulate plan approval or feature completion when the runtime is unavailable. Review may still return advisory output when tools, skills, or references are stale or unavailable, but the manager must not record it as Flow-gated evidence.

## Hard Gates

- Approved plans are immutable. To change direction, reset affected features or close the session and start a new goal.
- Only one feature can be active at a time.
- Completion requires at least one passing `validationRun` entry.
- Non-final completion requires `validationScope: "targeted"`.
- Final completion requires `validationScope: "broad"` and a passing `finalReview`.
- Every completed feature requires a passing `featureReview` with no blocking findings.
- `flow_session_close` accepts `kind: "completed"` only after an approved plan has passed final completion.

## Recovery

- Confused state: call `flow_status` and follow `nextAction`.
- Wrong assumption or failed implementation path: use `flow_feature_reset` for the feature and dependents, then rerun from the corrected plan.
- Missing validation or review evidence: gather real evidence, then call `flow_feature_complete`.
- Approved plan is materially wrong: reset the affected features, save a revised plan if the session is back in planning; otherwise close and start a new goal.
- Unknown runtime error: read `summary` and `recovery`; see `references/recovery-playbook.md` for common cases.

Never fabricate validation output, backfill review approval you did not perform, or close as `deferred`/`abandoned` merely to avoid an unfinished-work blocker.
