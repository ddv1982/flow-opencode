# Review and validation

Active contributors: ddv1982

## Purpose

Review and validation are evidence inputs to completion. `skills/flow-test/SKILL.md` selects and summarizes checks, `skills/flow-review/SKILL.md` returns review payloads, and `src/domain/transitions.ts` refuses completion until the accepted evidence is present and passing.

## Directory layout

```text
skills/
├── flow-test/SKILL.md
├── flow-review/SKILL.md
├── flow-review/references/review-rubric.md
└── flow-run/references/validation-rubric.md
src/application/schema.ts
src/domain/transitions.ts
```

## Key abstractions

| Abstraction | File | Description |
| --- | --- | --- |
| `ValidationRunSchema` | `src/application/schema.ts` | Command/status/summary validation evidence. |
| `ValidationScopeSchema` | `src/application/schema.ts` | `targeted` or `broad`. |
| `FeatureReviewDepthSchema` | `src/application/schema.ts` | `quick`, `standard`, or `detailed` feature-review depth. |
| `ReviewSchema` | `src/application/schema.ts` | Feature review payload. |
| `FinalReviewSchema` | `src/application/schema.ts` | Final review payload with `reviewDepth`. |
| `validateCompletion` | `src/domain/transitions.ts` | Enforces evidence and review gates. |

## How it works

Feature completion requires at least one passing validation run, `validationScope: "targeted"` for non-final features, `featureReviewDepth` that meets the feature's planned `reviewDepth`, and a passing `featureReview` with no blocking findings. Final feature completion requires `validationScope: "broad"`, a passing `featureReview`, a passing `finalReview`, and `finalReview.reviewDepth` equal to the plan's `finalReviewPolicy`.

## Integration points

The review feature connects skills and runtime without giving review its own state-changing tool. `skills/flow-review/SKILL.md` returns feature review packets and final review payloads, and the manager records them in `flow_feature_complete` through `src/application/flow-service.ts`. `tests/runtime-gates.test.ts` verifies rejected missing, failed, too-shallow, or mismatched evidence.

## Key source files

| File | Purpose |
| --- | --- |
| `skills/flow-test/SKILL.md` | Validation selection, run discipline, and evidence output shape. |
| `skills/flow-review/SKILL.md` | Feature and final review procedure. |
| `src/application/schema.ts` | Validation and review schemas. |
| `src/domain/transitions.ts` | Completion evidence gate. |
| `tests/runtime-gates.test.ts` | Review and validation enforcement tests. |

## Entry points for modification

Change validation judgment in `skills/flow-test/SKILL.md` or review judgment in `skills/flow-review/SKILL.md`. Change `src/application/schema.ts` and `src/domain/transitions.ts` only when the hard evidence contract changes.

Related pages: [Execution and completion](execution-and-completion.md), [Validation and review primitive](../primitives/validation-and-review.md), and [Testing](../how-to-contribute/testing.md).
