# Investigation: Complexity Reduction Without Functional Regression

## Summary
The project has real complexity-reduction opportunities, but this pass did **not** find confirmed dead source files or safe broad deletion targets. The best candidates are fixture dedupe, table-driven final-review coverage taxonomy, and shared audit coverage-summary derivation; several apparent duplications are intentional contract surfaces and should be preserved or refactored only behind existing tests/evals.

## Symptoms
- The project has accumulated broad runtime, prompt, tooling, validation, benchmark, and release surfaces.
- The requested investigation is architectural/maintenance-focused rather than a concrete runtime failure.
- Candidate reductions must avoid behavior loss and should be backed by tests/contracts where possible.

## Background / Prior Research
No external fact-gathering required for the initial pass. This investigation is repo-local: current source, tests, docs, fixtures, and project history artifacts.

## Investigator Findings
<!-- Pair investigator appends structured findings here: file:line refs, evidence, conclusions. -->

### Read-only complexity reconnaissance - 2026-05-02

#### Ranked complexity-reduction candidates

1. **Extract one table-driven final-review surface classifier.**
   - Evidence: `src/runtime/domain/final-review-coverage.ts:36-145` defines overlapping path-family classifiers (`isDocsAndPromptsPath`, `isToolingAndConfigPath`, `isReleaseSurfacePath`, `isOperatorSurfacePath`, `isTestPath`, `sharedAreaForPath`, `integrationAreaForPath`), then `deriveRequiredFinalReviewSurfaces` reuses those families for required surfaces at `src/runtime/domain/final-review-coverage.ts:166-238` while `surfaceHasArtifactEvidence` independently maps reviewed surfaces back to artifact evidence at `src/runtime/domain/final-review-coverage.ts:240-274`.
   - Inference: this is the strongest low-risk source-code cleanup because it preserves the existing two-gate model while reducing taxonomy drift when a new path family or final-review surface is added.
   - Protected by: `tests/completion-gates.test.ts:463-609` (derived docs/prompt and test surface failures), `tests/runtime-completion-contracts.test.ts:300-479` (completion recovery/order behavior), `tests/runtime/semantic-invariants.test.ts:326-355` (final-review failure invariants), and `bun run check:completion-lane` called out as the protected completion-gate check in `src/runtime/transitions/execution-completion.ts:1-11`.

2. **Consolidate duplicated final-review shape requirements without merging the gates.**
   - Evidence: reviewer-record validation requires final `reviewDepth`, `reviewedSurfaces`, `evidenceSummary`, `validationAssessment`, `evidenceRefs`, detailed-mode cross-surface coverage, `integrationChecks`, and `regressionChecks` in `src/runtime/transitions/review.ts:219-341`; completion validation then calls `finalReviewDepthMatchesPolicy` and `describeFinalReviewCoverageFailure` for both recorded decisions and worker payloads in `src/runtime/transitions/execution-completion-validation.ts:36-110`.
   - Inference: a shared helper for the detailed-mode field/surface requirements could reduce message/rule drift, but completion-time evidence checks must remain separate because they compare review claims to `worker.artifactsChanged` and `worker.validationRun`.
   - Protected by: `tests/reviewer-decision-scope.test.ts:40-180` (recorded final-review scope/surface validation), `tests/completion-gates.test.ts:206-609` (final path, depth, derived-surface, and recovery-code cases), `tests/runtime-completion-contracts.test.ts:772-1017` (lite/final completion contracts), `tests/runtime-recovery.test.ts:82-149`, `tests/cross-area/recovery-errorcode-matrix.test.ts:14-35`, and `tests/protocol-parity.test.ts:122-125`.

3. **Deduplicate final-review test/bench fixture builders.**
   - Evidence: the exact string `Validation coverage and cross-feature interactions were reviewed.` appears 51 times across `tests`, `bench`, and `src` by `rg`; repeated payload shapes appear in `tests/completion-gates.test.ts:100-130`, `tests/completion-gates.test.ts:300-609`, `tests/runtime-completion-contracts.test.ts:316-338`, `tests/runtime-completion-contracts.test.ts:607-729`, `tests/runtime-tools.test.ts:1167-1313`, `tests/cross-area/manual-flow.test.ts:120-144`, and `bench/fixtures.ts:160-239`.
   - Inference: moving the canonical approved final decision / passing finalReview payload to test helpers would remove fixture noise while keeping scenario-specific overrides local.
   - Protected by: the same runtime completion tests above plus `tests/render-fixtures.test.ts` and committed render goldens such as `tests/__fixtures__/render/all-completed/features/feature-5.md:56-84`, which intentionally pin rendered wording from `bench/fixtures.ts`.

4. **Return a reusable coverage summary from the audit normalizer for the presenter.**
   - Evidence: `src/audit/report-normalizer.ts:6-123` owns required full-audit categories, direct-review-with-evidence detection, missing full-audit categories, achieved-depth downgrades, and synthesized `not_run` validation; `src/audit/report-presenter.ts:209-252` recomputes directly reviewed/spot-checked/unreviewed counts, direct categories, missing full-audit categories, and full-audit eligibility for display.
   - Inference: expose normalized coverage metadata from `normalizeReviewReport` or a sibling helper so rendering does not rederive the same category set.
   - Protected by: `tests/runtime-tools.test.ts:1635-1889` and `tests/runtime-tools.test.ts:1904-2110` (deterministic render output, downgrade behavior, `not_run`, full-audit eligibility, category preservation), `tests/config.test.ts:790-823` (audit contract wording), and `tests/prompt-behavior-eval-helpers.ts:248-324` (behavior-eval scoring uses normalized + rendered reports).

5. **Thin or retire legacy exports in `src/runtime/application/tool-runtime.ts` after a focused API check.**
   - Evidence: `tool-runtime.ts` wraps `session-engine` with JSON/context helpers at `src/runtime/application/tool-runtime.ts:22-146`, while current named dispatchers live in `session-actions.ts`, `session-read-actions.ts`, and `session-workspace-actions.ts`. Word-boundary `rg` found no repo callers for `withSession`, `persistTransition`, or `withPersistedTransition` outside the `src/runtime/application/index.ts` barrel; `executeSessionMutation`, `runSessionMutationAction`, and `missingSessionResponse` are used by `tests/session-engine.test.ts`, and `parseToolArgs` is actively used by `src/tools/parsed-tool.ts:45-86` and `src/tools/runtime-tools/review-tools.ts:106-114`.
   - Inference: `withSession`/`persistTransition`/`withPersistedTransition` are possible stale public-barrel exports, but not dead-code findings unless package-consumer API compatibility is intentionally narrowed.
   - Protected by: `tests/session-engine.test.ts:74-170` for missing-session, persistence, sync, typed result, and JSON serialization behavior; `tests/session-engine.test.ts:188-322` for named dispatched mutation/read/workspace paths.

6. **Keep session action wrapper centralization, but consider a generic factory only if it stays clearer.**
   - Evidence: the three wrappers share the same shape: action-name tuple, payload/value maps, handler map, dispatch function, execute function, and run function in `src/runtime/application/session-actions.ts:34-383`, `src/runtime/application/session-read-actions.ts:16-121`, and `src/runtime/application/session-workspace-actions.ts:57-264`; all route through root executors in `src/runtime/application/session-engine.ts:130-276`.
   - Inference: there is visible boilerplate, but the current split documents three different runtime port semantics (mutation, read, workspace). This is lower priority than fixture/classifier cleanup because over-generalizing could obscure action-specific typing and permissions.
   - Protected by: catalog parity and dispatch tests in `tests/session-engine.test.ts:32-72`, mutation tests at `tests/session-engine.test.ts:74-230`, read tests at `tests/session-engine.test.ts:236-274`, and workspace tests at `tests/session-engine.test.ts:282-322`.

#### Candidates that look intentional / should not be simplified first

- **Do not collapse reviewer-record validation and completion validation into one gate.** `src/runtime/transitions/review.ts:219-341` validates reviewer decision shape at record time; `src/runtime/transitions/execution-completion-validation.ts:36-110` validates a recorded decision and worker finalReview against actual current-run artifacts/validation. The overlap is contract-protective, not purely accidental.
- **Do not aggressively deduplicate prompt policy wording first.** `src/audit/prompts/fragments.ts:1-22` deliberately shares audit prompt rules into `src/audit/prompts/agents.ts:27-58` and `src/audit/prompts/commands.ts:8-39`, while tests pin exact snippets and snapshots in `tests/config.test.ts:790-823`, `tests/config.test.ts:869-883`, `tests/config.test.ts:966-983`, and `tests/prompt-snapshot.test.ts:17-21`. Main workflow prompts also intentionally mirror runtime final-completion policy from `src/runtime/domain/workflow-policy.ts:5-9` into `src/prompts/fragments.ts:29-78`, `src/prompts/contracts.ts:68-101`, and `src/prompts/mode-contracts.ts:262-302`.
- **Do not treat `.factory/**` as wholesale dead code.** Evidence supports a mixed status: `git ls-files '.factory/**'` reports 69 tracked files; `biome.json:3-4` explicitly excludes `.factory` from lint/format; package scripts in `package.json:12-31` do not call `.factory`; repo references outside `.factory` are tests using `.factory` as a hidden-workspace sentinel plus prompt-eval assertions that fixtures must not include `.factory` (`tests/helpers.test.ts:78-128`, `tests/workspace-root-guard.test.ts:39-73`, `tests/runtime-tools.test.ts:607-758`, `tests/prompt-eval-corpus.test.ts:27-28`, `tests/prompt-mode-behavior-eval.test.ts:30-31`, `tests/prompt-behavior-eval.test.ts:22-23`). Inference: `.factory/validation/**` reads archival, while `.factory/library/**`, `.factory/services.yaml`, and `.factory/skills/**` remain process/support artifacts outside active package runtime.

#### Dead-code / unused-code findings

- `bun run deadcode` completed successfully with `knip --include files,dependencies` and reported no unused files/dependencies. Therefore no dead-code removal is recommended from this pass.
- Supported possible-unused API note: `rg` found `withSession`, `persistTransition`, and `withPersistedTransition` only in `src/runtime/application/tool-runtime.ts` and the re-export barrel `src/runtime/application/index.ts`; treat these as public API compatibility candidates, not dead code, unless a release/API review permits removal.

#### Concise priority conclusion

Highest value / lowest risk cleanup order: (1) extract final-review fixture builders in tests/bench, because it removes large repeated payloads while preserving behavior; (2) table-drive `final-review-coverage.ts` path/surface classification, because it reduces taxonomy drift behind strong completion-gate tests; (3) share audit coverage-summary derivation between normalizer and presenter. Defer prompt wording consolidation and session-wrapper abstraction until after these because those areas are intentionally contract- and snapshot-pinned.

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** Complexity reduction opportunities likely cluster around duplicated runtime transitions, prompt/audit surfaces, session/tool wrapper layers, fixture/golden generation, and validation artifacts.
**Findings:** External web/docs are not needed for the initial question; repo-local evidence should be sufficient. Git archaeology may be useful only if a candidate looks historically intentional.
**Evidence:** User-provided file map shows dense areas under `src/runtime`, `src/tools`, `src/prompts`, `src/audit/prompts`, and large test/fixture surfaces.
**Conclusion:** Proceed to Context Builder, then pair investigation, then oracle synthesis.

## Root Cause
The strongest source of reducible complexity is not unused code; it is **policy taxonomy and validation shape repeated across adjacent layers**:

- Final-review surface taxonomy is encoded in multiple directions in `src/runtime/domain/final-review-coverage.ts:36-274`: path classifiers, required-surface derivation, and artifact-evidence mapping. This increases drift risk when adding or changing a surface category.
- Final-review shape requirements appear in both reviewer-record validation (`src/runtime/transitions/review.ts:219-341`) and completion validation (`src/runtime/transitions/execution-completion-validation.ts:36-110`). The gates are intentionally separate, but shared helper extraction could reduce wording/rule drift.
- Audit full-coverage/category eligibility is derived in the normalizer (`src/audit/report-normalizer.ts:6-123`) and rederived for display in the presenter (`src/audit/report-presenter.ts:209-252`).
- Final-review fixture payloads are repeated heavily across tests and benchmarks; the canonical validation string appears 51 times across `tests`, `bench`, and `src`.

No confirmed dead-code removal is recommended: `bun run deadcode` completed successfully, and possible-unused `tool-runtime.ts` helpers remain barrel-exported API compatibility candidates rather than proven dead code.

## Recommendations
1. **High confidence / low risk — extract final-review test and benchmark fixture builders.** Start with repeated approved final-review decisions and passing `finalReview` payloads in `tests/completion-gates.test.ts`, `tests/runtime-completion-contracts.test.ts`, `tests/runtime-tools.test.ts`, `tests/cross-area/manual-flow.test.ts`, and `bench/fixtures.ts`. Preserve scenario-specific overrides and render golden expectations.
2. **High confidence / medium risk — table-drive `src/runtime/domain/final-review-coverage.ts`.** Keep the current behavior, but centralize path families, required surfaces, shared areas, integration areas, and artifact-evidence checks so taxonomy changes happen in one place. Protect with completion-gate and semantic-invariant tests.
3. **High confidence / low-to-medium risk — share audit coverage-summary derivation.** Move direct/spot/unreviewed counts, missing full-audit categories, and full-audit eligibility into a helper used by both `report-normalizer.ts` and `report-presenter.ts`. Preserve downgrade notes and rendered wording.
4. **Medium confidence / medium-high risk — extract only limited final-review shape helpers.** Do not merge reviewer-record and completion gates. Share only common final-review field/surface requirement checks where semantics remain identical.
5. **Medium confidence / medium risk — review `tool-runtime.ts` legacy helpers as public API cleanup, not dead code.** `withSession`, `persistTransition`, and `withPersistedTransition` look unused internally except for barrel export, but removal needs an explicit API/release review.
6. **Defer or avoid early prompt/session-wrapper dedupe.** Prompt wording is snapshot/eval-pinned, and session action wrappers preserve mutation/read/workspace authority boundaries. Treat both as intentional duplication unless a targeted refactor proves equal behavior and readability.
7. **Do not classify `.factory/**` as dead code.** It is excluded from lint/package scripts and much of it appears archival/process-oriented, but it is tracked and used as hidden-workspace sentinel material in tests.

## Preventive Measures
- Keep the ownership rule explicit: runtime/domain owns policy; tools, prompts, docs, and presenters mirror or render it.
- Prefer table-driven taxonomies for review surfaces, audit categories, and path-family rules.
- Add or reuse fixture builders before introducing new final-review test scenarios.
- Require `bun run deadcode` before claiming dead-code removal.
- Treat prompt changes as contract changes; run snapshots/evals before claiming simplification.
- Preserve separate mutation/read/workspace port boundaries unless a generic abstraction keeps permission semantics obvious.
- Keep `.factory` out of runtime/package/lint assumptions, but review process artifacts before deletion.

## Investigation Log Addendum

### Phase 4 - Oracle Synthesis
**Hypothesis:** Pair findings identify real simplification candidates but may overstate dead-code or collapse opportunities.
**Findings:** Oracle confirmed the top recommendations and downgraded broad deletion, prompt dedupe, session-wrapper abstraction, and final-review gate merging.
**Evidence:** Current selection included the pair report plus runtime, audit, tool, prompt, and protection-test files. Oracle synthesis aligned with spot-checked source references.
**Conclusion:** Confirmed: prioritize fixture dedupe, final-review taxonomy table-driving, and shared audit coverage summary. Eliminated: broad dead-code deletion and prompt/session-wrapper collapse as first-pass cleanups.

### Phase 5 - Verification Spot Checks
**Hypothesis:** Load-bearing claims in the pair/oracle findings can be verified with direct source reads and one dead-code command.
**Findings:** Verified the final-review classifier/mapping concentration, reviewer/completion gate distinction, audit coverage re-derivation, repeated fixture string count, `.factory` lint/package-script status, and deadcode command result.
**Evidence:** `src/runtime/domain/final-review-coverage.ts:36-274`; `src/runtime/transitions/review.ts:219-341`; `src/runtime/transitions/execution-completion-validation.ts:36-110`; `src/audit/report-normalizer.ts:1-123`; `src/audit/report-presenter.ts:209-252`; `biome.json:1-20`; `package.json:12-31`; `bun run deadcode` exited 0 with `knip --include files,dependencies`; `rg` found 51 matches for `Validation coverage and cross-feature interactions were reviewed.`
**Conclusion:** Evidence supports complexity reduction, not broad deletion.

### Phase 6 - Ralph Hook Fresh Verification
**Hypothesis:** The investigation artifact can be stopped only after fresh verification confirms the repo remains healthy and the report-only change did not hide source failures.
**Findings:** Full test suite passed after the report was written.
**Evidence:** `bun run test -- --timeout 30000` exited 0 with `424 pass`, `0 fail`, `1 snapshots`, `3744 expect() calls`, across `60 files`.
**Conclusion:** Fresh verification confirms the read-only investigation remains consistent with the existing test suite.

### Phase 7 - Full Project Check Verification
**Hypothesis:** The completed investigation can be closed after the repo's full quality gate passes with only the report artifact changed.
**Findings:** Full project check passed after the report was updated.
**Evidence:** `bun run check` exited 0. It ran typecheck, review/prompt capture checks, dependency contract, deadcode, build, release hygiene, pack invariants, cold-start budget, bundle sanity, full tests (`424 pass`, `0 fail`, `60 files`), Biome lint (`Checked 179 files`), and `bench:smoke`.
**Conclusion:** Strongest available local verification is green; remaining work is follow-up implementation of the report recommendations, not further investigation.

### Phase 8 - OMX Ralph State Cleanup
**Hypothesis:** The active Ralph loop should be terminalized after verified completion so the stop hook does not continue requesting redundant verification.
**Findings:** Current session Ralph state was marked terminal after `bun run check` passed.
**Evidence:** `.omx/state/sessions/019de7f0-8bc5-7f51-aa11-f1896731cf2b/ralph-state.json` now has `active=false`, `current_phase="cancelled"`, and `completed_at="2026-05-02T09:23:20.083Z"`; matching `skill-active-state.json` has `active=false` and `phase="cancelled"`.
**Conclusion:** Ralph state cleanup completed for this session after verification.

### Phase 9 - Implementation Pass
**Hypothesis:** The top three recommendations can be implemented as behavior-preserving cleanup without collapsing intentionally separate gates.
**Findings:** Implemented fixture dedupe, table-driven final-review taxonomy, and shared audit coverage-summary derivation. No confirmed source dead-code deletion was introduced beyond removing the now-unused internal `fullAuditRequiredCategories` export after the presenter stopped importing it.
**Evidence:** Changed files: `tests/final-review-fixtures.ts`, `tests/completion-gates.test.ts`, `bench/fixtures.ts`, `src/runtime/domain/final-review-coverage.ts`, `src/audit/report-normalizer.ts`, and `src/audit/report-presenter.ts`. Full `bun run check` passed after formatting. Oracle review found no concrete P0/P1/P2 findings.
**Conclusion:** The recommended cleanup was implemented with preserved behavior and green project verification.

### Phase 10 - Deferred Risk Follow-up
**Hypothesis:** The remaining medium-risk items can be reduced without deleting compatibility API or merging intentionally separate final-review gates.
**Findings:** Kept `tool-runtime.ts` helpers as explicit application-layer compatibility adapters, added a protocol-parity test that locks their barrel-exported presence, and extracted shared detailed-final-review requirement predicates used by both reviewer-record validation and completion-time final-review coverage checks. Reviewer-record and completion validation still render their own gate-specific messages and remain separate.
**Evidence:** Changed files: `src/runtime/application/tool-runtime.ts`, `tests/protocol-parity.test.ts`, `src/runtime/domain/final-review-coverage.ts`, `src/runtime/domain/index.ts`, and `src/runtime/transitions/review.ts`. Targeted tests passed: `bun test tests/runtime-tools.test.ts tests/runtime-completion-contracts.test.ts tests/completion-gates.test.ts tests/protocol-parity.test.ts --timeout 30000` with `113 pass`, `0 fail`. Full `bun run check` passed with typecheck, prompt capture checks, dependency contract, deadcode, build, release hygiene, pack invariants, cold-start budget, bundle sanity, full tests (`425 pass`, `0 fail`, `60 files`), Biome, and bench smoke. Oracle review found no concrete P0/P1/P2 findings.
**Conclusion:** Deferred risks are reduced by making compatibility intentional and sharing only identical detailed-review predicates; no risky API deletion or gate collapse was introduced.

### Phase 11 - Legacy Adapter Deletion
**Hypothesis:** After the focused API review, `src/runtime/application/tool-runtime.ts` can be deleted because the package entrypoint exposes the default plugin, active source callers can import owner modules directly, and session-engine tests can target the root engine instead of the stale JSON/context adapter.
**Findings:** Removed the `tool-runtime.ts` adapter and its application-barrel exports; moved `errorResponse`, `parseToolArgs`, and `toJson` imports in active tool code to `runtime/errors` and `runtime/application/workspace-runtime`; updated session-engine tests to exercise `executeSessionMutationAtRoot` / `runSessionMutationActionAtRoot` directly; removed the compatibility-helper parity test that intentionally protected the deleted exports.
**Evidence:** Changed files: `src/runtime/application/index.ts`, deleted `src/runtime/application/tool-runtime.ts`, `src/tools/parsed-tool.ts`, `src/tools/runtime-tools/review-tools.ts`, `tests/protocol-parity.test.ts`, and `tests/session-engine.test.ts`. Focused search found no active source/test references to `tool-runtime.ts` or the deleted wrapper exports. Targeted tests passed: `bun test tests/session-engine.test.ts tests/protocol-parity.test.ts tests/runtime-tools.test.ts tests/runtime-completion-contracts.test.ts tests/completion-gates.test.ts --timeout 30000` with `127 pass`, `0 fail`. `bun run typecheck` passed. Full `bun run check` passed with typecheck, capture checks, dependency contract, deadcode, build, release hygiene, pack invariants, cold-start budget, bundle sanity, full tests (`424 pass`, `0 fail`, `60 files`), Biome, and bench smoke. Oracle review found no concrete P0/P1/P2 findings.
**Conclusion:** The remaining legacy adapter cleanup is complete; the root engine remains tested and runtime tools no longer depend on a stale compatibility barrel.

### Phase 12 - Public Package Boundary Guard
> **Historical snapshot note (2026-05-02):** This phase records evidence captured when package version was `1.0.44`. Current package version is `1.0.48`.

**Hypothesis:** The remaining deep-import compatibility risk can be reduced without restoring the deleted adapter by making the supported package API explicit and guarding it in release checks.
**Findings:** Added a package `exports` map that exposes only the root plugin entry (`.` -> `./dist/index.js`), extended pack invariants to fail if `main` or `exports` drift, added a regression for accidental public-surface widening, and updated maintainer docs that still referenced the removed `tool-runtime.ts` adapter.
**Evidence:** Changed files: `package.json`, `scripts/cross-area/pack-invariants.mjs`, `tests/cross-area/pack-invariants.test.ts`, and `docs/development.md`. Baseline `bun test tests/cross-area/pack-invariants.test.ts --timeout 30000` passed before editing with `3 pass`, `0 fail`. After editing, root package import smoke passed (`import('opencode-plugin-flow')` exposes the default plugin) and deep dist import smoke failed as intended with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Targeted tests passed: `bun test tests/cross-area/pack-invariants.test.ts tests/smoke/dist-load.test.ts --timeout 30000` with `5 pass`, `0 fail`. `bun run typecheck` passed. `bun run check:pack-invariants` passed with 6 expected files and version `1.0.44` (historical at capture time).
**Conclusion:** Unsupported deep imports are now mechanically fenced by the package export map and release invariant; the supported public API remains the root OpenCode plugin entry.
