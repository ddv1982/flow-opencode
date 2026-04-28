# Development Guide

This file is for contributors working on the plugin itself.

If you are trying to use Flow inside OpenCode, start with the top-level `README.md` instead.

## Local workflow

Install dependencies and run the full local check:

```bash
bun install
bun run check
```

Useful scripts:

- `bun run build`
- `bun run deadcode`
- `bun run test`
- `bun run typecheck`
- `bun run check`
- `bun run install:opencode`
- `bun run uninstall:opencode`

## Source map

- `src/index.ts` — plugin entrypoint
- `src/installer.ts` — local OpenCode plugin installer
- `src/config.ts` — command and agent injection
- `src/tools.ts` — OpenCode runtime tool surface
- `src/runtime/schema.ts` — session and contract schemas
- `src/runtime/transitions/` — domain state transition rules split by lifecycle phase
- `src/runtime/domain/completion.ts` — shared completion-policy calculations
- `src/runtime/application/tool-runtime.ts` — application-level tool orchestration helpers
- `src/runtime/session.ts` — persistence and lifecycle exports
- `src/runtime/render.ts` — derived markdown rendering
- `src/prompts/agents.ts` — agent instructions
- `src/prompts/commands.ts` — slash-command templates

## Architecture in one view

Flow is built around a few stable responsibilities:

1. A plugin `config` hook injects commands and agents.
2. Runtime tools are adapter entrypoints and delegate to application/domain runtime helpers.
3. Session state is stored under `.flow/active/<session-id>/session.json`, with inactive resumable sessions under `.flow/stored/<session-id>/` and closed history under `.flow/completed/<session-id>-<timestamp>/`.
4. Domain transitions and runtime policy helpers remain authoritative for workflow state changes.
5. Prompted agents call runtime tools instead of mutating state directly.
6. Readable markdown docs are rendered beside each saved session directory under `.flow/active/<session-id>/docs/`, `.flow/stored/<session-id>/docs/`, or `.flow/completed/<session-id>-<timestamp>/docs/`.

## Current agent roles

- `flow-planner`
- `flow-worker`
- `flow-auto`
- `flow-reviewer`
- `flow-control`

### Role intent

- `flow-planner` reads the repo and creates a compact execution-ready plan
- `flow-worker` executes exactly one approved feature
- `flow-reviewer` reviews either the execution gate (`feature`) or the completion gate (`final`)
- `flow-auto` coordinates planning, execution, review, recovery, and continuation
- `flow-control` handles status/history/session/feature-reset requests only

## Current Runtime Tools

- `flow_status`
- `flow_doctor`
- `flow_history`
- `flow_history_show`
- `flow_auto_prepare`
- `flow_plan_start`
- `flow_plan_apply`
- `flow_plan_approve`
- `flow_plan_select_features`
- `flow_run_start`
- `flow_run_complete_feature`
- `flow_review_record_feature`
- `flow_review_record_final`
- `flow_session_activate`
- `flow_reset_feature`
- `flow_plan_context_record`
- `flow_session_close`

Current surface counts are intentional at the moment:

- 5 agents
- 8 commands
- 17 tools

Treat that shape as deliberate, not accidental duplication. Simplify it only when a concrete operator or maintenance win is clear enough to justify migration cost.

## Maintainer rules

- Runtime owns workflow semantics; prompts and docs describe them.
- Keep `zod` aligned with `@opencode-ai/plugin` unless a reviewed compatibility change is intentional.
- Preserve direct `tool(...)` arg-shape compatibility at the SDK boundary.
- Prefer deletion over new helper layers.

## Recovery model

Retryable runtime failures can include structured recovery metadata alongside the error summary.

That metadata can include:

- `errorCode`
- `resolutionHint`
- `recoveryStage`
- `prerequisite`
- optional `requiredArtifact`
- `nextCommand`
- optional `nextRuntimeTool`
- optional `nextRuntimeArgs`

The runtime uses this to distinguish between:

- missing prerequisites
- immediately executable recovery actions

Examples:

- missing reviewer approval reports a `reviewer_result_required` prerequisite
- missing validation scope or evidence reports `validation_rerun_required`
- missing final review payload reports `completion_payload_rebuild_required`
- failing review or validation can point directly to `flow_reset_feature`

## Workflow semantics

Flow now persists a few higher-level concepts directly in runtime state:

- planning decisions can be classified as `autonomous_choice`, `recommend_confirm`, or `human_required`
- runtime summaries expose the latest blocking planning decision as `decisionGate`
- runtime status/doctor outputs and concrete session-detail payloads include `laneReason` so lane selection is auditable in both structured payloads and operator summaries
- planning decisions also carry a domain such as `architecture`, `product`, `quality`, `scope`, or `delivery`
- plans can declare a `deliveryPolicy` so completion can be driven by a clean finish, a core-work finish, or a threshold
- `replan_required` outcomes must carry a structured reason, failed assumption, and recommended adjustment
- closed sessions carry an explicit closure kind: `completed`, `deferred`, or `abandoned`

## Deferred runtime parallelism

True runtime-level parallel feature execution is intentionally deferred. Current behavior remains single-feature-at-a-time execution with improved lane and recovery visibility.

## Performance direction

Keep Flow prompts narrow and stable. Prefer platform-native efficiency controls before adding plugin-specific machinery:

- keep orchestration prompts focused on routing and recovery, not duplicated workflow narration
- enable OpenCode compaction and provider cache keys when sessions get long
- treat `experimental.session.compacting` as optional escalation only if there is real evidence of Flow state loss
- avoid introducing Flow-owned compaction or measurement plumbing unless a concrete failure mode justifies it

## Tool schema note

OpenCode plugin tools expect `args` to be provided as a raw Zod shape, not a top-level schema object.

Example:

```ts
const FlowRunStartArgsShape = {
  featureId: z.string().optional(),
};
```

This plugin uses two validation layers:

- SDK-facing tool `args` stay as raw shapes for OpenCode compatibility
- stricter runtime validation happens later through schemas such as `WorkerResultSchema`

## Testing

The test suite covers:

- command and agent injection
- tool argument shape compatibility
- session creation, save, and load
- markdown doc rendering
- plan application, selection, and approval
- feature execution and reviewer gating
- blocked and replan-required outcomes
- final-review completion rules
- reset behavior
- prerequisite-aware recovery metadata and autonomous recovery behavior

Run tests with:

```bash
bun test
```
