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

Each feature should have one coherent outcome and a validation story. Split
only for a real dependency, an independently testable boundary, or safely
disjoint ownership. Keep overlapping changes together. Avoid step-shaped
features such as “update files” and vague checks such as “run tests.”

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
