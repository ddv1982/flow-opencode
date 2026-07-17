# Data models

The domain vocabulary is declared in `src/domain/session.ts`, validated by
`src/application/schema.ts`, and persisted through the filesystem repository.
Application input schemas reuse the core validators.

## Session

| Field | Meaning |
| --- | --- |
| `version` | Literal `3`; older versions are preserved as unsupported and never migrated. |
| `id` | Session id. |
| `goal` | User goal. |
| `status` | `planning`, `ready`, `running`, `blocked`, or `completed`. |
| `approval` | `pending` or `approved`. |
| `plan` | `Plan` or `null`. |
| `activeFeatureId` | Current feature id or `null`. |
| `history` | Completion and blocker history entries. |
| `budget` | Review-count, failed-review, and bounded orchestration telemetry. |
| `closure` | Completed, deferred, or abandoned closure record; when present, the session is archive-only. |
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
| `WorkerResultSchema` | `status`, `featureId`, `summary`, artifacts, validation, feature review depth, review, final review, explicitly discriminated outcome, and optional `orchestrationPasses`. |

## Orchestration telemetry

`OrchestrationPassRecordSchema` stores bounded pass ids, pass kind, decision,
candidate eligibility, candidate decision, structured decision factors, worker
counts, slice ids, dependencies, write scope, handoff references, verification
status, outcome, and synthesis references. The runtime keeps aggregates and
recent records under `budget.orchestration`; full handoffs and logs are not
stored in the session file. `skippedCandidateDecisionCount` means an
implementation-decision record was `eligible` for candidate workers but the
manager chose `skipped`. `latestPasses` retains at most 50 records, completion
accepts at most 50, and pass ids deduplicate only within the submitted payload
and retained window. An evicted id may count again because orchestration data is
telemetry rather than a permanent idempotency ledger. Each subtype worker count
(`candidateWorkerCount`, `verifierWorkerCount`) must not exceed the total
`workerCount`; a single worker may fill both roles. The remaining validation
manager-facing rules — valid decision pairings and the execution evidence required for
candidate-shaped decisions, `candidateDecision: "used"`, `candidatePassCount`,
and `verifierPassCount` — are canonical in
`skills/flow/references/parallel-decision.md` and
`skills/flow/references/parallel-synthesis.md`; `src/application/schema.ts` remains
the enforcement authority.

## Application payloads

| Tool | Schema |
| --- | --- |
| `flow_plan_save` | `FlowPlanSaveSchema` in `src/application/flow-service.ts`. |
| `flow_run_start` | `FlowRunStartSchema` in `src/application/flow-service.ts`. |
| `flow_feature_complete` | `FlowFeatureCompleteToolSchema` in `src/application/flow-service.ts`. |
| `flow_feature_reset` | `FlowFeatureResetSchema` in `src/application/flow-service.ts`. |
| `flow_session_close` | `FlowSessionCloseSchema` in `src/application/flow-service.ts`. |

Related pages: [Schema and JSON](../systems/schema-and-json.md), [Session, plan, and feature](../primitives/session-plan-feature.md), and [Flow tools](../api/flow-tools.md).
