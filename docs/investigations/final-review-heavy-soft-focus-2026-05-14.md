# Investigation: Heavy final review after small soft-focus change

## Summary
The `soft-focus` change was genuinely tiny—one file and two deleted autofocus lines—but its `.flow` session persisted an implementation plan with `finalReviewPolicy: "detailed"` and `strictReview: true`, then widened the final review through an unchanged CSS neighbor and behavior-risk accounting. The plugin should improve proportionality by narrowing temporal behavior-risk derivation and rejecting duplicate behavior classes, while preserving strict checked-or-gap behavior ledgers for real multi-domain async/lifecycle/state risks.

## Symptoms
- User reports a small change in `~/projects/soft-focus` produced a final review that felt heavy.
- Need to inspect what was modified in `~/projects/soft-focus` and its `.flow` folder, then assess what this implies for the `flow-opencode` plugin.

## Background / Prior Research

### soft-focus working tree and `.flow` evidence
- `/Users/vriesd/projects/soft-focus` is on `main...origin/main` with one modified tracked file: `src/dom/setupShell.ts`.
- The working-tree diff is two deletions from the welcome heading: `title.tabIndex = -1;` and `title.dataset.autofocus = 'true';` were removed from `renderEntry()`.
- Current source still has the setup-shell post-render autofocus lookup at `/Users/vriesd/projects/soft-focus/src/dom/setupShell.ts:87-96`, while the welcome heading now keeps `id = 'setup-entry-title'` without autofocus metadata at `/Users/vriesd/projects/soft-focus/src/dom/setupShell.ts:192-203`.
- `.flow` contains one completed session: `/Users/vriesd/projects/soft-focus/.flow/completed/95b036be-273d-4f29-992b-35da05e034b8-20260514T160426.599/`.
- The rendered session doc says the goal was to prevent the screenshot's unintentionally focused element on initial app open, and the final reviewer decision was `final | completion_gate | approved` with `review depth: detailed`, `reviewed surfaces: 4`, and `evidence packets: 1` (`.flow/.../docs/index.md:5-18`).
- The plan explicitly used `priority mode: strict_scope` and `final review policy: detailed` (`.flow/.../docs/index.md:22-35`).
- The plan's review scope had one actual file target, `src/dom/setupShell.ts`, but also a declared neighbor `src/styles/app-shell.css` for focus styling (`.flow/.../session.json:232-254`).
- The final reviewer decision reviewed `changed_files`, `integration_points`, `shared_surfaces`, and `validation_evidence`; it included both `src/dom/setupShell.ts` and unchanged `src/styles/app-shell.css` in context (`.flow/.../session.json:310-399`).
- The final decision recorded six behavior checks: `accessibility_semantics`, `async_event_ordering`, `lifecycle_reentrancy`, `state_commit_rollback`, and `test_evidence_authenticity` twice; validation coverage maps all six classes to `bun run validate` (`.flow/.../session.json:408-565`).

### flow-opencode prior final-review context
- A prior investigation says final review had previously missed a soft-focus lifecycle defect because it verified review accounting rather than temporal behavior proof (`docs/investigations/final-review-missed-soft-focus-2026-05-06.md:1-10`).
- That prior report recommended risk-triggered behavior invariant accounting, validation-command-to-behavior mapping, soft-focus-style evals, and connected-context inference (`docs/investigations/final-review-missed-soft-focus-2026-05-06.md:112-128`).
- The follow-up status says Flow now uses checked-or-gap behavior accounting for async/event-ordering, lifecycle, state rollback, and test-oracle risks (`docs/investigations/final-review-missed-soft-focus-2026-05-06.md:152-159`).
- A delegated probe identified the likely current heaviness source as `src/runtime/domain/final-review-behavior-risks.ts`, which derives required risk classes from changed artifacts, declared review scope, and review context. It reported that source-only multi-domain `src/*` changes can require async/lifecycle/state risks, and validation evidence can require `test_evidence_authenticity`.
- The same probe noted tests intentionally lock soft-focus-like behavior in `tests/runtime/final-review-contracts.test.ts:1441-1627` and completion-gate failures for missing behavior risk classes in `tests/completion-gates.test.ts:1620-1638` and `tests/completion-gates.test.ts:2010-2269`.
- Relevant commit surfaced by the probe: `18995f6` — "Lower final-review validation concentration behind a ledger seam", which extracted behavior-ledger validation into `src/runtime/domain/final-review-behavior-ledger-validation.ts`.

### Phase 1.5 blocker
- The delegated `soft-focus` explore agent could not inspect `/Users/vriesd/projects/soft-focus` because only `/Users/vriesd/projects/flow-opencode` is loaded in RepoPrompt. The orchestrator collected the outside-workspace facts via read-only shell commands instead.

## Investigator Findings
<!-- Pair investigator appends structured findings here. -->

### 2026-05-14 - Phase 1.5 runtime/prompt heaviness investigation

#### Direct evidence
- `/Users/vriesd/projects/soft-focus/src/dom/setupShell.ts:87-96` still runs a post-render `requestAnimationFrame(() => root.querySelector<HTMLElement>('[data-autofocus]')?.focus())`; `/Users/vriesd/projects/soft-focus/src/dom/setupShell.ts:192-203` now keeps `title.id = 'setup-entry-title'` and appends the title without `tabIndex` or `data-autofocus`.
- `git -C /Users/vriesd/projects/soft-focus diff -- src/dom/setupShell.ts` shows the actual soft-focus workspace diff is one tracked file with exactly two deleted lines: `title.tabIndex = -1;` and `title.dataset.autofocus = 'true';` near `src/dom/setupShell.ts:197`.
- `/Users/vriesd/projects/soft-focus/.flow/completed/95b036be-273d-4f29-992b-35da05e034b8-20260514T160426.599/session.json:238-254` records one changed file target, `src/dom/setupShell.ts`, plus declared review scope for unchanged neighbor `src/styles/app-shell.css`.
- `/Users/vriesd/projects/soft-focus/.flow/completed/95b036be-273d-4f29-992b-35da05e034b8-20260514T160426.599/session.json:263-273` records `goalMode: "implementation"`, `priorityMode: "strict_scope"`, `finalReviewPolicy: "detailed"`, and `strictReview: true`.
- `/Users/vriesd/projects/soft-focus/.flow/completed/95b036be-273d-4f29-992b-35da05e034b8-20260514T160426.599/session.json:317-337` records a detailed final review with four reviewed surfaces: `changed_files`, `integration_points`, `shared_surfaces`, and `validation_evidence`.
- `/Users/vriesd/projects/soft-focus/.flow/completed/95b036be-273d-4f29-992b-35da05e034b8-20260514T160426.599/session.json:338-399` shows the review context pack promoted unchanged `src/styles/app-shell.css` as `architectural_neighbor` / `shared_surfaces` and the same changed file as `caller` / `integration_points`.
- `/Users/vriesd/projects/soft-focus/.flow/completed/95b036be-273d-4f29-992b-35da05e034b8-20260514T160426.599/session.json:408-565` persisted six behavior checks and duplicated `test_evidence_authenticity` in both `behaviorChecks` and `validationCoverage.behaviorClasses`.
- `src/runtime/domain/workflow-policy.ts:13-52`, `src/runtime/schema-plan.ts:63-68`, and `src/runtime/transitions/plan.ts:49-58` make `detailed` the default final-review policy whenever a plan omits an explicit `deliveryPolicy.finalReviewPolicy` or provides `deliveryPolicy` without that field.
- `src/prompts/fragments.ts:29-34` and `src/prompts/fragments.ts:95-100` reinforce the runtime default in operator/worker guidance by repeatedly describing final completion as `detailed cross-feature by default`.
- `src/runtime/domain/final-review-coverage.ts:79-125` defines what `detailed` requires: at least two surfaces, `validation_evidence`, one cross-feature surface, `integrationChecks`, and `regressionChecks`; `src/runtime/domain/final-review-coverage.ts:230-243` wires those failures into validation messages.
- `src/runtime/domain/review-scope-targets.ts:55-58` makes strict review accounting active when `strictReviewGovernanceRequiredForPlan` is true; `src/runtime/domain/workflow-policy.ts:55-61` makes that true for review/review_and_fix modes or `deliveryPolicy.strictReview === true`.
- `src/runtime/domain/final-review-coverage.ts:244-257` passes `declaredReviewScopeForPlan(session.plan)` into behavior-risk validation when strict review accounting is required.
- `src/runtime/domain/final-review-behavior-risks.ts:83-140` derives required behavior risks from changed artifacts plus declared review scope and review context. In particular, `src/runtime/domain/final-review-behavior-risks.ts:99-124` counts generic app domains across those paths and adds `async_event_ordering`, `lifecycle_reentrancy`, and `state_commit_rollback` when at least two generic `src/*` domains appear; `src/runtime/domain/final-review-behavior-risks.ts:128-136` adds `test_evidence_authenticity` when risks exist and validation/test evidence exists.
- `src/runtime/domain/final-review-behavior-risks.ts:73-81` deduplicates derived required classes through a `Set`, and `src/runtime/domain/final-review-behavior-risks.ts:138-140` returns the canonical enum order. This eliminates duplicate required-risk derivation as the source of the repeated `test_evidence_authenticity` entry.
- `src/runtime/schema-review-shared.ts:128-144`, `src/runtime/schema-review-shared.ts:237-244`, and `src/runtime/schema-review-shared.ts:338-352` accept arrays of `behaviorChecks` and `validationCoverage.behaviorClasses` without an array-level uniqueness check.
- `src/runtime/domain/reviewer-decision-normalization.ts:83-110`, `src/runtime/domain/reviewer-decision.ts:119-167`, and `src/runtime/transitions/execution-completion-normalization.ts:120-160` normalize/canonicalize behavior-risk names and prior `oracleRefs`, but preserve duplicate check entries and duplicate coverage classes.
- `src/runtime/domain/final-review-behavior-ledger-validation.ts:101-226` checks missing required classes with `.some(...)` and validates every supplied matching check, but does not reject duplicate checks for the same `riskClass` or duplicate `validationCoverage.behaviorClasses` values.
- `tests/reviewer-decision-scope.test.ts:246-272` proves ordinary implementation final approval can pass without behavior accounting ledgers; `tests/reviewer-decision-scope.test.ts:324-391` proves explicit `strictReview: true` requires review-scope ledger accounting and retains behavior accounting requirements.
- `tests/runtime/final-review-contracts.test.ts:1419-1649` and `tests/runtime/final-review-contracts.test.ts:1689-1814` intentionally lock strict-review behavior for soft-focus-like/multi-domain app changes: missing async/lifecycle/state/test-evidence checks fails, and one check per required class plus validation coverage passes.
- `tests/runtime/final-review-contracts.test.ts:2040-2124` shows a simple runtime-only detailed final review can pass without behavior accounting, which supports that the heavy behavior ledger is strict/multi-domain-context driven rather than universal.
- `tests/review-prompt-capture.test.ts:284-558` and `tests/__fixtures__/review-capture-scenarios/review-scenarios.json:131-223` model a true multi-domain soft-focus incident. They reject keyword-only async/race output and require temporal tracing through panel action, deferred registration, lifecycle owner, state owner, and tests. They do not model the tiny one-file DOM autofocus deletion with an unchanged CSS neighbor.
- `tests/final-review-fixtures.ts:1-96` uses detailed final-review fixtures with `changed_files`, `shared_surfaces`, and `validation_evidence` by default; it has no DOM/autofocus/CSS-neighbor fixture.

#### Confirmed hypotheses
- **Confirmed:** The actual soft-focus change was tiny: one source file and two deleted autofocus lines.
- **Confirmed:** The observed `.flow` final review was heavy relative to that diff: detailed policy, four reviewed surfaces, strict review governance, declared unchanged CSS neighbor, and six behavior checks including a duplicate `test_evidence_authenticity`.
- **Confirmed:** `finalReviewPolicy: detailed` is the runtime default and is reinforced by prompt fragments as `detailed cross-feature by default`; there is no diff-size, file-count, lite-lane, or risk-based downgrade in the policy selector.
- **Confirmed:** The actual session did not merely use `priorityMode: strict_scope`; it also persisted `deliveryPolicy.strictReview: true`, which activates strict review accounting for an implementation-mode task.
- **Confirmed:** Runtime behavior-risk derivation can over-widen a tiny implementation when strict review is on and an unchanged neighboring `src/*` path is declared in review scope. The changed `src/dom/setupShell.ts` plus declared `src/styles/app-shell.css` create two generic app domains, which triggers async/lifecycle/state required risks; broad validation then adds test-evidence authenticity.
- **Confirmed:** Duplicate behavior risk evidence is accepted and persisted. Required-risk derivation dedupes, but input/persisted schemas, reviewer-decision normalization, worker final-review normalization, and ledger validation do not reject duplicate supplied risk classes.

#### Eliminated or down-ranked hypotheses
- **Eliminated:** Duplicate required-risk derivation is not the cause of duplicate `test_evidence_authenticity`; the canonical derivation path uses a `Set` and canonical enum ordering.
- **Down-ranked:** `strict_scope` alone is not the behavior-ledger trigger. In code, strict behavior/scope accounting is tied to review/review_and_fix modes or `deliveryPolicy.strictReview === true`, not `priorityMode: strict_scope`.
- **Down-ranked:** The soft-focus prompt/eval tests are not directly demanding heavy behavior accounting for this exact tiny DOM deletion. Current tests target the earlier true multi-domain async/lifecycle soft-focus incident shape, not a one-file autofocus attribute removal with a CSS neighbor.

#### Exact likely root causes
1. **Detailed-by-default final review is too blunt for tiny implementation sessions.** `finalReviewPolicyForPlan()` and plan/schema defaults choose `detailed` unless explicitly overridden, while prompt fragments repeatedly call that the default. A one-feature/two-line implementation therefore enters detailed cross-feature review unless the planner deliberately chooses `broad`.
2. **Strict review governance was enabled for an ordinary implementation task.** The soft-focus plan stored `strictReview: true`; the runtime treats that the same as review-mode governance for behavior-risk and review-scope accounting.
3. **Declared review scope/context converted an unchanged CSS neighbor into multi-domain risk evidence.** `declaredReviewScopeForPlan()` feeds `src/styles/app-shell.css` into behavior-risk derivation, and the generic-domain `>= 2` heuristic turns `src/dom` + `src/styles` into async/lifecycle/state obligations even though only `src/dom/setupShell.ts` changed.
4. **Prompt guidance then made the model fill the heavy shape.** The prompt tells final reviewers that changed files are seeds, not boundaries, and to review adversarial classes before approving. With `detailed` + strict review + CSS neighbor/context pack, the model supplied integration/shared-surface review and behavior checks beyond what the tiny diff itself warranted.
5. **Duplicate supplied behavior classes lack a guardrail.** The runtime validates grounding and required-class presence, but neither canonicalizes arrays to unique risk classes nor rejects duplicate behavior checks/coverage classes, so repeated `test_evidence_authenticity` survives persistence.

#### Specific improvement recommendations
- **Policy/defaulting:** Add an adaptive final-review policy path in `src/runtime/domain/workflow-policy.ts`, `src/runtime/schema-plan.ts`, and `src/runtime/transitions/plan.ts` so implementation-mode, tiny/single-file, low-risk sessions can default to `broad` unless `detailed` is explicitly selected with a rationale. Add tests near `tests/runtime-summary.test.ts`, `tests/completion-gates.test.ts`, and `tests/runtime/final-review-contracts.test.ts` covering a one-file DOM attribute deletion.
- **Strict-review gating:** Keep `strictReview` out of ordinary implementation defaults and clarify in `src/prompts/contracts.ts` / tool guidance that `strictReview` is for review/review_and_fix or explicitly high-assurance tasks, not a synonym for `priorityMode: strict_scope`. Add a regression proving `priorityMode: strict_scope` does not imply strict behavior ledgers.
- **Behavior-risk derivation:** Refine `src/runtime/domain/final-review-behavior-risks.ts` so unchanged declared-scope neighbors, especially `architectural_neighbor`/CSS focus styling, do not by themselves count as changed generic app domains for async/lifecycle/state obligations. Prefer actual changed artifact domains plus explicit `state_owner`, `lifecycle_owner`, or async/event signals. Add a fixture where `artifactsChanged = [src/dom/setupShell.ts]` and declared review scope includes `src/styles/app-shell.css`; expected required risks should be proportional, likely accessibility/test-evidence only or explicit no async/lifecycle/state requirement.
- **Duplicate guardrail:** Add uniqueness validation or canonical dedupe for `behaviorChecks[].riskClass` and `validationCoverage[].behaviorClasses` in `src/runtime/schema-review-shared.ts`, `src/runtime/domain/reviewer-decision-normalization.ts`, `src/runtime/transitions/execution-completion-normalization.ts`, and/or `src/runtime/domain/final-review-behavior-ledger-validation.ts`. Add tests in `tests/runtime/final-review-contracts.test.ts`, `tests/reviewer-decision-scope.test.ts`, and `tests/runtime/worker-result-contracts.test.ts` that reject or canonicalize duplicate `test_evidence_authenticity`.
- **Prompt calibration:** Update `src/prompts/fragments.ts` and `src/prompts/contracts.ts` so final review guidance explicitly says not to force async/lifecycle/state behavior checks for tiny local DOM/CSS-neighbor changes unless state/lifecycle/async evidence exists; use `not_applicable` or omit non-required classes according to runtime policy rather than padding the review.
- **Test shape:** Add a new tiny soft-focus DOM-focus fixture separate from the existing multi-domain soft-focus scenario. Keep the current true soft-focus async/lifecycle tests (`tests/review-prompt-capture.test.ts` and review-capture scenarios) as high-assurance coverage, but prevent them from becoming the default expectation for every focus-related change.

#### Remaining unknowns
- The repository evidence and completed `.flow` record confirm that `strictReview: true` was present, but this investigation did not identify why the planner/model chose to set it for this implementation-mode soft-focus task. The plan prompt contract shown in `src/prompts/contracts.ts:21-24` exposes `finalReviewPolicy` but not `strictReview`, while the runtime schema accepts `strictReview`; the exact model/tool-schema influence should be checked separately if this becomes a fix task.
- I did not run tests because this was a read-only investigation; findings are based on source/test inspection plus direct read-only inspection of the soft-focus diff and completed `.flow` session.


## Investigation Log

### Phase 1 - Initial assessment
**Hypothesis:** The plugin may be over-counting review scope or producing final-review obligations that are disproportionate to a small workspace diff.
**Findings:** Report scaffold created; external facts needed because `~/projects/soft-focus` is outside the loaded `flow-opencode` workspace.
**Evidence:** User specifically asked to inspect `~/projects/soft-focus` and `.flow` folder.
**Conclusion:** Proceeding with delegated outside-workspace fact gathering before local context selection.

## Root Cause

### Ranked synthesis
| Rank | Explanation | Confidence | Basis |
| --- | --- | --- | --- |
| 1 | The persisted session explicitly selected a heavy policy shape: `goalMode: implementation`, `finalReviewPolicy: "detailed"`, and `strictReview: true`. | High | `soft-focus/.flow/.../session.json:263-273`; `workflow-policy.ts:13-52` defaults omitted policy to `detailed` and treats explicit `strictReview` as strict governance. |
| 2 | Behavior-risk derivation over-counted unchanged declared scope/context. The changed DOM file plus unchanged `src/styles/app-shell.css` became two generic `src/*` app domains, triggering async/lifecycle/state risks. | High | `final-review-coverage.ts:244-257` passes declared review scope into behavior-risk validation when review-scope accounting is required; `final-review-behavior-risks.ts:83-140` combines artifact paths and declared scope paths, then uses `genericAppDomains.size >= 2`; `final-review-behavior-validation.ts:28-39` treats any non-infrastructure `src/<domain>/...` as a generic app domain. |
| 3 | Prompt guidance reinforces heavy final review behavior. | Medium-high | `fragments.ts:29-34` and `fragments.ts:95-100` describe final review as `detailed cross-feature by default`; `fragments.ts:89-91` says changed files are review seeds, not boundaries. |
| 4 | Duplicate behavior classes are accepted and persisted. | High for duplication, low as the primary cause | `final-review-behavior-risks.ts:73-81` and `:138-140` dedupe required risks, but `schema-review-shared.ts:128-352` defines arrays without uniqueness, and `final-review-behavior-ledger-validation.ts:101-226` checks required-class presence with `.some(...)` without rejecting duplicates. |
| 5 | Global `detailed` default is a systemic bias. | Medium | `workflow-policy.ts:13-52`, `schema-plan.ts:63-68`, and `transitions/plan.ts:49-58` make detailed the omitted-policy default, but this specific session also explicitly persisted `detailed`, so changing only the global default would not fully solve this incident. |

### Evidence-vs-inference boundary
- Evidence: the actual `soft-focus` diff removed only `title.tabIndex = -1` and `title.dataset.autofocus = 'true'`; current `setupShell.ts` still has the autofocus lookup at lines 87-96 and the welcome h1 without autofocus metadata at lines 192-203.
- Evidence: the completed `.flow` session recorded `reviewDepth: "detailed"`, four reviewed surfaces, unchanged CSS shared-surface context, six behavior checks, and duplicate `test_evidence_authenticity` (`.flow/.../session.json:310-565`).
- Inference: the heavy feel is not a single bug; it is a compounding policy effect: explicit strict/detailed mode + declared neighbor/context + broad risk heuristic + prompt pressure + duplicate acceptance.
- Eliminated: duplicate required-risk derivation is not the duplication source because required risks are held in a `Set` before canonical ordering (`final-review-behavior-risks.ts:73-81`, `:138-140`).
- Down-ranked: `priorityMode: strict_scope` alone is not the strict behavior-ledger gate; strict governance comes from review/review_and_fix goal modes or `deliveryPolicy.strictReview === true` (`workflow-policy.ts:55-61`, `review-scope-targets.ts:55-58`).

## Recommendations

1. **Refine runtime behavior-risk derivation first.** In `src/runtime/domain/final-review-behavior-risks.ts`, stop treating unchanged declared CSS/style neighbors as temporal async/lifecycle/state risk domains by themselves. Count actual changed executable behavior-source domains and explicit `reviewContextPack` state/lifecycle/async signals; preserve declared scope for review-scope ledgers and grounding.
2. **Reject or canonicalize duplicate behavior classes.** Add uniqueness validation for normalized `behaviorChecks[].riskClass` and `validationCoverage[].behaviorClasses` in `schema-review-shared.ts`, normalization, or `final-review-behavior-ledger-validation.ts`. Prefer a clear repair error over silent persistence.
3. **Clarify strictness in prompts/tool guidance.** Update `src/prompts/fragments.ts`, `src/prompts/contracts.ts`, and relevant tool guidance so `priorityMode: strict_scope` means scope discipline, not `strictReview`; reserve `strictReview` for review/review_and_fix or explicitly high-risk implementation.
4. **Calibrate final-review policy selection.** Planners should choose `broad` for tiny localized implementation changes with adequate validation, and `detailed` for multi-domain behavior-sensitive work, review/review_and_fix, release/tooling, broad refactors, or explicit high-assurance requests. Avoid changing the global default to `broad` as the first move; it is broader and riskier.
5. **Add a separate tiny soft-focus fixture.** In `tests/runtime/final-review-contracts.test.ts` and related completion/reviewer tests, add a scenario for changed `src/dom/setupShell.ts` plus unchanged `src/styles/app-shell.css` neighbor that does not require async/lifecycle/state rollback. Keep the existing multi-domain soft-focus tests intact.
6. **Add duplication regressions.** Add tests that duplicate `test_evidence_authenticity` in `behaviorChecks` or `validationCoverage.behaviorClasses` and expect rejection or canonical dedupe.

## Preventive Measures

- Maintain two distinct soft-focus test shapes: (1) true multi-domain async/lifecycle/state incident requiring strict checked-or-gap accounting; (2) tiny localized DOM/accessibility focus tweak requiring proportional review.
- Keep behavior-ledger validation strict for genuinely required risks; improve the derivation of what is required rather than weakening validation of required classes.
- Treat unchanged architectural neighbors as review context, not automatic temporal-risk sources, unless explicit state/lifecycle/async evidence exists.
- Include final-review policy and `strictReview` rationale in plan/review artifacts when selecting high-assurance mode for small implementation tasks.
- Add duplicate-risk-class validation so review ledgers stay concise and repairable.
