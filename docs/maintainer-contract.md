# Maintainer Contract

## What this project is

Flow is a workflow runtime delivered as an OpenCode plugin.

It injects Flow slash commands, Flow agents, and a bounded runtime tool surface into OpenCode. The runtime persists planning/execution state under the workspace-local `.flow/` tree and renders readable markdown artifacts beside each saved session.

## Source of truth

Runtime/domain/transitions own behavior.
Prompts and docs describe behavior; they do not define it.

Primary ownership map:

- Plugin registration: `src/index.ts`, `src/config.ts`, `src/tools.ts`
- Runtime schemas and persisted state contracts: `src/runtime/schema.ts`
- Runtime/domain policy: `src/runtime/domain/`
- State transitions: `src/runtime/transitions/`
- Session persistence and workspace-root rules: `src/runtime/session*.ts`, `src/runtime/paths.ts`, `src/runtime/workspace-root.ts`
- Tool schemas: `src/tools/schemas.ts`, with shared runtime payload schemas imported from `src/runtime/schema.ts`
- Prompt-mode contracts: `src/prompts/mode-contracts.ts`
- Prompt text: `src/prompts/`, `src/audit/prompts/`

## Historical references

Historical artifacts may mention deleted or renamed files that existed when the artifact was written. This is expected in `CHANGELOG.md`, generated `release-notes.md`, `docs/releases/**`, `docs/investigations/**`, and `.factory/validation/**`. Current behavior and required checks are defined by this maintainer contract, current source files, current tests, and active scripts.

## Commands

Command registration lives in `src/config.ts`, with the read-only audit command added by `src/audit/config.ts`.

| Command | Agent | Runtime entrypoint |
| --- | --- | --- |
| `/flow-plan` | `flow-planner` | Planning tools: `flow_plan_start`, `flow_plan_context_record`, `flow_plan_apply`, `flow_plan_approve`, `flow_plan_select_features` |
| `/flow-run` | `flow-worker` | Execution tools: `flow_run_start`, `flow_review_record_feature`, `flow_review_record_final`, `flow_run_complete_feature` |
| `/flow-auto` | `flow-auto` | Autonomous coordinator starts with `flow_auto_prepare`, then uses planning/execution/review tools as runtime state allows |
| `/flow-status` | `flow-control` | `flow_status` |
| `/flow-doctor` | `flow-control` | `flow_doctor` |
| `/flow-history` | `flow-control` | `flow_history`, `flow_history_show` |
| `/flow-session` | `flow-control` | `flow_session_activate`, `flow_session_close` |
| `/flow-reset` | `flow-control` | `flow_reset_feature` |
| `/flow-review` | `flow-control` | Read-only audit prompt plus `flow_review_render` |

## Tools

Tool registration is split by operator surface, but `src/tools/schemas.ts` is the schema-owner module at the OpenCode `tool(...)` boundary. Worker and reviewer payload compatibility is owned by `src/runtime/schema.ts` and re-exported through `src/tools/schemas.ts`.

| Tool | Registration owner | Schema owner |
| --- | --- | --- |
| `flow_status` | `src/tools/session-tools/history-tools.ts` | `FlowStatusArgsSchema` in `src/tools/schemas.ts` |
| `flow_doctor` | `src/tools/session-tools/history-tools.ts` | `FlowDoctorArgsSchema` in `src/tools/schemas.ts` |
| `flow_history` | `src/tools/session-tools/history-tools.ts` | `FlowHistoryArgsSchema` in `src/tools/schemas.ts` |
| `flow_history_show` | `src/tools/session-tools/history-tools.ts` | `FlowHistoryShowArgsSchema` in `src/tools/schemas.ts` |
| `flow_session_activate` | `src/tools/session-tools/history-tools.ts` | `FlowSessionActivateArgsSchema` in `src/tools/schemas.ts` |
| `flow_session_close` | `src/tools/session-tools/lifecycle-tools.ts` | `FlowSessionCloseArgsSchema` in `src/tools/schemas.ts` |
| `flow_auto_prepare` | `src/tools/session-tools/planning-tools.ts` | `FlowAutoPrepareArgsSchema` in `src/tools/schemas.ts` |
| `flow_plan_start` | `src/tools/session-tools/planning-tools.ts` | `FlowPlanStartArgsSchema` in `src/tools/schemas.ts` |
| `flow_plan_context_record` | `src/tools/runtime-tools/planning-tools.ts` | `FlowPlanContextRecordArgsSchema` in `src/tools/schemas.ts` |
| `flow_plan_apply` | `src/tools/runtime-tools/planning-tools.ts` | `FlowPlanApplyArgsSchema` in `src/tools/schemas.ts` |
| `flow_plan_approve` | `src/tools/runtime-tools/planning-tools.ts` | `FlowPlanApproveArgsSchema` in `src/tools/schemas.ts` |
| `flow_plan_select_features` | `src/tools/runtime-tools/planning-tools.ts` | `FlowPlanSelectArgsSchema` in `src/tools/schemas.ts` |
| `flow_run_start` | `src/tools/runtime-tools/execution-tools.ts` | `FlowRunStartArgsSchema` in `src/tools/schemas.ts` |
| `flow_run_complete_feature` | `src/tools/runtime-tools/execution-tools.ts` | `FlowRunCompleteFeatureArgsSchema` plus `WorkerResultArgsSchema` in `src/tools/schemas.ts` / `src/runtime/schema.ts` |
| `flow_reset_feature` | `src/tools/runtime-tools/execution-tools.ts` | `FlowResetFeatureArgsSchema` in `src/tools/schemas.ts` |
| `flow_review_record_feature` | `src/tools/runtime-tools/review-tools.ts` | `FlowReviewRecordFeatureJsonArgsSchema` plus `FlowReviewRecordFeatureArgsSchema` in `src/tools/schemas.ts` / `src/runtime/schema.ts` |
| `flow_review_record_final` | `src/tools/runtime-tools/review-tools.ts` | `FlowReviewRecordFinalJsonArgsSchema` plus `FlowReviewRecordFinalArgsSchema` in `src/tools/schemas.ts` / `src/runtime/schema.ts` |
| `flow_review_render` | `src/tools/runtime-tools/review-tools.ts` | `FlowReviewRenderArgsSchema` in `src/tools/schemas.ts` |

## State paths

Path construction and safety checks live in `src/runtime/paths.ts`.
Session loading, saving, locking, activation, and closure live in `src/runtime/session*.ts`.

Current workspace-local state paths:

- `.flow/active/<session-id>/session.json` — active mutable session state
- `.flow/active/<session-id>/docs/index.md` — derived active session index render
- `.flow/active/<session-id>/docs/features/<feature-id>.md` — derived active feature render
- `.flow/active/<session-id>/reviews/` — removable review artifact directory used by lifecycle cleanup
- `.flow/stored/<session-id>/session.json` — inactive resumable session state
- `.flow/stored/<session-id>/docs/**` — derived stored session docs
- `.flow/completed/<session-id>-<timestamp>/session.json` — closed session history
- `.flow/completed/<session-id>-<timestamp>/docs/**` — derived completed session docs

Ownership rules:

- Runtime writes `.flow/**`; prompts and docs must not prescribe alternate state paths.
- State shape changes require schema, persistence, recovery, and migration/recovery consideration.
- Rendered docs are derived artifacts, not the source of workflow truth.
- Read-only `/flow-review` reports are returned to the caller; Flow does not own a persisted review-history tree.

## Contract invariants

- Runtime owns workflow semantics.
- Prompt contracts must mirror runtime, not invent behavior.
- Tool schemas are compatibility surfaces.
- Completion/reviewer gates are release-critical.
- `zod` / `@opencode-ai/plugin` alignment must remain stable.
- Runtime tool names are public prompt contracts; renames require parity updates.
- Prompt-mode boundaries are first-party product contracts and are guarded by capture/eval tests.
- `/flow-review` is read-only and must not advance Flow planning/execution state.
- Surface expansion is frozen by default: avoid new commands, tools, prompt contracts, state paths, or runtime modes unless there is an explicit retirement/replacement tradeoff.

## Semantic invariant anchors

The runtime-owned semantic invariant catalog is mirrored here for maintainer orientation. The owners remain in `src/runtime/domain/semantic-invariants.ts` and the runtime/domain/transitions files named there.

- [semantic-invariant] completion.gates.required_order
- [semantic-invariant] completion.policy.min_completed_features
- [semantic-invariant] decision_gate.planning_surface.binding
- [semantic-invariant] review.scope.payload_binding
- [semantic-invariant] recovery.next_action.binding
- [semantic-invariant] tools.canonical_surface.no_raw_wrappers

## If you touch X, run Y

Prefer the narrowest useful check first, then run `bun run check` before release or cross-surface merges.

| Area touched | Required checks |
| --- | --- |
| `zod`, `@opencode-ai/plugin`, or tool arg compatibility | `bun pm ls zod`; `bun run check:dependency-contract`; `bun test tests/config/tool-schemas.test.ts tests/runtime-tools.test.ts tests/runtime/worker-result-contracts.test.ts tests/runtime/plan-and-tool-schema-contracts.test.ts tests/schema-equivalence.test-d.ts`; `bun run typecheck` |
| Completion/finalization transitions | `bun run gate:completion-lane`; `bun test tests/runtime/final-completion-gates.test.ts tests/runtime/final-review-contracts.test.ts tests/completion-gates.test.ts` |
| Runtime transitions or schema | `bun test tests/runtime.test.ts tests/runtime-recovery.test.ts tests/runtime/semantic-invariants.test.ts tests/protocol-parity.test.ts` |
| Prompt text or prompt-mode contracts | `bun run eval:prompt-capture:check`; `bun test tests/config/prompt-contracts.test.ts tests/mode-contracts.test.ts tests/prompt-snapshot.test.ts tests/prompt-mode-behavior-eval.test.ts` |
| `/flow-review` audit prompt or renderer | `bun run eval:review-capture:check`; `bun test tests/review-prompt-capture.test.ts tests/prompt-behavior-eval.test.ts` |
| Tool registration or tool schemas | `bun test tests/config/plugin-surface.test.ts tests/config/tool-schemas.test.ts tests/runtime-tools.test.ts tests/runtime-tools-metadata.test.ts tests/docs-tool-parity.test.ts`; `bun run typecheck` |
| Session paths, persistence, history, or migration | `bun test tests/runtime.test.ts tests/session-history.test.ts tests/runtime/render-snapshot.test.ts tests/runtime-summary.test.ts tests/workspace-root-guard.test.ts` |
| Install/uninstall or package release surface | `bun run build`; `bun run check:release-hygiene`; `bun run check:pack-invariants`; `bun test tests/install.test.ts tests/cross-area/install-lifecycle.test.ts tests/smoke/dist-load.test.ts` |
| Performance-sensitive save/render/schema paths | `bun run bench:smoke` |
| Any cross-surface release candidate | `bun run check` |
