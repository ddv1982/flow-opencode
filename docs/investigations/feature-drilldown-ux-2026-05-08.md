# Investigation: Clickable Feature Drilldown UX

## Summary
`featureId=<id>` references should drill down to the existing Flow-rendered feature artifact (`.flow/<active|stored|completed>/.../docs/features/<feature-id>.md`) when available. Status/history projections should act as the resolver and fallback; subagent/session navigation should be reserved for actual delegated planner/worker/reviewer work, not passive feature inspection.

## Symptoms
- Current plugin UX shows Flow tool activity inline and includes values like `featureId=responsive-theme-toggle`.
- The desired UX is to click a feature id and view what is being implemented for that feature.
- The best target is unclear: a new subagent call/session, an existing feature artifact, a rendered file, or metadata-driven tool UI.

## Background / Prior Research

### External OpenCode/plugin UX facts
- Official OpenCode plugin docs expose plugin lifecycle hooks, message/session/todo events, custom tools, and tool metadata via plugin/tool APIs. Plugins can observe `message.part.updated`, `session.*`, and `todo.updated` events and custom tools can provide metadata/title-style state for tool execution, but the docs do not describe a plugin-controlled arbitrary clickable-link renderer for TUI tool args. Sources: https://opencode.ai/docs/plugins, https://opencode.ai/docs/custom-tools
- Official OpenCode agents docs describe subagents as specialized assistants with child-session navigation; current docs mention navigating between child sessions from a parent and between siblings/parents. Source: https://opencode.ai/docs/agents#types
- OpenCode issue #16575 documents task tool clickability depending on `metadata.sessionId`: queued tasks are not clickable until the task execution creates a session and metadata arrives; the expected behavior is reactive clickability when `sessionId` exists. Source: https://github.com/anomalyco/opencode/issues/16575
- OpenCode issue #18585 documents that plugin tools can set metadata/title state, but TUI generic plugin rendering may still ignore custom titles; comments distinguish Task component rendering from generic tool rendering. Source: https://github.com/anomalyco/opencode/issues/18585
- Prior local investigation `docs/investigations/subagent-task-ux-2026-05-08.md` concluded that human-facing task/session progress should be projected from Flow runtime state and artifacts while preserving strict worker/reviewer/tool JSON contracts.

## Investigator Findings
<!-- Pair investigator appends structured findings here with file:line refs, evidence, and conclusions. -->

### Phase 2 - Repository evidence on feature drilldown target

#### Focus question 1: existing per-feature detail artifact

**Evidence**
- `docs/maintainer-contract.md:80-91` defines `.flow/active/<session-id>/docs/features/<feature-id>.md` as the derived active feature render, with sibling derived docs under `.flow/stored/<session-id>/docs/**` and `.flow/completed/<session-id>-<timestamp>/docs/**`.
- `src/runtime/paths.ts:67-80` defines the `.flow/active`, `.flow/stored`, and `.flow/completed` roots; `src/runtime/paths.ts:189-224` derives `docs/index.md` and `docs/features/<feature-id>.md` via `getFeatureDocPath(...)` / `getFeatureDocPathFromSessionDir(...)`.
- `src/runtime/render-feature-sections.ts:74-98` renders the per-feature markdown document headed `# Feature ${feature.id}`, including summary, task progress, description, latest runtime summary, file targets, verification, dependency/blocker sections, and feature-specific execution history.
- `src/runtime/render.ts:109-129` writes `index.md` plus every planned feature doc and then prunes feature docs no longer present in the active plan; `src/runtime/render.ts:160-168` deletes the docs tree for artifact cleanup.
- `src/runtime/session-persistence.ts:36-62` parks any previous active session into `.flow/stored`, reactivates stored copies when needed, writes the active `session.json`, and renders active docs when artifacts are included; `src/runtime/session-persistence.ts:104-135` distinguishes `saveSessionState` (state only), `syncSessionArtifacts` (render docs), and `saveSession` (state plus docs).
- `src/runtime/recovery/session-recovery-service.ts:33-61` writes/renders completed sessions and either moves the active session directory into completed storage or allocates a completed directory directly; `src/runtime/session-completed-storage.ts:99-145` makes completed directory allocation/move collision-safe.
- `tests/runtime-session-persistence.test.ts:159-189` proves source-of-truth state can be saved without docs and docs can be rendered later; `tests/runtime-session-persistence.test.ts:206-245` proves feature docs are rendered for planned work and stale feature docs are pruned after plan narrowing.
- `tests/render-fixtures.test.ts:56-88` reads generated feature docs from active or completed docs locations, and `tests/render-fixtures.test.ts:161-188` compares every rendered feature doc to committed golden fixtures across empty, single-feature, mid-execution, completed, and 100-feature scenarios.
- `tests/cross-area/markdown-parity.test.ts:41-99` verifies direct `renderSessionDocs` output matches golden docs and that changing one feature rewrites only that feature doc plus the index.

**Conclusion:** The exact existing per-feature implementation detail page is the rendered markdown projection at `.flow/<active|stored>/<session-id>/docs/features/<feature-id>.md` or `.flow/completed/<session-id>-<timestamp>/docs/features/<feature-id>.md`. It is a derived artifact, rendered from canonical session state, persisted beside active/stored/completed session directories, pruned when the plan narrows, and movable with the session lifecycle.

#### Focus question 2: metadata/action surfaces carrying `featureId`

**Evidence**
- `src/adapters/opencode/tool-surface/schemas.ts:21-34` defines `ToolMetadataPayload` as `{ title, metadata: Record<string, unknown> }` and adds `metadata?: (...) => void` to `ToolContext`, separate from tool argument schemas.
- `src/adapters/opencode/tool-surface/runtime-tools/execution-tools.ts:24-43` sets `flow_run_start` metadata with `featureId: input.featureId ?? null` and sends `{ featureId }` in the runtime action payload when supplied.
- `src/adapters/opencode/tool-surface/runtime-tools/execution-tools.ts:53-81` sets `flow_run_complete_feature` metadata with `featureId: input.featureResult?.featureId ?? null`; its runtime action payload remains `{ worker: input }`.
- `src/adapters/opencode/tool-surface/runtime-tools/execution-tools.ts:91-108` sets `flow_reset_feature` metadata with `featureId: input.featureId` and sends `{ featureId }` in the mutation payload.
- `src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts:32-52` sets `flow_review_record_feature` metadata with `featureId: input.featureId`; its action payload remains `{ decision: input }`.
- `src/runtime/schema.ts:130-139` defines the feature-review decision payload with `featureId`; `src/runtime/schema.ts:322-332` keeps worker args and feature-review args in separate runtime schemas, with the feature-review args explicitly strict; `src/runtime/schema-worker-result-shared.ts:47-52` defines worker `featureResult.featureId` separately.
- `tests/runtime-tools-metadata.test.ts:139-155` asserts every Flow tool emits non-empty metadata, and `tests/runtime-tools-metadata.test.ts:165-221` verifies task-progress metadata keys such as owner/phase/status, requested status, validation count, final-review presence, and status counts.

**Conclusion:** Existing visible tool metadata already carries `featureId` for start, completion, reset, and feature-review tools. Because OpenCode metadata is an open `Record<string, unknown>` and is emitted outside the worker/reviewer Zod payloads, a presentation-only drilldown hint such as `featureDocPath`, `drilldownPath`, or `drilldownTarget` can be added to tool metadata without changing worker/reviewer schemas. The caveat is timing: completion metadata is currently emitted before the guarded mutation runs, so a completed/stored path may be more reliably exposed by the post-mutation response, status/history presenter, or a runtime-computed metadata helper than by guessing lifecycle location up front.

#### Focus question 3: status/history/session-presenter drilldown fallback surfaces

**Evidence**
- `src/adapters/opencode/tool-surface/session-tools/history-tools.ts:63-101` has `flow_status` load the current session, project task progress, and emit metadata containing `sessionId`, `activeFeatureId`, view, task-progress counts, workspace root, and workspace mutability.
- `src/runtime/summary-projections.ts:30-61` defines `TaskProgressRow` with optional `featureId`; `src/runtime/summary-projections.ts:240-293` emits one execution row per feature with `id: feature:<feature-id>`, `ownerRole: flow-worker`, `phase: execution`, `subject: <feature-id> — <title>`, and `featureId`; `src/runtime/summary-projections.ts:333-368` emits reviewer rows with `featureId` for feature-scoped decisions; `src/runtime/summary-projections.ts:400-412` aggregates planning, feature, validation, reviewer, and final-review rows.
- `src/runtime/application/operator-presenters.ts:74-105` renders the active feature as `Working on: <feature-id> — <title> (...)` and then renders selected task-progress rows into the operator summary.
- `src/adapters/opencode/tool-surface/session-tools/history-tools.ts:138-162` implements `flow_history_show` as a read action by `sessionId`; `src/runtime/application/session-presenters.ts:120-176` returns `source`, `active`, `parked`, `path`, `completedPath`, `session`, `operatorSummary`, and `nextCommand` for stored/active/completed lookups.
- `tests/runtime-operator-history.test.ts:120-180` proves `flow_history_show` returns parked stored session details, warnings, `path`, task progress, and operator summary without changing the active session; `tests/runtime-operator-history.test.ts:263-304` proves completed lookups return `path`/`completedPath` and completed-session summaries.
- `tests/session-history.test.ts:19-54` proves completed history entries are sorted newest-first and expose `completedPath` values.

**Conclusion:** The best fallback surface is already Flow-owned and read-oriented: status/task-progress projections for active work, plus `flow_history_show` for active/stored/completed session lookup by session id. A feature-scoped drilldown can be layered onto these presenters by deriving `docs/features/<feature-id>.md` from the existing `path`/`completedPath` plus the feature id, or by adding a presenter/metadata field that points to that derived artifact.

#### Focus question 4: subagent/session opening semantics

**Evidence**
- `docs/development.md:80-87` describes Task/subagent handoffs as bounded planning, implementation, and review work in fresh child contexts, while runtime tools remain authoritative for session state and rendered docs; `docs/development.md:103-107` defines `flow-worker` as executing one approved feature and `flow-auto` as routing work to planner/worker/reviewer child contexts when supported.
- `docs/development.md:109-111` states Task/subagent handoffs are prompt-level orchestration only and must not bypass runtime-owned state transitions or persisted session data.
- `src/prompts/fragments.ts:42-48` limits Task/subagent handoffs to independent, bounded, role-appropriate subject groups and explicitly says not to create extra subagents for tiny sequential/shared-context work; the same fragment says handoffs do not replace Flow runtime ownership.
- `src/prompts/mode-contracts.ts:283-323` defines `flow-control` as the status/history/session-control surface, forbids planning/running/review-record tools, and requires it to stop after rendering the requested status/control result.
- `src/prompts/mode-contracts.ts:325-359` defines `/flow-review` as a standalone read-only audit command that returns a report and forbids session activation, execution, and review-record mutation tools.
- `docs/architecture/flow-core-vnext-contract.md:24-34` says status/history/resumable-session queries are read-only and must not mutate session snapshots or rendered artifacts; snapshot plus optional rendered markdown artifacts are the durable product format.
- `docs/maintainer-contract.md:93-104` says runtime owns `.flow/**`, task/subagent handoffs still report through runtime tools, rendered docs are derived artifacts, and prompt contracts must mirror runtime behavior.
- `docs/investigations/subagent-task-ux-2026-05-08.md:145-163` recommends preserving strict JSON contracts, keeping reviewer/audit/control roles mostly leaf/report/control, improving UX through derived projections, and treating first-class child-session trees as a later decision.

**Conclusion:** Repo evidence strongly supports treating `featureId` click/drilldown as passive inspection of Flow state/artifacts, not as a new subagent session. Opening or creating a child session would imply a fresh role handoff for bounded work, while the requested interaction is to inspect an existing feature projection.

### Ranked recommendation

| Rank | Recommendation | Confidence | Basis |
| --- | --- | --- | --- |
| 1 | Make `featureId` drill down to the existing rendered feature doc projection: `.flow/<active|stored>/<session-id>/docs/features/<feature-id>.md` or `.flow/completed/<session-id>-<timestamp>/docs/features/<feature-id>.md`. | High | Direct path contract, render code, persistence lifecycle, cleanup, and golden/lifecycle tests all already support this artifact. |
| 2 | Add presentation-only metadata/presenter fields for a feature drilldown target/path, using existing tool metadata and status/history/session presenters rather than worker/reviewer payload changes. | High | `ToolContext.metadata` is an open bag, feature-scoped tools already emit `featureId`, and status/history presenters already carry session ids, paths, completed paths, task progress, and active feature ids. |
| 3 | Use status/history as the fallback resolver when a tool call cannot know the final artifact location at metadata-emission time. | Medium-high | Completion metadata is emitted before mutation/persistence, but `flow_status` and `flow_history_show` can resolve current or historical session context after persistence. |
| 4 | Do not create/open a subagent session solely for `featureId` inspection. Reserve subagent/session navigation for actual planner/worker/reviewer handoffs or existing child sessions. | High | Prompt contracts and docs define subagents as execution/review orchestration, while control/status/history/review surfaces are read/report-only and derived from Flow runtime state. |

**Overall conclusion:** The hypothesis is supported. `featureId=responsive-theme-toggle` should drill down to a Flow-owned rendered feature projection when available, with status/history-derived fallback metadata. A subagent session would be semantically mismatched unless there is an actual child task/session created for implementation or review work.

## Investigation Log

### Phase 1 - Initial assessment and external research
**Hypothesis:** A clickable `featureId` should probably open a Flow-owned feature artifact/projection rather than spawn a new worker just to inspect state.
**Findings:** External docs and issues support two separate interaction families: task/subagent clickability is session-id based, while plugin-tool display customization is currently metadata/title oriented and less capable for arbitrary link targets. This suggests a feature drilldown should be modeled as a Flow projection/artifact link first, with subagent-session navigation only for actual child sessions.
**Evidence:** Prior research links in `## Background / Prior Research`; existing local report `docs/investigations/subagent-task-ux-2026-05-08.md`.
**Conclusion:** Initial direction confirmed enough to seed workspace context; repo evidence must now identify existing feature artifacts, render paths, and tool metadata/action surfaces.

## Root Cause
The current UX exposes the machine-facing `featureId` in tool-call arguments/metadata but does not yet expose a first-class presentation target for that feature. Repository evidence shows the target already exists as a derived Flow artifact: `renderSessionDocs` writes per-feature docs, `paths.ts` safely derives the active/stored/completed doc paths, and status/history presenters can resolve the session location. The missing piece is a presentation-only drilldown hint that connects visible feature ids to those existing artifacts.

## Recommendations
1. **Default target:** make `featureId=<id>` drill down to the rendered feature doc: `.flow/active/<session-id>/docs/features/<feature-id>.md`, `.flow/stored/<session-id>/docs/features/<feature-id>.md`, or `.flow/completed/<session-id>-<timestamp>/docs/features/<feature-id>.md`.
2. **Resolver/fallback:** use Flow status/history projections (`flow_status`, `flow_history_show`, task-progress rows, session paths/completed paths) to resolve the correct session root and recover gracefully when a doc is missing, pruned, or not yet rendered.
3. **Metadata shape:** add a presentation-only drilldown hint such as `{ kind: "feature_doc", label: "Open feature details", featureId, path }` in metadata/presenter responses where session context is known.
4. **Do not use subagent sessions as the default drilldown:** only navigate to child sessions when there is an actual delegated planner/worker/reviewer session to inspect.
5. **Do not change machine contracts for this UX:** avoid changes to worker/reviewer schemas, persisted `SessionSchema`, JSON transport shape, or nested worker result wrappers.

## Preventive Measures
- Keep UX drilldowns as derived projections from canonical Flow state and rendered artifacts.
- Treat OpenCode renderer capability as a host integration constraint: prefer explicit metadata/path hints over assuming arbitrary inline tool args can become clickable.
- Handle lifecycle states explicitly: active, stored, completed, missing artifact, and pruned feature doc.
- Preserve the semantic boundary between passive state inspection and new delegated subagent work.
