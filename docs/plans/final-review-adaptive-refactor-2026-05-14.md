# Adaptive Final Review Refactor: Plan

## Goal
Make Flow final reviews proportional to implementation risk while preserving strict checked-or-gap behavior accounting for genuinely high-risk async, lifecycle, state, persistence, accessibility, and validation-evidence changes.

This is a runtime/prompt/test refactor plan, not an implementation pass. The target is less final-review complexity and better adaptive review quality, not weaker completion safety.

## Decisions
- Keep completion safety and runtime-owned review gates intact; do not rewrite the final-review pipeline.
- Do **not** change the global runtime default from `detailed` to `broad` in the first pass. The observed incident also persisted explicit `detailed` + `strictReview`, so a default flip would be broad and insufficient.
- Make adaptivity planner/prompt-led first: low-risk localized implementation should choose `finalReviewPolicy: "broad"`; review/review-and-fix and explicit high-assurance implementation should keep `detailed` and, when needed, `strictReview: true`.
- Separate review context from behavior-risk derivation: unchanged architectural neighbors may ground review scope, but should not by themselves create temporal async/lifecycle/state obligations.
- Reject duplicate behavior-risk evidence for new inputs after canonicalization; do not silently persist repeated risk classes as additional assurance.
- Preserve the existing multi-domain soft-focus regressions; add a distinct tiny-localized soft-focus fixture instead of weakening those tests.

## Background
- The investigation found a tiny `soft-focus` diff—two deleted autofocus lines in one file—produced a detailed final review with strict review governance, four reviewed surfaces, unchanged CSS neighbor context, six behavior checks, and duplicate `test_evidence_authenticity` (`docs/investigations/final-review-heavy-soft-focus-2026-05-14.md`).
- `workflow-policy.ts` defaults omitted final-review policy to `detailed` and treats review/review-and-fix or `deliveryPolicy.strictReview === true` as strict governance (`src/runtime/domain/workflow-policy.ts:13`, `src/runtime/domain/workflow-policy.ts:49`, `src/runtime/domain/workflow-policy.ts:55`).
- `schema-plan.ts` also defaults `deliveryPolicy.finalReviewPolicy` to `detailed` (`src/runtime/schema-plan.ts:63`).
- `final-review-behavior-risks.ts` derives behavior risks from changed artifact paths plus declared review scope; two generic `src/*` domains trigger async/lifecycle/state obligations (`src/runtime/domain/final-review-behavior-risks.ts:83`, `src/runtime/domain/final-review-behavior-risks.ts:99`).
- `final-review-behavior-ledger-validation.ts` requires grounded classes but does not reject duplicate checks for the same risk class (`src/runtime/domain/final-review-behavior-ledger-validation.ts:104`). `schema-review-shared.ts` accepts behavior-check and validation-coverage arrays without uniqueness (`src/runtime/schema-review-shared.ts:327`).
- Prompt fragments still describe final review as `detailed cross-feature by default` and changed files as seeds, not boundaries (`src/prompts/fragments.ts:29`, `src/prompts/fragments.ts:89`).
- Prior soft-focus work shows the opposite failure mode: final review can miss temporal behavior defects if it only verifies accounting, so this plan narrows risk derivation without weakening checked-or-gap validation (`docs/investigations/final-review-missed-soft-focus-2026-05-06.md`).
- Prior simplification and architecture contracts keep runtime transitions, completion safety, snapshot persistence, thin adapters, and optional strict review governance as supported surfaces (`docs/investigations/simplify-flow-opencode-2026-05-07.md`, `docs/architecture/flow-core-vnext-contract.md`, `docs/architecture/strictness-contract.md`).

## Approach
Use four phases after a test-first baseline. Each phase should either lock behavior with tests, reduce a known source of noise, or clarify an existing seam. Avoid new abstractions unless they retire duplicated logic.

### Phase 0 — Test-first guardrails
Add failing tests before changing runtime or prompt behavior.

Required cases:
1. **Tiny DOM focus change with unchanged CSS neighbor**: changed artifact `src/dom/setupShell.ts`, declared scope `src/styles/app-shell.css`, validation `bun run validate`. Expected: no required async/lifecycle/state/test-evidence behavior ledger solely from the unchanged neighbor; optional accessibility evidence may still be valid.
2. **True multi-domain soft-focus incident remains strict**: existing async/lifecycle/state/test-evidence requirements still pass/fail exactly as today.
3. **`priorityMode: "strict_scope"` is not strict review**: no review-scope or behavior-ledger requirement unless goal mode or `deliveryPolicy.strictReview` requires it.
4. **Duplicate behavior checks are rejected**: duplicate canonical classes and duplicate prior/canonical aliases such as `test_oracle_authenticity` + `test_evidence_authenticity` produce a repairable error.
5. **Duplicate validation coverage classes are rejected**: repeated `validationCoverage[].behaviorClasses` fail with a precise message.
6. **Tiny soft-focus prompt fixture is separate**: add a localized DOM-focus prompt-capture scenario that accepts local DOM/accessibility review and rejects padded async/lifecycle/state ledgers. Keep the existing multi-domain soft-focus scenario unchanged.
7. **`strictReview` source is located before prompt edits**: inspect the plan contract/tool-schema/defaulting path that can emit or persist `deliveryPolicy.strictReview`; if the source is not prompt-owned, adjust Phase 3 scope before editing prompt text.

For `strict_scope`, the expected behavior is scope discipline only: no review-scope ledger and no behavior ledger unless goal mode or `deliveryPolicy.strictReview` requires strict governance.

Primary files: `tests/runtime/final-review-contracts.test.ts`, `tests/reviewer-decision-scope.test.ts`, `tests/completion-gates.test.ts`, `tests/runtime/worker-result-contracts.test.ts`, `tests/config/prompt-contracts.test.ts`, `tests/review-prompt-capture.test.ts`, and `tests/__fixtures__/review-capture-scenarios/review-scenarios.json`.

### Phase 1 — Duplicate behavior-class guardrail
Reject duplicates for new reviewer/worker inputs after canonical risk normalization, while keeping persisted completed sessions loadable.

Implementation seams:
- New-input boundary: enforce uniqueness on the runtime/tool input shapes used by `schema-review-decisions.ts` and `schema-worker-result.ts` through the shared input final-review shape in `src/runtime/schema-review-shared.ts`. Do not add the same array-level uniqueness to persisted session-history load shapes.
- Persisted-session boundary: keep `finalReviewPersistedSharedShape` and completed-session loading tolerant enough for prior `.flow` histories that already contain duplicate classes.
- `src/runtime/domain/final-review-behavior-ledger-validation.ts`: add defense-in-depth duplicate failure reasons before the `requiredRisks.length === 0` early return, so direct validation callers also get repairable errors.
- `src/runtime/domain/reviewer-decision-normalization.ts` and `src/runtime/transitions/execution-completion-normalization.ts`: keep canonicalization, but do not silently dedupe.

Expected repair messages should name the duplicated normalized class, e.g. `behaviorChecks must contain at most one entry per riskClass: test_evidence_authenticity`.

### Phase 2 — Refine behavior-risk derivation
Change `deriveRequiredFinalReviewBehaviorRisks()` so declared review scope remains grounding/context, not automatic changed-domain evidence.

Recommended model:
- Count generic app domains from `artifactPathsForWorker(worker)` only.
- Keep explicit `reviewContextPack` signals only after the pack is normalized/grounded by the existing review-context path (`review-context-normalization.ts`, `review-context-grounding.ts`). Treat `includedContext.reason === "state_owner"` as `state_commit_rollback`, `"lifecycle_owner"` as `lifecycle_reentrancy`, and explicit async/event signals as `async_event_ordering`.
- Do not infer temporal risk from freeform context summaries, unchanged declared-scope paths, or architectural-neighbor relationships unless they carry one of those explicit grounded signals.
- Require async/lifecycle/state from multi-domain source changes only when actual changed artifacts span at least two generic `src/*` domains.
- Add `test_evidence_authenticity` only when another behavior risk is already required and test/validation evidence exists.
- Keep `declaredReviewScopePaths()` available for grounding and review-scope ledgers in `final-review-behavior-validation.ts`.

This should fix the tiny DOM + CSS-neighbor case without weakening review/review-and-fix or true multi-domain behavior-risk sessions.

### Phase 3 — Calibrate final-review policy and prompt pressure
Keep runtime defaults stable for this pass, but make policy selection explicit in planner/worker/reviewer guidance.

Policy matrix:

| Case | Recommended policy |
| --- | --- |
| One localized implementation file, no state/lifecycle/async/persistence/release/tooling/schema risk | `finalReviewPolicy: "broad"` |
| Small DOM/CSS/accessibility tweak with direct validation and no state/lifecycle owner changes | `broad`, optional accessibility notes/checks |
| Actual multi-domain source behavior change | `detailed` |
| Review or review-and-fix mode | `detailed` + strict review governance |
| Explicit high-assurance implementation | `detailed` + `strictReview: true` with rationale |
| Runtime transitions, persistence, recovery, adapter/tool schemas, release automation, prompt/runtime semantic contracts | `detailed` |
| `priorityMode: "strict_scope"` alone | scope discipline only; does not imply `strictReview` |

Update `src/prompts/fragments.ts` and `src/prompts/contracts.ts` to replace blanket `detailed cross-feature by default` pressure with “match `deliveryPolicy.finalReviewPolicy`; choose broad for low-risk localized implementation and detailed/strict for high-risk or review-mode work.” Clarify that required behavior risks use `passed` or `gap_recorded`; omit non-required classes instead of padding `not_applicable` entries.

If generated prompt surfaces change, update them through the repo’s existing generation path rather than hand-editing generated files.

### Phase 4 — Validate and document release risk
Run targeted final-review tests first, then broader schema/prompt gates if touched surfaces require them. Add a short release note only if behavior or prompts materially change the user-visible final-review contract.

## Work Items
1. Add Phase 0 failing tests for proportional tiny review, strict multi-domain preservation, `strict_scope` separation, and duplicate behavior-class rejection.
2. Implement duplicate behavior-class validation in input schemas and ledger validation, preserving old persisted-session tolerance.
3. Refactor `deriveRequiredFinalReviewBehaviorRisks()` to count only changed artifacts for generic-domain temporal-risk derivation while retaining review-context explicit signals.
4. Inspect the `strictReview` selection path before prompt edits; if it is schema/tool-default driven, fix that seam before changing prose.
5. Update final-review prompt fragments/contracts with the policy matrix and strictReview guidance; run `bun run check:generated-drift` plus the prompt capture checks instead of hand-editing generated outputs blindly.
6. Add the tiny soft-focus review-capture fixture and expected prompt behavior checks.
7. Run targeted validation, then strictness/parity checks for any schema or generated-prompt changes.

## Acceptance Criteria
- Tiny localized DOM/CSS-neighbor implementation no longer requires async/lifecycle/state/test-evidence behavior ledgers solely because of unchanged declared scope.
- Existing true multi-domain soft-focus async/lifecycle/state/test-evidence tests still pass.
- `priorityMode: "strict_scope"` remains scope discipline and does not imply strict review governance.
- Duplicate `behaviorChecks[].riskClass` and duplicate `validationCoverage[].behaviorClasses` are rejected or repaired before persistence for new inputs.
- Planner/prompt guidance clearly distinguishes `broad`, `detailed`, and `strictReview` use cases.
- Runtime transitions, completion gates, persisted session loading, and `.flow/**` ownership semantics remain unchanged.
- The implementation removes or clarifies existing complexity rather than adding a second final-review pipeline.

## Validation Plan
Run focused checks first:

```bash
bun test tests/runtime/final-review-contracts.test.ts
bun test tests/reviewer-decision-scope.test.ts
bun test tests/completion-gates.test.ts
bun test tests/runtime/worker-result-contracts.test.ts
bun test tests/runtime/plan-and-tool-schema-contracts.test.ts
bun test tests/config/prompt-contracts.test.ts
bun test tests/review-prompt-capture.test.ts
```

If schema, generated prompt, or adapter-facing contracts changed, also run:

```bash
bun test tests/runtime/semantic-invariants.test.ts
bun test tests/docs-semantic-parity.test.ts
bun test tests/schema-equivalence.test-d.ts
bun run check:dependency-contract
bun run typecheck
```

## Risks
- **Overcorrection to shallow reviews.** Mitigate by preserving existing multi-domain soft-focus and strict review tests before changing derivation.
- **Persisted-session tolerance.** Enforce duplicate rejection on new inputs and validation paths, but do not make prior completed sessions fail to load.
- **Prompt-only adaptivity is incomplete.** Runtime derivation refinement reduces the worst overreach; a separate follow-up may be needed if planner policy selection still overuses `strictReview`.
- **Schema strictness drift.** Any schema change must follow `docs/architecture/strictness-contract.md` and avoid new bridge casts or widened raw payload paths.
- **More prose instead of less complexity.** Prompt edits should replace blanket heavy-default wording, not layer more instructions on top of it.

## Non-goals
- No direct implementation in this planning pass.
- No global default flip from `detailed` to `broad` in the first implementation pass.
- No weakening of checked-or-gap validation once a risk class is truly required.
- No new final-review mode, second review pipeline, or new dependency.
- No independent zod or `@opencode-ai/plugin` version change.

## References
- `docs/investigations/final-review-heavy-soft-focus-2026-05-14.md`
- `docs/investigations/final-review-missed-soft-focus-2026-05-06.md`
- `docs/investigations/simplify-flow-opencode-2026-05-07.md`
- `docs/architecture/flow-core-vnext-contract.md`
- `docs/architecture/strictness-contract.md`
- `src/runtime/domain/workflow-policy.ts`
- `src/runtime/schema-plan.ts`
- `src/runtime/domain/final-review-coverage.ts`
- `src/runtime/domain/final-review-behavior-risks.ts`
- `src/runtime/domain/final-review-behavior-ledger-validation.ts`
- `src/runtime/schema-review-shared.ts`
- `src/runtime/domain/reviewer-decision-normalization.ts`
- `src/runtime/transitions/execution-completion-normalization.ts`
- `src/prompts/fragments.ts`
- `src/prompts/contracts.ts`
- `tests/runtime/final-review-contracts.test.ts`
- `tests/reviewer-decision-scope.test.ts`
- `tests/completion-gates.test.ts`
- `tests/review-prompt-capture.test.ts`
- GitLab Code Review Guidelines: https://docs.gitlab.com/development/code_review/#best-practices

## Orchestration Progress
- [x] Lane 1 — Phase 0 guardrail tests and strictReview source inspection. Validation: focused suite currently has 5 expected red failures pending runtime/schema changes; strictReview is prompt/model-owned for selection and schema/tool-supported for persistence, not schema-defaulted.
- [x] Lane 2 — Duplicate behavior-class validation in new input schemas and direct ledger validation. Validation: duplicate-focused schema/worker tests, plan/tool schema contracts, typecheck, persisted duplicate parse tolerance, and focused suite pass.
- [x] Lane 3 — Behavior-risk derivation refinement for changed artifacts vs unchanged context. Validation: `tests/runtime/final-review-contracts.test.ts` passes; full focused Phase 0/1/2 suite passes (106 tests).
- [x] Lane 4 — Prompt guidance, generated drift checks, capture fixture validation, final targeted validation. Validation: focused plan suite passes (125 tests), `check:generated-drift`, semantic/docs parity, schema-equivalence path check, dependency contract, and typecheck pass; Oracle review findings addressed.
