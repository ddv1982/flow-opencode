# Flow tools

The seven Flow tools are registered in `src/adapters/opencode/tools.ts` and implemented in `src/runtime/api.ts`. They are the only state-changing API surface for Flow sessions.

## Tool table

| Tool | Runtime function | Purpose |
| --- | --- | --- |
| `flow_status` | `flowStatus` in `src/runtime/api.ts` | Read the active session and next action. |
| `flow_plan_save` | `flowPlanSave` in `src/runtime/api.ts` | Create or update a draft plan. |
| `flow_plan_approve` | `flowPlanApprove` in `src/runtime/api.ts` | Approve the draft plan. |
| `flow_run_start` | `flowRunStart` in `src/runtime/api.ts` | Start the next runnable feature; accepts `phaseBoundaryAck` when resuming after a checkpoint. |
| `flow_feature_complete` | `flowFeatureComplete` in `src/runtime/api.ts` | Record completion or blocker evidence, including `featureReviewDepth` and optional bounded `orchestrationPasses`. |
| `flow_feature_reset` | `flowFeatureReset` in `src/runtime/api.ts` | Reset one feature and dependents. |
| `flow_session_close` | `flowSessionClose` in `src/runtime/api.ts` | Archive the active session. |

## Input schemas

| Schema | File | Used by |
| --- | --- | --- |
| `FlowPlanSaveSchema` | `src/runtime/api.ts` | `flow_plan_save` |
| `FlowRunStartSchema` | `src/runtime/api.ts` | `flow_run_start` |
| `FlowFeatureCompleteToolSchema` | `src/runtime/api.ts` | `flow_feature_complete` |
| `FlowFeatureResetSchema` | `src/runtime/api.ts` | `flow_feature_reset` |
| `FlowSessionCloseSchema` | `src/runtime/api.ts` | `flow_session_close` |

## Response shape

Tools return JSON strings through `src/adapters/opencode/tools.ts`. Runtime success responses include status, summary, next action, and session details where useful. Failures include `status: "error"`, a summary, and recovery guidance when the transition provides one.

## Key source files

| File | Purpose |
| --- | --- |
| `src/adapters/opencode/tools.ts` | OpenCode tool registration and JSON wrapping. |
| `src/runtime/api.ts` | Runtime tool implementation. |
| `src/runtime/schema.ts` | Payload schemas reused by tool inputs. |
| `tests/distribution-and-surface.test.ts` | Tool surface tests. |

Related pages: [Runtime state machine](../systems/runtime-state-machine.md), [Validation and review](../primitives/validation-and-review.md), and [Flow loop](../features/flow-loop.md).
