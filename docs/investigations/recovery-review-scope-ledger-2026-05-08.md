# Investigation: Recovery Review Scope Ledger Retry Message

## Summary
The observed retry is expected structured recovery for a missing or incomplete final-review `reviewScopeLedger`, not evidence of a runtime bug by itself. The wording “the runtime provided the missing scope ledger entries” is misleading: the runtime provides declared scopes, candidate evidence, notes, and an example ledger scaffold, while the reviewer/agent must still produce truthful, evidence-grounded ledger entries.

## Symptoms
- During a new run with the OpenCode plugin, the agent/runtime emitted: “Recovery/review: The runtime provided the missing scope ledger entries, so I’ll retry the final review with every declared file target accounted for.”
- User question: whether this indicates something is not working correctly yet, or whether it is expected recovery behavior.

## Background / Prior Research
No external research performed yet. Initial triage suggests this is repository-local behavior around final-review recovery, review-scope accounting, and prompt/runtime retry guidance.

## Investigator Findings
<!-- Pair investigator appends structured findings here. -->

### 2026-05-09 - Codex investigation

#### Confirmed root cause
- **Conclusion:** The retry behavior is expected structured recovery for missing or incomplete `reviewScopeLedger` accounting, but the quoted wording is a UX/prompt mismatch. The runtime provides declared scopes, evidence candidates, notes, and an `exampleReviewScopeLedger`; it does **not** prove that the missing review happened or literally "provide the missing scope ledger entries" as completed evidence.
- **Exact-string check:** The full sentence only appears as the symptom in this report (`docs/investigations/recovery-review-scope-ledger-2026-05-08.md:6-8`), not in source, generated prompts, tests, or release notes. The closest checked-in runtime copy says to "Provide" or "Re-record" ledger entries, not that the runtime already provided completed entries (`src/runtime/transitions/recovery.ts:197-220`).
- **Bug-vs-expected classification:** **Expected runtime behavior with misleading agent-facing prose.** Treat `status: "error"` plus structured recovery as a normal retry path; treat "runtime provided the missing scope ledger entries" as overclaiming unless the agent actually re-ran/re-recorded the review with a valid, evidence-grounded ledger.

#### Evidence: runtime path and recovery payload
- `flow_review_record_final` is a real OpenCode adapter tool whose args come from the runtime final reviewer decision schema; the tool forwards the normalized decision into the guarded session mutation path (`src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts:68-110`, `src/adapters/opencode/tool-surface/schemas.ts:105-107`, `src/adapters/opencode/tool-surface/schemas.ts:179-180`, `src/runtime/schema.ts:142-151`, `src/runtime/schema.ts:333-335`).
- The final reviewer decision schema allows optional `reviewScopeLedger`, while each ledger entry must have `scopeId`, status, `evidenceRefs`, `residualRisk`, and optional `findingRefs`/`validationRefs`/`rationale` (`src/runtime/schema-review-shared.ts:47-54`).
- Final reviewer decision validation rejects approved review/review-and-fix decisions when `describeFinalReviewerReviewScopeFailure` reports missing, structurally invalid, or ungrounded ledger accounting (`src/runtime/domain/reviewer-decision.ts:272-340`, `src/runtime/domain/review-scope-accounting.ts:759-807`).
- `recordReviewerDecision` maps `final_review_scope_accounting` validation failures into `buildCompletionRecovery(..., "missing_final_reviewer_review_scope_accounting", { reviewScopeLedger: ... })`, so the expected recovery stage is `record_review` and the required artifact is `final_reviewer_decision` (`src/runtime/transitions/review.ts:202-225`, `src/runtime/transitions/recovery.ts:209-220`).
- Final completion validation performs a second check: if the recorded final reviewer decision later fails scope accounting, completion fails with the same `missing_review_scope_accounting` error code and final-review-specific recovery details (`src/runtime/transitions/execution-completion-validation.ts:300-344`). Separately, worker-result completion payloads with missing top-level `reviewScopeLedger` fail earlier with `missing_review_scope_accounting` and `retry_completion` (`src/runtime/transitions/execution-completion-validation.ts:225-245`, `src/runtime/transitions/recovery.ts:197-207`).
- The recovery details are explicitly scaffold fields: `declaredScopes`, `evidenceCandidates`, `exampleReviewScopeLedger`, and `notes` (`src/runtime/domain/review-scope-accounting.ts:539-553`). The builder creates examples from declared scope plus known artifacts/context/validation, defaulting example entries to `status: "reviewed_no_findings"` and a placeholder residual-risk instruction (`src/runtime/domain/review-scope-accounting.ts:560-590`, `src/runtime/domain/review-scope-accounting.ts:594-646`).
- The notes prove this is guidance, not proof: they tell the agent to use exact scope ids, require concrete `evidenceRefs`, warn that validation refs alone are insufficient, and warn that closed finding refs are candidates only (`src/runtime/domain/review-scope-accounting.ts:635-646`).

#### Evidence: prompt/generated guidance
- The prompt contract tells workers and reviewers to account for every declared review scope target/domain, include evidence and residual risk, and explicitly says the ledger is runtime scope accounting, not a requirement to edit every target file (`src/prompts/contracts.ts:103-107`, `src/prompts/contracts.ts:177-180`).
- Tool descriptor guidance exposes the same requirement for both completion and final-review recording: include `reviewScopeLedger` accounting for every declared review scope target/domain (`src/adapters/opencode/tool-surface/descriptor-guidance.ts:44-66`).
- General recovery prompt guidance says to inspect structured recovery metadata, satisfy `recovery.prerequisite`, and only call canonical `recovery.nextRuntimeTool` when present (`src/prompts/fragments.ts:37-38`, `src/prompts/generated/role-prompts.ts:258-273`).
- Prompt guidance also bounds re-record behavior: after `flow_review_record_final` returns `ok`, do not re-record the same final review unless the tool itself errors or final completion returns structured recovery requiring `final_reviewer_decision` (`src/prompts/fragments.ts:102-105`). This supports a retry after the observed error, not repeated retries after success.

#### Evidence: tests and release notes
- `tests/runtime-tools.test.ts:982-1064` locks the tool-level behavior: an invalid final-review scope ledger returns `status: "error"`, `errorCode: "missing_review_scope_accounting"`, `recoveryStage: "record_review"`, `prerequisite: "reviewer_result_required"`, `requiredArtifact: "final_reviewer_decision"`, and recovery details containing both `declaredScopes` and `exampleReviewScopeLedger` for the declared file target.
- `tests/completion-gates.test.ts:783-827` locks completion recovery details: declared file targets are returned in both `declaredScopes` and `exampleReviewScopeLedger`, example entries are `reviewed_no_findings`, and notes warn that finding refs are not assigned automatically.
- `tests/completion-gates.test.ts:827-852` locks final-review-record recovery details for missing final reviewer ledger accounting.
- `tests/runtime/final-review-contracts.test.ts:551-803` locks the discriminating cases: missing ledger fails, partial ledger names the missing file target, placeholder/unsafe/cross-scope/validation-only evidence fails, and a complete ledger with grounded evidence succeeds.
- `tests/completion-gates.test.ts:1169-1228` shows `reviewScope` adds to `fileTargets` rather than narrowing them; a domain-only ledger fails until the declared file target entry is also present.
- `tests/config/prompt-contracts.test.ts:214-243` locks the prompt guard against repeating `flow_review_record_final` after an `ok` response unless structured recovery explicitly requires final reviewer decision.
- `tests/runtime-tools.test.ts:900-984` locks identical final-review records as successful no-op retries with no extra session-state save, reducing repeated-review/infinite-loop risk after a successful record.
- `docs/releases/v2.0.11.md:3-21` documents the intended feature: review/review-and-fix plans must declare scope and cannot complete until every declared target is accounted with evidence and residual risk. `docs/releases/v2.0.23.md:3-25` documents singleton retry/idempotency semantics and says prompts/docs are descriptive while runtime transitions remain authoritative.

#### Eliminated hypotheses
- **Missing schema/tool guidance:** eliminated. The schema, tool descriptor guidance, worker/reviewer prompt contracts, and generated role prompts all surface `reviewScopeLedger` and the final-review retry contract (`src/runtime/schema.ts:142-151`, `src/adapters/opencode/tool-surface/descriptor-guidance.ts:63-66`, `src/prompts/contracts.ts:139-180`, `src/prompts/generated/role-prompts.ts:258-273`).
- **Impossible first-attempt payload:** eliminated. Tests show bad first attempts fail with actionable details, while complete grounded ledgers are accepted (`tests/runtime/final-review-contracts.test.ts:551-803`).
- **Runtime requiring information unavailable to the agent:** mostly eliminated. Recovery details return the declared scopes and candidate evidence; when candidate artifact evidence is unavailable, notes instruct the agent to add matching changed artifacts or `reviewContextPack` before retrying (`src/runtime/domain/review-scope-accounting.ts:594-646`). That can still require agent work, but it is not an unavailable-runtime-info bug.
- **Repeated retry after `ok` / infinite loop:** not supported by current evidence. Prompt guidance forbids re-recording after `ok` except when structured recovery explicitly requires it, and duplicate final reviewer records no-op (`src/prompts/fragments.ts:102-105`, `tests/runtime-tools.test.ts:900-984`). Completion calls remain intentionally non-idempotent without new worker evidence (`docs/releases/v2.0.23.md:11-25`).
- **Runtime internally auto-filling proof of review:** eliminated. Recovery creates `exampleReviewScopeLedger` scaffold from declared scope and candidates; validation still requires concrete, scoped evidence before success (`src/runtime/domain/review-scope-accounting.ts:560-646`, `src/runtime/domain/review-scope-accounting.ts:779-807`).

#### Remaining gaps / UX notes
- I did not find a single end-to-end test that takes the exact `exampleReviewScopeLedger` returned by recovery and replays it unchanged into a successful retry. Coverage is split between recovery-detail assertions and separate acceptance tests.
- The phrase "provided the missing scope ledger entries" is the only confirmed mismatch: it implies completed evidence, while the runtime actually provided declared-scope scaffolding and hints. Better operator prose would be: "The runtime returned the declared scopes and example ledger scaffold, so I will re-record/retry the final review with evidence-grounded entries for every declared target."
- No source evidence indicates a runtime bug in this path unless a real run shows repeated `status: "error"` after the agent supplies a ledger that passes the same structural/grounding rules covered by the tests above.


## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** The message may be expected recovery behavior after final review scope accounting detects missing ledger entries and supplies required targets for retry.
**Findings:** A prior investigation already found final-review recovery can route agents back to `record_review` when review-scope accounting fails; this run needs a narrower check of the exact “runtime provided missing scope ledger entries” behavior.
**Evidence:** User-provided symptom text; prior local report `docs/investigations/final-review-record-repeat-2026-05-08.md`.
**Conclusion:** Confirmed after context-builder selection, pair investigation, spot checks, and oracle synthesis.

### Phase 2-4 - Context Builder, Pair Investigation, Spot Checks, Oracle Synthesis
**Hypothesis:** The runtime intentionally routes final-review scope-accounting failures back to `record_review`, but the human-facing message overstates what the runtime supplied.
**Findings:** Confirmed. `missing_final_reviewer_review_scope_accounting` recovery requires `final_reviewer_decision`, and recovery details contain scaffold fields (`declaredScopes`, `evidenceCandidates`, `exampleReviewScopeLedger`, `notes`) rather than completed proof.
**Evidence:** `src/runtime/transitions/recovery.ts:209-220`, `src/runtime/transitions/review.ts:202-225`, `src/runtime/domain/review-scope-accounting.ts:539-648`, `tests/runtime-tools.test.ts:900-1064`, `tests/completion-gates.test.ts:783-852`, `tests/runtime/final-review-contracts.test.ts:551-640`, `src/prompts/fragments.ts:102-105`.
**Conclusion:** Expected runtime recovery with misleading agent/UX prose; no runtime bug is evidenced by the selected contracts/tests.

## Root Cause
The runtime is enforcing an intentional review/review-and-fix final-review invariant: every declared review scope target/domain must be accounted for by `reviewScopeLedger` entries with scoped evidence and residual-risk accounting. When a final reviewer decision omits or incompletely accounts for that ledger, `recordReviewerDecision` maps the validation failure to `missing_final_reviewer_review_scope_accounting`, which returns structured recovery targeting `record_review` / `final_reviewer_decision` (`src/runtime/transitions/review.ts:202-225`, `src/runtime/transitions/recovery.ts:209-220`).

The misleading part is the agent-facing prose. The runtime does not literally provide completed “missing scope ledger entries”; it provides recovery scaffolding: declared scopes, available evidence candidates, an example ledger, and notes explaining how to ground each entry (`src/runtime/domain/review-scope-accounting.ts:539-648`). Tests lock that incomplete ledgers fail, declared file targets are returned in recovery details, and complete grounded ledgers can succeed (`tests/runtime-tools.test.ts:982-1064`, `tests/completion-gates.test.ts:783-852`, `tests/completion-gates.test.ts:1169-1228`, `tests/runtime/final-review-contracts.test.ts:551-640`).

## Recommendations
1. Treat the observed retry as normal when it follows `status: "error"` / structured recovery requiring `final_reviewer_decision`.
2. Reword operator/agent prose from “runtime provided the missing scope ledger entries” to “runtime returned declared scopes and an example ledger scaffold; I’ll re-record final review with evidence-grounded entries for every declared target.”
3. Do not re-record `flow_review_record_final` after an `ok` response unless the tool itself errored or `flow_run_complete_feature` returns structured recovery requiring `final_reviewer_decision` (`src/prompts/fragments.ts:102-105`).
4. Treat a live run as suspicious only if a complete grounded ledger still loops with `missing_review_scope_accounting`, invalid/placeholder ledger entries are accepted, valid `reviewScopeLedger` cannot be sent through the OpenCode tool schema, or the agent blindly copies scaffold entries as proof.

## Preventive Measures
- Add/keep tests that distinguish recovery scaffolding from accepted reviewer evidence.
- Consider an end-to-end regression test that repairs a failed final-review ledger using the returned declared scopes, while replacing placeholder residual-risk text with grounded reviewer evidence.
- Keep prompt/descriptor copy explicit that `exampleReviewScopeLedger` is a scaffold and may not be replayable unchanged.

