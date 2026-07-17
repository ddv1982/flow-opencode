# Session, plan, and feature

Active contributors: ddv1982

## Purpose

The session is Flow's durable workflow ledger. The plan describes the goal and feature breakdown, and each feature carries status, review depth, targets, validation hints, and dependency ordering.

## Directory layout

```text
src/runtime/
├── schema.ts
├── transitions.ts
├── api.ts
└── workspace.ts
```

## Key abstractions

| Abstraction | File | Description |
| --- | --- | --- |
| `SessionSchema` | `src/runtime/schema.ts` | Version 2 persisted session model. |
| `PlanSchema` | `src/runtime/schema.ts` | Summary, overview, requirements, decisions, final review policy, and features. |
| `FeatureSchema` | `src/runtime/schema.ts` | Kebab-case feature id and feature state. |
| `createSession` | `src/runtime/transitions.ts` | Creates a planning session with `approval: "pending"`. |
| `summarizeSession` | `src/runtime/transitions.ts` | Produces user-facing status and next action. |

## How it works

`SessionSchema` persists `version`, `id`, `goal`, `status`, `approval`, `plan`, `activeFeatureId`, `history`, budget telemetry, `closure`, `lastError`, and timestamps. `PlanSchema` requires at least one feature. `FeatureSchema` restricts ids to lowercase kebab-case using `FEATURE_ID_PATTERN` and records the feature's minimum `reviewDepth`.

## Integration points

The session is written to `.flow/session.json` by `saveSession` in `src/runtime/workspace.ts`. It is read by `flow_status` and the generated instruction projection. Skills refer to plan `requirements`, `decisions`, feature `targets`, feature `validation`, and feature `reviewDepth` when choosing work and evidence.

## Key source files

| File | Purpose |
| --- | --- |
| `src/runtime/schema.ts` | Session, plan, feature, and history schemas. |
| `src/runtime/transitions.ts` | State changes for session, plan, and feature status. |
| `src/runtime/workspace.ts` | Session persistence and instruction projection. |
| `tests/runtime-gates.test.ts` | Plan and feature gate tests. |

## Entry points for modification

Change `src/runtime/schema.ts` first when model fields change. Then adjust transitions, workspace tests, and [Data models](../reference/data-models.md). Avoid adding model fields that only serve prompt convenience.

Related pages: [Runtime state machine](../systems/runtime-state-machine.md), [Planning and approval](../features/planning-and-approval.md), and [Workspace persistence](../systems/workspace-persistence.md).
