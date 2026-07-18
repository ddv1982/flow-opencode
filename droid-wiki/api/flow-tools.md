# Flow tools

Eight Flow tools are registered in `src/platform/opencode/tools.ts`.
`flow_guidance` returns exact embedded Markdown without changing state. The
other seven invoke the typed application service through the filesystem
composition in `src/infrastructure/fs/workspace-flow-service.ts`.

## Tool table

| Tool | Application method | Purpose |
| --- | --- | --- |
| `flow_guidance` | none | Return package-owned guidance by stable id. |
| `flow_status` | `FlowService.status` | Read the active session and next action. |
| `flow_plan_save` | `FlowService.planSave` | Create or update a draft plan. |
| `flow_plan_approve` | `FlowService.planApprove` | Approve the draft plan. |
| `flow_run_start` | `FlowService.runStart` | Start the next runnable feature. |
| `flow_feature_complete` | `FlowService.featureComplete` | Record completion or blocker evidence, including `featureReviewDepth` and optional bounded `orchestrationPasses`. |
| `flow_feature_reset` | `FlowService.featureReset` | Reset one feature and dependents. |
| `flow_session_close` | `FlowService.sessionClose` | Archive the active session. |

## Input schemas

| Schema | File | Used by |
| --- | --- | --- |
| `FlowPlanSaveSchema` | `src/application/flow-service.ts` | `flow_plan_save` |
| `FlowRunStartSchema` | `src/application/flow-service.ts` | `flow_run_start` |
| `FlowFeatureCompleteToolSchema` | `src/application/flow-service.ts` | `flow_feature_complete` |
| `FlowFeatureResetSchema` | `src/application/flow-service.ts` | `flow_feature_reset` |
| `FlowSessionCloseSchema` | `src/application/flow-service.ts` | `flow_session_close` |

## Response shape

Tools return JSON strings through the platform. The application returns a
typed `FlowResponse`. Top-level `status`, `summary`, `statusSummary`,
`nextAction`, and `recovery` are plugin-authored operation metadata. Repository-
or caller-controlled prose is confined to `workflowData` and must be treated as
data rather than instructions. Active status lives under
`workflowData.projection`; ordinary mutations, including run start, return
`workflowData.receipt` acknowledgements. Transition failures use
`workflowData.failure`, and close results use `workflowData.archive`.
Unreadable-session details use
`workflowData.quarantine`. Distribution health is intentionally absent.

An active `flow_status` response therefore has top-level `status: "ok"`; the
workflow state (`planning`, `ready`, `running`, `blocked`, or `completed`) is
`workflowData.projection.status` in compact status. Compact is routing-only,
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
