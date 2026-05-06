# Investigation: Final Review Missed Soft-Focus Lifecycle Issues

## Summary
Flow/OpenCode final review missed the soft-focus lifecycle defects because its hard completion path verifies review accounting, not temporal behavior proof. The strongest improvement path is risk-triggered behavior/gap accounting: final reviews should explicitly map async/lifecycle/state risks to checked paths, validation oracles, and remaining gaps instead of treating command success plus surface coverage as sufficient.

## Symptoms
- A final review of `~/projects/soft-focus` reported validation success (`bun run typecheck && bun run smoke:test`) but missed lifecycle edge cases.
- Must-fix missed issue: panel actions can race while `ensureSceneRegistered()` is pending, allowing a later first action to override a second user intent.
- Suggested missed issue: `sessionStore.updateCurrentScene(request.to)` can commit navigation state before `scene.scene.start(...)`, leaving state inconsistent if `start` throws.
- Existing coverage focused on rejected registration failures, not concurrent in-flight actions or `scene.start()` failure.

## Background / Prior Research

### Flow final-review coverage and prompt history

- `71b4b75` — “Ground final review coverage in canonical evidence” introduced the current final-review grounding model: `ReviewContextPack`, grounded `reviewedSurfaces`, and validation-command cross-checking. Reported refs: `src/runtime/domain/review-content-discovery.ts:74-89, 186-223, 437-449`; `src/runtime/domain/final-review-coverage.ts:30-45, 83-265`; `src/runtime/domain/reviewer-decision.ts:1-208`; `src/runtime/schema-review-shared.ts:52-114`; `src/adapters/opencode/tool-surface/schemas.ts:68-100`.
- `16df877` — “Refresh planning evidence packets without preserving stale context” shifted prompt guidance toward durable evidence packets while separating runtime-owned persistence from read-only/review surfaces. Reported refs: `src/prompts/contracts.ts:27-36, 68-96`; `src/prompts/fragments.ts:38-44, 53-56, 65-95`; `src/prompts/generated/role-prompts.ts:217-256, 265-314`.
- `4fe1f3c` — “Preserve review packet boundaries before audit findings” added providerless review capture packets and packet-boundary scoring for `/flow-review`. Reported refs: `src/audit/prompts/commands.ts:10-39`; `src/audit/prompts/fragments.ts:1-29`; `scripts/cross-area/review-prompt-capture.ts:22-32, 260-338, 396-525`; `tests/review-prompt-capture.test.ts:145-152, 229-231`; `tests/__fixtures__/review-capture-scenarios/review-scenarios.json:1-132`.
- Final review is required on the completion path, with broad validation first and `flow-reviewer` as the approval gate. Reported refs: `src/prompts/fragments.ts:22-31, 93-95`; `src/prompts/generated/role-prompts.ts:202-256, 265-314`; `src/prompts/contracts.ts:84-96, 125-152`.
- Runtime final-review gating requires validation refs to match actual recorded commands, but the audit/report layer still treats missing validation as `not_run` and can downgrade depth without forcing behavioral coverage. Reported refs: `src/runtime/domain/final-review-coverage.ts:107-265`; `src/runtime/domain/review-content-discovery.ts:403-460`; `src/audit/report-normalizer.ts:62-95`; `src/audit/report-presenter.ts:194-214`.

#### Prior hypotheses from Flow-history lane

- Seed-only review scope can miss lifecycle owners if the reviewer stays near changed files instead of expanding into callers/callees/state/lifecycle owners.
- Validation evidence is command-level, not temporal-behavior-level: `bun run typecheck && bun run smoke:test` can pass without exercising ordering/race behavior.
- The compact OpenCode `reviewContextPack` tool payload keeps the contract small but can make lifecycle-owner/caller evidence easy to omit.
- Packet-boundary preservation prevents context loss but cannot force adversarial traversal if the packet itself lacks async lifecycle/race prompts.
- Most likely incident failure mode: the reviewer treated soft-focus as a local lifecycle fix plus successful validation, rather than tracing pending-action race and `scene.start()` failure ordering through state-owner edges.

### Soft-focus incident evidence

- `/Users/vriesd/projects/soft-focus` had uncommitted changes in the reported lifecycle files: `src/dom/setupShell.ts`, `src/game/navigation.ts`, `src/main.ts`, `src/scenes/PracticeScene.ts`, `src/shell/sessionPanelActions.ts`, `src/shell/sessionPanels.ts`, `tests/fullFlowSmoke.ts`, `tests/sessionPanelActions.ts`, plus `src/observability/`.
- `src/shell/sessionPanels.ts:28-31` defines `runPanelAction` as `void action().catch(...)`; it reports errors but has no pending-action token, serialization, button disabling, or stale-result guard.
- `src/shell/sessionPanels.ts:98-99` wires completion buttons directly to independent `runPanelAction(...)` calls, leaving both actions clickable while the first async action awaits registration.
- `src/shell/sessionPanelActions.ts:37-44` awaits optional lazy registration and then updates scene state before `game.scene.start(...)`; `src/shell/sessionPanelActions.ts:55-65` awaits registration and then calls `prepareForNextSession()` before setup-scene show/start. If two calls are in flight, the earlier one can resume later and clear/navigate after the newer intent.
- `src/game/navigation.ts:59-75` starts async navigation; `src/game/navigation.ts:68-72` commits `sessionStore.updateCurrentScene(request.to)` before `scene.scene.start(request.to, request.data)`, and the catch at `src/game/navigation.ts:73-75` reports but does not roll back state if `start` throws.
- `tests/sessionPanelActions.ts:98-116` covers rejected registration preserving session state, but the file's scenarios at `tests/sessionPanelActions.ts:63-134` do not include deferred-promise/out-of-order concurrent panel actions.
- `tests/fullFlowSmoke.ts:60-99` covers async registration failure not starting the scene, but it does not cover synchronous `scene.scene.start(...)` failure after `updateCurrentScene(...)`.
- `package.json` validation scripts in soft-focus show `smoke:test` runs `tests/fullFlowSmoke.ts`, `tests/sessionPersistence.ts`, `tests/sessionRestartLifecycle.ts`, and `tests/sessionPanelActions.ts`; this is useful regression coverage but not a temporal/interleaving proof.

## Investigator Findings
<!-- Pair investigator appends structured findings here with file:line refs, evidence, and conclusions. -->

### 2026-05-06 - Flow final-review async lifecycle gap investigation

#### Question
Why did Flow final review miss soft-focus-style async lifecycle/state-order issues, and how can the plugin improve generally?

#### Ranked synthesis
| Rank | Explanation | Confidence | Basis |
| --- | --- | --- | --- |
| 1 | The main hypothesis is confirmed: a reviewer decision can satisfy runtime final-review gates with changed/test/validation/shared-surface coverage while omitting concrete async race or state rollback proof. | High | Runtime gates require approved final scope, matching depth, broad validation, required reviewed surfaces, evidence strings, evidence refs, and matching validation commands, but no temporal-invariant/proof field or semantic check. |
| 2 | Soft-focus-like artifact sets do not naturally force `integration_points`; generic `src/*` contributes `shared_surfaces`, while tests contribute `tests`, so a detailed review can pass with `changed_files`, `shared_surfaces`, `validation_evidence`, `tests`, plus textual integration/regression checks. | High | Current path rules classify generic source paths as shared area `source`, but integration areas omit generic `src/`; detailed review only requires at least one cross-feature surface and non-empty integration/regression arrays. |
| 3 | Prompt/eval calibration asks for adversarial lifecycle/async review, but scoring still accepts generic failure-mode mentions and connected-context accounting; it does not reject shallow `async/race` language that lacks a concrete lifecycle/state-owner trace. | Medium-high | Prompt wording is strong, but prompt behavior scoring is lexical and packet-boundary oriented, not a temporal-trace proof evaluator. |

#### Evidence

- `src/runtime/transitions/execution-completion-validation.ts:82-111` and `src/runtime/transitions/execution-completion-validation.ts:258-281` show the final completion gate accepts an approved final reviewer decision when scope/depth/coverage checks pass. The gate delegates content adequacy to `describeFinalReviewCoverageFailure(...)`; it does not inspect for async interleavings, state rollback ordering, stale-result guards, or lifecycle traces.
- `src/runtime/domain/final-review-coverage.ts:30-45` defines the final-review target fields: `reviewDepth`, `reviewedSurfaces`, `evidenceSummary`, `validationAssessment`, `evidenceRefs`, optional `reviewContextPack`, `integrationChecks`, `regressionChecks`, gaps, and suggested validation. There is no behavioral-invariant ledger field.
- `src/runtime/domain/final-review-coverage.ts:134-145` requires non-empty `reviewedSurfaces`, `evidenceSummary`, `validationAssessment`, and `evidenceRefs`; `src/runtime/domain/final-review-coverage.ts:159-180` checks referenced artifacts/commands against worker evidence; `src/runtime/domain/final-review-coverage.ts:206-255` checks derived surfaces and artifact-backed surface support. These are evidence-accounting checks, not semantic proof checks.
- `src/runtime/domain/reviewer-decision.ts:20-37` has no temporal proof input. `src/runtime/domain/reviewer-decision.ts:80-131` rejects missing final-review fields, unknown surfaces, and missing detailed-review arrays, but never requires a concrete lifecycle trace, interleaving scenario, rollback invariant, or test oracle that exercises one.
- `src/runtime/schema-review-shared.ts:104-112` and `src/runtime/schema.ts:89-119` expose the same final-review shape through runtime schema; the tool/schema bridge in `src/adapters/opencode/tool-surface/schemas.ts:68-100` extends that shape only with a compact `reviewContextPack`, not behavioral proof fields.
- `src/runtime/domain/review-content-discovery.ts:14-24` includes useful reasons such as `state_owner` and `lifecycle_owner`, and `src/runtime/domain/review-content-discovery.ts:175-198` maps them to review surfaces. But `src/runtime/domain/review-content-discovery.ts:329-355` treats `validation_evidence` as satisfied when a pack command matches recorded validation; it does not ask what behavior the command proves.
- `src/runtime/domain/final-review-coverage-evidence.ts:45-79` derives required surfaces from artifact paths and validation presence. For soft-focus-like paths (`src/dom/...`, `src/game/...`, `src/scenes/...`, `src/shell/...`, `src/observability/...`, `tests/...`) this yields `changed_files`, `validation_evidence`, `tests`, and `shared_surfaces` when validation is recorded; it does not force `integration_points` unless two integration areas are present.
- `src/runtime/domain/final-review-coverage-paths.ts:97-107` classifies generic `src/` as shared area `source` and `tests/` as shared area `tests`; `src/runtime/domain/final-review-coverage-paths.ts:111-119` defines integration areas for `src/runtime/`, prompt/audit prompt paths, tooling/docs/tests/release/operator surfaces, but not generic `src/`. Therefore a non-Flow app's `src/game`/`src/shell` files are not enough to derive `integration_points`.
- `src/runtime/domain/final-review-coverage.ts:71-77` lets detailed review satisfy the cross-feature requirement with `shared_surfaces`; `src/runtime/domain/final-review-coverage.ts:83-105` then only needs at least two surfaces, `validation_evidence`, one cross-feature surface, and non-empty `integrationChecks`/`regressionChecks`.
- `tests/runtime/final-review-contracts.test.ts:500-587` proves the accepted shape: an approved detailed final review with `changed_files`, `shared_surfaces`, `validation_evidence`, generic integration/regression strings, and matching `bun test` evidence completes successfully. The test does not assert any lifecycle ordering proof.
- `tests/final-review-fixtures.ts:4-45` encodes canonical final-review fixture language as “Validation coverage and cross-feature interactions were reviewed” plus generic integration/regression checks. This fixture is strong for coverage accounting but weak as a behavioral proof oracle.
- `tests/completion-gates.test.ts:420-590` covers missing final-review payloads, broad validation, surface derivation, and final-scope decisions. The negative cases are still schema/gate/accounting failures, not “approved review omitted concrete temporal invariant proof.”
- Prompt surfaces do ask for the right behavior: `src/prompts/contracts.ts:142-156`, `src/prompts/fragments.ts:71-72`, `src/audit/prompts/contracts.ts:16-21`, `src/audit/prompts/commands.ts:22-26`, and `src/audit/prompts/fragments.ts:12-13` require adversarial lifecycle/reentrancy/async/event-order review and concrete invariant/failure-path tracing.
- The eval scorer is shallower than the prompt contract: `tests/prompt-behavior-eval-helpers.ts:265-287` treats `async`, `race`, `event order`, `idempot`, etc. as keyword evidence for failure-mode accounting; `tests/prompt-behavior-eval-helpers.ts:308-319` checks only whether those patterns appear in report text for behavior surfaces. It does not verify that a review traced “click -> async action -> lifecycle/state owner -> stale result/rollback oracle.”
- `tests/__fixtures__/review-capture-scenarios/review-scenarios.json:57-92` does include a connected-context scenario requiring caller/click-handler, lifecycle/state owner, related tests, and explicit product-path gap accounting. `tests/review-prompt-capture.test.ts:110-254` verifies connected-context accounting. This catches changed-files-only review but still does not prove a concrete lifecycle interleaving/rollback analysis was performed.
- `tests/__fixtures__/review-capture-scenarios/review-scenarios.json:96-132` adds a general adversarial failure-mode scenario, but it is intentionally broad and does not define a soft-focus-style deferred-promise / out-of-order action / `scene.start()` throw scenario with scoring that rejects generic async-race mentions.
- The standalone audit/report layer is also coverage/accounting oriented: `src/audit/report-schema.ts:27-48` requires evidence refs for directly reviewed surfaces; `src/audit/report-schema.ts:51-84` calibrates finding taxonomy; `src/audit/report-normalizer.ts:69-79` defaults missing validation to `not_run`; `src/audit/report-presenter.ts:194-214` renders validation status and coverage notes. These improve honesty but do not make behavioral proof mandatory.
- Review tools persist already-formed review decisions: `src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts:62-86` parses `flow_review_record_final`, records metadata, and calls `record_final_review`; `src/adapters/opencode/tool-surface/descriptors.ts:442-472` describes this as recording an already-validated final cross-feature decision. The tool surface does not perform semantic review itself.

#### Conclusions

- **Confirmed:** Runtime final-review gates can be satisfied by a polished final review that lists required surfaces, cites changed artifacts and validation commands, provides non-empty `validationAssessment`, and includes non-empty integration/regression strings, while never proving the specific async lifecycle invariant that soft-focus needed.
- **Confirmed:** The current model is excellent at preventing ungrounded final-review claims such as missing paths, unknown validation commands, unsupported surfaces, and changed-files-only packet collapse. It is not designed to prove temporal behavior invariants.
- **Confirmed:** For soft-focus-like changes, broad validation such as `bun run typecheck && bun run smoke:test` can be accurately recorded yet still not prove interleavings unless the review maps commands to behavior classes and names the unproved gaps.
- **Inference:** The likely incident failure mode was not “Flow forgot final review”; it was “Flow accepted final review evidence accounting as sufficient review completion even though the review did not produce an adversarial temporal trace or require tests for pending-action races / state rollback on start failure.”

#### Eliminated or down-ranked hypotheses

- **Eliminated: final review was optional on the completion path.** `src/runtime/transitions/execution-completion-validation.ts:231-242` rejects final completion without `finalReview`, and `src/runtime/transitions/execution-completion-validation.ts:258-281` requires a final-scope recorded reviewer decision.
- **Eliminated: validation refs can cite commands that were not recorded.** `src/runtime/domain/final-review-coverage.ts:159-180` rejects unknown validation command refs, and `tests/runtime/final-review-contracts.test.ts:337-368` verifies validation grounding behavior.
- **Eliminated: reviewContextPack can claim ungrounded connected context without relationships.** `src/runtime/domain/review-content-discovery.ts:420-437` rejects included context not grounded by changed files or relationships; `tests/runtime/final-review-contracts.test.ts:210-283` covers that failure.
- **Down-ranked: prompt wording simply lacks async/lifecycle instructions.** The instructions exist in both runtime reviewer prompts and `/flow-review` audit prompts. The weaker point is enforcement/scoring, not absence of words.
- **Down-ranked: generic `integration_points` derivation should have forced deeper review.** The path rules do not derive `integration_points` for generic `src/*` app files; they derive `shared_surfaces` and `tests`, which is enough for detailed cross-feature accounting.

#### Specific recommendations

1. **Add behavior-invariant review ledger fields.** Extend final-review/reviewContextPack and audit ledger surfaces with a structured `behaviorInvariants` or `temporalChecks` array: `{ invariant, entrypointRefs, stateOwnerRefs, lifecycleOwnerRefs, interleavingOrFailurePath, oracleRefs, validationRefs, result, remainingGap }`. Keep it optional generally, but require it when artifacts/pack hints indicate async lifecycle/state-owner risk.
2. **Map validation commands to behaviors and gaps.** Strengthen `validationAssessment` from prose into structured command-to-behavior coverage: each command should state which behavior classes it proves and which remain unproved. A passing smoke/typecheck command should be allowed but must not imply temporal coverage unless its oracle is named.
3. **Add soft-focus-style review-capture/eval scenario.** Create a providerless scenario with deferred registration, two concurrent panel actions, stale first action overwriting later intent, and `scene.start()` throwing after state update. Score down outputs that mention “async/race” without a concrete interleaving trace, affected state owner, and missing regression oracle.
4. **Harden prompt behavior scoring beyond keywords.** Replace or supplement `FAILURE_MODE_REVIEW_PATTERNS` with specific expectations such as `requiredTraceEvidence`, `stateOwnerTrace`, `lifecycleOwnerTrace`, and `validationGapMapping`. A report should not pass failure-mode accounting merely because it contains “race” or “async.”
5. **Improve generic app path inference.** Add a heuristic that when changed artifacts span multiple generic `src/*` areas plus tests (for example `src/shell`, `src/game`, `src/scenes`), final review should require explicit connected-context/lifecycle mapping even if the existing integration-area taxonomy does not derive `integration_points`.
6. **Make detailed final-review fixtures less generic.** Replace canonical fixture strings like “Checked final cross-feature integration and validation evidence” with examples that name an entrypoint, state/lifecycle owner, failure path, and test oracle. This would calibrate future tests and model outputs toward behavioral proof rather than coverage prose.
7. **Use `remainingGaps` as a first-class non-proof escape hatch.** If a reviewer cannot prove a temporal invariant, it should be required to record the gap explicitly and either block/needs_fix when the invariant is release-critical or recommend exact validation. Do not let an empty `remainingGaps` coexist with applicable untested async lifecycle classes.


## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** The final review likely missed a lifecycle interleaving class because review context and validation evidence emphasized changed files, rejected registration failures, and happy-path smoke/typecheck success rather than adversarial async/state-transition invariants.
**Findings:** Report scaffold created and external facts gathered from Flow history/current mechanisms plus targeted soft-focus file reads.
**Evidence:** `/Users/vriesd/projects/flow-opencode/docs/investigations/final-review-missed-soft-focus-2026-05-06.md`; soft-focus targeted reads of `src/shell/sessionPanels.ts`, `src/shell/sessionPanelActions.ts`, `src/game/navigation.ts`, `tests/sessionPanelActions.ts`, `tests/fullFlowSmoke.ts`, and `package.json`.
**Conclusion:** Confirmed as a plausible incident shape; deeper Flow mechanism analysis required.

### Phase 2 - Broad Context Gathering
**Hypothesis:** Flow's review coverage, review context pack, prompt contracts, and eval harness would explain the miss better than soft-focus validation alone.
**Findings:** `context_builder` selected runtime final-review coverage, review content discovery, schema/tool bridge, prompt/audit contracts, review capture harness, and final-review tests. Initial oracle synthesis identified the central gap as coverage accounting vs temporal invariant proof.
**Evidence:** Oracle chat `final-review-miss-map-272306`; selected files include `src/runtime/domain/final-review-coverage.ts`, `src/runtime/domain/final-review-coverage-paths.ts`, `src/runtime/domain/review-content-discovery.ts`, `src/runtime/domain/reviewer-decision.ts`, `src/adapters/opencode/tool-surface/schemas.ts`, `tests/runtime/final-review-contracts.test.ts`, and `tests/prompt-behavior-eval-helpers.ts`.
**Conclusion:** Confirmed; pair investigation should test whether a shallow but structurally valid final review can pass.

### Phase 3 - Pair Investigator
**Hypothesis:** A final reviewer decision can satisfy runtime gates with changed/test/validation/shared-surface coverage while omitting concrete async race or rollback proof.
**Findings:** Confirmed. Runtime gates require broad validation, passing review, required surfaces, evidence strings, evidence refs, and matching validation commands. They do not require lifecycle traces, interleaving scenarios, stale-result guards, rollback invariants, or behavior-specific test oracles.
**Evidence:** Pair findings above, especially `src/runtime/transitions/execution-completion-validation.ts:220-284`, `src/runtime/domain/final-review-coverage.ts:30-109`, `src/runtime/domain/reviewer-decision.ts:20-131`, `src/runtime/schema-review-shared.ts:104-112`, `src/runtime/schema.ts:89-119`, `src/adapters/opencode/tool-surface/schemas.ts:68-100`, and `tests/runtime/final-review-contracts.test.ts:500-587`.
**Conclusion:** Confirmed.

### Phase 4 - Oracle Synthesis and Spot-Check
**Hypothesis:** Recommendations should focus on making behavior/gap accounting explicit, not pretending runtime can mechanically prove temporal behavior.
**Findings:** Oracle confirmed the root cause and corrected the recommendation framing: use risk-triggered applicable-check/gap accounting, command-to-behavior validation mapping, soft-focus-style calibration scenarios, and scoring that rejects keyword-only async mentions. Spot-checks verified the load-bearing claims.
**Evidence:** `src/runtime/domain/final-review-coverage.ts:30-109`; `src/runtime/domain/final-review-coverage-paths.ts:97-119`; `tests/prompt-behavior-eval-helpers.ts:265-319`; `src/runtime/transitions/execution-completion-validation.ts:220-284`; Oracle chat `final-review-miss-map-272306`.
**Conclusion:** Confirmed and ready for final synthesis.

## Root Cause
Flow/OpenCode final review missed the soft-focus lifecycle defects because its hard completion path proves review accounting rather than temporal behavior proof.

**Evidence:** runtime completion requires broad validation, a passing final review, and an approved final reviewer decision, then delegates adequacy to final-review coverage and reviewer-decision checks. Those checks validate schema fields, reviewed surfaces, changed artifact refs, validation command refs, detailed-review arrays, and optional `reviewContextPack` grounding. They do not require a concrete ledger for async interleavings, stale-result suppression, state commit/rollback, lifecycle-owner traversal, or test-oracle coverage.

**Evidence:** prompt/audit contracts already ask reviewers to inspect lifecycle/reentrancy, async/event ordering, and test-oracle authenticity. The enforcement gap is not absence of words; it is that schemas, coverage gates, and eval scoring are mostly structural or lexical. Current scoring can reward `async`/`race` language without proving the actual path: user entrypoint -> async boundary -> lifecycle/state owner -> failure ordering -> validation oracle/gap.

**Evidence:** soft-focus-like generic app paths can derive `changed_files`, `shared_surfaces`, `tests`, and `validation_evidence` without necessarily deriving `integration_points`, because generic `src/game`, `src/shell`, and `src/scenes` are not integration areas under current Flow path rules.

**Inference:** the incident was likely not a missing-review-process failure. It was a review-readiness signal mismatch: successful validation plus grounded surface coverage looked sufficient, while the defect class required adversarial temporal tracing and explicit unproved-gap accounting.

## Recommendations
1. **P0 — Add risk-triggered behavior invariant accounting.** Add structured final-review/audit fields for applicable temporal checks or explicit gaps. Suggested classes: async race/event ordering, lifecycle reentrancy/idempotency, state commit/rollback, persistence/recovery, and test-oracle authenticity. Runtime should require checked-or-gap accounting, not pretend it can mechanically prove behavior.
2. **P0 — Map validation commands to behaviors proved/unproved.** Strengthen `validationAssessment` from generic prose into command -> behavior coverage/gap mapping. A passing smoke/typecheck command should not imply race/rollback coverage unless the test oracle is named.
3. **P1 — Add a soft-focus-style review capture scenario.** Include deferred async registration, concurrent actions, stale first-result overwrite, state commit before failing start, and tests that cover rejection but not interleaving. Reject outputs that only mention `async` or `race` without tracing the concrete lifecycle/state path and missing oracle.
4. **P1 — Harden prompt behavior scoring beyond keywords.** Supplement `FAILURE_MODE_REVIEW_PATTERNS` with required trace expectations: entrypoint, async boundary, state/lifecycle owner, failure/interleaving path, validation gap.
5. **P1 — Improve generic app connected-context inference.** Do not blindly force `integration_points` for every generic `src/*` change. Instead trigger a connected-context/temporal-risk requirement when multiple generic app domains plus tests are touched, such as `src/shell` + `src/game` + `src/scenes` + `tests`.
6. **P2 — Replace generic final-review fixtures with behavioral examples.** Use examples that name entrypoints, owners, failure paths, validation commands, and remaining gaps rather than generic “cross-feature interactions reviewed” prose.
7. **P2 — Treat `remainingGaps` as a non-proof escape hatch.** Do not allow `remainingGaps: []` to imply behavioral proof when async/lifecycle/state-owner risk is applicable but untested. If temporal behavior was not proven, record the missing invariant/test oracle and either block as `needs_fix` when release-critical or list exact follow-up validation.
8. **P2 — Add negative contract tests for polished but shallow final reviews.** First demonstrate the current gap with a structurally valid review that omits async interleaving/state rollback proof; then lock the desired stricter behavior once invariant/gap accounting is introduced.
9. **P3 — Keep prompt wording, but make examples concrete.** Existing prompt language already asks for adversarial lifecycle/async/test-oracle review; examples and fixture prose should teach the exact trace shape.

## Preventive Measures
- Add a soft-focus-style regression capture for final-review behavior and score it against concrete temporal-path tracing.
- Require behavior/gap accounting for risk-triggered changes involving async actions, lifecycle owners, state commits, persistence/recovery, or product-path tests.
- Review validation as oracle evidence, not command success only: every final review should say what each command proves and what it leaves unproved.
- Prefer explicit `needs_fix` over silent approval when an applicable temporal invariant lacks test or code evidence.
- Periodically audit final-review fixtures for generic “coverage reviewed” language that could train shallow approval patterns.
- Track real final-review misses as calibration cases by promoting them into providerless review packets or prompt-behavior eval fixtures.

## Verification Evidence
- External fact lane for Flow history completed and its findings were recorded in `## Background / Prior Research`.
- soft-focus source evidence was target-read with shell because the sibling repo was outside the explore agent workspace.
- `context_builder` seeded the Flow review/coverage/prompt/eval selection and produced oracle chat `final-review-miss-map-272306`.
- Pair investigator `6AB2B2E9-BEB4-467A-84C7-9BA1C21C4DB5` appended `## Investigator Findings` and reported only the investigation doc changed.
- Load-bearing claims were spot-checked against `src/runtime/domain/final-review-coverage.ts`, `src/runtime/domain/final-review-coverage-paths.ts`, `tests/prompt-behavior-eval-helpers.ts`, and `src/runtime/transitions/execution-completion-validation.ts`.

## Implementation Follow-up — 2026-05-06

Status note: the root-cause, recommendations, and preventive-measure sections above are preserved as pre-implementation findings. The current implementation status is summarized here rather than rewriting the original investigation record.

Flow now treats behavior-sensitive final review as checked-or-gap accounting: when changed artifacts or grounded review context trigger async/event-ordering, lifecycle, state commit/rollback, or test-oracle risk classes, final completion requires `behaviorChecks` entries that either prove the class, mark it not applicable with a concrete boundary, or record a gap with follow-up validation. Runtime still does not mechanically prove temporal correctness; it rejects shallow approval when the reviewer fails to name the entrypoint, owner, failure path, and validation oracle or explicit gap.

Validation evidence is now mapped as an oracle ledger through `validationCoverage`: recorded commands must be tied to behavior classes they prove or leave uncovered, and referenced validation commands must match the worker's actual `validationRun`. This keeps successful commands from standing in for unproven interleavings or rollback paths.
