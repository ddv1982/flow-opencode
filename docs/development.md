# Development Guide

This file is for contributors working on the plugin itself.

If you are trying to use Flow inside OpenCode, start with the top-level `README.md` instead.

Current maintainer contract lives in [`docs/maintainer-contract.md`](maintainer-contract.md). Use [`docs/contributor-map.md`](contributor-map.md) to pick the right source files and checks before touching high-risk areas.

This repo's maintainer workflow is intentionally Bun-first. In target projects, Flow is script-first: existing package.json scripts are the primary contract, and package-manager detection is supporting evidence.

For monorepos, package-manager detection starts from the current tool `directory` and walks upward to the mutable Flow workspace root, so subpackage-local evidence can override root-level defaults.

`package.json#packageManager` is authoritative when present and takes precedence over conflicting lockfiles in the same directory.

If one directory has conflicting lockfile families and no explicit `package.json#packageManager`, runtime records package-manager evidence as ambiguous instead of guessing. In that case prompts should continue on existing package.json scripts instead of manager-specific guesses.

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
- `bun run report:prompt-eval`
- `bun run eval:review-capture`
- `bun run eval:review-capture:check`
- `bun run eval:prompt-capture`
- `bun run eval:prompt-capture:check`
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
- `src/runtime/application/session-engine.ts` — root-scoped session mutation orchestration
- `src/runtime/application/workspace-runtime.ts` — tool-argument parsing and workspace-root adapters
- `src/runtime/session.ts` — persistence and lifecycle exports
- `src/runtime/render.ts` — derived markdown rendering
- `src/prompts/agents.ts` — agent instructions
- `src/prompts/commands.ts` — slash-command templates
- `src/prompts/mode-contracts.ts` — canonical prompt-mode boundaries used by prompts, tests, and capture tooling

## Architecture in one view

Flow is built around a few stable responsibilities:

1. A plugin `config` hook injects commands and agents.
2. Runtime tools are adapter entrypoints and delegate to application/domain runtime helpers.
3. Session state is stored under `.flow/active/<session-id>/session.json`, with inactive resumable sessions under `.flow/stored/<session-id>/` and closed history under `.flow/completed/<session-id>-<timestamp>/`.
4. Domain transitions and runtime policy helpers remain authoritative for workflow state changes.
5. Prompted agents call runtime tools instead of mutating state directly.
6. Coordinators use OpenCode task/subagent handoffs for bounded planning, implementation, and review work when the host supports them, so each role can work in a fresh child context while runtime tools remain the state authority.
7. Readable markdown docs are rendered beside each saved session directory under `.flow/active/<session-id>/docs/`, `.flow/stored/<session-id>/docs/`, or `.flow/completed/<session-id>-<timestamp>/docs/`.

## Current agent roles

- `flow-planner`
- `flow-worker`
- `flow-auto`
- `flow-reviewer`
- `flow-control`

### Role intent

- `flow-planner` reads the repo and creates a compact execution-ready plan
- `flow-worker` executes exactly one approved feature and, where OpenCode Task/subagent handoff is supported, asks `flow-reviewer` through Task for an independent fresh-context approval pass before persistence
- `flow-reviewer` reviews either the execution gate (`feature`) or the completion gate (`final`); the final gate follows the runtime-owned final review policy (`detailed` cross-feature by default, `broad` when explicitly configured)
- `flow-auto` coordinates planning, execution, review, recovery, and continuation; where OpenCode Task/subagent handoff is supported, it routes planning to `flow-planner`, implementation to `flow-worker`, and approval to `flow-reviewer` in fresh child contexts
- `flow-control` handles status/history/session/reset requests and the review command surface

Task/subagent handoffs are prompt-level orchestration only. Flow runtime tools remain authoritative for state transitions and persisted session data, and prompts must never edit `.flow` files directly.

Read-only repo review stays separate from feature execution and is exposed through `/flow-review` on `flow-control`. User-facing depth tokens map to internal rigor:

- `default` => `broad_audit`
- `detailed` => `deep_audit`
- `exhaustive` => `full_audit`

`/flow-review` now returns a renderer-backed human report by default; the structured review ledger remains an internal contract behind `flow_review_render`.
Flow may only claim achieved `full_audit` when every major discovered repo surface is directly reviewed with no major unreviewed gaps.

## Prompt quality and evals

Prompt behavior is part of the product contract. Keep mode boundaries in `src/prompts/mode-contracts.ts` and use that file as the canonical source for:

- which prompt surfaces exist
- which source files define each mode
- which runtime and repository mutations are allowed
- which Flow tools are expected or forbidden
- what each mode must do before stopping

Providerless evals protect this contract without calling a model API:

- `bun run eval:review-capture:check` validates `/flow-review` capture scenarios.
- `bun run eval:prompt-capture:check` validates prompt-mode capture scenarios for planner, worker, auto, reviewer, run, and control behavior.
- `bun run report:prompt-eval` writes the combined prompt-eval summary artifacts.

To refresh manual prompt captures:

1. Run `bun run eval:prompt-capture` to export capture prompts.
2. Fill a capture JSON with the observed model/plugin output.
3. Run `bun run eval:prompt-capture -- --score <capture-file.json>`.
4. Promote calibrated outputs with `bun run eval:prompt-capture -- --promote <capture-file.json>`.

The scorer accepts structured tool intent (`toolCalls`, `actualToolCalls`, `plannedToolCalls`, `toolPlan`, or `willCallTools`) when available and falls back to affirmative prose matching otherwise. Keep structured tool-call evidence when possible; it is less brittle than text-only assertions.

Do not add model-provider credentials to this path. These checks are intentionally offline so prompt quality stays testable in CI and local development.

## Current Runtime Tools

Default (core) surface:

- `flow_status`
- `flow_doctor`
- `flow_history`
- `flow_history_show`
- `flow_auto_prepare`
- `flow_plan_start`
- `flow_plan_apply`
- `flow_plan_approve`
- `flow_plan_select_features`
- `flow_plan_context_record`
- `flow_run_start`
- `flow_run_complete_feature`
- `flow_review_record_feature`
- `flow_review_record_final`
- `flow_review_render`
- `flow_session_activate`
- `flow_session_close`
- `flow_reset_feature`


Keep operator-facing messaging simple. Runtime remains the single owner of workflow semantics and internal complexity.

## Maintainer rules

- Runtime owns workflow semantics; prompts and docs describe them.
- Package API is root-only (`opencode-plugin-flow` import). Internal paths are not public API and may change in any release.
- Keep `zod` aligned with `@opencode-ai/plugin` unless a reviewed compatibility change is intentional.
- Preserve direct `tool(...)` arg-shape compatibility at the SDK boundary.
- Use permission-only OpenCode agent restrictions; do not reintroduce deprecated boolean `tools` config for read-only Flow agents.
- Prefer deletion over new helper layers.
- Keep release-bound source free of debug-only artifacts. Do not leave ad-hoc `console.*` calls or `debugger` statements in `src` or the built release artifact. Inspect existing logging, telemetry, CLI-output, and test patterns before changing `console.*`; remove temporary debug noise, but preserve intentional operator or observability signals with an equivalent replacement that keeps severity, message intent, and key context.
- Pair behavior changes with targeted tests and run the existing validation scripts before release.

## Coding guidelines and release hygiene

Flow treats engineering quality as part of the workflow contract, not just reviewer preference:

- Planning records a runtime-owned stack and standards profile. Local repo guidance and configs outrank official docs, and official docs outrank broader Exa/websearch guidance.
- Flow caches the generated stack and standards profile in `.flow/standards-profile.json`; the cache is ignored when the workspace, start directory, schema version, package-manager hint, or relevant source-file fingerprint changes, and external guidance expires after 30 days.
- Prefer deletion and reuse over new abstraction layers.
- Keep diffs small, reviewable, and reversible.
- Use existing package scripts and repo utilities before adding new commands.
- Validate at the smallest useful scope first, then use broader gates before release.
- Keep production/release-bound code free of debug-only artifacts (`console.*` and `debugger`).
- Preserve intentional observability: deleting a meaningful log, diagnostic event, or operator-facing message is only acceptable when an equivalent logger, telemetry, or stdout/stderr replacement remains and preserves severity, message intent, and key context.

When changing `console.*` in release-bound code, use this decision tree:

1. Temporary debug trace or local scratch output: remove it.
2. CLI/operator output: route it through an injected logger or explicit `process.stdout.write` / `process.stderr.write` adapter.
3. Application diagnostic signal: use the repo's existing structured logger with a level and contextual fields.
4. Cross-service or performance diagnostic signal: use the repo's existing telemetry API for spans, events, metrics, or logs.
5. No existing observability facility: add the smallest local injected adapter needed for the current surface, or report a blocker when an equivalent replacement would require a broader observability decision; do not add a dependency unless the change explicitly approves one.

The release hygiene gate is enforced through these mechanisms:

- `biome.json` enables Biome's `lint/suspicious/noConsole` rule for production source. Biome documents this rule as non-recommended by default, configurable as an error, and intended to keep console debugging out of shipped code.
- The release build uses Bun's `--drop=console` setting so bundled dependency code cannot reintroduce console calls into `dist/index.js`.
- `bun run check:release-hygiene` scans `src` and `dist/index.js` after build so release artifacts cannot silently reintroduce `console.*` or `debugger`.

Development-only scripts and tests may still print to stdout/stderr when they are intentionally operator-facing. Release-bound CLI code should make that intent explicit with injectable logger functions or direct `process.stdout.write` / `process.stderr.write` adapters. The goal is to avoid shipping raw debug consoles, not to reduce production observability.

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
- runtime status/doctor structured payloads and detailed views include `laneReason` so lane selection remains auditable without overloading compact operator summaries
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

For the heaviest payload tools (`flow_plan_context_record`, `flow_plan_apply`, `flow_run_complete_feature`, `flow_review_record_feature`, and `flow_review_record_final`), keep the SDK-facing shape thin by transporting the real object as a JSON string field (`planningJson`, `planJson`, `workerJson`, or `decisionJson`) and validating the decoded object at runtime. This keeps the global tool schema surface small enough for ordinary OpenCode requests. Any legacy direct-object compatibility at the `execute(...)` boundary is for internal direct callers and tests only; OpenCode itself will see and validate the thin wrapper schema.

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
