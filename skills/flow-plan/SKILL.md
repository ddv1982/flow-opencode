---
name: flow-plan
description: Create, revise, or approve a concise Flow plan before implementation. Use for new goals, draft-plan changes, and plan-only requests.
---

# Flow Plan

Plan only after reading the repository facts that determine the work. A useful
plan is short enough to scan and concrete enough that another agent can execute
it without rediscovering the goal.

## Start

- Call `flow_status { request: { view: "compact" } }` first.
- If compact status contains `archiveRetry`, finish that already-accepted close
  by calling `flow_session_close` once with the projected request byte-for-byte,
  then refresh compact status. Stop without saving a plan if archive publication
  remains unconfirmed; otherwise continue from the refreshed projection. This
  exact cleanup grants no new work, so it precedes goal alignment. Apply the
  same rule if closing a completed session later returns archive-pending.
- Before any other manager-owned lifecycle mutation, align the compact-projected
  goal with the current direct `/flow-plan` request. Continue only for the same
  goal or a compatible narrowing that changes method or emphasis, not requested
  outcomes. A completed-but-unclosed session must close as completed before a
  new request proceeds or a new plan is saved. Otherwise a materially new or
  expanded request makes no mutation; offer to continue, defer, or abandon the
  active session. Keep this a conversational judgment with no classifier or new
  state.
- If the user asked only for a plan and an approved same-goal session already
  exists, load `flow_status { request: { view: "detail" } }` once. Report the
  immutable active plan and current progress, then stop. Do not save, approve,
  or run anything.
- Do not replace an unclosed different goal. Close or finish it explicitly.
- If `flow_plan_save` or `flow_plan_approve` is unavailable, stop and report
  that the Flow plugin is not fully loaded.
- Inspect relevant code, tests, docs, package scripts, and local conventions.
  Resolve repository facts by inspection; ask the user only when a missing
  product choice would materially change the outcome.

## Plan contract

Save one plan with:

- `summary`: the promised result in one sentence.
- `overview`: the implementation approach and important boundaries.
- `requirements`: acceptance criteria, constraints, and non-goals.
- `decisions`: assumptions and architecture or scope choices already made.
- `features`: ordered outcome slices, each with a stable `id`, `title`,
  `summary`, bounded `targets`, concrete `validation`, and `dependsOn` ids.

Each feature should have one observable outcome that a reviewer can judge
pass/fail from bounded evidence, plus one focused validation story. Split only
when two outcomes can fail independently or a true dependency requires ordered
acceptance. Keep behavior together when it shares one invariant or neither part
can be accepted alone. Overlapping files by themselves force neither a split nor
a merge. A reviewer should not re-audit the whole product to decide whether one
feature passed. Avoid step-shaped features such as “update files” and vague
checks such as “run tests.”

When a `validation` entry names an executable command, record the exact
plan-listed command byte-for-byte. Behavior-oriented prose that has never run
as an exact command remains reviewer judgment rather than a fabricated command
result.

Before saving, confirm:

- every requirement maps to a feature or an explicit non-goal;
- targets name real files, modules, routes, commands, or artifacts;
- validation names the behavior or contract the check will prove;
- dependencies capture true ordering without circular or hidden work;
- assumptions and intentional gaps are visible in `decisions`.

## Save and approve

Call `flow_plan_save` with one nested request containing a stable operation id,
the current revision (`0` for a new session), the goal, and the complete draft.
Summarize the outcome, feature order, validation, and material decisions for
the user. Call `flow_plan_approve` with a fresh operation id and current
revision only after explicit approval or when the user already authorized
autonomous implementation. Approval locks the plan.

Do not begin implementation during a plan-only request. Do not create a plan
document in the repository unless the user explicitly requests one.
