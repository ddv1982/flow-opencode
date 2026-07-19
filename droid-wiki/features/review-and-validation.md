# Review and validation

Active contributors: ddv1982

## Purpose

Review and validation are evidence inputs to a feature outcome.
`skills/flow-test/SKILL.md` selects and summarizes checks,
`skills/flow-review/SKILL.md` returns assignment results, and
`src/domain/transitions.ts` refuses the outcome until accepted evidence is
present, passing, and chronologically applicable.

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
| `ValidationObservationSchema` | `src/application/schema.ts` | Caller-attested command result accepted by `flow_review_start`. |
| `ValidationEvidenceSchema` | `src/application/schema.ts` | Runtime-owned source-, snapshot-, and feature-run-bound validation evidence. |
| `ValidationScopeSchema` | `src/application/schema.ts` | `targeted` or `broad`. |
| `FeatureReviewDepthSchema` | `src/application/schema.ts` | `quick`, `standard`, or `detailed` feature-review depth. |
| `ReviewAssignmentSchema` | `src/application/schema.ts` | Durable runtime-owned review identity and lifecycle. |
| `ReviewAssignmentResultInputSchema` | `src/application/schema.ts` | Small reviewer result bound to one assignment id. |
| `completeAssignedFeature` | `src/domain/transitions.ts` | Enforces assignment, evidence, source, and review gates atomically. |

## How it works

The manager submits passing validation observations to `flow_review_start`.
The runtime binds them to the current source and feature run, derives review
identity and required depth from the approved plan, and returns an assignment
id. A non-final feature outcome requires a targeted feature-assignment result. Final
assignment creation requires broad validation plus the exact passing feature
result and stores it as a durable bound prerequisite. The final feature outcome
submits only the distinct passing final-assignment result; Flow records both
atomically. A source-changed pending assignment is
invalidated while its replacement is created. Failed results require blocking
findings and consume the run-scoped retry budget as accepted blocker mutations.
The first final assignment pins its prerequisite for same-source final-review
retries. Detail status exposes the bounded aggregate under
`finalReviewRetry.prerequisite`; compact and reviewer status omit it. A source
edit requires a new targeted feature-review sequence. A mismatched same-source
retry records nothing and leaves its operation id reusable.
Reported validation and review times must follow run, validation, assignment,
and result order and cannot postdate runtime acceptance. Broad final validation
must start no earlier than the passing feature-assignment result.

## Integration points

`flow_review_start` is the manager-only state-changing boundary that makes a
review assignment durable before dispatch. `skills/flow-review/SKILL.md`
instructs a hidden reviewer to recover only that assignment and return its
small result to the manager. The manager records the result atomically through
`flow_feature_complete`; reviewers never mutate Flow state.

## Key source files

| File | Purpose |
| --- | --- |
| `skills/flow-test/SKILL.md` | Validation selection, run discipline, and evidence output shape. |
| `skills/flow-review/SKILL.md` | Feature and final review procedure. |
| `src/application/schema.ts` | Validation and review schemas. |
| `src/domain/transitions.ts` | Feature-outcome validation and assignment-result gate. |
| `tests/runtime-gates.test.ts` | Review and validation enforcement tests. |

## Entry points for modification

Change validation judgment in `skills/flow-test/SKILL.md` or review judgment in `skills/flow-review/SKILL.md`. Change `src/application/schema.ts` and `src/domain/transitions.ts` only when the hard evidence contract changes.

Related pages: [Execution and completion](execution-and-completion.md), [Validation and review primitive](../primitives/validation-and-review.md), and [Testing](../how-to-contribute/testing.md).
