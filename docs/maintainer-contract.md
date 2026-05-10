# Maintainer Contract

## What this project is

Flow is a workflow runtime delivered as an OpenCode plugin.

It injects Flow slash commands, Flow agents, and a bounded runtime tool surface into OpenCode. The runtime persists planning/execution state under the workspace-local `.flow/` tree and renders readable markdown artifacts beside each saved session.

## Source of truth

Runtime/domain/transitions own behavior.
Prompts and docs describe behavior; they do not define it.
Live runtime persistence is snapshot-primary; core event/replay infrastructure is a semantic oracle and regression gate unless a future migration explicitly changes that authority.

Primary ownership map:

- Plugin registration: `src/index.ts`, `src/config.ts`, `src/adapters/opencode/tools.ts`
- Runtime schemas and persisted state contracts: `src/runtime/schema.ts`
- Runtime/domain policy: `src/runtime/domain/`
- State transitions: `src/runtime/transitions/`
- Session persistence and workspace-root rules: `src/runtime/session*.ts`, `src/runtime/paths.ts`, `src/runtime/workspace-root.ts`
- Tool schemas: `src/adapters/opencode/tool-surface/schemas.ts`, with shared runtime payload schemas imported from `src/runtime/schema.ts`
- OpenCode tool/action projection descriptors: `src/adapters/opencode/tool-surface/descriptors.ts`
- Attachment ingress/materialization: `src/adapters/opencode/attachment-store.ts`, `src/adapters/opencode/attachment-materialization.ts`, and `src/adapters/opencode/tool-surface/session-tools/attachment-tools.ts`
- Prompt-mode contracts: `src/prompts/mode-contracts.ts`
- Prompt text and fallback surfaces: `src/prompts/`, `src/audit/prompts/`
- Generated skills: `src/prompts/skills.ts`, `src/prompts/generated/skill-docs.ts`, `src/adapters/opencode/skill-bundle.ts`

## Historical references

Historical artifacts may mention deleted or renamed files that existed when the artifact was written. This is expected in `CHANGELOG.md`, generated `release-notes.md`, `docs/releases/**`, and `docs/investigations/**`. Current behavior and required checks are defined by this maintainer contract, current source files, current tests, and active scripts.

## Commands

Command registration lives in `src/config.ts`, with the read-only audit command added by `src/audit/config.ts`.

| Command | Agent | Runtime entrypoint |
| --- | --- | --- |
| `/flow-plan` | `flow-planner` | Planning tools: `flow_plan_start`, `flow_plan_context_record`, `flow_plan_apply`, `flow_plan_approve`, `flow_plan_select_features` |
| `/flow-run` | `flow-worker` | Execution tools: `flow_run_start`, `flow_review_record_feature`, `flow_review_record_final`, `flow_run_complete_feature`; where Task/subagent handoff is supported, the worker can ask `flow-reviewer` for an independent fresh-context approval pass before persistence |
| `/flow-auto` | `flow-auto` | Autonomous coordinator starts with `flow_auto_prepare`, materializes supported image attachments (PNG, JPEG, WebP, GIF, and AVIF; SVG unsupported) with `flow_attachments_materialize` before attachment-dependent planning/delegation, then routes planning/execution/review through `flow-planner`, `flow-worker`, and `flow-reviewer` Task handoffs where supported while runtime tools remain the state authority |
| `/flow-status` | `flow-control` | `flow_status` |
| `/flow-doctor` | `flow-control` | `flow_doctor` |
| `/flow-history` | `flow-control` | `flow_history`, `flow_history_show` |
| `/flow-session` | `flow-control` | `flow_session_activate`, `flow_session_close` |
| `/flow-reset` | `flow-control` | `flow_reset_feature` |
| `/flow-review` | `flow-auditor` | Read-only audit prompt plus `flow_review_render` |

`flow-auto` is the coordinator-facing entrypoint for task/subagent orchestration. Its injected agent config allows Task handoffs to `flow-planner`, `flow-worker`, and `flow-reviewer`; `flow-worker` can hand off to `flow-reviewer` for an independent fresh-context approval pass. For goals that depend on supported image attachments (PNG, JPEG, WebP, GIF, and AVIF), `flow-auto` must materialize attachments before planning or handoff so child roles receive concrete workspace-relative paths rather than chat-only file parts. SVG remains unsupported by the materialization tool. Those handoffs are orchestration only: runtime tools remain the only authority for Flow state transitions, and prompts must never edit `.flow` state directly.

## Generated skills

Generated global OpenCode skills are installed by the default OpenCode lifecycle alongside the global plugin. The current generated bundle is:

| Skill | Installed path | Runtime authority |
| --- | --- | --- |
| `flow-plan` | `~/.config/opencode/skills/flow-plan/SKILL.md` | Existing planning tools and `flow-plan` mode contract |
| `flow-run` | `~/.config/opencode/skills/flow-run/SKILL.md` | Existing execution/review tools and `flow-run` / `flow-worker` mode contracts |
| `flow-review` | `~/.config/opencode/skills/flow-review/SKILL.md` | Existing reviewer/audit contracts and `flow-reviewer` / `flow-review` mode contracts |

Skills are instruction surfaces only. They may cite Flow mode contracts, role protocols, and registered runtime tool names, but must not define new tools, state transitions, completion gates, persistence paths, review semantics, or `.flow/**` write behavior. OpenCode `permission.skill` controls whether generated skills are visible; `deny` or hidden skills must leave slash commands and agents usable through their named fallback contracts. Install/uninstall may touch only intact generated Flow-owned files under `~/.config/opencode/skills/**` and must never write under `.flow/**`.

## Tools

Tool registration is split by operator surface, but `src/adapters/opencode/tool-surface/schemas.ts` is the schema-owner module at the OpenCode `tool(...)` boundary. Worker and reviewer payload validation is owned by `src/runtime/schema.ts` and projected through `src/adapters/opencode/tool-surface/schemas.ts`. `FLOW_TOOL_PAYLOAD_SCHEMA_REGISTRY` co-locates each tool's raw arg shape, parser schema, and payload owner metadata so descriptor metadata is parity-tested against the actual schema boundary instead of file-existence checks alone.

OpenCode tool/action metadata is described in `src/adapters/opencode/tool-surface/descriptors.ts`. Descriptors intentionally split typed `runtimeActionBinding` facets from nullable `coreAction` facets because read, control, workspace, and render tools are legitimate public surfaces even when they are not core workflow commands. Tool implementation modules own the dispatch constants they invoke, and descriptor parity tests compare those constants against descriptor `runtimeActionBinding` metadata. OpenCode projections may expose a flat optional `runtimeAction` string for stable host-facing output, but descriptors retain the read/workspace/mutation binding kind. Descriptors do not enforce completion/review/recovery behavior; runtime transitions do.

| Tool | Registration owner | Schema owner |
| --- | --- | --- |
| `flow_status` | `src/adapters/opencode/tool-surface/session-tools/history-tools.ts` | `FlowStatusArgsSchema` in `src/adapters/opencode/tool-surface/schemas.ts` |
| `flow_doctor` | `src/adapters/opencode/tool-surface/session-tools/history-tools.ts` | `FlowDoctorArgsSchema` in `src/adapters/opencode/tool-surface/schemas.ts` |
| `flow_history` | `src/adapters/opencode/tool-surface/session-tools/history-tools.ts` | `FlowHistoryArgsSchema` in `src/adapters/opencode/tool-surface/schemas.ts` |
| `flow_history_show` | `src/adapters/opencode/tool-surface/session-tools/history-tools.ts` | `FlowHistoryShowArgsSchema` in `src/adapters/opencode/tool-surface/schemas.ts` |
| `flow_session_activate` | `src/adapters/opencode/tool-surface/session-tools/history-tools.ts` | `FlowSessionActivateArgsSchema` in `src/adapters/opencode/tool-surface/schemas.ts` |
| `flow_session_close` | `src/adapters/opencode/tool-surface/session-tools/lifecycle-tools.ts` | `FlowSessionCloseArgsSchema` in `src/adapters/opencode/tool-surface/schemas.ts` |
| `flow_auto_prepare` | `src/adapters/opencode/tool-surface/session-tools/planning-tools.ts` | `FlowAutoPrepareArgsSchema` in `src/adapters/opencode/tool-surface/schemas.ts` |
| `flow_attachments_materialize` | `src/adapters/opencode/tool-surface/session-tools/attachment-tools.ts` | `FlowAttachmentsMaterializeArgsSchema` in `src/adapters/opencode/tool-surface/schemas.ts` |
| `flow_plan_start` | `src/adapters/opencode/tool-surface/session-tools/planning-tools.ts` | `FlowPlanStartArgsSchema` in `src/adapters/opencode/tool-surface/schemas.ts` |
| `flow_plan_context_record` | `src/adapters/opencode/tool-surface/runtime-tools/planning-tools.ts` | `FlowPlanContextRecordArgsSchema` in `src/adapters/opencode/tool-surface/schemas.ts` / `src/runtime/schema.ts` |
| `flow_plan_apply` | `src/adapters/opencode/tool-surface/runtime-tools/planning-tools.ts` | `FlowPlanApplyArgsSchema` in `src/adapters/opencode/tool-surface/schemas.ts` / `src/runtime/schema.ts` |
| `flow_plan_approve` | `src/adapters/opencode/tool-surface/runtime-tools/planning-tools.ts` | `FlowPlanApproveArgsSchema` in `src/adapters/opencode/tool-surface/schemas.ts` |
| `flow_plan_select_features` | `src/adapters/opencode/tool-surface/runtime-tools/planning-tools.ts` | `FlowPlanSelectArgsSchema` in `src/adapters/opencode/tool-surface/schemas.ts` |
| `flow_run_start` | `src/adapters/opencode/tool-surface/runtime-tools/execution-tools.ts` | `FlowRunStartArgsSchema` in `src/adapters/opencode/tool-surface/schemas.ts` |
| `flow_run_complete_feature` | `src/adapters/opencode/tool-surface/runtime-tools/execution-tools.ts` | `FlowRunCompleteFeatureArgsSchema` plus `WorkerResultArgsSchema` in `src/adapters/opencode/tool-surface/schemas.ts` / `src/runtime/schema.ts` |
| `flow_reset_feature` | `src/adapters/opencode/tool-surface/runtime-tools/execution-tools.ts` | `FlowResetFeatureArgsSchema` in `src/adapters/opencode/tool-surface/schemas.ts` |
| `flow_review_record_feature` | `src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts` | `FlowReviewRecordFeatureArgsSchema` in `src/adapters/opencode/tool-surface/schemas.ts` / `src/runtime/schema.ts` |
| `flow_review_record_final` | `src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts` | `FlowReviewRecordFinalArgsSchema` in `src/adapters/opencode/tool-surface/schemas.ts` / `src/runtime/schema.ts` |
| `flow_review_render` | `src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts` | `FlowReviewRenderArgsSchema` in `src/adapters/opencode/tool-surface/schemas.ts` / `src/audit/report-schema.ts` |

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
- Materialized OpenCode attachment assets are user/project files outside `.flow/**`; `.flow/**` remains session state and derived docs only.
- Task/subagent handoffs do not bypass runtime ownership; they still report back through runtime tools instead of mutating `.flow/**` directly.
- State shape changes require schema, persistence, recovery, and migration/recovery consideration.
- Rendered docs are derived artifacts, not the source of workflow truth.
- Read-only `/flow-review` reports are returned to the caller; Flow does not own a persisted review-history tree.

## Contract invariants

- Runtime owns workflow semantics.
- Live runtime persistence remains snapshot-primary until an explicit event-first migration changes it.
- Prompt contracts and generated skills must mirror runtime, not invent behavior.
- Tool schemas are SDK boundary surfaces.
- Completion/reviewer gates are release-critical.
- `zod` / `@opencode-ai/plugin` alignment must remain stable.
- Runtime tool names are public prompt contracts; renames require parity updates.
- Prompt-mode boundaries are first-party product contracts and are guarded by capture/eval tests.
- `/flow-review` is read-only and must not advance Flow planning/execution state.
- Surface expansion is frozen by default: avoid new commands, tools, skills, prompt contracts, state paths, or runtime modes unless there is an explicit retirement/replacement tradeoff.
- Fallback surfaces are required: existing slash commands and agents must remain usable without installed or permitted skills.


## Gate contract matrix

`bun run check` is the canonical local/mainline contract. Focused gates may also run in CI or during local diagnosis to fail faster or produce artifacts, but every hard gate below must remain covered by `bun run check`, an explicitly documented focused lane, or both. Advisory and diagnostic commands must not be treated as merge blockers unless this matrix, the owning script, and tests are updated together.

| Gate | Command / location | Artifact owner | Source of truth | Local role | CI role | Status | Repeated inside `check` | Pass/fail expectation | No-weakening note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Full mainline check | `bun run check` / `package.json` | maintainer contract + CI workflow | `package.json` script | canonical all-in-one readiness gate | final validate job contract | hard | n/a | fails on any included hard-gate failure | Do not replace with focused gates unless every included hard gate is preserved and documented. |
| Dependency contract | `bun run check:dependency-contract` | package/runtime schema owners | `scripts/cross-area/dependency-contract.mjs` | targeted SDK/dependency alignment check | may run directly or through `bun run check` | hard | yes | fails on dependency/schema alignment drift, including `zod` / `@opencode-ai/plugin` alignment | `zod`/plugin alignment is a standing checklist constraint for tool/schema changes. |
| Architecture seams enforce | `bun run check:architecture-seams:enforce` | architecture seam owner | `scripts/cross-area/architecture-seams.mjs` | targeted seam blocker and part of `bun run check` | focused fast-fail lane and/or covered by `bun run check` | hard | yes | fails on blocked cross-layer imports | Preserve enforce mode as the merge contract; report mode is not a substitute. |
| Architecture seams report | `bun run check:architecture-seams` | architecture seam owner | `scripts/cross-area/architecture-seams.mjs` | local diagnostic inventory | optional diagnostic artifact only | diagnostic | no | exits `0` while reporting seam findings | Keep separate from hard enforcement to avoid accidental blocking semantics. |
| Generated drift | `bun run check:generated-drift` | prompt/review/descriptor owners | `package.json` composed script | generated prompt/review/descriptor parity check | focused fast-fail lane and/or covered by `bun run check` | hard | indirect | fails on generated prompt/review/descriptor parity drift | Keep either direct invocation in `check` or equivalent covered constituent checks + explicit proof in no-weakening notes. |
| Completion lane | `bun run gate:completion-lane` | runtime completion owner | `scripts/cross-area/check-completion-lane.mjs` | focused completion invariant gate and part of `bun run check` | focused fast-fail lane and/or covered by `bun run check` | hard | yes | fails on completion-lane invariant violation | Completion/reviewer gates are release-critical and must remain hard. |
| Snapshot persistence gate | `bun run test:replay` | runtime persistence owners | `tests/runtime/semantic-invariants.test.ts` + `tests/runtime/final-completion-gates.test.ts` | snapshot/runtime invariant gate and part of `bun run check` | focused fast-fail lane and/or covered by `bun run check` | hard | yes | fails on runtime invariant regression | Snapshot-first persistence is the supported authority; event/replay/checkpoint stores are intentionally absent. |
| Benchmark gate | `bun run bench:gate` | performance owner | `scripts/cross-area/bench-gate.mjs` | benchmark baseline gate and part of `bun run check` | focused fast-fail lane and/or covered by `bun run check` | hard | yes | fails on benchmark baseline regression | `bench:smoke` may provide extra signal, but `bench:gate` owns baseline failure. |
| Boundary report | `bun run check:boundary-report` | prompt/tool schema boundary owners | `scripts/cross-area/boundary-violations-report.mjs` | supplemental boundary visibility | optional advisory report | advisory | no | exits `0`; emits advisory signal unless a future change promotes it | Do not cite this as hard enforcement; promote only with script/docs/test updates. |
| Docs parity/staleness | docs test bundle | docs/runtime/tool owners | `tests/docs-*.test.ts` | required when docs/contracts change | covered by broader test/check lanes | hard when docs/contracts touched | via `bun run test` inside `bun run check` | fails on stale references or parity drift | Contract docs must stay synchronized with runtime/tool surfaces. |
| Runtime metrics report | `bun run report:runtime-simplification-metrics` | runtime simplification owner | `scripts/cross-area/runtime-simplification-metrics.mjs` | diagnostic/report for simplification planning | optional artifact only | diagnostic/report | no | prints metrics; seam count failure belongs to seam enforce gate | Metrics guide runtime slices; they are not a standalone merge gate. |

### CI/local no-weakening policy

CI may keep focused preflights before the final `bun run check` when the duplicate gives faster failure isolation for high-risk contracts. Any CI/package gate simplification must record: the before/after hard-gate list, where each hard gate still runs, why each retained duplicate is intentional, why each removed duplicate is covered by `bun run check` or a named lane, and fresh verification from affected gates plus `bun run check`.

## Semantic invariant anchors

The runtime-owned semantic invariant catalog is mirrored here for maintainer orientation. The owners remain in `src/runtime/domain/semantic-invariants.ts` and the runtime/domain/transitions files named there.

- [semantic-invariant] completion.gates.required_order
- [semantic-invariant] completion.policy.min_completed_features
- [semantic-invariant] decision_gate.planning_surface.binding
- [semantic-invariant] review.scope.payload_binding
- [semantic-invariant] recovery.next_action.binding
- [semantic-invariant] tools.canonical_surface.no_raw_wrappers

## Test organization

Broad runtime tests should stay small and behavior-specific. Add new coverage to the narrowest matching suite (`tests/runtime-*.test.ts`, `tests/runtime/**`, or `tests/config/**`) before expanding catch-all files.

## If you touch X, run Y

Prefer the narrowest useful check first, then run `bun run check` before release or cross-surface merges.

| Area touched | Required checks |
| --- | --- |
| `zod`, `@opencode-ai/plugin`, or tool arg shapes | `bun pm ls zod`; `bun run check:dependency-contract`; `bun test tests/config/tool-schemas.test.ts tests/runtime-tools.test.ts tests/runtime/worker-result-contracts.test.ts tests/runtime/plan-and-tool-schema-contracts.test.ts tests/schema-equivalence.test-d.ts`; `bun run typecheck` |
| Completion/finalization transitions | `bun run gate:completion-lane`; `bun test tests/runtime/final-completion-gates.test.ts tests/runtime/final-review-contracts.test.ts tests/completion-gates.test.ts` |
| Runtime transitions or schema | `bun test tests/runtime.test.ts tests/runtime-replanning.test.ts tests/runtime-actionable-metadata.test.ts tests/runtime-recovery.test.ts tests/runtime/semantic-invariants.test.ts tests/protocol-parity.test.ts` |
| Prompt text, generated skills, or prompt-mode contracts | `bun run eval:prompt-capture:check`; `bun test tests/config/prompt-contracts.test.ts tests/config/skill-bundle.test.ts tests/mode-contracts.test.ts tests/protocol-parity.test.ts tests/prompt-snapshot.test.ts tests/prompt-mode-behavior-eval.test.ts` |
| `/flow-review` audit prompt or renderer | `bun run eval:review-capture:check`; `bun test tests/review-prompt-capture.test.ts tests/prompt-behavior-eval.test.ts` |
| Tool registration or tool schemas | `bun test tests/config/plugin-surface.test.ts tests/config/tool-schemas.test.ts tests/runtime-tools.test.ts tests/runtime-tools-metadata.test.ts tests/docs-tool-parity.test.ts`; `bun run typecheck` |
| Session paths, persistence, history, or migration | `bun test tests/runtime-session-persistence.test.ts tests/runtime-tool-persistence.test.ts tests/runtime-execution-history.test.ts tests/session-history.test.ts tests/runtime/render-snapshot.test.ts tests/runtime-summary.test.ts tests/workspace-root-guard.test.ts` |
| Install/uninstall or package release surface | `bun run build`; `bun run check:release-hygiene`; `bun run check:pack-invariants`; `bun test tests/install.test.ts tests/cross-area/install-lifecycle.test.ts tests/smoke/dist-load.test.ts` |
| Performance-sensitive save/render/schema paths | `bun run bench:smoke` |
| Any cross-surface release candidate | `bun run check` |
