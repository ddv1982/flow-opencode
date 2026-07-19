# Data models

The domain vocabulary is declared in `src/domain/session.ts`, validated by
`src/application/schema.ts`, and persisted through the filesystem repository.
Application input schemas reuse the core validators.

## Session

| Field | Meaning |
| --- | --- |
| `version` | Literal `4`; every other version is generic unsupported input and cannot become Flow state or canonical history. |
| `id` | Bounded session identity (1–128 ASCII letters, digits, underscores, or hyphens); persistence maps its exact case-sensitive bytes to a lowercase SHA-256 archive filename. |
| `goal` | User goal. |
| `status` | `planning`, `ready`, `running`, `blocked`, or `completed`. |
| `approval` | `pending` or `approved`. |
| `plan` | `Plan` or `null`. |
| `activeFeatureId` | Active-execution feature id or `null`; paired with `activeFeatureRunId`. |
| `activeFeatureRunId` | Active-execution epoch or `null`; paired with `activeFeatureId`. |
| `featureRuns` | Historical and active execution epochs. |
| `reviewAssignments` | Durable runtime-owned feature and final review assignments. |
| `history` | Completion and blocker history entries. |
| `budget` | Review-count, run-scoped failed-review, lifecycle, and bounded orchestration telemetry. |
| `closure` | Completed, deferred, or abandoned quiescent closure plus archive retry handle; when present, no active execution or pending assignment remains. It may be null only in active state, never canonical history. |
| `lastError` | Last runtime completion or transition error. |
| `timestamps` | Created, updated, and completed timestamps. |

## Plan and feature

`PlanSchema` stores `summary`, `overview`, `requirements`, `decisions`, `finalReviewPolicy`, and `features`. `FeatureSchema` stores `id`, `title`, `summary`, `status`, `reviewDepth`, `targets`, `validation`, and `dependsOn`.

## Evidence

| Schema | Fields |
| --- | --- |
| `FeatureReviewDepthSchema` | `quick`, `standard`, or `detailed`. |
| `ValidationObservationSchema` | Caller-attested command result; runtime derives command class, digest, source, run, and capture identity. |
| `ValidationEvidenceSchema` | Runtime-owned validation identity, source and run binding, command identity, timestamps, result digests, and optional restricted artifact reference. |
| `ReviewAssignmentSchema` | Runtime-owned feature/final assignment, validation refs, packet/source identity, planned depth, final bound prerequisite result, invalidation reason, and pending/terminal/invalidated lifecycle. |
| `ReviewExecutionSchema` | Assignment-bound verdict, typed findings, timestamps, and terminal disposition. |
| `ReviewAssignmentResultInputSchema` | Assignment id, verdict, typed findings, reported result time, and terminal disposition. |
| `ExecutionHistoryEntrySchema` | Feature-run outcome with validation evidence refs and canonical review-assignment ids; duplicate review summaries are not persisted. |
| `FlowFeatureCompleteToolSchema` | Nested `completed` or `blocked` result with causal guards and assignment result(s). |

Detail status exposes `finalReviewRetry` only when one active-run/source final
assignment has established a prerequisite. It contains the bounded final
assignment, run, source, and prerequisite aggregate needed for same-source
manager recovery, including prerequisite assignment id, raw result, and digest.
The raw result remains inside the persisted 64 KiB limit. Compact and reviewer
status omit it.

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
| `flow_review_start` | `FlowReviewStartSchema` in `src/application/flow-service.ts`. |
| `flow_feature_complete` | `FlowFeatureCompleteToolSchema` in `src/application/flow-service.ts`. |
| `flow_feature_reset` | `FlowFeatureResetSchema` in `src/application/flow-service.ts`. |
| `flow_session_close` | `FlowSessionCloseSchema` in `src/application/flow-service.ts`. |

Related pages: [Schema and JSON](../systems/schema-and-json.md), [Session, plan, and feature](../primitives/session-plan-feature.md), and [Flow tools](../api/flow-tools.md).
