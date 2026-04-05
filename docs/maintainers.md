# Maintainer and Contributor Notes

This file collects implementation and development details that are less useful for day-to-day plugin users.

## Development

Install dependencies and run the full local check:

```bash
bun install
bun run check
```

Useful scripts:

- `bun run build`
- `bun run test`
- `bun run typecheck`
- `bun run check`

## Key Source Files

- `src/index.ts`: plugin entrypoint
- `src/config.ts`: command and agent injection
- `src/tools.ts`: runtime tool surface
- `src/runtime/schema.ts`: session and contract schemas
- `src/runtime/transitions.ts`: state transition rules
- `src/runtime/session.ts`: load and save helpers
- `src/runtime/render.ts`: derived markdown rendering
- `src/prompts/agents.ts`: agent instructions
- `src/prompts/commands.ts`: slash command templates

## Recovery Model

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

The runtime uses this to distinguish between missing prerequisites and immediately executable actions.

Examples:

- missing reviewer approval reports a `reviewer_result_required` prerequisite
- missing validation scope or evidence reports `validation_rerun_required`
- missing final review payload reports `completion_payload_rebuild_required`
- failing review or validation can point directly to `flow_reset_feature`

## Architecture

The plugin is built around a small set of responsibilities:

1. A plugin `config` hook injects commands and agents.
2. Runtime tools own all state transitions.
3. Session state is stored under `.flow/sessions/<session-id>/session.json` with `.flow/active` pointing at the current run.
4. Prompted agents call those tools instead of mutating state directly.
5. Derived markdown docs are rendered beside each saved session under `.flow/sessions/<session-id>/docs/`.

## Token Efficiency

Keep Flow prompts narrow and stable. Prefer platform-native efficiency controls before adding plugin-specific machinery:

- keep orchestration prompts focused on routing and recovery, not duplicated workflow narration
- enable OpenCode compaction and provider cache keys when sessions get long
- treat `experimental.session.compacting` as optional escalation only if there is real evidence of Flow state loss
- avoid introducing Flow-owned compaction or measurement plumbing unless a concrete failure mode justifies it

Current injected agents:

- `flow-planner`
- `flow-worker`
- `flow-auto`
- `flow-reviewer`
- `flow-control`

Current runtime tools:

- `flow_status`
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
- `flow_reset_session`

## Agent Roles

### `flow-planner`

- reads the repo and creates a compact execution-ready plan
- does not write code
- does not write `.flow` files directly

### `flow-worker`

- executes exactly one approved feature
- runs validation
- iterates on fixes when review finds issues
- persists completion only through runtime tools

### `flow-reviewer`

- reviews feature-level or final cross-feature state
- returns `approved`, `needs_fix`, or `blocked`
- does not write code

### `flow-auto`

- orchestrates planning, approval, execution, validation, review, fixing, and replanning
- keeps looping until completion or a real blocker
- treats internally solvable contract, gating, and validation failures as recovery work

### `flow-control`

- handles status and reset requests only

## Tool Schema Note

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
