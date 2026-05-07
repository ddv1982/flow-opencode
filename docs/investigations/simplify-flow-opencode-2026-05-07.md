# Investigation: Simplify flow-opencode While Keeping the Good Parts

## Summary
flow-opencode can likely be made substantially smaller by extracting the existing runtime transition path as the authoritative core, replacing descriptor/projection machinery with a small tool registry, using snapshot-first persistence, and moving strict review/accounting governance into optional or review-mode-only policy. The safest simplification is not a blank rewrite: keep runtime transitions, completion/recovery invariants, workspace safety, and OpenCode integration; cut duplicated metadata, replay/projection surfaces, and default-path review ledgers.

## Symptoms
- The project has grown into a high-complexity plugin/runtime with workflow state, review governance, generated prompt/tool surfaces, persistence, recovery, and release/eval machinery.
- Prior soft-focus review evidence suggests the system can pass structural review accounting while still missing behavior-sensitive lifecycle bugs.
- The user wants a near-start-over simplification strategy that keeps the valuable parts while making the codebase substantially smaller.

## Background / Prior Research
No external research needed for this phase. This is a repository-local architecture and simplification investigation.

## Investigator Findings
<!-- Pair investigator appends structured findings here with file:line refs, evidence, and conclusions. -->

### Pair investigation - near-start-over simplification (2026-05-07)

#### Hypothesis results

1. **Durable core is small: strongly supported.** The essential behavior-bearing path is `OpenCode tool -> guarded adapter dispatch -> runtime application action -> runtime transition -> snapshot save/artifact sync`. OpenCode registers `createTools(ctx)` as the plugin tool surface in `src/adapters/opencode/plugin.ts:91-110`; `createTools` composes session/runtime tools and orders them through projected tool names in `src/adapters/opencode/tools.ts:25-64`; runtime tools bind host tool names to a small set of action names in `src/adapters/opencode/tool-surface/runtime-tools/execution-tools.ts:16-24` and `src/adapters/opencode/tool-surface/runtime-tools/planning-tools.ts:27-44`; the shared adapter guard only checks mutable workspace permission and forwards to application dispatch in `src/adapters/opencode/tool-surface/runtime-tools/shared.ts:27-47`; mutation handlers then call transition functions such as `applyPlan`, `approvePlan`, `startRun`, `completeRun`, and `record_final_review` in `src/runtime/application/session-actions.ts:119-243`; persistence is centralized by `executeTransitionAtRoot` / `runSessionMutationActionAtRoot`, which load a session, run the transition, save session state, and optionally sync artifacts in `src/runtime/application/session-engine.ts:192-276`.

2. **The largest accidental complexity is descriptor/projection/review-governance/parity machinery: supported with caveat.** The descriptor/projection family does not own runtime behavior: it maps tool metadata, runtime bindings, core actions, docs rows, allowed modes, invariants, policy owners, descriptions, and verification anchors in `src/adapters/opencode/tool-surface/descriptors.ts:69-179`, while generated projections and guidance derive host descriptions/core summaries in `src/adapters/opencode/tool-projections.generated.ts:1-89` and append guidance to descriptions in `src/adapters/opencode/tool-guidance.generated.ts:1-30`. Tests then enforce parity between descriptors, implementation bindings, schemas, generated docs, core registry, mode contracts, and tool construction in `tests/descriptor-family-parity.test.ts:1-120`. This machinery is valuable for maintainer confidence, but it sits around the core dispatch path rather than carrying state-machine behavior.

3. **Choosing one authoritative state engine plus snapshot-first persistence would substantially simplify the project: supported.** The docs already state the desired authority: runtime/domain/transitions own behavior, and live persistence is snapshot-primary while core event/replay is a semantic oracle/regression gate (`docs/maintainer-contract.md:9-24`, `docs/development.md:80-90`, `docs/architecture/maintainer-risk-checklist.md:22-25`, `docs/architecture/role-protocol-projections.md:12-21`). `src/workflow/transitions.ts:1-9` is only a re-export of runtime transitions. `src/core/workflow/commands.ts:1-15` imports those same runtime transitions and converts command decisions to events; its command cases delegate to transition calls rather than implementing a separate state machine (`src/core/workflow/commands.ts:101-305`). `src/core/workflow/reducer.ts:1-230` replays accepted events into `Session` state, including storing full resulting state for run completion/reset events (`src/core/workflow/commands.ts:245-302`, `src/core/workflow/reducer.ts:110-128`, `src/core/workflow/reducer.ts:199-205`). That means a near-start-over design can keep runtime transitions as the single authoritative engine and demote/remove command/event/replay from live operation.

#### Minimum core to preserve

- **State schema and transition invariants.** Keep a single `Session` state, plan feature statuses, approval/status transitions, active feature selection, completion marking, and recovery payloads. Runtime plan transitions already enforce plan graph, review-and-fix prerequisites, completion policy, review-scope declaration, status changes, and approval timestamps in `src/runtime/transitions/plan.ts:98-236`.
- **Plan -> run -> review -> complete loop.** The minimal mutation set is `plan_start`, `record_planning_context` (optional), `apply_plan`, `approve_plan/select_features` (optional for auto/lite), `start_run`, `record_review` (feature/final), `complete_run`, `reset/replan`, and `status/history`. The current handlers expose this small set in `src/runtime/application/session-actions.ts:119-243`.
- **Completion/recovery guardrails.** Completion must keep: non-empty passing validation, targeted validation for feature completion, broad validation for final completion, passing feature review, final review on final feature, and completion only when the policy target is reached. These are enforced directly in `src/runtime/transitions/execution-completion-validation.ts:187-314` and finalization checks completion policy plus `sessionCompletionReached` before marking the session completed in `src/runtime/transitions/execution-completion-finalization.ts:64-94`.
- **Snapshot-first persistence and rendered artifacts.** The live product path only needs session snapshots, active/stored/completed directories, save locks, and optional rendered markdown. `src/runtime/session-persistence.ts:27-86` writes active/completed sessions by status, `src/runtime/session-persistence.ts:91-137` loads/saves/syncs snapshots and artifacts, and `src/runtime/paths.ts:65-91` separates active/stored/completed from events/checkpoints/projections.
- **Thin OpenCode adapter.** Preserve host registration, arg parsing, workspace mutability guard, and JSON response shaping, but not the full descriptor/projection governance as mandatory runtime machinery (`src/adapters/opencode/plugin.ts:91-110`, `src/adapters/opencode/tool-surface/runtime-tools/shared.ts:27-47`).

#### Simplification candidates ranked by confidence

| Rank | Candidate | Confidence | Evidence and conclusion |
| --- | --- | --- | --- |
| 1 | Make `src/runtime/transitions/**` the only authoritative state engine; remove or quarantine `src/core/workflow/**` from live concepts. | High | `src/workflow/transitions.ts:1-9` re-exports runtime transitions; `src/core/workflow/commands.ts:101-305` delegates to those transitions before emitting events; `src/core/workflow/reducer.ts:1-230` is replay/projection, not the live mutation path. Conclusion: keep runtime transitions, treat core workflow as optional replay/test harness or delete in a rewrite. |
| 2 | Collapse descriptor/projection/generated guidance into a small inline tool registry. | High | Runtime dispatch needs bindings like `flow_run_start -> start_run` (`src/adapters/opencode/tool-surface/runtime-tools/execution-tools.ts:16-24`) and parser/execute functions; the descriptor family stores much broader metadata (`src/adapters/opencode/tool-surface/descriptors.ts:69-179`) and generated guidance only decorates descriptions (`src/adapters/opencode/tool-guidance.generated.ts:14-29`). Conclusion: use one adapter registry containing name, schema, mode/permission, handler, and description; generate docs only if needed. |
| 3 | Make event/checkpoint/projection stores optional audit/regression infrastructure, not product architecture. | High | Live save/load uses `session-persistence` snapshots and artifacts without importing `src/persistence/event-store.ts`, `checkpoint-store.ts`, or `projection-store.ts` (`src/runtime/session-persistence.ts:1-137`). Separate roots exist for events/checkpoints/projections (`src/runtime/paths.ts:82-91`), and the stores implement append/replay, checkpoints, and rendered projections (`src/persistence/event-store.ts:126-234`, `src/persistence/checkpoint-store.ts:103-152`, `src/persistence/projection-store.ts:116-163`). Conclusion: snapshot-first should be the product default; event/checkpoint/projection can be opt-in audit or removed in a rewrite. |
| 4 | Replace detailed final-review governance ledgers with strict/optional modes. | Medium-high | Essential gates are direct: validation evidence/pass/final review checks in `src/runtime/transitions/execution-completion-validation.ts:187-314`. Additional accounting requires declared review scopes, unique IDs, ledger entries, evidence refs, validation refs, context packs, coverage gaps, and behavior-risk mappings in `src/runtime/domain/review-scope-accounting.ts:95-190`, `src/runtime/domain/review-scope-accounting.ts:703-750`, `src/runtime/domain/review-content-discovery.ts:357-464`, and `src/runtime/domain/final-review-coverage.ts:127-318`. Conclusion: keep minimal blocking gates always; make review-scope ledgers, context packs, and behavior-risk matrices optional strict/audit mode. |
| 5 | Flatten runtime application/presenter/read/workspace layers after the state engine is chosen. | Medium | `session-engine` already provides the persistence gate (`src/runtime/application/session-engine.ts:192-276`); `session-actions` is mostly an action-name dispatch map (`src/runtime/application/session-actions.ts:119-293`). Conclusion: the application layer can become a small command service, but do this after schema/transition consolidation to avoid breaking UX/history semantics. |

#### Things to preserve

- **Authoritative runtime/domain transition ownership.** Maintainer docs explicitly define runtime/domain/transitions as behavior owners (`docs/maintainer-contract.md:9-24`).
- **Snapshot-primary session lifecycle.** Active, stored, and completed session history is a product feature, not accidental complexity (`src/runtime/paths.ts:69-80`; `src/runtime/session-persistence.ts:27-86`).
- **Completion invariants that prevent false completion.** The valuable safety core is validation evidence/pass, feature/final validation scope, feature review pass, final review presence/pass, and final target completion (`src/runtime/transitions/execution-completion-validation.ts:187-314`; `src/runtime/transitions/execution-completion-finalization.ts:64-94`).
- **Recovery hints tied to failed completion.** Completion failures return structured recovery details from validation failures (`src/runtime/transitions/execution-completion-validation.ts:187-314`), and tests assert recovery behavior for missing broad validation/failing validation in `tests/runtime/final-completion-gates.test.ts:60-219`.
- **Grounded final-review checks as an optional high-assurance mode.** Final reviewer decision shape and coverage checks catch real classes of errors (`src/runtime/domain/reviewer-decision.ts:168-338`; `tests/reviewer-decision-scope.test.ts:36-180`), but should not be mandatory for every lightweight flow.

#### Risks / unknowns

- **Prompt/agent behavior may depend on generated descriptors and mode contracts.** The descriptor parity tests intentionally bind tools, core registry, prompt mode contracts, docs rows, schemas, and implementation bindings (`tests/descriptor-family-parity.test.ts:1-120`). Removing this without replacing a smaller contract risks stale prompts or tools.
- **Review-and-fix mode may need stricter accounting than ordinary feature delivery.** Review scope accounting is only required for `goalMode === "review" || "review_and_fix"` (`src/runtime/domain/review-scope-accounting.ts:95-100`), so a rewrite should keep an escape hatch for audit-heavy review workflows.
- **Soft-focus failure class is not solved by accounting alone.** The repository’s broad final-review contract tests exercise context packs and behavior-risk mappings (`tests/runtime/final-review-contracts.test.ts:28-82`, `tests/runtime/final-review-contracts.test.ts:1240-1359`), but the prior investigation suggests structural coverage can still miss lifecycle-sensitive bugs. Simplification should favor smaller executable invariants/tests over larger ledgers.
- **Compatibility with existing `.flow/` sessions is unknown.** Snapshot-first migration is supported by current authority, but deleting replay/projection stores may affect users relying on generated projection artifacts or replay tests.

#### Recommended near-start-over architecture

1. **Core package:** one `Session` schema, one reducer/transition module, one `Command` union, one `dispatch(command, session) -> {session, response/recovery}` function. Start with plan/apply/approve/start/record-review/complete/reset/status only.
2. **Persistence package:** snapshot-first `SessionStore` with atomic `load/save/list/complete/archive`; markdown rendering is a derived artifact hook. No event/checkpoint/projection stores in the default path.
3. **Adapter package:** thin OpenCode registry where each tool has `{name, description, argsSchema, permission, command}` and calls the core command service. No descriptor family, generated guidance, or parity graph unless strict mode is enabled.
4. **Review policy package:** always-on minimal completion gates; optional `strictReview` plugin for review-scope ledgers, context packs, behavior-risk coverage, and final-review depth policies.
5. **Tests:** shrink to transition golden tests, snapshot persistence tests, adapter schema smoke tests, and a small strict-review suite. Preserve tests that prove false completion is blocked; retire parity tests whose only purpose is keeping duplicated metadata synchronized.

**Overall conclusion:** the hypotheses mostly hold. The good part is a compact workflow runtime with snapshot persistence and completion/recovery invariants. The removable complexity is not a second live engine; it is the layers of metadata projection, parity enforcement, event/replay/projection infrastructure, and review governance that surround a much smaller state machine.

## Investigation Log

### Phase 1 - Initial assessment
**Hypothesis:** The codebase can be simplified by separating the durable core from accumulated governance, generated surfaces, and cross-area enforcement layers.
**Findings:** Initial hypothesis was supported by Context Builder, pair investigation, spot checks, and Oracle synthesis.
**Evidence:** Prior session evidence: `docs/investigations/final-review-missed-soft-focus-2026-05-06.md`; current report findings; selected runtime, adapter, persistence, domain, docs, and tests.
**Conclusion:** Confirmed with caveats: strict review governance should be optional or review-mode-specific, not deleted wholesale.

### Phase 2 - Context Builder synthesis
**Hypothesis:** A smaller durable core exists inside the current architecture.
**Findings:** Context Builder identified the minimum durable value as a workflow state machine, completion/recovery invariants, thin OpenCode adapter, snapshot persistence, and optional audit/review tooling.
**Evidence:** Selected files included `src/runtime/transitions/**`, `src/runtime/application/**`, `src/adapters/opencode/**`, `src/persistence/**`, `src/core/workflow/**`, docs architecture files, and key runtime/config tests.
**Conclusion:** Confirmed; the durable product is much smaller than the current governance/projection surface.

### Phase 3 - Pair investigation
**Hypothesis:** Runtime transitions are already the live authority, while descriptor/projection/review accounting layers are surrounding complexity.
**Findings:** Pair investigator confirmed the live path is OpenCode tools -> runtime action dispatch -> runtime transition -> snapshot save/artifact sync. It found `core/workflow` delegates to runtime transitions and functions as replay/projection rather than live authority.
**Evidence:** `src/runtime/application/session-engine.ts:192-276`; `src/core/workflow/commands.ts:1-305`; `src/adapters/opencode/tool-surface/descriptors.ts:69-179`; `src/runtime/transitions/execution-completion-validation.ts:187-314`; `src/runtime/domain/review-scope-accounting.ts:95-190`.
**Conclusion:** Confirmed; a simplification should extract runtime transitions as core rather than promote `core/workflow`.

### Phase 4 - Oracle synthesis
**Hypothesis:** The smallest safe refactor is runtime-core extraction plus governance deletion/demotion.
**Findings:** Oracle agreed: freeze runtime transitions as authoritative, replace descriptors/projections with a small registry, collapse dispatch layers, keep compact completion safety, make strict review optional or review-mode-specific, and use snapshot-first persistence.
**Evidence:** Oracle synthesis over refreshed selection including pair-referenced files and prior soft-focus investigation.
**Conclusion:** Confirmed; the ranked cut/keep plan below is the recommended simplification path.

## Root Cause
The project’s complexity is primarily architectural accretion around a smaller live workflow engine.

Evidence supports three root causes:

1. **Multiple representations of the same behavioral surface.** Runtime transitions own live behavior, while `src/core/workflow/**`, core action registries, descriptor metadata, generated projections, docs rows, protocol parity tests, and prompt contracts also model or summarize the same actions. `src/core/workflow/commands.ts` imports runtime transitions and delegates to them before producing events, so it is not an independent simpler core.

2. **Governance moved into the runtime hot path.** The soft-focus miss motivated stronger final-review accounting, but the resulting review-scope, behavior-risk, validation coverage, context-pack, and closure ledgers make review governance feel like a second product. Some of this is valuable for review/review-and-fix mode, but it is too heavy as default workflow law.

3. **Support infrastructure shapes the architecture.** Event/checkpoint/projection stores, generated tool guidance/projections, and broad parity tests improve maintainer confidence, but much of it exists to synchronize duplicated metadata rather than to run the product. The live product path mostly needs snapshot persistence, transition validation, recovery responses, and optional rendered artifacts.

## Recommendations
1. **Make `src/runtime/transitions/**` the authoritative core.** Do not promote `src/core/workflow/**` in the smallest refactor; it currently delegates to runtime transitions and behaves like replay/projection infrastructure. Either quarantine it as tests/debug support or delete it in a vNext simplification.

2. **Replace descriptor/projection machinery with one small OpenCode tool registry.** Keep `{ toolName, description, argsSchema, permission/mode, commandName, handler }`. Remove broad metadata such as docs row ownership, emitted event projections, verification anchors, policy owners, generated guidance, and parity tests whose only purpose is keeping duplicated metadata synchronized.

3. **Collapse runtime application dispatch into `flow.dispatch(command)` and `flow.query(query)`.** Preserve the `session-engine` behavior: load session, run transition, save snapshot, sync optional artifacts, return response/recovery. Merge separate read/workspace/mutation/review action families after transition authority is frozen.

4. **Keep compact completion safety always on.** Preserve validation evidence, passing validation, targeted validation for feature completion, broad validation for final completion, passing feature review, final review on final path, final-scoped reviewer decision, completion target policy, recovery metadata, plan graph validity, and workspace/root safety.

5. **Move strict review governance out of the default path.** Keep behavior-risk ledgers, validationCoverage, reviewContextPack grounding, review-scope accounting, and finding-closure accounting only for `review` / `review_and_fix` or explicit `strictReview`. Do not delete strict review entirely; the soft-focus miss shows high-assurance review still needs stronger behavioral proof.

6. **Make persistence snapshot-first.** Preserve `.flow/active`, `.flow/stored`, `.flow/completed`, `session.json`, atomic save/load, and optional rendered markdown. Demote event/checkpoint/projection stores to debug/test infrastructure or remove them if replay is not a supported product feature.

7. **Shrink schemas by separating runtime, adapter, and audit concerns.** Keep persisted `Session`, `Plan`, `WorkerResult`, `ReviewerDecision`, and minimal tool input schemas. Decouple audit report schemas and behavior-ledger schemas from the default runtime schema.

8. **Retain tests for behavioral invariants, retire tests for deleted metadata.** Keep/rewrite final completion gate tests, reviewer decision scope tests, plan graph validation tests, transition golden tests, snapshot persistence tests, workspace root guard tests, and minimal adapter schema smoke tests. Retire descriptor-family, generated-doc/tool-projection, and large prompt/protocol parity tests once their duplicated surfaces are removed.

## Preventive Measures
- Before any simplification edit, write a compact “Flow Core vNext” contract: command union, session shape, transition authority, completion gates, recovery response shape, persistence format, and adapter responsibilities.
- Treat every surviving layer as one of: core behavior, adapter, persistence, optional audit, or test/debug support. Delete or quarantine anything that cannot fit one category.
- Prefer executable behavioral tests over accounting fields. The soft-focus failure class argues for adversarial lifecycle tests, not larger ledgers.
- Maintain a strict distinction between ordinary implementation flow and high-assurance review/review-and-fix flow.
- Use schema size and descriptor parity churn as complexity metrics; simplification is not complete if the new system still needs large synchronization tests for duplicated metadata.
- Preserve backwards compatibility deliberately: decide whether existing `.flow/` sessions, projections, and replay artifacts are migration requirements before deleting stores.

## Implementation Tracking

- [x] Item 1: Freeze Flow Core vNext contract and add a thin command/query facade over the existing runtime transition + snapshot persistence path.
  - Done when: contract/facade exists, delegates to existing runtime/session-engine paths, and targeted behavior tests pass.
  - Evidence: `docs/architecture/flow-core-vnext-contract.md`; `src/runtime/application/flow-core.ts`; `tests/session-engine.test.ts`; `bun test tests/session-engine.test.ts` passed on 2026-05-07.
- [x] Item 2: Route OpenCode tool helpers through the Flow Core facade without deleting descriptor/projection machinery yet.
  - Done when: runtime/session tool execution reaches `executeFlowCoreCommand` / `executeFlowCoreQuery` where appropriate, tool JSON responses stay compatible, and focused adapter/runtime tests pass.
  - Evidence: `src/adapters/opencode/tool-surface/runtime-tools/shared.ts`; `src/adapters/opencode/tool-surface/session-tools/shared.ts`; `tests/runtime-tool-routing.test.ts`; `bun test tests/runtime-tool-routing.test.ts tests/runtime-tools.test.ts tests/runtime-operator-tools.test.ts tests/session-engine.test.ts` passed on 2026-05-07.
- [x] Item 3: Collapse adapter metadata duplication into a small registry, deleting duplicated/deprecated descriptor/projection code rather than leaving dead compatibility surfaces.
  - Done when: duplicated descriptor/projection surfaces are removed or replaced by the smaller registry, compatibility risks are documented, affected parity/tool tests are updated intentionally, and no deprecated/dead adapter code remains.
  - Evidence: `src/adapters/opencode/tool-surface/tool-registry.ts`; `src/adapters/opencode/tool-surface/descriptors.ts`; `tests/descriptor-family-parity.test.ts`; targeted descriptor/docs/tool tests passed on 2026-05-07.
- [x] Item 4: Separate optional strict-review/audit governance from always-on completion gates.
  - Done when: ordinary flows keep compact completion safety, review/review-and-fix or explicit strict mode retains high-assurance ledgers, and final-completion/reviewer-scope tests still pass.
  - Evidence: `src/runtime/domain/workflow-policy.ts`; `src/runtime/domain/review-scope-accounting.ts`; `tests/reviewer-decision-scope.test.ts`; `tests/runtime/final-review-contracts.test.ts`; targeted final-review tests passed on 2026-05-07.
- [x] Item 5: Final cleanup: remove dead/deprecated code left by simplification, including replay/event/checkpoint/projection infrastructure if it is no longer product-supported.
  - Done when: snapshot-first persistence remains default, dead/deprecated compatibility surfaces are deleted rather than kept, no unused exports/files remain, and persistence/replay/build tests reflect the supported contract.
  - Evidence: deleted `src/persistence/**`, `src/core/workflow/**`, `tests/replay/**`, replay persistence tests, and event-store benchmark; `package.json` now points replay/fast lanes at supported runtime invariant tests; final validation passed on 2026-05-07.

## Verification
- Item 5 cleanup removed unsupported replay/event/checkpoint/projection persistence and stale replay tests/benchmarks after import-graph verification showed no live runtime product imports.
- Snapshot-first persistence remains the supported contract through `src/runtime/session-persistence.ts` and runtime session workspace save/load paths.
- Final validation completed: `bun run deadcode`; `bun run typecheck`; `bun run lint`; `bun run build`; `bun test` (545 pass, 0 fail); targeted Item 1-4 suites (129 pass, 0 fail); `bun run test:replay`; `bun run bench:smoke`; `bun run bench:gate`.
