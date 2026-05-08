# Investigation: Subagent Task Splitting and End-User UX

## Summary
Flow should adopt a hybrid, role-aware subject-group split policy: use fresh subagents for independent, bounded, role-specific work that benefits from fresh context, but do not make every subagent recursively spawn more subagents. Preserve strict worker/reviewer/tool JSON as the machine contract and improve end-user UX through runtime-owned task/session progress projections in summaries, presenters, renderers, history, and action metadata.

## Symptoms
- The current subagent model may be using long-lived agent contexts for multiple task subjects where fresh per-subject contexts could be more efficient.
- JSON is technically useful for machine contracts, but may be a poor end-user presentation layer for showing task progress and agent work.
- The question applies broadly across subagents, not only `flow-worker`.

## Background / Prior Research

### OpenCode external docs and ecosystem direction
- OpenCode's agents docs define primary agents as the main conversation and subagents as specialized assistants invoked automatically or manually for specific tasks. Built-in `general` is described for complex/multi-step tasks and parallel units of work; built-in `explore` is read-only for codebase lookup. Source: https://opencode.ai/docs/agents/
- OpenCode agent configuration supports `mode: "subagent"`, per-agent permissions, hidden internal subagents, and `permission.task` controls for which subagents an agent may invoke. Source: https://opencode.ai/docs/agents/
- The external explore probe also found OpenCode docs around commands, server endpoints, plugins, and permissions indicating that progress can be represented through child sessions, todo/session events, and completion/error notifications rather than only JSON payloads. Sources cited by probe: https://opencode.ai/docs/commands/, https://opencode.ai/docs/server/, https://opencode.ai/docs/plugins/, https://opencode.ai/docs/permissions
- OpenCode PR/issue evidence points toward hierarchical delegation and task/session UX: PR/issue #7756 proposes subagent-to-subagent delegation with budgets/depth limits and a session tree; issue #12711 discusses agent teams with per-member status, todo progress, busy indicators, and shared task lists. These are directional ecosystem signals, not necessarily stable product guarantees. Sources: https://github.com/anomalyco/opencode/issues/7756, https://github.com/anomalyco/opencode/issues/12711

### Claude Code / general agent UX research
- Claude Code docs describe subagents as isolated context windows for task-specific workflows, context preservation, tool restrictions, parallel research, and fresh perspective. They recommend subagents when side work would flood the main conversation, and recommend the main conversation for tightly coupled or iterative work. Source: https://code.claude.com/docs/en/sub-agents
- Claude Code SDK docs identify the main benefits as context management, parallelization, specialized instructions, and tool restrictions; each subagent maintains separate context from the main agent and returns focused results. Source: https://docs.claude.com/en/docs/claude-code/sdk/subagents
- Anthropic prompt-engineering docs warn that strong models may overuse subagents and recommend explicit guidance: use subagents for parallel, isolated, independent workstreams; work directly for simple, sequential, single-file, or shared-context tasks. Source: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices.md#subagent-orchestration
- Claude Code agent-team docs distinguish subagents from heavier teams: subagents are lower-cost focused workers that report back to the caller; teams are for work requiring inter-agent communication, shared task lists, and direct user interaction with individual workers. Source: https://code.claude.com/docs/en/agent-teams

### Prior external conclusion
**External evidence supports a hybrid rule:** split into fresh subagents per task subject group when work is independent, self-contained, permission/model-specific, high-output, or needs fresh perspective; avoid splitting tiny, sequential, same-file, or shared-context work. For end-user UX, present subagent work as task/session progress with concise status, ownership, and completion summaries while keeping JSON as the internal contract.

## Investigator Findings
<!-- Pair investigator appends structured findings here with file:line refs, evidence, and conclusions. -->

### 2026-05-08 - Repo evidence verification

#### 1. Prompt / role guidance

**Evidence**
- `src/prompts/fragments.ts:41-46` defines the shared routing and Task/subagent policy: use `flow-planner` for planning, `flow-worker` for implementation/validation, `flow-reviewer` for approval, and when OpenCode task/subagent invocation is available hand planning research to `flow-planning-researcher`, planning to `flow-planner`, implementation to `flow-worker`, and review to `flow-reviewer` so each role works in a fresh child context; the same rule says state changes remain owned by Flow runtime tools.
- `src/prompts/fragments.ts:49-59` separately defines operator progress as assistant prose at phase boundaries and explicitly forbids progress narration inside worker-result, reviewer-decision, or `finalReview` fields.
- `src/prompts/generated/role-prompts.ts:145-174` gives `flow-planner` a narrow Task handoff: for broad review-and-fix requests, ask `flow-planning-researcher` for a read-only planning research packet before finalizing decomposition.
- `src/prompts/generated/role-prompts.ts:189-219` gives `flow-worker` the most concrete fresh-child-context instruction: ask `flow-reviewer` through Task for independent review, persist that reviewer decision, then persist exactly one worker result.
- `src/prompts/generated/role-prompts.ts:224-277` makes `flow-auto` the broad coordinator: prefer Task handoff to `flow-planner`, `flow-worker`, and `flow-reviewer`; for broad review-and-fix/codebase-review, start with `flow-planning-researcher`; keep the same feature active until clean or truly blocked.
- `src/prompts/generated/role-prompts.ts:277-304` shows `flow-reviewer` is mostly a recipient/approval role, not a handoff orchestrator: it is read-only, returns `approved`/`needs_fix`/`blocked`, and has no Task/subagent splitting rule of its own.
- `src/audit/prompts/agents.ts:29-61` and `src/audit/prompts/contracts.ts:3-57` show the standalone auditor builds an internal coverage ledger but defaults to a human-readable review and includes structured details only on request; no Task/subagent splitting instruction appears in the audit prompt itself.
- `src/prompts/contracts.ts:1-2` states prompt contracts must stay aligned with runtime invariants and must not introduce conflicting policy.

**Conclusion**
The initial conclusion is mostly supported but needs one precision: the policy is broad in shared fragments and `flow-auto`, but actual Task/fresh-child-context instructions are concentrated in coordinator/worker/planner surfaces. `flow-reviewer` and `flow-review`/audit should participate in the policy as subject-specific roles, but current evidence supports treating them primarily as fresh-context targets or read-only report producers rather than recursive subagent orchestrators.

#### 2. Runtime / tool contract boundary

**Evidence**
- `src/runtime/schema.ts:130-151` defines strict feature/final reviewer-decision JSON schemas, including final-review strictness and behavior-consistency checks.
- `src/runtime/schema.ts:177-233` defines the worker-result JSON contract with `contractVersion: "1"`, `status`, `summary`, `artifactsChanged`, `validationRun`, `nextStep`, `featureResult`, `featureReview`, and optional `finalReview`.
- `src/runtime/schema.ts:322-334` exposes `WorkerResultArgsSchema` as a discriminated union and `FlowReviewRecordFeatureArgsSchema` / `FlowReviewRecordFinalArgsSchema` as canonical runtime tool inputs.
- `src/runtime/schema.ts:336-376` stores execution history as flat entries keyed by `featureId` and stores `lastReviewerDecision`, `lastValidationRun`, `lastOutcome`, and `history` under `SessionSchema.execution`.
- `src/runtime/schema-worker-result-refinements.ts:21-48` requires `needs_input` / `replan_required` outcomes to include `replanReason`, `failedAssumption`, and `recommendedAdjustment`.
- `src/adapters/opencode/tool-surface/schemas.ts:88-157` mirrors runtime contracts into OpenCode tool arg shapes and keeps `WorkerResultArgsSchema` equal to the runtime schema.
- `src/adapters/opencode/tool-surface/schemas.ts:238-264` registers payload schema owners for `flow_run_complete_feature`, `flow_review_record_feature`, and `flow_review_record_final` as adapter + runtime schema files.
- `src/adapters/opencode/tool-surface/runtime-tools/execution-tools.ts:44-68` parses `flow_run_complete_feature` with `WorkerResultArgsSchema`, emits action metadata, and passes the parsed worker payload into the guarded runtime mutation.
- `src/runtime/transitions/execution-completion-validation.ts:181-356` enforces completion gates after schema parse: completed outcomes only, non-empty passing validation, review-finding/scope accounting, recorded reviewer approval, targeted validation for non-final features, broad validation/final review/final reviewer decision for final completion.
- `tests/config/tool-schemas.test.ts:455-498` locks the direct top-level worker payload shape and rejects JSON-string transport fields and nested `result` payloads.
- `tests/config/tool-schemas.test.ts:500-575` verifies raw tool schema and runtime schema alignment, while allowing runtime cross-field rules to be stricter.
- `tests/runtime/worker-result-contracts.test.ts:27-51` rejects incomplete structured replan outcomes; `tests/runtime/worker-result-contracts.test.ts:58-119` rejects `ok` with a replan outcome; `tests/runtime/worker-result-contracts.test.ts:123-181` accepts the documented top-level worker payload.
- `tests/runtime/final-review-contracts.test.ts:494-544` requires explicit `evidenceRefs` fields for live final-review inputs and worker final reviews.
- `tests/runtime-tools.test.ts:254-282` rejects nested worker results; `tests/runtime-tools.test.ts:331-365` rejects malformed and syntactically valid JSON-string worker transport fields.
- `tests/runtime/final-completion-gates.test.ts:244-277` verifies broad final validation is required before final-session completion; `tests/runtime/final-completion-gates.test.ts:282-342` verifies rejected completion does not retain ok worker projections.

**Conclusion**
JSON contract preservation is not optional. Worker/reviewer/tool payloads are the machine-readable source of truth at the adapter and transition boundary. UX work should not replace these contracts with prose or nested/stringified JSON. It should project from them.

#### 3. Presentation boundary

**Evidence**
- `src/runtime/summary-projections.ts:3-36` defines summarized feature projections and active-feature projection; `src/runtime/summary-projections.ts:46-66` summarizes planning context for presentation.
- `src/runtime/summary.ts:17-74` defines `SessionGuidance`, `SummarizedSessionDetails`, `SessionViewModel`, `featureProgress`, `features`, `nextCommand`, and operator state as the runtime-owned projection model.
- `src/runtime/summary.ts:92-140` computes active feature, feature progress, feature lines, planning summaries, last outcome/reviewer/validation, and next command from the canonical session.
- `src/runtime/summary.ts:145-222` derives human-facing guidance by phase: no session, planning, decision gate, blocked, execution, or completed.
- `src/runtime/application/operator-presenters.ts:5-39` renders the canonical human-readable operator summary with Flow guidance, blocker, next step, command, active feature, progress, final-review policy, and goal.
- `src/runtime/application/session-presenters.ts:60-104` presents history as counts and active/stored/completed session records; `src/runtime/application/session-presenters.ts:107-175` wraps stored/status session responses with guidance and `operatorSummary` rather than exposing only raw session JSON.
- `src/runtime/application/session-action-responses.ts:17-55` makes mutation responses return `summarizeSession(saved).session`, not raw unprojected session internals.
- `src/runtime/session-operator-state.ts:11-24` defines phase/lane/blocker/reason/nextStep/nextCommand; `src/runtime/session-operator-state.ts:82-196` derives those fields from session state.
- `src/runtime/render-index-sections.ts:54-163` renders markdown session docs containing summary, plan, features, outcome, feature result, notes, artifacts, validation, and execution history.
- `src/runtime/render-feature-sections.ts:13-79` renders per-feature docs with per-feature execution history.
- `src/runtime/render-feature-history-sections.ts:17-66` renders each execution-history entry into changed artifacts, validation, decisions, closures, reviewer decision, outcome, notes, follow-ups, and reviews.
- `src/runtime/render-history-formatters.ts:9-23` defines compact human rows for artifacts, validation, and execution history.
- `src/adapters/opencode/tool-surface/runtime-tools/planning-tools.ts:52-60`, `src/adapters/opencode/tool-surface/runtime-tools/planning-tools.ts:94-101`, `src/adapters/opencode/tool-surface/runtime-tools/planning-tools.ts:142-148`, and `src/adapters/opencode/tool-surface/runtime-tools/planning-tools.ts:166-171` emit action metadata for planning-context recording, plan apply, approval, and feature selection.
- `src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts:33-40` and `src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts:59-82` emit reviewer-action metadata, including final-review depth, surfaces, behavior-check counts, validation-coverage counts, and review-scope ledger counts.
- `src/adapters/opencode/tool-surface/session-tools/shared.ts:1-4` explicitly says session tool response shaping belongs in the runtime/application boundary and routing policy belongs in next-command policy.
- `tests/runtime-summary.test.ts:330-344` locks the canonical human-readable status string with working feature and progress; `tests/runtime-summary.test.ts:388-424` locks history-specific command override and runtime-owned operator model.
- `tests/runtime-actionable-metadata.test.ts:96-131` verifies actionable `needs_input` metadata is summarized and rendered into index/feature docs.
- `tests/runtime-operator-history.test.ts:33-55` verifies `flow_history` returns machine-readable history plus guidance; `tests/runtime-operator-history.test.ts:70-117` verifies stored/completed session history rows; `tests/runtime-operator-history.test.ts:119-167` verifies `flow_history_show` returns an `operatorSummary` with progress.

**Conclusion**
Human-facing task/session progress belongs in summary/projection, render, operator presenter, session presenter, and action metadata layers. It should not be embedded as prose inside worker-result/reviewer/finalReview JSON fields.

#### 4. UX recommendation and eliminated alternatives

**Supported recommendation**
Use a hybrid projection model:
1. Keep the existing JSON schemas and tool contracts unchanged as the machine boundary.
2. Treat visible work as Flow feature/session progress today: active feature, feature progress, validation/review status, execution-history rows, session history rows, and operator guidance.
3. When the UX needs to expose subagent work, add a projection layer that groups activity by subject/workstream and maps it back to existing feature/session/history/tool metadata. This can be shown as subject-group task rows or child-work rows, but should initially be a derived presentation model rather than a new persisted runtime contract.
4. Apply the policy across `flow-auto`, `flow-planner`, `flow-planning-researcher`, `flow-worker`, `flow-reviewer`, and audit/review surfaces with role-specific limits: coordinators create handoffs; workers request fresh review; reviewer/audit primarily return evidence-backed decisions/reports.

**Eliminated alternatives**
- **Replace JSON with human prose:** rejected because schemas, adapters, transition guards, and tests require direct JSON payloads (`src/runtime/schema.ts:177-334`, `src/adapters/opencode/tool-surface/schemas.ts:130-157`, `tests/config/tool-schemas.test.ts:455-575`).
- **Use JSON-string transport or nested result objects for friendlier UX:** rejected by tool-schema and runtime-tool tests (`tests/config/tool-schemas.test.ts:455-498`, `tests/runtime-tools.test.ts:254-365`).
- **Make child sessions a first-class runtime model now:** not supported by current repo evidence. Session history and execution history are flat and keyed by session/feature (`src/runtime/schema.ts:336-376`, `src/runtime/application/session-presenters.ts:60-104`); no current subject-group or child-session schema was found in the inspected runtime/presenter surfaces.
- **Scope the policy only to `flow-worker`:** rejected. Worker has the clearest review handoff, but the shared rule and `flow-auto` coordinator already apply handoff guidance across planning research, planning, implementation, and review (`src/prompts/fragments.ts:41-46`, `src/prompts/generated/role-prompts.ts:224-277`).
- **Let reviewer/audit recursively spawn subagents by default:** not supported by prompt evidence. Reviewer and audit are currently read-only evidence/report roles without their own Task orchestration rule (`src/prompts/generated/role-prompts.ts:277-304`, `src/audit/prompts/agents.ts:29-61`).

## Investigation Log

### Phase 1 - Initial assessment and external research
**Hypothesis:** The product may need a separation between machine-readable subagent/task contracts and a more task-oriented, end-user presentation model.
**Findings:** Confirmed. External research from OpenCode docs, Claude Code docs, Exa, Ref, and an explore probe supports subagents as fresh contexts for independent work, but warns against over-splitting sequential or tightly coupled work. External sources also point toward child-session, todo/session-event, and progress/status UX rather than raw JSON as the end-user model.
**Evidence:** OpenCode agents docs; Claude Code subagent and agent-team docs; Anthropic subagent orchestration guidance; external probe notes in `## Background / Prior Research`.
**Conclusion:** Confirmed hybrid premise: split independent subject groups; avoid blanket recursive orchestration.

### Phase 2 - Context Builder assessment
**Hypothesis:** The repo already separates machine JSON contracts from user-facing presentation layers.
**Findings:** Confirmed. Context Builder selected prompt fragments, role prompts, runtime schemas, transition gates, summary/projection/render/presenter files, OpenCode adapter schemas, and contract tests. Initial assessment identified JSON as runtime/tool-owned and UX as summary/presenter/render-owned.
**Evidence:** Selected context included `src/prompts/fragments.ts`, `src/prompts/generated/role-prompts.ts`, `src/runtime/schema.ts`, `src/runtime/summary.ts`, `src/runtime/application/operator-presenters.ts`, `src/adapters/opencode/tool-surface/schemas.ts`, and relevant tests.
**Conclusion:** Confirmed architecture supports presentation improvements without changing payload contracts.

### Phase 3 - Pair investigation
**Hypothesis:** Current prompt guidance supports fresh child contexts broadly enough to justify subject-group splitting, but actual spawning authority is concentrated in coordinator/worker/planner roles.
**Findings:** Confirmed with precision. Shared fragments define fresh child-context handoffs and operator progress rules, but concrete role prompts concentrate orchestration in `flow-auto`, planner/researcher paths, and `flow-worker` review handoff. `flow-reviewer` and audit are mostly leaf/report roles.
**Evidence:** `src/prompts/fragments.ts:41-59`; `src/prompts/generated/role-prompts.ts:145-304`; `src/audit/prompts/agents.ts:29-61`; `src/audit/prompts/contracts.ts:3-57`.
**Conclusion:** Use role-aware splitting: coordinators orchestrate, workers own one feature and request independent review, leaf roles report rather than recursively spawn.

### Phase 4 - Contract and UX boundary verification
**Hypothesis:** End-user UX should be improved by projections, not by replacing JSON.
**Findings:** Confirmed. Runtime schemas and adapter schemas require direct top-level worker/reviewer JSON payloads, and tests reject JSON-string transport or nested `result` payloads. Existing summary, operator presenter, session presenter, render, history, and metadata layers already provide the right boundary for human-facing task/session progress.
**Evidence:** `src/runtime/schema.ts:177-376`; `src/adapters/opencode/tool-surface/schemas.ts:88-157`; `tests/config/tool-schemas.test.ts:455-575`; `tests/runtime-tools.test.ts:254-365`; `src/runtime/summary.ts:17-222`; `src/runtime/application/operator-presenters.ts:5-39`; `src/runtime/application/session-presenters.ts:60-175`; render/history files cited above.
**Conclusion:** Keep JSON unchanged; add or refine derived work-item/subject-progress presentation if UX is improved later.

### Phase 5 - Oracle synthesis
**Hypothesis:** The final recommendation should avoid overreach by distinguishing policy awareness from recursive spawning authority.
**Findings:** Confirmed. Oracle recommended a hybrid, role-aware subject-group split policy, centralized orchestration, non-recursive leaf roles, preserved JSON contracts, and presentation-only task/session progress projections.
**Evidence:** Oracle synthesis over refreshed selection including pair-referenced tests and presenters.
**Conclusion:** Final recommendation has high confidence for the JSON/UX boundary and medium confidence for any future first-class child-session tree persistence, because current runtime/session history is flat.

## Root Cause
The current UX tension comes from mixing two valid needs at different layers:

1. **Machine contracts are intentionally strict JSON.** Worker results, reviewer decisions, final review payloads, and tool args are runtime/adapter contracts. They are validated by Zod schemas, completion transitions, and regression tests. This is correct for reliability, but raw JSON is not an ideal end-user progress surface.
2. **Subagent policy exists but is not uniformly role-scoped.** Shared prompt fragments already encourage fresh child contexts for role handoffs, but concrete orchestration authority is concentrated in `flow-auto`, planner/researcher handoffs, and `flow-worker` review handoff. Reviewer and audit roles are not currently designed as recursive orchestrators.
3. **Presentation capabilities exist but do not yet expose subject-group work as first-class UX.** Summary, operator presenter, session presenter, render, history, and action metadata layers already translate state into human-facing status. They are the natural place to show “working on tasks” or “subagent work” rows, but current runtime history is flat and feature/session-oriented rather than child-session-tree-oriented.

## Recommendations
1. **Adopt a hybrid, role-aware split policy.** Split into fresh subagents per independent task subject group when the work is bounded, high-output, read-only/review-heavy, role-specific, parallelizable, or benefits from fresh perspective. Do not split tiny, sequential, same-file, single-transition, or tightly coupled work.
2. **Centralize orchestration.** `flow-auto` should be the primary broad orchestrator. `flow-planner` may request planning research and then synthesize. `flow-worker` should own one active feature and request a fresh `flow-reviewer` context for independent review. `flow-reviewer`, `flow-planning-researcher`, audit, and `flow-control` should mostly be leaf/report/control roles unless a future explicit orchestration mode is added.
3. **Preserve JSON contracts exactly.** Do not replace worker/reviewer payloads with prose, do not stringify JSON into transport fields, and do not nest payloads under friendlier wrapper keys. Existing tests explicitly reject those alternatives.
4. **Improve end-user UX through derived projections.** Present users with task/session progress rows derived from existing feature, session, execution-history, reviewer-decision, validation, and action metadata. Example fields: `phase`, `owner`, `subject`, `status`, `evidence`, `blocker`, `next`.
5. **Start with prompt and presentation refinements, not schema changes.** If implementation follows, first refine shared prompt wording around subject-group splitting and over-splitting limits. Then add a presentation-only work-item projection in `summary-projections.ts`, `summary.ts`, `operator-presenters.ts`, or session/render layers. Avoid changing `WorkerResultArgsSchema`, reviewer schemas, or persisted `SessionSchema` initially.
6. **Treat first-class child-session trees as a later decision.** External OpenCode direction makes session-tree UX attractive, but current flow-opencode runtime evidence supports flat feature/session/history projections today. Add persisted child-session modeling only after a concrete UX/runtime requirement appears.

## Preventive Measures
- Keep a hard boundary: machine-readable JSON belongs to schemas/tools/transitions; user-facing progress belongs to summaries, presenters, renderers, history, and metadata.
- Add prompt/eval coverage for “split independent subject groups, avoid tiny sequential/same-file splits, and avoid recursive reviewer/audit orchestration by default.”
- Extend metadata/summary tests if subject-progress rows are added, while preserving existing schema and runtime-tool regression tests.
- Use role-specific language: coordinators orchestrate; leaf roles report; runtime state transitions remain single-owner through Flow tools.
- Re-check OpenCode subagent/session-tree support before implementing first-class child-session UX because external PR/issue evidence is directional and may change.
