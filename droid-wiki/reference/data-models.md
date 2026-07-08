# Data models

The data model is defined in `src/runtime/schema.ts` and persisted through `src/runtime/workspace.ts`. Runtime API input schemas in `src/runtime/api.ts` reuse these domain schemas.

## Session

| Field | Meaning |
| --- | --- |
| `version` | Literal `2`. |
| `id` | Session id. |
| `goal` | User goal. |
| `status` | `planning`, `ready`, `running`, `blocked`, or `completed`. |
| `approval` | `pending` or `approved`. |
| `plan` | `Plan` or `null`. |
| `activeFeatureId` | Current feature id or `null`. |
| `history` | Completion and blocker history entries. |
| `budget` | Phase-boundary, review-count, failed-review, compact orchestration, and token-telemetry status. |
| `closure` | Completed, deferred, or abandoned closure record. |
| `lastError` | Last runtime completion or transition error. |
| `timestamps` | Created, updated, and completed timestamps. |

## Plan and feature

`PlanSchema` stores `summary`, `overview`, `requirements`, `decisions`, `finalReviewPolicy`, and `features`. `FeatureSchema` stores `id`, `title`, `summary`, `status`, `reviewDepth`, `targets`, `validation`, and `dependsOn`.

## Evidence

| Schema | Fields |
| --- | --- |
| `ValidationRunSchema` | `command`, `status`, `summary`. |
| `FeatureReviewDepthSchema` | `quick`, `standard`, or `detailed`. |
| `ReviewSchema` | `status`, `summary`, `blockingFindings`. |
| `FinalReviewSchema` | Review fields plus `reviewDepth`. |
| `WorkerResultSchema` | `status`, `featureId`, `summary`, artifacts, validation, feature review depth, review, final review, outcome, and optional `orchestrationPasses`. |

## Orchestration telemetry

`OrchestrationPassRecordSchema` stores compact pass ids, pass kind, decision,
worker counts, slice ids, dependencies, write scope, handoff references,
verification status, outcome, and synthesis references. The runtime keeps
aggregates and recent records under `budget.orchestration`; full handoffs and
logs are not stored in the session file.

## Runtime API payloads

| Tool | Schema |
| --- | --- |
| `flow_plan_save` | `FlowPlanSaveSchema` in `src/runtime/api.ts`. |
| `flow_run_start` | `FlowRunStartSchema` in `src/runtime/api.ts`. |
| `flow_feature_complete` | `FlowFeatureCompleteToolSchema` in `src/runtime/api.ts`. |
| `flow_feature_reset` | `FlowFeatureResetSchema` in `src/runtime/api.ts`. |
| `flow_session_close` | `FlowSessionCloseSchema` in `src/runtime/api.ts`. |

Related pages: [Schema and JSON](../systems/schema-and-json.md), [Session, plan, and feature](../primitives/session-plan-feature.md), and [Flow tools](../api/flow-tools.md).
