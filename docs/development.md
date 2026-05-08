# Development Guide

This file is for contributors working on the plugin itself.

If you are trying to use Flow inside OpenCode, start with the top-level `README.md` instead.

Current maintainer contract lives in [`docs/maintainer-contract.md`](maintainer-contract.md). Use [`docs/contributor-map.md`](contributor-map.md) to pick the right source files and checks before touching high-risk areas. Ownership boundaries and cross-domain review/triage policy live in [`docs/architecture/ownership-operating-model.md`](architecture/ownership-operating-model.md).

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
- `bun run test:fast`
- `bun run test:deep`
- `bun run typecheck`
- `bun run check`
- `bun run report:prompt-eval`
- `bun run eval:review-capture`
- `bun run eval:review-capture:check`
- `bun run eval:prompt-capture`
- `bun run eval:prompt-capture:check`
- `bun run install:opencode`
- `bun run uninstall:opencode`


## Gate contract quick reference

`bun run check` is the canonical local/mainline readiness contract. Run focused scripts first when they help isolate a touched area, but do not treat focused CI preflights as replacements for the full local contract unless `docs/maintainer-contract.md` records a no-weakening proof.

Gate status terms:

- **Hard** gates fail the command and block merge/release readiness. Examples: `bun run check:dependency-contract`, `bun run check:architecture-seams:enforce`, `bun run check:generated-drift`, `bun run gate:completion-lane`, `bun run test:replay`, and `bun run bench:gate`.
- **Advisory** gates are supplemental visibility and do not block by exit code. `bun run check:boundary-report` is advisory by design today: it exits `0` and reports prompt/tool boundary findings unless a future reviewed change promotes it with script, docs, and test updates.
- **Diagnostic/report** commands support investigation or planning. `bun run check:architecture-seams` is seam report mode; `bun run report:runtime-simplification-metrics` prints simplification metrics. Use the corresponding hard gate (`check:architecture-seams:enforce`) for pass/fail readiness.

The full matrix, artifact owners, source-of-truth scripts, repeated-inside-`check` status, and CI/local no-weakening rules live in [`docs/maintainer-contract.md#gate-contract-matrix`](maintainer-contract.md#gate-contract-matrix).

Standing dependency/tool checklist: keep `zod` aligned with `@opencode-ai/plugin`, preserve raw `tool(...)` arg shapes at the SDK boundary, and run `bun run check:dependency-contract` for dependency, schema, or tool-surface changes.

## Source map

- `src/index.ts` — plugin entrypoint
- `src/installer.ts` — local OpenCode plugin installer
- `src/config.ts` — command and agent injection
- `src/adapters/opencode/tools.ts` — OpenCode runtime tool surface
- `src/adapters/opencode/attachment-policy.ts`, `src/adapters/opencode/attachment-store.ts`, and `src/adapters/opencode/attachment-materialization.ts` — supported image attachment policy, captured OpenCode attachment index, and explicit workspace materialization for `/flow-auto`
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

Flow is built around a few stable responsibilities and authority boundaries:

1. A plugin `config` hook injects commands and agents.
2. Runtime tools are adapter entrypoints and delegate to application/domain runtime helpers.
3. Session state is stored under `.flow/active/<session-id>/session.json`, with inactive resumable sessions under `.flow/stored/<session-id>/` and closed history under `.flow/completed/<session-id>-<timestamp>/`.
4. Domain transitions and runtime policy helpers remain authoritative for workflow state changes.
5. Prompted agents call runtime tools instead of mutating state directly.
6. Coordinators use OpenCode task/subagent handoffs for bounded planning, implementation, and review work when the host supports them, so each role can work in a fresh child context while runtime tools remain the state authority.
7. For attachment-dependent `/flow-auto` goals, the coordinator materializes captured OpenCode PNG, JPEG, WebP, GIF, or AVIF attachments into explicit workspace asset paths before planning or handoff; SVG remains unsupported, and chat attachments are not filesystem files until `flow_attachments_materialize` returns paths.
8. Readable markdown docs are rendered beside each saved session directory under `.flow/active/<session-id>/docs/`, `.flow/stored/<session-id>/docs/`, or `.flow/completed/<session-id>-<timestamp>/docs/`.

Live runtime persistence is snapshot-primary: runtime application ports load and save session snapshots, then sync derived artifacts. The core workflow event/replay stack is active semantic and regression infrastructure, but it is not the live persistence authority unless a future migration explicitly promotes it.

Projection metadata is consolidated through the OpenCode surface descriptor family in `src/adapters/opencode/tool-surface/descriptors.ts`. That family can describe core-backed mutation tools, workspace/control tools, read tools, and render-only tools without pretending every surface has both a runtime action and a core workflow action. Adapter implementation modules still own the dispatch constants they invoke, and `src/adapters/opencode/tool-surface/schemas.ts` owns a payload schema registry that co-locates each tool's raw arg shape, parser schema, and owner metadata; descriptor parity tests compare both sources against the descriptor projection contract. Runtime transitions still enforce behavior; descriptors, prompts, docs, and audit surfaces project or verify that behavior.

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

Prompt behavior is part of the product contract. Keep prompt-mode boundaries in `src/prompts/mode-contracts.ts` and use that file as the canonical source for prompt visibility and mode behavior, not as the owner of runtime transition law:

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

Default OpenCode tool surface, in descriptor docs-row order:

- `flow_status` — Show the active Flow session summary
- `flow_doctor` — Run non-destructive readiness checks for Flow in the current workspace
- `flow_history` — Show active, stored, and completed Flow session history
- `flow_history_show` — Show a specific active, stored, or completed Flow session by id
- `flow_session_activate` — Activate a stored Flow session by id
- `flow_plan_start` — Create or refresh the active Flow planning session
- `flow_auto_prepare` — Classify a flow-auto invocation and report attachment materialization requirements
- `flow_attachments_materialize` — Import captured PNG, JPEG, WebP, GIF, or AVIF OpenCode attachments into a safe workspace path
- `flow_session_close` — Close the active Flow session as completed, deferred, or abandoned
- `flow_plan_context_record` — Persist repo profile, research, implementation approach, and optional planning decisions into the active Flow session from a JSON payload
- `flow_plan_apply` — Persist a Flow draft plan into the active session from a JSON payload
- `flow_plan_approve` — Approve the active Flow draft plan
- `flow_plan_select_features` — Keep only selected features in the active Flow draft plan
- `flow_run_start` — Start the next runnable Flow feature
- `flow_run_complete_feature` — Persist an already-validated Flow feature execution result from a JSON payload
- `flow_reset_feature` — Reset a Flow feature to pending
- `flow_review_record_feature` — Record an already-validated reviewer decision for the active feature from a JSON payload
- `flow_review_record_final` — Record an already-validated reviewer decision for final cross-feature validation from a JSON payload
- `flow_review_render` — Render a structured Flow review ledger into a human-readable report, structured JSON, or both


Attachment materialization is a narrow `/flow-auto` coordinator surface. It imports only captured OpenCode PNG, JPEG, WebP, GIF, or AVIF `data:` attachments into a caller-selected workspace asset directory, never into `.flow/**`, and returns workspace-relative paths for plans, workers, and reviewers to cite as artifacts/evidence. SVG, raw base64 payloads, filesystem paths, and HTTP URLs are unsupported; unsupported attachment types remain chat/model context unless a future explicit materialization path adds support.

Keep operator-facing messaging simple. Runtime remains the single owner of workflow semantics and internal complexity.

## Maintainer rules

- Runtime owns workflow semantics; prompts and docs describe them.
- Keep live runtime persistence snapshot-primary unless a dedicated event-first migration plan proves and stages a different authority.
- Runtime transitions and snapshot persistence are the supported workflow authority. Do not reintroduce core workflow replay, event-store, checkpoint-store, or projection-store surfaces without an explicit product requirement and replacement tests.
- Package API is root-only (`opencode-plugin-flow` import). Internal paths are not public API and may change in any release.
- Keep `zod` aligned with `@opencode-ai/plugin` unless a reviewed SDK-boundary change is intentional.
- Preserve direct `tool(...)` arg shapes at the SDK boundary.
- Use permission-only OpenCode agent restrictions; do not reintroduce boolean `tools` config for read-only Flow agents.
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

- SDK-facing tool `args` stay as raw shapes for OpenCode's plugin contract
- stricter runtime validation happens later through schemas such as `WorkerResultSchema`

For the heaviest payload tools (`flow_plan_context_record`, `flow_plan_apply`, `flow_run_complete_feature`, `flow_review_record_feature`, and `flow_review_record_final`), expose the current raw object-shape contract directly at the SDK boundary and let runtime schemas enforce the stricter semantic refinements. Do not reintroduce JSON-string transport fields or alternate direct-caller fallbacks.

## Testing

The test suite covers:

- command and agent injection
- tool argument shapes
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

Fast lane for runtime invariant safety checks:

```bash
bun run test:fast
```

Deep lane for broad coverage (default CI depth):

```bash
bun run test:deep
```

Replay/event/checkpoint/projection persistence was removed during the 2026-05-07 simplification. The supported persistence contract is active/stored/completed session snapshots plus rendered session docs.
