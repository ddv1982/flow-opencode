# Investigation: Repeated `flow_review_record_final` Calls

## Summary
Repeated visible `flow_review_record_final` / `flow_review_record_feature` rows are primarily caused by request-status metadata and host tool-call presentation being shown before Flow mutation success is known. Final review adds legitimate retry/re-record behavior when strict completion-gate validation rejects or invalidates an approval; the selected runtime path shows no internal retry loop.

## Symptoms
- During implementation of a new feature, the session log showed `flow_review_record_final` called multiple times in succession.
- The first visible call appears to have been rejected for overly broad review metadata; later calls appear to retry approval with more grounded evidence.
- User question: is this normal retry behavior, a prompt/runtime design issue, or an unintended loop?
- Follow-up evidence: similar behavior appears for `flow_review_record_feature`; after the visible feature summary looks complete, the UI still shows/flashes a `Called flow_review_record_feature` row. This broadens the investigation from final-review-only retry semantics to possible generic OpenCode tool-call row rendering/status presentation.

## Background / Prior Research
No external docs or web research needed. This is repository-local behavior around Flow final review tooling, prompt guidance, schemas, and runtime review persistence.

## Investigator Findings
<!-- Pair investigator appends structured findings here. -->

### 2026-05-08 — OpenCode review-record row/status investigation

#### Question
Why can a Flow/OpenCode log show multiple consecutive `flow_review_record_final` calls, and why can the row look approved even when an initial approved payload is rejected and retried? New user evidence shows the same row/flash phenomenon for `flow_review_record_feature`, so this trace separates generic OpenCode tool-call presentation from final-review-specific retry semantics.

#### Ranked synthesis
| Rank | Explanation | Confidence | Basis |
| --- | --- | --- | --- |
| 1 | A `status=approved` / `Final reviewer approved` / `Reviewer approved ...` row is primarily request metadata emitted before the guarded runtime mutation finishes, not proof that the decision persisted. The feature-review tool has the same requested-status metadata behavior. | High | `review-tools.ts` emits `context.metadata` from `input.status` before `executeGuardedSessionMutation` for both feature and final review calls. |
| 2 | The runtime implementation path is single-call/no internal retry loop. Repeats are caused by the agent/host making multiple tool invocations after errors or recovery guidance, not by `record_final_review` recursively retrying itself. | High | `withParsedArgs -> executeGuardedSessionMutation -> executeFlowCoreCommand -> record_final_review -> recordReviewerDecision` is linear; no loop or retry branch appears in the traced code. |
| 3 | Final review has extra retry/re-record semantics that feature review does not: final completion re-checks the recorded final decision against the worker result, broad validation, coverage, and review-scope accounting, and can return recovery that tells the agent to record/re-record the final reviewer decision. | High | `validateNormalizedSuccessfulCompletion` revalidates final decisions and maps final reviewer accounting failures to `record_review` recovery. |
| 4 | Historical HEAD behavior overwrote singleton `session.execution.lastReviewerDecision` for identical direct-transition records; current direct-transition and session-action/runtime-tool paths treat identical duplicate reviewer decisions as no-op successes, while changed decisions still overwrite the singleton. | High | Current `recordReviewerDecision` checks for an already recorded decision before assignment; review actions preserve that no-op behavior before persistence; `recordWorkerResult` appends execution history separately. |
| 5 | Prompt guidance permits bounded retry/recovery behavior, while v2.0.13 reduced prompt duplication. Pure prompt duplication remains possible but is less supported as the primary explanation for consecutive rows than requested metadata + recovery-driven re-invocation. | Medium-high | Prompt fragments tell agents to resolve runtime errors and satisfy structured recovery; tests bound literal tool-name occurrences to `<= 2`. |

#### Evidence
- `src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts:41-56` — `flow_review_record_feature` emits `context.metadata` with `title: Reviewer ${input.status} ${input.featureId}`, `requestedTaskStatus: input.status`, and `status: input.status` before calling `executeGuardedSessionMutation`. This means feature-review rows can show the requested reviewer status before domain validation/persistence completes.
- `src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts:73-111` — `flow_review_record_final` has the same pattern: it emits `title: Final reviewer ${input.status}`, `requestedTaskStatus: input.status`, `status: input.status`, and review-count metadata before the guarded `record_final_review` mutation runs.
- `src/adapters/opencode/tool-surface/parsed-tool.ts:24-34` and `src/runtime/application/workspace-runtime.ts:225-245` — schema parse happens before the tool body runs; parse failures return JSON `{ status: "error", summary }` without calling the metadata block. Therefore the pre-validation metadata issue applies after tool-arg parsing succeeds but before guarded/domain mutation validation succeeds.
- `src/adapters/opencode/tool-surface/runtime-tools/shared.ts:33-40`, `src/runtime/application/flow-core.ts:149-170`, `src/runtime/application/session-actions.ts:242-243`, and `src/runtime/application/session-review-actions.ts:37-46` — the final-review mutation path is linear: guarded adapter mutation -> Flow core command -> `record_final_review` -> `createFinalReviewerDecisionAction` -> `recordReviewerDecision(normalizeFinalReviewDecision(decision))`.
- `src/runtime/application/session-engine.ts:240-276` — a mutation loads the session once and executes the transition once. `executeTransitionAtRoot` persists only on success, or saves only when a failing transition returns a replacement session; there is no built-in retry loop around review recording.
- `src/runtime/domain/reviewer-decision.ts:118-315` — final-review decision validation rejects malformed or ungrounded approved decisions: final scope must include `reviewDepth`, known `reviewedSurfaces`, `evidenceSummary`, `validationAssessment`, and `evidenceRefs`; approved decisions are checked by `describeFinalReviewCoverageFailure` and `describeFinalReviewerReviewScopeFailure` before a decision is built.
- `src/runtime/domain/final-review-coverage.ts:96-150` and `src/runtime/domain/final-review-coverage.ts:260-331` — coverage failure reasons include missing evidence fields, unknown changed artifact refs, unknown validation command refs, missing required review surfaces, validation-evidence claims without validation commands, claimed surfaces not backed by artifact/context evidence, and required artifact-backed surfaces without refs.
- `src/runtime/domain/review-scope-accounting.ts:757-807` — approved final reviewer decisions for review/review-and-fix sessions must include `reviewScopeLedger`, structurally valid ledger entries, and accounting for every declared scope.
- `src/runtime/transitions/review.ts:91-99` — feature reviewer decisions have post-metadata domain validation too: they fail if no feature is active or if the decision feature id does not match the active feature. A `Called flow_review_record_feature` row can therefore be a requested call even if later rejected.
- `src/runtime/transitions/review.ts:163-209` — historical HEAD behavior at the direct domain-transition layer overwrote singleton `execution.lastReviewerDecision` for identical decisions; current `recordReviewerDecision` validates/builds the decision, returns no-op success when the same decision is already recorded, and only changed successful decisions set `execution.lastReviewerDecision = decision` plus `lastSummary = decision.summary`. It does not append history.
- `src/runtime/schema.ts:336-386` — session execution state models `lastReviewerDecision` as a singleton nullable field and `history` as a separate array.
- `src/runtime/transitions/execution-completion-normalization.ts:200-242` — history is appended when a worker result is recorded, and that history entry snapshots `session.execution.lastReviewerDecision`; reviewer-record calls themselves do not append history rows.
- `src/runtime/application/session-review-actions.ts` and `tests/runtime-tools.test.ts` — current session-action/runtime-tool behavior also treats identical repeated feature and final reviewer records as no-op successes that skip session persistence; changed reviewer decisions still persist and replace the singleton decision.
- `src/runtime/transitions/execution-completion-validation.ts:53-65` and `src/runtime/transitions/execution-completion-validation.ts:86-130` — final completion re-checks the recorded decision: it must be approved, final-scope, match `deliveryPolicy.finalReviewPolicy`, pass final coverage, and pass final reviewer scope accounting.
- `src/runtime/transitions/execution-completion-validation.ts:320-356` — if final completion rejects the recorded final decision, it returns completion recovery. Review-scope accounting failures choose `missing_final_reviewer_review_scope_accounting`; other missing/invalid final decisions choose `missing_reviewer_decision`.
- `src/runtime/transitions/recovery.ts:121-137` and `src/runtime/transitions/recovery.ts:209-217` — final recovery for missing reviewer decision and missing final reviewer review-scope accounting uses `recoveryStage: "record_review"`, `requiredArtifact: "final_reviewer_decision"`, `retryable: true`, and `autoResolvable: true`; the latter explicitly says to re-record the final reviewer decision with proper `reviewScopeLedger`.
- `src/prompts/fragments.ts:31-38` and `src/prompts/fragments.ts:49-52` — prompt rules require final review before final completion, instruct agents to persist reviewer decisions through canonical review-record tools, and tell agents to treat runtime contract errors/completion-gate failures as recoverable work.
- `src/prompts/generated/role-prompts.ts:206-216` and `src/prompts/generated/role-prompts.ts:263-268` — worker/auto workflow text tells agents to persist final approval with `flow_review_record_final`, inspect structured recovery when `flow_run_complete_feature` fails, and keep fixing/revalidating until final review passes.
- `tests/runtime-tools-metadata.test.ts:236-255` — metadata coverage asserts feature-review metadata exposes `taskOwner: flow-reviewer`, `taskPhase: review`, `taskStatus: active`, and `requestedTaskStatus: approved`, corroborating that review metadata is request-status oriented.
- `tests/runtime-tools.test.ts:478-529` — the final-review tool returns structured recovery details for review-scope accounting failures, including `status: "error"`, `recovery.errorCode: "missing_review_scope_accounting"`, `recoveryStage: "record_review"`, `prerequisite: "reviewer_result_required"`, and `requiredArtifact: "final_reviewer_decision"`.
- `tests/runtime/plan-and-tool-schema-contracts.test.ts:128-181` — a successful `flow_review_record_final` response returns `status: "ok"` and a session whose `lastReviewerDecision.scope` is `final`, distinguishing successful persistence from pre-mutation metadata emission.
- `tests/reviewer-decision-scope.test.ts:139-307` — direct transition tests cover final-review rejection for missing `reviewDepth`, policy mismatch, unknown surfaces, missing strict-review ledger accounting, and missing behavior accounting.
- `docs/releases/v2.0.10.md:3-20` — v2.0.10 intentionally hardened live `flow_review_record_final` approval to require explicit, behavior-grounded evidence and fail fast before shallow approvals are recorded.
- `docs/releases/v2.0.13.md:3-21`, `tests/config/prompt-contracts.test.ts:185-194`, and `tests/config/prompt-contracts.test.ts:416-422` — v2.0.13 intentionally narrowed prompt duplication; tests keep `flow_review_record_final` and `flow_run_complete_feature` occurrences bounded to at most two per worker/auto prompt.

#### Conclusions
- Displayed review-row status is not a reliable persistence signal. For both `flow_review_record_feature` and `flow_review_record_final`, Flow adapter metadata uses requested `input.status` and is emitted before the guarded mutation completes. The generic OpenCode `Called <tool>` row should be read as “the model/host invoked this tool,” not “Flow successfully persisted this decision.”
- The feature-review phenomenon is mostly generic presentation/metadata behavior. A feature review call can still appear after the surrounding prose summary because the host shows tool-call rows independently of Flow state, and Flow’s metadata says `requestedTaskStatus: approved` as soon as the parsed tool body begins. Feature-review recording itself has only simple active-feature validation after metadata; no final-completion re-record loop is specific to feature review.
- The final-review repeats have an additional runtime explanation. Final completion can reject a previously recorded final approval if the worker result, broad validation, coverage, or review-scope accounting does not line up with the recorded final decision. The recovery metadata then tells the agent to satisfy the prerequisite and re-record the final reviewer decision, which can produce consecutive `flow_review_record_final` calls.
- There is no evidence of an internal retry loop inside the runtime tool or transition. Repeated rows require repeated host/model invocations, likely driven by prompt/recovery guidance after a rejected call or after `flow_run_complete_feature` rejects the recorded decision.
- Historical HEAD behavior did not dedupe identical direct-transition reviewer decisions, but current direct-transition and session-action/runtime-tool paths have identical-decision no-op guards. Changed successful review-record calls still overwrite the singleton `lastReviewerDecision`; reviewer-record calls still do not append history rows, so durable execution history only captures whichever decision is current when a worker result is recorded.

#### Eliminated or down-ranked hypotheses
- **Eliminated:** “`status=approved` in a Flow/OpenCode review row proves successful persistence.” The metadata is request-derived and emitted before mutation validation/persistence.
- **Eliminated:** “The runtime internally retries `record_final_review`.” The traced code path is single-pass and has no retry loop.
- **Eliminated:** “Feature-review rows require a final-review-specific retry mechanism.” The feature-review tool shares the same requested-status metadata pattern and generic host row rendering can explain the observed flash even without final-review completion recovery.
- **Down-ranked:** “Pure prompt duplication is the primary cause.” Prompt rules do encourage recovery/retry, but v2.0.13 bounded repeated literal tool guidance; runtime recovery plus request-derived metadata better explains the observed sequence.

#### Confidence
High for the code-path conclusions above. Medium for the UI-host interpretation because the repository exposes the `context.metadata` seam and tool responses, but the exact OpenCode client rendering of `Called <tool>` rows is outside this repo. The repository evidence is sufficient to conclude that a visible `Called flow_review_record_feature/final` row and requested `approved` metadata do not by themselves prove that Flow persisted an approved reviewer decision.

## Investigation Log

### Phase 1 - Initial triage
**Hypothesis:** Repeated calls may be expected if the runtime/tool schema rejects the first payload and the agent retries with corrected metadata.
**Findings:** Exact tool references appear across runtime review tools, schemas, prompt surfaces, tests, and prior review investigations.
**Evidence:** Initial search found `flow_review_record_final` in `src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts`, `src/adapters/opencode/tool-surface/schemas.ts`, `src/prompts/fragments.ts`, `src/prompts/generated/role-prompts.ts`, `tests/config/tool-schemas.test.ts`, and prior docs.
**Conclusion:** Needs context-builder selection and main investigator trace before concluding.

## Root Cause
The broadened evidence points to two layered causes:

1. **Generic review-tool presentation ambiguity.** Both `flow_review_record_feature` and `flow_review_record_final` emit `context.metadata` from requested `input.status` before `executeGuardedSessionMutation` runs (`src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts:41-56`, `src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts:73-111`). A UI row like `Called flow_review_record_feature` or requested `approved` metadata therefore means the tool body started with parsed args, not that Flow persisted the decision. Parse failures return before metadata (`src/adapters/opencode/tool-surface/parsed-tool.ts:24-34`, `src/runtime/application/workspace-runtime.ts:225-245`), but guarded mutation/domain validation failures can happen after the approved-looking metadata row.
2. **Final-review-specific recovery.** Final completion revalidates the recorded final decision against the worker result, review policy, coverage, and review-scope accounting (`src/runtime/transitions/execution-completion-validation.ts:53-130`, `src/runtime/transitions/execution-completion-validation.ts:315-356`). If that check fails, recovery can explicitly send the agent back to `record_review` / `final_reviewer_decision` (`src/runtime/transitions/recovery.ts:121-137`, `src/runtime/transitions/recovery.ts:209-217`), producing additional `flow_review_record_final` calls.

The runtime call path itself is linear: guarded adapter mutation → Flow core command → `record_final_review` / `record_feature_review` action → `recordReviewerDecision` (`src/adapters/opencode/tool-surface/runtime-tools/shared.ts:33-40`, `src/runtime/application/flow-core.ts:149-170`, `src/runtime/application/session-actions.ts:238-243`, `src/runtime/application/session-review-actions.ts:25-46`, `src/runtime/transitions/review.ts:163-209`). No selected code supports an internal retry loop. Historically, successful repeated direct-transition review records were not deduped: identical records overwrote singleton `execution.lastReviewerDecision` rather than appending a reviewer-history row (`src/runtime/transitions/review.ts:163-209`, `src/runtime/schema.ts:336-386`, `src/runtime/transitions/execution-completion-normalization.ts:200-242`). Current direct-transition and session-action/runtime-tool paths now guard identical feature/final reviewer decisions as no-op successes, while changed decisions still overwrite the singleton and reviewer-record calls still do not append history rows.

## Eliminated Hypotheses
- **`status=approved` proves successful persistence:** eliminated. The metadata is request-derived and emitted before mutation validation/persistence.
- **Runtime internally retries `record_final_review`:** eliminated. The traced mutation path is single-pass.
- **Feature-review flashing requires final-review recovery semantics:** eliminated. Feature review has the same requested-status metadata pattern and generic host row behavior.
- **Pure prompt duplication is the primary cause:** down-ranked. Prompt guidance encourages resolving runtime recovery, but v2.0.13 and tests bound literal prompt duplication; recovery-driven re-invocation plus UI ambiguity better explain the observations.

## Recommendations
1. Treat raw tool response status as authoritative: `status: "error"` followed by retry is expected recovery; repeated `status: "ok"` no-op responses indicate an identical decision was already recorded without a state save.
2. UI/log improvement: label review tool metadata as requested status, and display final tool response status separately so `Called ... approved` is not confused with persisted approval.
3. Prompt improvement: after `flow_review_record_final` returns `ok`, do not call it again unless `flow_run_complete_feature` rejects the recorded decision with structured recovery.
4. Runtime/doc improvement: keep identical-review no-op behavior covered by tests and continue distinguishing historical direct-transition overwrite behavior from current no-op handling plus changed-decision singleton overwrite behavior.

## Preventive Measures
- Add regression coverage that distinguishes pre-mutation metadata from successful persistence in review tool rows.
- Keep tests for repeated successful review-record calls so identical duplicates remain no-op successes and changed decisions remain explicit singleton overwrites.
- Keep final-review recovery messages explicit about when to re-record the reviewer decision versus when to retry completion with the existing decision.

## Follow-up (2026-05-08)
- Mutation-owning prompt surfaces (planner/worker/auto role prompts and plan/run/auto command templates) now include generic singleton retry guidance: treat runtime metadata as request progress, and avoid repeating singleton runtime transitions after `ok` unless response loss, `flow_status` evidence, or structured recovery explicitly requires it.
- Prompt contract tests now assert that this guidance appears only on mutation-owning surfaces and is absent from reviewer, planning-researcher, status, doctor, and control prompts.
- Worker completion remains intentionally non-idempotent: the guidance explicitly forbids repeating history-appending completion calls without new worker evidence.
