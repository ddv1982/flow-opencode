# Phase 7. Inspect-shaped planning

Back-link. [Overview](overview.md).

## Goal

A goal that asks for findings and no code change does not become a fake
implementation DAG. The planner either saves inspect slices that promise
no edits, or it stops and says Flow will treat the request as a change.

## Changes

- `skills/flow-plan/SKILL.md`. If the request is inspect-only (review,
  audit, survey, no promised edit), do not invent repair features. Save
  at most a small set of inspect features whose `validation` is reviewer
  inspection, whose `targets` are existing paths, and whose `decisions`
  state that no source edit is authorized. The gate may be the repo's
  existing check. Ask before turning an inspect request into repairs.
- `docs/positioning.md`. One "Do not use" bullet is not enough by itself.
  Add one sentence under Use or Do not use. Flow's independent review is a
  gate on a change. A codebase survey needs the inspect path in this plan,
  or an ordinary non-Flow chat. Stay inside the maintained-docs byte
  budget. Pay with a deletion if needed.

Use Cursor `create-skill`. No new plan schema field.

## Data structures

None. Inspect is a planning convention in `decisions` and feature
summaries, not a stored kind. Phase 9 adds a kind only if this leaks.

## Verification

**Static.** `bun test tests/prompt-quality.test.ts tests/documentation-contract.test.ts`.

**Runtime.** No OpenCode control skill in-repo. Phase 8's scenario is the
behavior check. Until then, read the compiled `flow-plan` surface and
confirm it forbids repair features for inspect-only requests.
