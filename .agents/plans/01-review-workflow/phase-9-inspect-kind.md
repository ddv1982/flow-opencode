# Phase 9. Inspect kind

Back-link. [Overview](overview.md).

## Goal

Only if phases 1 to 8 still leak in evals. A stored inspect kind so a blocking
finding can be recorded without stopping the rest of the survey, without a
second ledger.

## Changes

This phase is a major. It replaces "every feature is an implementation
slice" with "a feature is an outcome slice that is `change` or `inspect`."
Default hydrate to `change` so old Session v5 documents keep today's
rules.

Expect edits in `src/domain/session.ts`, `src/application/schema.ts`,
`src/domain/transitions.ts`, compact `nextAction`, reviewer skill, ADR
0005, and `tests/documentation-contract.test.ts` (optional plan fields).

Do not start this phase in the same PR as 1 to 8. Interrogate first.
`completed` for inspect means the survey finished, not that the tree is
clean. Blocking findings on inspect features stay in the digest and do
not force `flow_feature_reset` unless the user asked to fix them.

## Data structures

`PlanFeature.kind?: "change" | "inspect"`. Absent means `change`. That is
a new optional plan field and a documented major, even if save does not
require it, because `documentation-contract` currently pins the optional
set to `evidence` only.

## Verification

**Static.** Full `bun run check`. Documentation contract. Schema pin test
updated on purpose.

**Runtime.** Phase 8 scenario plus a second feature after a blocking
inspect finding must still be startable without reset. Paid matrix before
release.

Skip this phase if phase 8 stays green on inspect goals with phases 1 to 8 alone.
