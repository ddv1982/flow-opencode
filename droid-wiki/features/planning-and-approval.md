# Planning and approval

Active contributors: ddv1982

## Purpose

Planning turns a user goal into a structured plan that the runtime can enforce. `skills/flow-plan/SKILL.md` defines planning behavior, and `src/runtime/transitions.ts` locks the plan once `flow_plan_approve` succeeds.

## Directory layout

```text
skills/flow-plan/
├── SKILL.md
└── references/
    ├── planning-examples.md
    └── parallel-discovery.md
src/runtime/
├── api.ts
├── schema.ts
└── transitions.ts
```

## Key abstractions

| Abstraction | File | Description |
| --- | --- | --- |
| `PlanInputSchema` | `src/runtime/schema.ts` | Accepts draft plan input before feature statuses are normalized. |
| `PlanSchema` | `src/runtime/schema.ts` | Persisted plan shape with normalized features. |
| `applyPlan` | `src/runtime/transitions.ts` | Validates and applies a draft plan. |
| `approvePlan` | `src/runtime/transitions.ts` | Moves a planning session to approved ready state. |
| `FlowPlanSaveSchema` | `src/runtime/api.ts` | Tool input schema for `flow_plan_save`. |

## How it works

`applyPlan` clones the plan through `PlanInputSchema`, sets every feature to `pending`, defaults `finalReviewPolicy` to `detailed`, and validates duplicate feature ids, unknown dependencies, self-dependencies, and dependency cycles. `approvePlan` only accepts sessions in `planning` status with a draft plan.

## Integration points

The public `/flow-plan` command is defined in `src/config-shared.ts`. Its command template bundles `skills/flow-plan/SKILL.md`, planning examples, parallel discovery guidance, and the core Flow orchestration references so planning still works when native skill discovery is stale.

## Key source files

| File | Purpose |
| --- | --- |
| `skills/flow-plan/SKILL.md` | Planning procedure and payload shape. |
| `src/runtime/schema.ts` | Plan, feature, and review-policy schemas. |
| `src/runtime/transitions.ts` | Plan validation and approval logic. |
| `tests/runtime-gates.test.ts` | Invalid dependency and immutable-plan tests. |

## Entry points for modification

Change `skills/flow-plan/SKILL.md` for planning guidance. Change `src/runtime/schema.ts` and `src/runtime/transitions.ts` together if the persisted plan contract changes, then update tests in `tests/runtime-gates.test.ts` and surface docs in [Data models](../reference/data-models.md).

Related pages: [Flow loop](flow-loop.md), [Session, plan, and feature](../primitives/session-plan-feature.md), and [Flow tools](../api/flow-tools.md).
