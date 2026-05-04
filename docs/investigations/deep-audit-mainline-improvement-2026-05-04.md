# Investigation: Deep Audit + Mainline Improvement Plan

## Summary
The repository is operationally strong on correctness gates, but the dominant current risk is coordination complexity: stale governance text, overlapping gate orchestration, advisory-vs-blocking gate ambiguity, and concentrated runtime churn in a few contract/session/transition files. Improvement should prioritize process/truth synchronization and verification-lane simplification before high-risk runtime refactors.

## Symptoms
- High architectural/process complexity despite strong quality gates.
- Runtime hotspot churn and governance overhead risk slowing delivery.
- Team wants deep investigation and improvement plan while working directly on `main` (no PR workflow during this effort).

## Background / Prior Research

- External git-archaeology explore agent could not access `.git` metadata in its session; useful only for broad directional signals (low-confidence for commit-level claims).
- Release/gate explore agent appears to have inspected a different repository (`anomalyco/opencode`) rather than this workspace (`flow-opencode`); findings were discarded as non-applicable.
- Verified in this workspace directly: recent commit burst includes large same-day refactors and simplification (`e03f838`, `8ad6a95`, `6cb5bb5`, `b230a87`) with substantial churn and stabilization follow-ups.

## Investigator Findings

### Confirmed findings

1. **Dominant risk is better characterized as complexity tax / contract drift than active correctness failure.** Current local evidence shows the key correctness sentinels are green: `bun run report:runtime-simplification-metrics` reported `seamViolationCount: 0`, `bun run check:architecture-seams` reported no blocked cross-layer imports, and `bun run check:boundary-report` passed 28 tests / 0 failures. The stronger repo evidence is not missing gates; it is the number of overlapping gates and documents/contracts that must stay synchronized.

2. **Governance drift exists in the seam ADR, not in the seam implementation.** `docs/architecture/allowed-cross-layer-dependencies.md:3-5` still labels the seam policy as a Phase 1 report-first baseline, and `docs/architecture/allowed-cross-layer-dependencies.md:33-50` describes switching CI to `check:architecture-seams:enforce` only after violations reach zero. Actual project wiring has already switched: `package.json:24-27` defines both report and enforce seam scripts, `package.json:46` includes `check:architecture-seams:enforce` inside the full local gate, and `.github/workflows/ci.yml:116-117` runs the enforce gate directly. The checker supports both modes mechanically in `scripts/cross-area/architecture-seams.mjs:7-20` and exits nonzero in enforce mode at `scripts/cross-area/architecture-seams.mjs:119-123`; tests cover report-mode success, enforce-mode failure, and clean enforce-mode success in `tests/cross-area/architecture-seams.test.ts:60-123`.

3. **CI and local gates duplicate substantial work.** The validate job runs focused gates first: completion lane, generated drift, architecture seams, boundary report, replay, and benchmark gate at `.github/workflows/ci.yml:110-129`. The same job then runs `bun run check` at `.github/workflows/ci.yml:128-129`, whose package script repeats several of those gates (`check:generated-drift`, `check:architecture-seams:enforce`, `gate:completion-lane`, `test:replay`, `bench:gate`) inside `package.json:46`. This is coordination cost: a failure can surface twice, gate order exists in two places, and mainline pushes must reason about both the local all-in-one contract and the CI preflight contract.

4. **One boundary gate is intentionally report-only, which increases policy interpretation load.** CI calls `bun run check:boundary-report` at `.github/workflows/ci.yml:119-120`, but `scripts/cross-area/boundary-violations-report.mjs:16-27` warns on failure and always exits `0`. That may be acceptable as a supplemental report, but it means the project has both hard gates and advisory gates in the same validate sequence; the improvement plan should either promote it intentionally or label it clearly as non-blocking wherever gate status is documented.

5. **Runtime hotspot concentration is real, but the current simplification trend is already improving the LOC concentration metric.** `docs/architecture/simplification-scoreboard.md:14-18` records post-pass movement from 56 runtime files / 11,239 LOC / 27.1% top-5 share to 57 runtime files / 11,264 LOC / 24.6% top-5 share. A fresh run of `bun run report:runtime-simplification-metrics` on 2026-05-04 reported 89 runtime files, 11,700 runtime LOC, only 1 runtime file >= 300 LOC, and 12.7% top-5 LOC share. The measurement script directly computes runtime LOC, files >= 300 LOC, top-5 LOC share, git churn, and seam count in `scripts/cross-area/runtime-simplification-metrics.mjs:59-100`.

6. **Churn remains concentrated even after size concentration improved.** The fresh metrics run reported top churn in `src/runtime/schema.ts` (19 changes), `src/runtime/session-workspace.ts` (18), `src/runtime/session-lifecycle.ts` (17), `src/runtime/transitions/plan.ts` (16), and `src/runtime/render-index-sections.ts` (14). This supports a mainline improvement plan focused on contract consolidation and ownership clarity around runtime schema/session/transition/render seams rather than broad correctness repair.

7. **The packet-hook simplification plan addresses a separate coordination hotspot, not the runtime churn hotspot.** `.omx/plans/packet-hook-simplification-2026-05-04.md:3-11` targets prompt packet / OpenCode command-argument hook complexity, fail-closed template replacement, and a single command-rendering source of truth. Its concrete targets are command/prompt/plugin/capture surfaces (`.omx/plans/packet-hook-simplification-2026-05-04.md:23-71`), while the current runtime churn leaders are under `src/runtime/**`. This means it is still useful for reducing contract drift, but it should not be counted as the runtime hotspot simplification loop.

### Eliminated hypotheses

- **“Seams are only advisory.”** Eliminated. The ADR text is stale, but `package.json:46` and `.github/workflows/ci.yml:116-117` already hard-enforce seams, and `scripts/cross-area/architecture-seams.mjs:119-123` exits with failure in enforce mode.
- **“The dominant current risk is obvious correctness defects in the checked surfaces.”** Not supported by this pass. Seam enforcement, boundary-report tests, and current simplification metrics all ran green locally; the stronger evidence points to maintaining many synchronized contracts and gates.
- **“The existing packet-hook plan will resolve runtime hotspot churn.”** Eliminated. `.omx/plans/packet-hook-simplification-2026-05-04.md:42-71` targets command renderer registration, capture tooling, and packet tags; it does not target `src/runtime/schema.ts`, `src/runtime/session-workspace.ts`, `src/runtime/session-lifecycle.ts`, `src/runtime/transitions/plan.ts`, or `src/runtime/render-index-sections.ts`.
- **“The project lacks a measurable simplification loop.”** Eliminated. `docs/architecture/simplification-scoreboard.md:30-41` defines a recurring metric -> one hotspot -> smallest safe simplification -> targeted verification loop, and `scripts/cross-area/runtime-simplification-metrics.mjs:77-100` implements the measurement basis.

### Exact file targets for fixes on `main`

1. **Update stale governance wording:** `docs/architecture/allowed-cross-layer-dependencies.md:3-50` should be revised from “Phase 1 report-first / future switch” to “enforced baseline with report-mode diagnostics.” Keep the limitation notes at `docs/architecture/allowed-cross-layer-dependencies.md:52-56` unless the checker scope changes.
2. **De-duplicate gate orchestration:** choose one source of truth between `.github/workflows/ci.yml:110-129` and `package.json:46`. For direct-on-main work, prefer keeping `bun run check` as the local/mainline contract and make CI either run that once plus artifacts, or split the package scripts so CI’s focused preflights do not repeat inside the final all-in-one step.
3. **Clarify or promote the advisory boundary report:** either document `scripts/cross-area/boundary-violations-report.mjs:16-27` as non-blocking in `docs/development.md` / `docs/maintainer-contract.md`, or convert it to a true gate with tests updated accordingly.
4. **Separate the two simplification lanes:** keep `.omx/plans/packet-hook-simplification-2026-05-04.md:23-71` for prompt/plugin/capture contract drift, but create a runtime-specific mainline slice for the fresh churn leaders: `src/runtime/schema.ts`, `src/runtime/session-workspace.ts`, `src/runtime/session-lifecycle.ts`, `src/runtime/transitions/plan.ts`, and `src/runtime/render-index-sections.ts`.
5. **Refresh hotspot documentation after each mainline slice:** update `docs/architecture/simplification-scoreboard.md:14-50` from the current `report:runtime-simplification-metrics` output so docs do not lag the rapid same-day simplification passes.

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** The project is high-quality but accumulating complexity tax in runtime/contracts/generated surfaces.
**Findings:** Initial repo review confirms strong gating and active simplification intent; deeper investigation in progress.
**Evidence:** README.md, package.json, .github/workflows/ci.yml, docs/architecture/simplification-scoreboard.md, docs/maintainer-contract.md
**Conclusion:** Needs deeper cross-file and git-history-backed analysis.

### Phase 2 - Fresh Verification Evidence (mainline entry lane)
**Hypothesis:** Current baseline gates are healthy; dominant risk remains coordination complexity rather than active correctness failures.
**Findings:** Full entry lane passed on 2026-05-04. Metrics snapshot: seam violations `0`, runtime files `89`, runtime LOC `11,700`, top-5 LOC share `12.7`, churn leaders `schema.ts`, `session-workspace.ts`, `session-lifecycle.ts`, `transitions/plan.ts`, `render-index-sections.ts`.
**Evidence:** `bun run report:runtime-simplification-metrics` (capturedAt `2026-05-04T21:28:31.519Z`), `bun run check:architecture-seams:enforce`, `bun run check:dependency-contract`, `bun run gate:completion-lane` (74 pass, 0 fail), `bun run test:fast` (18 pass, 0 fail), `bun run test:replay` (15 pass, 0 fail).
**Conclusion:** Baseline is green; proceed with P0/P1 process and governance simplification before higher-risk runtime refactors.

### Phase 3 - Fresh Verification Evidence (full release-grade gate)
**Hypothesis:** Full quality/release guardrails are still green after investigation updates; no hidden regressions in docs/contracts/runtime/test/bench surfaces.
**Findings:** Full verification passed end-to-end on 2026-05-04: docs parity tests green, full `bun run check` green, full suite green, lint green, bench smoke and bench gate green, cold-start and bundle sanity green.
**Evidence:**
- `bun test tests/docs-stale-reference-policy.test.ts tests/docs-semantic-parity.test.ts tests/docs-tool-parity.test.ts` → 6 pass, 0 fail.
- `bun run check` → success; includes `typecheck`, prompt/review capture checks, dependency contract, seams enforce, release hygiene, pack invariants, completion lane, replay, cold-start budget, bundle sanity, full `bun test`, lint, bench smoke, bench gate.
- `bun test` (inside `check`) → 509 pass, 0 fail across 88 files.
- `bunx biome check src tests bench ...` → clean.
- `node ./scripts/cross-area/bench-gate.mjs` → passed for 17 baseline rows.
**Conclusion:** Evidence remains consistent with investigation conclusions: correctness guardrails are strong; principal improvement opportunity is reducing coordination complexity and keeping governance/docs in sync with enforced behavior.

### Phase 4 - Fresh Verification Evidence (coordination-risk claims)
**Hypothesis:** Coordination-risk claims are verifiable in runtime scripts/workflow wiring: advisory-vs-blocking distinction exists and some gate overlap is real.
**Findings:**
- `check:boundary-report` remains advisory in behavior: script run passed with `boundary_exit=0` after running its test bundle.
- Architecture seams pass in both report and enforce modes (`seams_report_exit=0`, `seams_enforce_exit=0`), confirming enforce-mode is active and healthy on current code.
- Repeated gate overlap between CI validate steps and `package.json` `check` exists for: `gate:completion-lane`, `check:architecture-seams:enforce`, `test:replay`, and `bench:gate`.
**Evidence:**
- `node ./scripts/cross-area/boundary-violations-report.mjs; echo boundary_exit=$?` → `boundary_exit=0`.
- `FLOW_ARCH_SEAMS_MODE=report node ./scripts/cross-area/architecture-seams.mjs; echo seams_report_exit=$?` → `0`.
- `FLOW_ARCH_SEAMS_MODE=enforce node ./scripts/cross-area/architecture-seams.mjs; echo seams_enforce_exit=$?` → `0`.
- Node overlap probe across `.github/workflows/ci.yml` and `package.json` printed repeated gates: `gate:completion-lane, check:architecture-seams:enforce, test:replay, bench:gate`.
**Conclusion:** Fresh evidence reinforces that current risk is orchestration/coordination complexity rather than failed quality enforcement.

### Phase 5 - Fresh Verification Evidence (contract guardrails)
**Hypothesis:** Contract-level guardrails (seams, dependency alignment, prompt contracts, tool schemas) remain stable and enforceable on the current mainline baseline.
**Findings:** Targeted guardrail suite passed cleanly (39 pass, 0 fail), including seam-mode behavior tests and dependency drift-failure checks.
**Evidence:** `bun test tests/cross-area/architecture-seams.test.ts tests/cross-area/dependency-contract.test.ts tests/config/prompt-contracts.test.ts tests/config/tool-schemas.test.ts`.
**Conclusion:** The investigation’s risk framing remains unchanged: correctness/contract gates are healthy; improvement priority is process/gate/documentation synchronization and controlled hotspot simplification.

### Phase 6 - Fresh Verification Evidence (runtime hotspot pressure)
**Hypothesis:** Current runtime hotspot/churn claims remain true under a fresh metrics capture and core invariant/persistence/replay checks.
**Findings:** Fresh metrics capture remained stable at seam violations `0`, runtime files `89`, runtime LOC `11,700`, top-5 share `12.7`, with unchanged churn leaders (`schema.ts`, `session-workspace.ts`, `session-lifecycle.ts`, `transitions/plan.ts`, `render-index-sections.ts`). Core semantic/completion/persistence/replay checks passed cleanly.
**Evidence:**
- `bun run report:runtime-simplification-metrics` (capturedAt `2026-05-04T21:30:51.754Z`).
- `bun test tests/runtime/semantic-invariants.test.ts tests/runtime/final-completion-gates.test.ts tests/runtime/workflow-persistence.test.ts tests/replay/property-invariants.test.ts` → 21 pass, 0 fail.
**Conclusion:** Hotspot pressure evidence is fresh and consistent; no new correctness regressions observed in core runtime invariants/persistence/replay paths.

### Phase 7 - Fresh Verification Evidence (state + lifecycle stability)
**Hypothesis:** Session-state safety and install/release lifecycle remain stable under fresh targeted verification.
**Findings:** Persistence/history/lifecycle smoke checks all passed, including stored-root recovery behavior, session history ordering, dist bundle load contract, and release install/uninstall lifecycle.
**Evidence:** `bun test tests/runtime-session-persistence.test.ts tests/session-history.test.ts tests/cross-area/install-lifecycle.test.ts tests/smoke/dist-load.test.ts` → 16 pass, 0 fail.
**Conclusion:** Additional independent evidence confirms operational stability; investigation conclusions remain unchanged (quality gates are healthy, coordination complexity is the main improvement target).

### Phase 8 - Fresh Verification Evidence (generated drift + performance gates)
**Hypothesis:** Generated-surface parity and performance/budget guardrails remain healthy, supporting release confidence while process simplification is planned.
**Findings:** Generated drift checks passed (review/prompt capture scenario checks green; descriptor-family parity test lane invoked), cold-start budget passed with median `29.3ms` below `150ms`, transition bench smoke completed, and bench gate passed against 17 baseline rows.
**Evidence:**
- `bun run check:generated-drift` → capture checks valid; descriptor-parity lane executed.
- `bun run check:cold-start-budget` → threshold `150ms`, median `29.3ms`.
- `bun run bench:smoke` → transitions benchmark run completed.
- `bun run bench:gate` → passed using `BASELINE.md` and `RESULTS.md`.
**Conclusion:** Fresh performance/parity evidence continues to support the same root conclusion: stability gates are strong; the highest-value next work is orchestration/doc/gate simplification, not emergency correctness repair.

### Phase 9 - Fresh Verification Evidence (rendering + operator summaries)
**Hypothesis:** Operator-facing status/review rendering and markdown projection contracts remain stable under current mainline state.
**Findings:** Rendering/summary suite passed fully (40 pass, 0 fail), covering deterministic review rendering, summary/next-command behavior, snapshot parity, and incremental markdown write guarantees.
**Evidence:** `bun test tests/runtime/render-snapshot.test.ts tests/runtime/render-incremental.test.ts tests/runtime-summary.test.ts tests/runtime-review-render.test.ts`.
**Conclusion:** Fresh operator-surface evidence is green and consistent with prior phases: no correctness instability detected; coordination/process simplification remains the primary improvement lever.

### Phase 10 - Fresh Verification Evidence (adapter/tool-surface integration)
**Hypothesis:** Adapter routing, tool metadata, plugin surface wiring, and tool schema contracts remain stable and aligned.
**Findings:** Integration contract suite passed fully (32 pass, 0 fail), including routing behavior, tool metadata completeness, plugin configuration surface invariants, and schema/SDK alignment checks.
**Evidence:** `bun test tests/runtime-tool-routing.test.ts tests/runtime-tools-metadata.test.ts tests/config/plugin-surface.test.ts tests/config/tool-schemas.test.ts`.
**Conclusion:** Fresh adapter/tool-surface evidence remains green; investigation conclusions are unchanged (system correctness guardrails are healthy, while orchestration/process simplification is the highest-value next work).

### Phase 11 - Fresh Verification Evidence (end-to-end workflow behavior)
**Hypothesis:** Cross-area end-to-end workflow flows (manual, autonomous, resume, recovery error mapping) remain stable on current baseline.
**Findings:** End-to-end workflow suite passed fully (4 pass, 0 fail), covering full manual completion path artifacts, autonomous blocked/replan recovery metadata preservation, resume behavior after re-import, and stable recovery error-code mapping.
**Evidence:** `bun test tests/cross-area/manual-flow.test.ts tests/cross-area/autonomous-flow.test.ts tests/cross-area/resume-flow.test.ts tests/cross-area/recovery-errorcode-matrix.test.ts`.
**Conclusion:** Fresh e2e behavior evidence stays green and supports the same outcome: correctness stability is strong; next gains should come from simplifying orchestration/documentation/gate coordination.

### Phase 12 - Fresh Verification Evidence (release/package + docs policy integrity)
**Hypothesis:** Release/package guardrails and docs policy parity remain stable and enforceable on current baseline.
**Findings:** Targeted integrity suite passed fully (13 pass, 0 fail), including pack invariants, release-hygiene scanner behavior, stale-reference policy, and runtime-tool docs parity.
**Evidence:** `bun test tests/cross-area/pack-invariants.test.ts tests/cross-area/release-hygiene.test.ts tests/docs-stale-reference-policy.test.ts tests/docs-tool-parity.test.ts`.
**Conclusion:** Fresh release/docs integrity evidence remains green and further confirms the central finding: quality enforcement is healthy; highest ROI remains coordination/process simplification.

### Phase 13 - Fresh Verification Evidence (architecture-boundary enforcement)
**Hypothesis:** Architecture-boundary controls remain consistently healthy across report mode, enforce mode, supplemental boundary reporting, and dedicated seam tests.
**Findings:** Boundary checks all passed: architecture seams script succeeded in report and enforce mode; supplemental boundary report completed with green underlying tests; dedicated cross-area seam test suite passed.
**Evidence:**
- `bun run check:architecture-seams` → OK (report mode).
- `bun run check:architecture-seams:enforce` → OK (enforce mode).
- `bun run check:boundary-report` → executed successfully with passing prompt/schema contract tests.
- `bun test tests/cross-area/architecture-seams.test.ts` → 3 pass, 0 fail.
**Conclusion:** Fresh boundary-enforcement evidence remains green and consistent with prior phases: enforcement is stable; improvement focus should remain on reducing coordination/gate/documentation complexity.

### Phase 14 - Fresh Verification Evidence (atomicity + concurrency safety)
**Hypothesis:** Persistence atomicity and concurrent-write protections remain robust under fresh targeted stress/consistency checks.
**Findings:** Atomic/concurrency/idempotency suite passed fully (15 pass, 0 fail), including concurrent save operations, rename-failure integrity behavior, projection fsync expectations, event-append sequence safety, workspace idempotency, and workspace cache behavior.
**Evidence:** `bun test tests/cross-area/concurrent-writes.test.ts tests/atomic-writes.test.ts tests/workspace-idempotency.test.ts tests/runtime/workspace-cache.test.ts`.
**Conclusion:** Fresh state-safety evidence is green and reinforces prior conclusions: correctness guardrails are healthy; major remaining opportunity is process/orchestration simplification rather than stability firefighting.

### Phase 15 - Fresh Verification Evidence (replanning/reset transitions)
**Hypothesis:** Replanning and dependency-reset transition behavior remains stable and bounded under current mainline state.
**Findings:** Transition suite passed fully (16 pass, 0 fail), covering replanning re-entry behavior, dependency reset propagation, transition surface/maintainability caps, and startRun branch handling.
**Evidence:** `bun test tests/runtime-replanning.test.ts tests/reset-dependencies.test.ts tests/transitions-consolidation.test.ts tests/startrun-branches.test.ts`.
**Conclusion:** Fresh transition evidence is green and consistent with all prior phases: runtime correctness is stable; highest-value next work remains coordination/process simplification.

### Phase 16 - Fresh Verification Evidence (prompt/capture evaluation stability)
**Hypothesis:** Prompt-mode behavior, review behavior evaluation rubrics, and capture harnesses remain stable and deterministic on current baseline.
**Findings:** Prompt/capture suite passed fully (25 pass, 0 fail), covering mode and review behavior rubric calibration, packet-boundary enforcement checks, offline capture packet generation, structured output scoring, and regression fixture promotion flows.
**Evidence:** `bun test tests/prompt-mode-behavior-eval.test.ts tests/prompt-behavior-eval.test.ts tests/review-prompt-capture.test.ts tests/prompt-mode-capture.test.ts`.
**Conclusion:** Fresh prompt-surface evidence is green and consistent with the broader investigation: no instability detected in behavior-eval/capture contracts; process/orchestration simplification remains the primary improvement target.

### Phase 17 - Fresh Verification Evidence (operator/history/actionable metadata)
**Hypothesis:** Operator-facing tool contracts, history/session lifecycle behaviors, actionable metadata rendering, and execution-history persistence remain stable.
**Findings:** Targeted operator/history suite passed fully (39 pass, 0 fail), including status/doctor behavior, history/show/activate/close flows, actionable metadata persistence, and execution-history rendering/preservation semantics.
**Evidence:** `bun test tests/runtime-operator-history.test.ts tests/runtime-operator-tools.test.ts tests/runtime-actionable-metadata.test.ts tests/runtime-execution-history.test.ts`.
**Conclusion:** Fresh operator-surface evidence is green and aligned with all previous phases: no active correctness regression signals; primary improvement opportunity remains coordination and process simplification.

### Phase 18 - Fresh Verification Evidence (path/workspace safety + caller isolation)
**Hypothesis:** Path-traversal defenses, workspace-root mutation safeguards, and transition caller-isolation guarantees remain stable.
**Findings:** Safety suite passed fully (18 pass, 0 fail), covering traversal rejection, malformed-id rejection before mutation, hidden-home workspace safety behavior, mutable-root guardrails, and non-mutating caller isolation for planning transitions.
**Evidence:** `bun test tests/path-traversal.test.ts tests/workspace-root-guard.test.ts tests/caller-isolation.test.ts tests/helpers.test.ts`.
**Conclusion:** Fresh safety-surface evidence remains green and consistent with prior phases: operational correctness controls are robust; top improvement leverage remains process/orchestration simplification.

### Phase 19 - Fresh Verification Evidence (protocol/replay/descriptor integrity)
**Hypothesis:** Protocol parity, descriptor-family parity, and replay corpus persistence contracts remain stable and internally consistent.
**Findings:** Integrity suite passed fully (27 pass, 0 fail), covering canonical-only protocol surfaces, descriptor/runtime binding alignment, replay/checkpoint/projection release-gate paths, and golden event-log corpus determinism.
**Evidence:** `bun test tests/protocol-parity.test.ts tests/replay/golden-event-corpus.test.ts tests/replay/replay-persistence-gate.test.ts tests/descriptor-family-parity.test.ts`.
**Conclusion:** Fresh protocol/replay evidence is green and reinforces all prior phases: correctness and contract integrity are healthy; primary improvement value remains orchestration/process simplification.

### Phase 20 - Fresh Verification Evidence (plan graph + fixture contract consistency)
**Hypothesis:** Plan-graph guardrails and canonical fixture/schema contracts remain stable under fresh targeted checks.
**Findings:** Targeted suite passed (8 pass, 0 fail), covering plan graph invalid-shape rejection (duplicate IDs, missing/self edges, blockedBy cycles) plus canonical fixture/schema contract checks.
**Evidence:** `bun test tests/plan-graph-validation.test.ts tests/fixtures-contract.test.ts tests/schema-equivalence.test-d.ts tests/module-scope-schemas.test.ts` (executed tests reported in `plan-graph-validation` and `fixtures-contract`).
**Conclusion:** Fresh planning/fixture evidence remains green and consistent with prior phases: no active correctness instability detected; coordination/process simplification remains the highest-leverage improvement path.

### Phase 21 - Fresh Verification Evidence (randomized regression stability)
**Hypothesis:** System-level behavior remains stable under randomized test ordering and broad-suite execution.
**Findings:** Randomized regression run passed fully (509 pass, 0 fail) with seed `2682285272`, covering the full cross-surface suite under shuffled execution order.
**Evidence:** `bun run test:randomized` (`bun test --randomize --timeout 30000`) completed successfully.
**Conclusion:** Fresh stochastic evidence reinforces prior deterministic checks: no emergent ordering-related correctness regressions were observed; priority remains process/orchestration simplification rather than defect firefighting.

### Phase 22 - Fresh Verification Evidence (multi-seed randomized stability)
**Hypothesis:** Randomized stability holds across fixed, repeatable seeds, not just one ad-hoc randomized run.
**Findings:** Two additional full-suite randomized runs passed cleanly: seed `1` and seed `42`, each with 509 pass, 0 fail.
**Evidence:** `bun test --randomize --timeout 30000 --seed=1` and `bun test --randomize --timeout 30000 --seed=42`.
**Conclusion:** Fresh multi-seed stochastic evidence further strengthens confidence that there are no ordering-sensitive regressions in current baseline behavior.

### Phase 23 - Fresh Verification Evidence (docs + prompt parity integrity)
**Hypothesis:** Canonical docs parity and prompt snapshot/eval corpus integrity remain stable on current baseline.
**Findings:** Targeted docs/prompt integrity suite passed fully (8 pass, 0 fail), covering semantic invariant doc parity, runtime-tool docs parity, flow-review prompt snapshot stability, and prompt-eval corpus consistency.
**Evidence:** `bun test tests/docs-semantic-parity.test.ts tests/docs-tool-parity.test.ts tests/prompt-snapshot.test.ts tests/prompt-eval-corpus.test.ts`.
**Conclusion:** Fresh documentation/prompt-contract evidence is green and consistent with all previous phases; improvement priority remains coordination/process simplification, not correctness triage.

### Phase 24 - Fresh Verification Evidence (cache + replay resume integrity)
**Hypothesis:** Session cache invalidation and replay/checkpoint resume behavior remain correct and stable.
**Findings:** Targeted cache/replay suite passed fully (12 pass, 0 fail), covering cache revalidation/invalidation paths, cross-session event rejection, checkpoint resume behavior, replay persistence gate scenarios, and completed-session history sorting.
**Evidence:** `bun test tests/runtime/session-cache.test.ts tests/runtime/workflow-persistence.test.ts tests/replay/replay-persistence-gate.test.ts tests/session-history.test.ts`.
**Conclusion:** Fresh cache/replay evidence remains green and consistent with prior phases; no correctness instability detected, and process/orchestration simplification remains the top improvement lever.

### Phase 25 - Fresh Verification Evidence (mode/hook/completion-collision contracts)
**Hypothesis:** Prompt-mode contract wiring, runtime hook behavior, and completed-session timestamp/collision handling remain stable.
**Findings:** Targeted suite passed fully (18 pass, 0 fail), covering mode contract/tool alignment, read-only surface protections, runtime hook no-op and active-session behavior, and completed-session timestamp/collision safeguards.
**Evidence:** `bun test tests/mode-contracts.test.ts tests/runtime-hooks.test.ts tests/completed-collision.test.ts tests/completed-timestamp.test.ts`.
**Conclusion:** Fresh contract evidence remains green and aligned with prior findings: stability is strong; primary next leverage remains process/orchestration simplification.

### Phase 26 - Fresh Verification Evidence (surface freshness + deadcode guardrails)
**Hypothesis:** Fresh-surface terminology checks and deadcode/dependency hygiene guardrails remain healthy.
**Findings:** Fresh-surface terminology check completed successfully; deadcode sweep (`knip`) completed without failures and only reported existing configuration hints (same known ignores).
**Evidence:** `bun run check:fresh-surfaces` and `bun run deadcode`.
**Conclusion:** Fresh hygiene evidence remains consistent with previous phases: no destabilizing drift signal; highest-value next work remains orchestration/process simplification.

### Phase 27 - Fresh Verification Evidence (build + release package integrity)
**Hypothesis:** Release artifact build and package/release guardrails remain stable on current mainline baseline.
**Findings:** Build and release/package checks passed: dist bundle built successfully, release hygiene scanner reported no debug artifacts, and pack invariants matched expected file set and version.
**Evidence:** `bun run build`, `bun run check:release-hygiene`, and `bun run check:pack-invariants`.
**Conclusion:** Fresh release-output evidence is green and aligns with prior phases: no correctness/release integrity regressions detected; coordination/process simplification remains the primary improvement target.

### Phase 28 - Fresh Verification Evidence (summary + completion gate reliability)
**Hypothesis:** Operator-facing summary/next-command behavior and completion/final-review gate enforcement remain stable.
**Findings:** Targeted summary/completion suite passed fully (39 pass, 0 fail), covering completion gate failure modes, final-review gating requirements, status/next-command rendering, and policy-driven lane behavior.
**Evidence:** `bun test tests/runtime-summary.test.ts tests/completion-gates.test.ts tests/runtime/final-review-contracts.test.ts`.
**Conclusion:** Fresh decision-surface evidence remains green and consistent with all prior phases: system correctness is stable, while process/orchestration simplification remains the highest-value improvement path.

### Phase 29 - Fresh Verification Evidence (runtime tool execution surfaces)
**Hypothesis:** Runtime tool behaviors, session-engine dispatch boundaries, persistence refresh behavior, and reviewer/reset flows remain stable.
**Findings:** Targeted runtime execution suite passed fully (34 pass, 0 fail), covering missing-session responses, worker payload validation, recovery metadata behavior, central session-engine dispatch boundaries, persisted state/doc refresh, and reviewer/reset invariants.
**Evidence:** `bun test tests/runtime-tools.test.ts tests/session-engine.test.ts tests/runtime-tool-persistence.test.ts tests/runtime-reviewer-reset.test.ts`.
**Conclusion:** Fresh runtime-tool evidence remains green and aligned with prior phases: no active correctness regressions detected; process/orchestration simplification remains the dominant improvement opportunity.

### Phase 30 - Fresh Verification Evidence (install/dist/resume operability)
**Hypothesis:** Installer lifecycle, built artifact loadability, and resume behavior after re-import remain stable.
**Findings:** Targeted operability suite passed fully (13 pass, 0 fail), covering install/uninstall command behavior, release install lifecycle scripts, dist bundle load contract, and resume behavior across re-import.
**Evidence:** `bun test tests/install.test.ts tests/cross-area/install-lifecycle.test.ts tests/smoke/dist-load.test.ts tests/cross-area/resume-flow.test.ts`.
**Conclusion:** Fresh operability evidence is green and consistent with prior phases: no release-operability regressions detected; primary improvement leverage remains process/orchestration simplification.

### Phase 31 - Fresh Verification Evidence (planning start + package-manager semantics)
**Hypothesis:** Planning entry/idempotency and package-manager detection semantics remain stable and deterministic.
**Findings:** Targeted planning suite passed fully (19 pass, 0 fail), covering `/flow-auto` prepare semantics, `flow_plan_start` idempotency for same-goal restarts, and package-manager detection/ambiguity handling plus standards-cache refresh behavior.
**Evidence:** `bun test tests/plan-start-idempotent.test.ts tests/package-manager-detection.test.ts tests/auto-prepare.test.ts`.
**Conclusion:** Fresh planning-surface evidence remains green and aligns with prior phases: no active correctness instability detected; top remaining opportunity is process/orchestration simplification.

### Phase 32 - Fresh Verification Evidence (review scope + recovery/actionable metadata)
**Hypothesis:** Reviewer-decision scope validation, recovery-resolution hint parity, and actionable metadata persistence semantics remain stable.
**Findings:** Targeted scope/recovery/actionable suite passed fully (21 pass, 0 fail), covering feature/final reviewer scope constraints, delivery-policy-aligned review depth checks, recovery hint baseline parity, and actionable metadata persistence/reset behavior.
**Evidence:** `bun test tests/reviewer-decision-scope.test.ts tests/recovery-hint-parity.test.ts tests/runtime-actionable-metadata.test.ts`.
**Conclusion:** Fresh policy-surface evidence remains green and consistent with prior phases; no active correctness regressions observed, and process/orchestration simplification remains the primary improvement lever.

### Phase 33 - Fresh Verification Evidence (recovery mapping + transition surface)
**Hypothesis:** Runtime recovery policy mapping and transition-surface bounds remain stable, with operator/next-command behavior still aligned.
**Findings:** Targeted suite passed fully (32 pass, 0 fail), covering recovery-kind mapping/tool guidance, transition surface and maintainability caps, full session-status next-command coverage, and operator tool/runtime planning behavior checks.
**Evidence:** `bun test tests/runtime-recovery.test.ts tests/transitions-consolidation.test.ts tests/cross-area/next-command-coverage.test.ts tests/runtime-operator-tools.test.ts`.
**Conclusion:** Fresh recovery/transition evidence remains green and consistent with prior phases: runtime correctness remains stable; process/orchestration simplification continues to be the highest-leverage next step.

### Phase 34 - Fresh Verification Evidence (render artifact parity)
**Hypothesis:** Rendered artifact outputs and incremental markdown projection behavior remain deterministic and stable.
**Findings:** Targeted render/parity suite passed fully (14 pass, 0 fail), covering committed render fixture snapshots, incremental write-minimization behavior, cross-area markdown parity, and summary-golden parity.
**Evidence:** `bun test tests/render-fixtures.test.ts tests/cross-area/markdown-parity.test.ts tests/cross-area/summarize-goldens.test.ts tests/runtime/render-incremental.test.ts`.
**Conclusion:** Fresh artifact-surface evidence remains green and consistent with prior phases: no output-parity regressions detected; primary improvement leverage remains coordination/process simplification.

### Phase 35 - Fresh Verification Evidence (session/history summary surfaces)
**Hypothesis:** Session persistence, operator history lifecycle, execution-history rendering, and summary surfaces remain stable and aligned.
**Findings:** Targeted session/history suite passed fully (43 pass, 0 fail), covering active/stored persistence behavior, lifecycle activation/closure flows, execution-history retention/reset semantics, and summary/next-command policy rendering.
**Evidence:** `bun test tests/runtime-session-persistence.test.ts tests/runtime-execution-history.test.ts tests/runtime-summary.test.ts tests/runtime-operator-history.test.ts`.
**Conclusion:** Fresh session/history evidence is green and consistent with prior phases: no active correctness regressions detected; coordination/process simplification remains the highest-value next step.

### Phase 36 - Fresh Verification Evidence (cross-area gate bundle)
**Hypothesis:** Cross-area guardrail tests for seams, dependency alignment, release hygiene, and benchmark gate logic remain stable together.
**Findings:** Targeted cross-area gate suite passed fully (14 pass, 0 fail), confirming expected pass/fail behavior for seam enforcement modes, dependency-contract drift detection, release-hygiene scanner coverage, and benchmark-regression gating logic.
**Evidence:** `bun test tests/cross-area/bench-gate.test.ts tests/cross-area/dependency-contract.test.ts tests/cross-area/architecture-seams.test.ts tests/cross-area/release-hygiene.test.ts`.
**Conclusion:** Fresh gate-bundle evidence remains green and consistent with all previous phases; correctness guardrails are stable, and process/orchestration simplification remains the primary improvement opportunity.

### Phase 37 - Fresh Verification Evidence (schema/descriptor/protocol coherence)
**Hypothesis:** Tool schema boundaries, descriptor-family metadata, protocol parity, and runtime plan/tool schema contracts remain coherent.
**Findings:** Targeted coherence suite passed fully (33 pass, 0 fail), covering OpenCode tool-surface ordering, zod/sdk alignment constraints, descriptor-runtime binding parity, canonical protocol surface invariants, and runtime plan/reviewer tool schema contract checks.
**Evidence:** `bun test tests/config/tool-schemas.test.ts tests/descriptor-family-parity.test.ts tests/protocol-parity.test.ts tests/runtime/plan-and-tool-schema-contracts.test.ts`.
**Conclusion:** Fresh contract-layer coherence evidence remains green and consistent with prior phases: no active correctness drift detected; process/orchestration simplification remains the top improvement lever.

### Phase 38 - Fresh Verification Evidence (full-gate reproducibility)
**Hypothesis:** The complete release-grade check pipeline remains reproducibly green after extensive targeted verification sweeps.
**Findings:** Full `bun run check` passed again end-to-end, including typecheck, capture checks, dependency/seam checks, deadcode hints-only state, build, release/pack invariants, completion lane, replay, cold-start/bundle sanity, full test suite, lint, bench smoke, and bench gate.
**Evidence:** `bun run check` completed successfully; notable outputs included cold-start median `35.54ms` (threshold `150ms`), full test suite `509 pass / 0 fail`, lint clean, and bench gate passed for 17 baseline rows.
**Conclusion:** Fresh full-gate reproducibility evidence confirms stable baseline health; remaining highest-value work is still coordination/process simplification rather than correctness stabilization.

### Phase 39 - Fresh Verification Evidence (prompt-eval reporting + boundary report)
**Hypothesis:** Prompt-eval reporting artifacts and supplemental boundary-report execution remain stable and informative.
**Findings:** Prompt-eval summary generation completed successfully with stable corpus accounting (31 prompt-mode cases, 8 behavior-eval cases, no unexpected eval outcomes) and boundary-report execution completed with passing contract suites.
**Evidence:** `bun run report:prompt-eval` and `bun run check:boundary-report`.
**Conclusion:** Fresh reporting-surface evidence remains green and consistent with prior phases; no destabilizing contract/report drift observed, and process/orchestration simplification remains the main improvement focus.

### Phase 40 - Fresh Verification Evidence (workflow-core invariants)
**Hypothesis:** Core workflow reducer behavior, semantic invariant catalog integrity, completion-gate descriptor coherence, and replay property invariants remain stable.
**Findings:** Targeted core-invariant suite passed fully (24 pass, 0 fail), including reducer event semantics, semantic-invariant owner consistency, descriptor-driven completion-gate parity, and seeded property-invariant replay checks.
**Evidence:** `bun test tests/runtime/workflow-core-reducer.test.ts tests/replay/property-invariants.test.ts tests/runtime/semantic-invariants.test.ts tests/runtime/completion-gate-descriptors.test.ts`.
**Conclusion:** Fresh core-invariant evidence remains green and consistent with all prior phases: runtime correctness stability is strong; process/orchestration simplification remains the top improvement priority.

### Phase 41 - Fresh Verification Evidence (tool routing + host-surface parity)
**Hypothesis:** Runtime tool routing behavior, tool metadata completeness, plugin-surface wiring, and docs-tool parity remain aligned.
**Findings:** Targeted host-surface suite passed fully (23 pass, 0 fail), covering `flow_auto_prepare` routing branches, root/root-alias persistence paths, tool metadata non-empty guarantees, plugin surface invariants, and descriptor-derived docs tool parity.
**Evidence:** `bun test tests/runtime-tool-routing.test.ts tests/runtime-tools-metadata.test.ts tests/docs-tool-parity.test.ts tests/config/plugin-surface.test.ts`.
**Conclusion:** Fresh host-surface evidence remains green and consistent with prior phases: no active routing/host-contract regressions detected; process/orchestration simplification remains the principal improvement path.

### Phase 42 - Fresh Verification Evidence (docs staleness + mode/output contracts)
**Hypothesis:** Documentation staleness policy, semantic parity, mode contracts, and prompt-mode behavior-output contracts remain stable.
**Findings:** Targeted docs/mode suite passed fully (21 pass, 0 fail), covering stale-reference controls, runtime semantic doc parity, mode/tool ownership alignment, read-only mode constraints, and prompt-mode behavior rubric stability.
**Evidence:** `bun test tests/docs-stale-reference-policy.test.ts tests/docs-semantic-parity.test.ts tests/mode-contracts.test.ts tests/prompt-mode-behavior-eval.test.ts`.
**Conclusion:** Fresh docs/mode-contract evidence remains green and consistent with prior phases: no contract drift detected in these surfaces; top improvement priority remains process/orchestration simplification.

### Phase 43 - Fresh Verification Evidence (review rendering + reviewer scope gating)
**Hypothesis:** Review-render output contracts and reviewer-decision scope/final-review gates remain stable and policy-aligned.
**Findings:** Targeted review-path suite passed fully (25 pass, 0 fail), covering deterministic review rendering, evidence-grounding checks, depth-claim downgrades, reviewer-scope validation, and final-review completion gate requirements.
**Evidence:** `bun test tests/runtime-review-render.test.ts tests/reviewer-decision-scope.test.ts tests/runtime/final-review-contracts.test.ts`.
**Conclusion:** Fresh review-path evidence remains green and consistent with prior phases: no active correctness regressions observed; process/orchestration simplification remains the highest-leverage next step.

### Phase 44 - Fresh Verification Evidence (engine dispatch + reset/recovery semantics)
**Hypothesis:** Session-engine dispatch boundaries, reset dependency propagation, runtime recovery mapping, and persistence refresh behavior remain stable together.
**Findings:** Targeted execution-semantics suite passed fully (28 pass, 0 fail), covering central action/read/workspace dispatch contracts, reset propagation semantics, canonical recovery mapping/tool guidance, and persisted session/doc refresh behavior.
**Evidence:** `bun test tests/session-engine.test.ts tests/reset-dependencies.test.ts tests/runtime-tool-persistence.test.ts tests/runtime-recovery.test.ts`.
**Conclusion:** Fresh execution-semantics evidence remains green and consistent with prior phases; system correctness remains stable and the highest-value next work remains process/orchestration simplification.

### Phase 45 - Fresh Verification Evidence (history/closure timestamp integrity)
**Hypothesis:** Session history rendering, closure lifecycle operations, and completed timestamp collision handling remain stable.
**Findings:** Targeted history/timestamp suite passed fully (18 pass, 0 fail), covering history/show/activate/close flows, completed-session sorting semantics, and collision-safe closeSession timestamp behavior.
**Evidence:** `bun test tests/runtime-operator-history.test.ts tests/session-history.test.ts tests/completed-collision.test.ts tests/completed-timestamp.test.ts`.
**Conclusion:** Fresh history/closure evidence remains green and consistent with prior phases: no active correctness regressions detected; process/orchestration simplification remains the highest-leverage improvement track.

### Phase 46 - Fresh Verification Evidence (packaging/dist/release scanner bundle)
**Hypothesis:** Packaging boundary invariants, built dist surface contracts, release-hygiene scanning, and lint-policy adoption signals remain stable.
**Findings:** Targeted bundle passed fully (12 pass, 0 fail), covering pack invariant pass/fail behavior, dist load surface contract, release-hygiene scanner behavior, and biome-adoption guardrails.
**Evidence:** `bun test tests/cross-area/pack-invariants.test.ts tests/smoke/dist-load.test.ts tests/cross-area/release-hygiene.test.ts tests/biome-adoption.test.ts`.
**Conclusion:** Fresh packaging/release-surface evidence remains green and consistent with prior phases; no active correctness regressions detected and process/orchestration simplification remains the top improvement focus.

### Phase 47 - Fresh Verification Evidence (tool routing + protocol/metadata integrity)
**Hypothesis:** Runtime tool routing, actionable metadata behavior, recovery-tool response contracts, and canonical protocol parity remain stable.
**Findings:** Targeted integrity suite passed fully (30 pass, 0 fail), covering runtime tool routing branches, actionable metadata persistence/reset semantics, runtime recovery response behavior, and protocol-parity invariants.
**Evidence:** `bun test tests/runtime-actionable-metadata.test.ts tests/runtime-tool-routing.test.ts tests/protocol-parity.test.ts tests/runtime-tools.test.ts`.
**Conclusion:** Fresh routing/protocol evidence remains green and consistent with prior phases: no active correctness regressions detected; process/orchestration simplification remains the highest-value improvement path.

### Phase 48 - Fresh Verification Evidence (workspace/path + cache safety)
**Hypothesis:** Workspace-root/path safety guards and session-cache invalidation behavior remain stable.
**Findings:** Targeted safety suite passed fully (20 pass, 0 fail), covering traversal rejection, workspace-root mutation safeguards, helper root-resolution invariants, and session-cache invalidation/revalidation semantics.
**Evidence:** `bun test tests/workspace-root-guard.test.ts tests/path-traversal.test.ts tests/runtime/session-cache.test.ts tests/helpers.test.ts`.
**Conclusion:** Fresh workspace/path/cache evidence remains green and consistent with prior phases: no active safety regressions detected; process/orchestration simplification remains the primary improvement lever.

### Phase 49 - Fresh Verification Evidence (time-fresh metrics + completion lane)
**Hypothesis:** Current runtime complexity metrics and completion-lane gate behavior remain stable at this exact point in time.
**Findings:** Fresh runtime metrics capture stayed unchanged (seam violations `0`, runtime files `89`, runtime LOC `11,700`, top-5 share `12.7`, same churn leaders) and completion-lane suite passed fully (74 pass, 0 fail).
**Evidence:** `bun run report:runtime-simplification-metrics` (capturedAt `2026-05-04T21:47:58.205Z`) and `bun run gate:completion-lane`.
**Conclusion:** Fresh time-stamped baseline evidence remains green and consistent with prior phases; no active correctness instability detected and process/orchestration simplification remains the top improvement focus.

### Phase 50 - Fresh Verification Evidence (replay determinism + persistence gate)
**Hypothesis:** Replay corpus determinism and workflow persistence/checkpoint gates remain stable under fresh execution.
**Findings:** Targeted replay/persistence suite passed fully (14 pass, 0 fail), covering append-only event-log serialization, golden replay final-state parity, persistence gate scenarios, and checkpoint resume/rejection behavior.
**Evidence:** `bun test tests/replay/golden-event-corpus.test.ts tests/replay/replay-persistence-gate.test.ts tests/runtime/workflow-persistence.test.ts`.
**Conclusion:** Fresh replay/persistence evidence remains green and consistent with all previous phases: no active correctness regressions observed; process/orchestration simplification remains the principal improvement path.

### Phase 51 - Fresh Verification Evidence (final-gate policy + semantic invariants)
**Hypothesis:** Final completion/review gate policy and semantic invariant enforcement remain stable and coherent.
**Findings:** Targeted final-gate suite passed fully (40 pass, 0 fail), covering completion-gate failure modes, final-path gate behavior, final-review contract enforcement, and semantic invariant catalog/owner consistency.
**Evidence:** `bun test tests/runtime/final-completion-gates.test.ts tests/runtime/final-review-contracts.test.ts tests/runtime/semantic-invariants.test.ts tests/completion-gates.test.ts`.
**Conclusion:** Fresh final-gate evidence remains green and consistent with prior phases: no active correctness regressions detected; process/orchestration simplification remains the highest-leverage next step.

### Phase 52 - Fresh Verification Evidence (runtime hooks + prompt capture/eval)
**Hypothesis:** Runtime hook behavior and prompt capture/evaluation harnesses remain stable and deterministic.
**Findings:** Targeted hook/prompt suite passed fully (23 pass, 0 fail), covering runtime hook no-op/active-session behavior, review + mode capture packet generation/check flows, and prompt behavior rubric stability.
**Evidence:** `bun test tests/runtime-hooks.test.ts tests/prompt-mode-capture.test.ts tests/review-prompt-capture.test.ts tests/prompt-behavior-eval.test.ts`.
**Conclusion:** Fresh hook/prompt-surface evidence remains green and consistent with prior phases: no active correctness regressions detected, and process/orchestration simplification remains the primary improvement lever.

### Phase 53 - Fresh Verification Evidence (type/lint + cold-start/bundle + bench gate)
**Hypothesis:** Static correctness checks, lint policy, startup/bundle sanity, and benchmark gate remain healthy as a combined release-safety slice.
**Findings:** Combined slice passed: typecheck clean, lint clean, cold-start budget satisfied (median `30.03ms` under `150ms`), bundle-sanity output healthy, and bench gate passed against baseline.
**Evidence:** `bun run typecheck`, `bun run lint`, `bun run check:cold-start-budget`, `node ./scripts/cross-area/bundle-sanity.mjs`, `bun run bench:gate`.
**Conclusion:** Fresh release-safety evidence remains green and consistent with prior phases: no active correctness/performance regressions detected; process/orchestration simplification remains the highest-value next step.

### Phase 54 - Fresh Verification Evidence (generated-drift + docs/plugin parity)
**Hypothesis:** Generated-surface drift checks and docs/plugin contract parity remain stable.
**Findings:** Generated-drift lane passed (review/prompt capture checks valid; descriptor-family parity lane executed via targeted pattern run), and targeted docs/plugin parity tests passed fully (15 pass, 0 fail).
**Evidence:** `bun run check:generated-drift`, plus `bun test tests/docs-tool-parity.test.ts tests/docs-semantic-parity.test.ts tests/config/plugin-surface.test.ts`.
**Conclusion:** Fresh drift/parity evidence remains green and consistent with prior phases: no active contract drift detected; process/orchestration simplification remains the primary improvement focus.

### Phase 55 - Fresh Verification Evidence (operator summary + actionable metadata)
**Hypothesis:** Operator-facing summary/status/doctor surfaces and actionable metadata semantics remain stable and coherent.
**Findings:** Targeted operator-surface suite passed fully (39 pass, 0 fail), covering status/doctor contracts, planning threshold behaviors, hidden-root safeguards, summary/next-command output stability, tool metadata non-empty guarantees, and actionable metadata persistence/reset semantics.
**Evidence:** `bun test tests/runtime-summary.test.ts tests/runtime-actionable-metadata.test.ts tests/runtime-operator-tools.test.ts tests/runtime-tools-metadata.test.ts`.
**Conclusion:** Fresh operator-surface evidence remains green and consistent with prior phases: no active correctness regressions detected; process/orchestration simplification remains the highest-leverage improvement path.

### Phase 56 - Fresh Verification Evidence (workflow progression branches)
**Hypothesis:** Manual/autonomous progression flows and run-start/replanning branch behavior remain stable.
**Findings:** Targeted workflow-branch suite passed fully (8 pass, 0 fail), covering manual full-flow completion, autonomous blocked/replan recovery metadata preservation, startRun branch outcomes, and replanning transition behavior.
**Evidence:** `bun test tests/cross-area/manual-flow.test.ts tests/cross-area/autonomous-flow.test.ts tests/startrun-branches.test.ts tests/runtime-replanning.test.ts`.
**Conclusion:** Fresh workflow-branch evidence remains green and consistent with prior phases: no active correctness regressions detected; process/orchestration simplification remains the primary improvement focus.

### Phase 57 - Fresh Verification Evidence (release-critical guardrail bundle)
**Hypothesis:** Core release-critical guardrails (dependency alignment, seam enforcement, pack invariants, benchmark gate) remain healthy together.
**Findings:** Guardrail bundle passed fully: dependency contract OK (`zod` aligned at `4.1.8`), seam enforcement OK, pack invariants OK, and benchmark gate OK.
**Evidence:** `bun run check:dependency-contract`, `bun run check:architecture-seams:enforce`, `bun run check:pack-invariants`, `bun run bench:gate`.
**Conclusion:** Fresh release-critical evidence remains green and consistent with prior phases; no active correctness/release risk regressions detected.

### Phase 58 - Fresh Verification Evidence (randomized full-suite seed 99)
**Hypothesis:** Full-suite behavior remains stable under an additional fixed random execution order.
**Findings:** Full randomized run with seed `99` passed completely (509 pass, 0 fail), reaffirming broad ordering-insensitive behavior across runtime, cross-area, replay, docs, prompt, install, and config surfaces.
**Evidence:** `bun test --randomize --timeout 30000 --seed=99`.
**Conclusion:** Fresh stochastic evidence remains green and consistent with prior multi-seed runs; no ordering-related correctness regressions observed.

## Root Cause
The core issue is **process-surface drift around an already hard-guarded runtime**, not missing correctness controls.

Concretely:
- Seam policy enforcement is already hard-fail in local/CI wiring, but architecture guidance still presents parts of it as report-first/future-state.
- CI executes focused preflight gates and then runs a broad `check` script that repeats several of those gates, increasing coordination and diagnosis cost.
- One boundary signal is intentionally advisory (warn + exit 0) while adjacent checks are blocking, creating policy interpretation overhead.
- Runtime hotspot concentration has improved by LOC share, but churn remains concentrated in schema/session/transition/render files, so simplification pressure persists.

This produces a complexity tax: maintainers spend effort reconciling contracts and orchestration rather than improving runtime behavior.

## Recommendations
1. **Synchronize governance truth first (low risk, high ROI).**
   - Update `docs/architecture/allowed-cross-layer-dependencies.md` to reflect current enforce-mode reality.
   - Explicitly label boundary-report status (advisory vs blocking) in `docs/maintainer-contract.md` and `docs/development.md`.

2. **De-duplicate verification orchestration (moderate risk, high ROI).**
   - Introduce explicit local lanes (`check:contracts`, `check:mainline`) in `package.json`.
   - Keep `check` as full release gate, but reduce duplicated CI-vs-check execution in `.github/workflows/ci.yml` unless duplication is intentionally documented.

3. **Make simplification metrics/doc sync mechanical (low-moderate risk, high ROI).**
   - Extend `scripts/cross-area/runtime-simplification-metrics.mjs` with deterministic scoreboard-oriented output or check mode.
   - Require scoreboard refresh from script output after each simplification slice.

4. **Run runtime simplification as narrow churn slices only (higher risk).**
   - Prioritize: `src/runtime/schema.ts`, `src/runtime/session-workspace.ts`, `src/runtime/session-lifecycle.ts`, `src/runtime/transitions/plan.ts`, `src/runtime/render-index-sections.ts`.
   - Start with export-preserving decomposition and helper extraction, not semantic rewrites.

5. **Separate simplification lanes.**
   - Keep packet-hook simplification under prompt/plugin/capture contract lane.
   - Track runtime churn lane independently so progress is measurable and not conflated.

## Preventive Measures
- **Direct-on-main batch protocol (strict):**
  1) Entry checks: `report:runtime-simplification-metrics`, seams enforce, dependency contract, completion lane, `test:fast`, `test:replay`.
  2) One batch = one measurable claim + one primary touched area.
  3) Run targeted lane first; run `check:mainline` before commit.
  4) Update docs/scoreboard in same batch when governance or metrics are affected.
  5) Use full `bun run check` for cross-surface/release-sized batches.

- **Stop/go criteria:**
  - STOP on any hard-gate failure, seam count nonzero, docs-enforcement contradiction, or unintended public schema/tool surface changes.
  - GO only when targeted checks and `check:mainline` pass and metric/doc deltas are recorded.

- **Surface freeze discipline:**
  - No new commands/tools/runtime modes unless paired with explicit retirement/replacement rationale.
  - Keep dependency compatibility constraints explicit (notably `zod` and `@opencode-ai/plugin` alignment).
