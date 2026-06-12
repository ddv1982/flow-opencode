---
name: flow-plan
description: Plan Flow work - profile the repo, decompose a goal into right-sized features, then save and approve the plan. Load before calling flow_plan_save.
---

# Flow planning

Planning never implements. This skill ends at a saved or approved plan — implementation starts only from the `flow-run` skill.

## Profile the repo yourself, first

No tool does this for you. Before drafting features, establish:

- Package manager (lockfile wins over docs) and language/runtime versions.
- The real build, test, lint, and typecheck commands — read `package.json` scripts, `Makefile`, CI config; do not guess.
- Frameworks, test layout, and module conventions actually in use.
- House rules: `CONTRIBUTING`, `AGENTS.md`/`CLAUDE.md`, lint/format config.

Record these findings in the `flow_plan_save` payload so execution and review later work from the same profile instead of re-deriving (or contradicting) it.

## Decompose the goal

- Normalize the request into: outcome, constraints, done condition, and open questions. Keep unknowns as named gaps, not invented scope.
- A feature is a vertical slice that is independently completable and independently validatable. If you cannot say how a feature alone will be validated, it is not a feature yet.
- Typical plans are 1–5 features. Split a feature that hides two unrelated validation stories; merge features that can only be validated together.
- Order by dependency, riskiest or most unknown first.
- Validation and tests live inside each feature. Never plan a separate "write tests" or "cleanup" feature.
- Broad "review and fix the codebase" goals with no concrete findings yet: plan a review-first feature that produces findings, then fix features driven by those findings. Do not plan fixes you have not seen evidence for.

Read `references/planning-examples.md` whenever you draft a multi-feature plan or are unsure about sizing — it shows good and bad plans side by side.

## Save and approve

- `flow_plan_save` persists the draft: goal, constraints, done condition, stack profile, and per-feature outcome, scope, and validation plan.
- `flow_plan_approve` locks it (optionally approving only a subset of features). After approval the plan is immutable except by explicit reset.
- Auto-approve only when ALL hold: the user asked for autonomous execution or pre-approved the work; nothing destructive, migratory, or security-sensitive; scope matches what the user literally asked for; the plan is small (roughly ≤3 features). Otherwise present the draft and ask.

Never: auto-approve to keep momentum; pad the plan with scope the user did not ask for; edit an approved plan in place — reset the affected features and save a revision instead.
