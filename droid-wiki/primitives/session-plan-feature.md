# Session, plan, and feature

Active contributors: ddv1982

## Purpose

The session is Flow's durable workflow ledger. The plan describes the goal and feature breakdown, and each feature carries status, review depth, targets, validation hints, and dependency ordering.

## Directory layout

```text
src/domain/session.ts
src/domain/transitions.ts
src/application/schema.ts
```

## Key abstractions

| Abstraction | File | Description |
| --- | --- | --- |
| `SessionSchema` | `src/application/schema.ts` | Version 3 persisted session model. |
| `PlanSchema` | `src/application/schema.ts` | Summary, overview, requirements, decisions, final review policy, and features. |
| `FeatureSchema` | `src/application/schema.ts` | Kebab-case feature id and feature state. |
| `createSession` | `src/domain/transitions.ts` | Creates a planning session with `approval: "pending"`. |
| `summarizeSession` | `src/domain/transitions.ts` | Produces user-facing status and next action. |

## How it works

`SessionSchema` persists `version`, `id`, `goal`, `status`, `approval`, `plan`, `activeFeatureId`, `history`, budget telemetry, `closure`, `lastError`, and timestamps. `PlanSchema` requires at least one feature. `FeatureSchema` restricts ids to lowercase kebab-case using `FEATURE_ID_PATTERN` and records the feature's minimum `reviewDepth`.

## Integration points

The session is written to `.flow/session.json` by `saveSession` in `src/infrastructure/fs/workspace.ts` and read explicitly by `flow_status`. Flow guidance refers to plan `requirements`, `decisions`, feature `targets`, feature `validation`, and feature `reviewDepth` when choosing work and evidence.

## Key source files

| File | Purpose |
| --- | --- |
| `src/application/schema.ts` | Session, plan, feature, and history schemas. |
| `src/domain/transitions.ts` | State changes for session, plan, and feature status. |
| `src/infrastructure/fs/workspace.ts` | Session persistence, archive, and quarantine. |
| `tests/runtime-gates.test.ts` | Plan and feature gate tests. |

## Entry points for modification

Change `src/application/schema.ts` first when model fields change. Then adjust transitions, workspace tests, and [Data models](../reference/data-models.md). Avoid adding model fields that only serve prompt convenience.

Related pages: [Runtime state machine](../systems/runtime-state-machine.md), [Planning and approval](../features/planning-and-approval.md), and [Workspace persistence](../systems/workspace-persistence.md).
