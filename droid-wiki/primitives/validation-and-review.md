# Validation and review

Active contributors: ddv1982

## Purpose

Validation and review records are the evidence that lets a feature complete. They are not advisory prose: the runtime requires specific passing payloads before `flow_feature_complete` can mark a feature done.

## Directory layout

```text
src/runtime/schema.ts
src/runtime/transitions.ts
skills/flow-test/SKILL.md
skills/flow-review/SKILL.md
```

## Key abstractions

| Abstraction | File | Description |
| --- | --- | --- |
| `ValidationRunSchema` | `src/runtime/schema.ts` | Exact command, status, and summary evidence. |
| `FeatureReviewDepthSchema` | `src/runtime/schema.ts` | `quick`, `standard`, or `detailed` feature-review depth. |
| `ReviewSchema` | `src/runtime/schema.ts` | Feature review status, summary, and blocking findings. |
| `FinalReviewSchema` | `src/runtime/schema.ts` | Review plus final `reviewDepth`. |
| `ReviewFindingSchema` | `src/runtime/schema.ts` | Blocking or advisory finding summary. |
| `validateCompletion` | `src/runtime/transitions.ts` | Gate that checks evidence before completion. |

## How it works

`ValidationRunSchema` permits `passed` or `failed`, but `validateCompletion` requires every recorded validation run to be `passed`. Feature completion records `featureReviewDepth`, which must meet or exceed the feature's planned `reviewDepth`. `ReviewSchema` permits failed reviews, but completion requires `status: "passed"` and no blocking findings. Final completion adds `FinalReviewSchema` and requires its `reviewDepth` to match the plan's `finalReviewPolicy`.

## Integration points

`skills/flow-test/SKILL.md` produces `validationRun` summaries. `skills/flow-review/SKILL.md` produces feature review packets with `featureReviewDepth` plus `featureReview`, and final review payloads. The manager records accepted payloads through `flow_feature_complete`; no separate review-record tool exists in v4.

## Key source files

| File | Purpose |
| --- | --- |
| `src/runtime/schema.ts` | Evidence schemas. |
| `src/runtime/transitions.ts` | Evidence enforcement. |
| `skills/flow-test/SKILL.md` | Validation evidence guidance. |
| `skills/flow-review/SKILL.md` | Review payload guidance. |
| `tests/runtime-gates.test.ts` | Evidence rejection and acceptance tests. |

## Entry points for modification

Adjust `skills/flow-test/SKILL.md` or `skills/flow-review/SKILL.md` for judgment changes. Adjust `src/runtime/schema.ts` and `src/runtime/transitions.ts` only when persisted or enforced evidence changes.

Related pages: [Review and validation](../features/review-and-validation.md), [Flow tools](../api/flow-tools.md), and [Testing](../how-to-contribute/testing.md).
