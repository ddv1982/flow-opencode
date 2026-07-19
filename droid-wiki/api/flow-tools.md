# Flow tools

Nine Flow tools are registered in `src/platform/opencode/tools.ts`.
`flow_guidance` returns exact embedded Markdown without changing state. The
other eight invoke the typed application service through the filesystem
composition in `src/infrastructure/fs/workspace-flow-service.ts`.

## Tool table

| Tool | Application method | Purpose |
| --- | --- | --- |
| `flow_guidance` | none | Return package-owned guidance by stable id. |
| `flow_status` | `FlowService.status` | Read the active session and next action. |
| `flow_plan_save` | `FlowService.planSave` | Create a session or update its active same-goal draft; never replace a different unclosed goal. |
| `flow_plan_approve` | `FlowService.planApprove` | Approve the draft plan. |
| `flow_run_start` | `FlowService.runStart` | Start the next runnable feature. |
| `flow_review_start` | `FlowService.reviewStart` | Record source-bound validation and create one durable review assignment; final review stores the passing feature result as a bound prerequisite. |
| `flow_feature_complete` | `FlowService.featureComplete` | Atomically record a targeted feature-assignment result, a broad final-assignment result, or a blocker, with optional bounded `orchestrationPasses`; Flow supplies any durable prerequisite. |
| `flow_feature_reset` | `FlowService.featureReset` | Reset one feature and dependents. |
| `flow_session_close` | `FlowService.sessionClose` | Start quiescent closure or resume interrupted archive publication by durable retry handle. |

## Input schemas

| Schema | File | Used by |
| --- | --- | --- |
| `FlowPlanSaveSchema` | `src/application/flow-service.ts` | `flow_plan_save` |
| `FlowRunStartSchema` | `src/application/flow-service.ts` | `flow_run_start` |
| `FlowReviewStartSchema` | `src/application/flow-service.ts` | `flow_review_start` |
| `FlowFeatureCompleteToolSchema` | `src/application/flow-service.ts` | `flow_feature_complete` |
| `FlowFeatureResetSchema` | `src/application/flow-service.ts` | `flow_feature_reset` |
| `FlowSessionCloseSchema` | `src/application/flow-service.ts` | `flow_session_close` |

Each lifecycle tool registers one required strict `request` object. Status has
compact, detail, execution, and reviewer branches; reviewer requires
`assignmentId`. Review start pairs feature with targeted validation and final
with broad validation plus `featureReview`. The final assignment stores that
result as a bound prerequisite, so a broad feature outcome submits only
`finalReview`. Session close has `start` and `retry` branches; retry accepts only
the stored operation id. Application, registered, emitted, and executed schemas
must accept and reject the same requests.

After a first final assignment, detail status may expose bounded
`finalReviewRetry` state. A same-source retry copies
`finalReviewRetry.prerequisite.result` unchanged into the next final review
start's `request.featureReview`. The detail object includes final-assignment,
run, source, prerequisite-assignment, and result-digest identity; the raw result
is bounded by the persisted 64 KiB limit. Compact and reviewer views omit that
manager-only recovery aggregate. A mismatch is mutation-free and leaves the
operation id reusable.

OpenCode 1.18.3 can invoke a handler even after advertising a request as
invalid. Each registered handler therefore parses its own registered schema at
entry before calling the application execution wrapper. Invalid host calls
become tool errors without reading or mutating Flow state.

## Response shape

Tools return JSON strings through the platform. The application returns a
typed `FlowResponse`. Top-level `status`, `summary`, `statusSummary`,
`nextAction`, and `recovery` are plugin-authored operation metadata. Repository-
or caller-controlled prose is confined to `workflowData` and must be treated as
data rather than instructions. Active status lives under
`workflowData.projection`; ordinary mutations, including run start, return
`workflowData.receipt` acknowledgements. Transition failures use
`workflowData.failure` plus a rejected consequence receipt, and close results
use `workflowData.archive` plus their accepted receipt. Distribution health is
intentionally absent.

An active `flow_status` response therefore has top-level `status: "ok"`; the
workflow state (`planning`, `ready`, `running`, `blocked`, or `completed`) is
`workflowData.projection.status` after an explicit
`{ request: { view: "compact" } }`. Compact is routing-only,
execution is full active-feature scope, detail is diagnostic, and reviewer is
narrow assignment context. Removing `workflowData` from any response must
also remove every value sourced from `.flow/session.json` or tool payload prose.

## Key source files

| File | Purpose |
| --- | --- |
| `src/platform/opencode/tools.ts` | OpenCode tool registration and JSON wrapping. |
| `src/application/flow-service.ts` | Typed use cases and core input schemas. |
| `src/infrastructure/fs/workspace-flow-service.ts` | Filesystem-backed composition. |
| `src/application/schema.ts` | Payload schemas reused by tool inputs. |
| `tests/distribution-and-surface.test.ts` | Tool surface tests. |

Related pages: [Runtime state machine](../systems/runtime-state-machine.md), [Validation and review](../primitives/validation-and-review.md), and [Flow loop](../features/flow-loop.md).
