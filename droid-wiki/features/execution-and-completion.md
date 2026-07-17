# Execution and completion

Active contributors: ddv1982

## Purpose

Execution runs one approved feature at a time and records real validation and review evidence before completion. `skills/flow-run/SKILL.md` guides implementation, while `completeFeature` in `src/domain/transitions.ts` enforces the completion gate.

## Directory layout

```text
skills/flow-run/
├── SKILL.md
└── references/
    ├── validation-rubric.md
    └── audit-rubric.md
src/domain/transitions.ts
src/application/schema.ts
src/application/flow-service.ts
```

## Key abstractions

| Abstraction | File | Description |
| --- | --- | --- |
| `startRun` | `src/domain/transitions.ts` | Selects a runnable feature and marks it `in_progress`. |
| `completeFeature` | `src/domain/transitions.ts` | Records `ok` or `needs_input` worker results. |
| `resetFeature` | `src/domain/transitions.ts` | Resets a feature and dependents to `pending`. |
| `WorkerResultSchema` | `src/application/schema.ts` | Validates completion or blocker payloads. |
| `ExecutionHistoryEntrySchema` | `src/application/schema.ts` | Persists completion and blocker history. |

## How it works

```mermaid
graph TD
    Ready[ready session] --> Start[startRun]
    Start --> Active[in_progress feature]
    Active --> Payload[flow_feature_complete payload]
    Payload --> Validate[validateCompletion]
    Validate --> NonFinal[targeted validation + featureReviewDepth + featureReview]
    Validate --> Final[broad validation + featureReviewDepth + featureReview + finalReview]
    NonFinal --> NextReady[ready for next feature]
    Final --> Complete[completed session]
    Payload --> Blocked[blocked session when needs_input]
```

`startRun` only chooses pending features whose dependencies are complete and refuses every session with a stored closure. `completeFeature` rejects missing validation, failed validation, wrong validation scope, too-shallow feature review depth, failed feature review, missing final review, failed final review, or final review depth that does not match the plan policy.

## Integration points

`skills/flow-run/SKILL.md` tells agents to use `flow-test` for complex validation
and `flow-review` before recording completion. The application and domain do
not know those helper details; they only see the evidence payload defined by
`WorkerResultSchema`.

## Key source files

| File | Purpose |
| --- | --- |
| `skills/flow-run/SKILL.md` | Execution rules and completion payload example. |
| `src/domain/transitions.ts` | Runnable feature selection, completion, reset, and close gates. |
| `src/application/flow-service.ts` | Tool handlers for start, complete, reset, and close. |
| `tests/runtime-gates.test.ts` | Completion, final feature, blocker, and reset tests. |

## Entry points for modification

Change `skills/flow-run/SKILL.md` for execution behavior. Change `validateCompletion` in `src/domain/transitions.ts` for hard gate changes, and update [Validation and review](../primitives/validation-and-review.md) when payload requirements change.

Related pages: [Review and validation](review-and-validation.md), [Runtime state machine](../systems/runtime-state-machine.md), and [Flow tools](../api/flow-tools.md).
