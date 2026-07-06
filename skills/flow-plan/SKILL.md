---
name: flow-plan
description: "Use when Flow work needs planning before implementation: a new goal to turn into an approved Flow feature plan, a draft plan to revise, or a decomposition or plan-approval decision in the v4 skills-first runtime. For executing an approved feature use flow-run; for the full goal-to-completion loop use flow."
---

# Flow Plan

Use this skill before implementation. The output is a compact plan the runtime can enforce and future agents can execute without rediscovering the goal.

If `flow_plan_save` or `flow_plan_approve` is unavailable, stop and tell the user to check that `opencode-plugin-flow` is loaded in OpenCode. Planning requires the loaded Flow runtime.

## Inspect first

- Read the files, docs, tests, package scripts, and local conventions that determine the work.
- For broad discovery, read `references/parallel-discovery.md` after a serial orientation pass. Use `../flow/references/parallel-orchestration.md` when discovery needs multiple workers, and write its pass manifest before fan-out.
- Helper rule: when a named helper skill is unavailable, record a planning gap
  and keep the corresponding claims conservative instead of simulating its
  checks.
- For complex validation, regression-sensitive changes, browser QA, route QA,
  failure-prone checks, or uncertain test strategy, load `flow-test`.
- For cleanup/refactor goals, load `flow-deslop`.
- For UI/frontend goals, load `flow-ui-quality`.
- Do not invent findings. Broad "review and fix" goals start with a review-first feature whose deliverable is evidence-backed findings.

## Reduce uncertainty before decomposing

A vague goal does not slice into reliable features yet. Name what is uncertain,
because the two kinds resolve differently:

- **Specification uncertainty** — what the user wants: ambiguous goal, missing
  acceptance criteria, unstated constraints. Resolve by stating an explicit
  assumption in `decisions` and proceeding, or by asking only when a wrong
  guess would be expensive to undo.
- **Environment uncertainty** — facts the repo, docs, commands, or data can
  answer: code shape, schema, API behavior, current conventions. Resolve by
  inspecting or by a discovery pass, never by asking the user.

Spend the cheapest probe that removes the most uncertainty first: local reads
before worker fan-out, fan-out before user questions. Decompose into features
only once the remaining uncertainty is low enough that `targets` and
`validation` can be stated concretely; otherwise the first feature is a
review-first or discovery deliverable that produces the missing evidence.

## Plan shape

Call `flow_plan_save` with:

```json
{
  "goal": "user-visible goal",
  "plan": {
    "summary": "one-sentence outcome",
    "overview": "implementation strategy and boundaries",
    "requirements": ["constraints, acceptance criteria, user promises"],
    "decisions": ["architecture or scope decisions already made"],
    "finalReviewPolicy": "detailed",
    "features": [
      {
        "id": "lowercase-kebab-case",
        "title": "Short title",
        "summary": "Outcome this feature delivers",
        "targets": ["files, modules, routes, commands, or docs in scope"],
        "validation": ["focused checks expected before completion"],
        "dependsOn": []
      }
    ]
  }
}
```

Use only `finalReviewPolicy: "broad"` or `"detailed"`. These are the canonical final-review policy and `reviewDepth` enum values. Use `"broad"` only for low-risk, narrow work. Use `"detailed"` for behavioral changes, cross-module edits, migrations, releases, security-sensitive code, or large refactors.

## Feature sizing

- Each feature should have one owner, one coherent outcome, and a validation story.
- Split by dependency order: foundations before callers, schema before consumers, implementation before docs when docs depend on behavior.
- Avoid "misc cleanup" features. Tie cleanup to evidence and targets.
- Keep feature ids stable once the plan is approved.
- Put scope boundaries in `targets` and expected checks in `validation`. Each
  validation entry should name the expected test level, such as targeted unit,
  integration, browser/e2e, package/build, docs/static, cleanup preservation, or
  broad project gate.

## Approval

After saving, summarize the plan to the user. Call `flow_plan_approve` only after explicit user approval, unless the user already authorized autonomous implementation. Approved plans are immutable; changing them later requires reset/closure rather than silent edits.

See `references/planning-examples.md` for payload examples and decomposition anti-patterns.
