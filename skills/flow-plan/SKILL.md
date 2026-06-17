---
name: flow-plan
description: Plan Flow work for the v4 skills-first runtime: inspect the repo, decompose a user goal into right-sized features, save a draft with flow_plan_save, and approve it with flow_plan_approve.
---

# Flow Plan

Use this skill before implementation. The output is a compact plan the runtime can enforce and future agents can execute without rediscovering the goal.

If `flow_plan_save` or `flow_plan_approve` is unavailable, stop and tell the user to check that `opencode-plugin-flow` is loaded in OpenCode. Planning requires the loaded Flow runtime.

## Inspect first

- Read the files, docs, tests, package scripts, and local conventions that determine the work.
- For broad discovery, read `references/parallel-discovery.md` after a serial orientation pass. Use `../flow/references/parallel-orchestration.md` when discovery needs multiple workers, and apply its coverage gate before fan-out.
- For complex validation, regression-sensitive changes, browser QA, route QA,
  failure-prone checks, or uncertain test strategy, load `flow-test`. If it is
  unavailable, record a planning gap and keep validation claims conservative.
- For cleanup/refactor goals, load `flow-deslop`. If it is unavailable, record
  a planning gap and keep cleanup claims conservative.
- For UI/frontend goals, load `flow-ui-quality`. If it is unavailable, record a
  planning gap and require next-best UI evidence rather than claiming visual
  quality was reviewed.
- Do not invent findings. Broad "review and fix" goals start with a review-first feature whose deliverable is evidence-backed findings.

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
