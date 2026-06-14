---
name: flow-deslop
description: Flow guidance for evidence-backed code smell cleanup, AI-slop removal, overengineering reduction, maintainability refactors, and behavior-preserving cleanup. Use when planning, executing, or reviewing broad cleanup/refactor work, code smell findings, duplicated or bloated code, speculative abstractions, dead code, or agent-introduced mess.
---

# Flow deslop

Use this skill when the Flow work is about improving code quality rather than adding a new user-visible feature. The job is to make the code easier to change without changing behavior unless the approved plan explicitly says behavior changes.

## Ground the cleanup

- Start from concrete evidence: duplicated code, unnecessary abstraction, long or tangled functions, dead branches, confusing ownership, repeated conditionals, excessive coupling, or validation gaps that hide maintainability risk.
- Load `references/smell-rubric.md` when classifying findings or deciding what is worth fixing.
- Load `references/refactor-workflow.md` before implementing or reviewing non-trivial cleanup.
- Treat scanner output, metrics, and model impressions as candidates only. A smell becomes actionable after reading the surrounding code, callers, tests, and relevant contracts.
- Record cleanup context in existing Flow plan fields: `requirements`, `decisions`, feature `targets`, and feature `validation`. Do not invent new Flow payload fields.

## Plan cleanup work

- Prefer one feature per validated cleanup theme with a clear validation story. "Clean the whole repo" starts with a review-first feature that produces evidence-backed findings, then fix features for confirmed clusters.
- Keep refactors small and behavior-preserving. If a cleanup requires behavior change, surface it as product scope and replan.
- State what will not be cleaned. Broad cleanup without boundaries invites churn and makes review impossible.
- Choose validation before editing: focused tests for affected behavior, typecheck/lint for mechanical changes, and a broad gate when cleanup spans shared abstractions.

## Execute cleanup safely

- Preserve public APIs, persisted data, command names, tool names, and observable behavior unless the approved plan explicitly changes them.
- Prefer removal, consolidation, naming, and local extraction before new abstractions. New abstractions must reduce real duplication or clarify an existing boundary.
- Delete dead code only after checking references, exports, generated entrypoints, docs, tests, and runtime/distribution paths that static search may miss.
- Keep every change tied to a finding or plan target. Opportunistic style edits are out of scope.

## Review cleanup claims

For each claimed smell removal, verify:

- **location** — the changed code and the original smell were actually read.
- **impact** — the change reduces duplication, coupling, complexity, or future-change risk in a concrete way.
- **refutation checked** — apparent smell was not intentional compatibility, performance, generated code, framework convention, or a safety guard.
- **behavior preserved** — tests or other evidence cover the behavior touched.
- **blast radius** — public contracts and downstream callers still work.

Never approve cleanup because it "looks cleaner" without evidence. Tests passing is necessary but not sufficient when the refactor changes structure across files.
