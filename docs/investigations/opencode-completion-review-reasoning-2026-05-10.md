# Investigation: OpenCode Completion State, Final Review Repeats, and Reasoning Levels

## Summary
The `soft-focus` run looked code-complete, but Flow was not complete: every final-review and final-completion persistence attempt returned `status: "error"`, so the active Flow session correctly remained `status: "running"`. The repeated `flow_review_record_final` rows were repeated model/host tool attempts whose OpenCode metadata reflected requested approval before guarded mutation, not persisted approval; lane-aware `reasoningEffort` is configured/tested in Flow, but the observed OpenCode DB/UI evidence does not prove effective host application or display.

## Symptoms
- OpenCode UI shows the `soft-focus` session title/left rail as if work remains in progress even though the Flow task appears completed.
- The visible chat log contains many repeated `Called `flow_review_record_final`` rows with `scope=final reviewPurpose=completion_gate status=approved`.
- Changing OpenCode reasoning levels did not appear visible in OpenCode, although different reasoning levels were expected to be used on a change in `~/projects/soft-focus`.

## Background / Prior Research

### External/live artifact findings
- `soft-focus` currently has an active Flow session at `/Users/vriesd/projects/soft-focus/.flow/active/e8e23071-1e6c-4311-abc4-0a95a0b83ead/session.json` with `status: "running"`, `activeFeatureId: "responsive-practice-resize"`, feature status `in_progress`, no execution history, and only a feature-scope reviewer decision persisted.
- The active rendered docs at `/Users/vriesd/projects/soft-focus/.flow/active/e8e23071-1e6c-4311-abc4-0a95a0b83ead/docs/index.md` show `status: running`, `closure: open`, `next command: /flow-run`, task progress `active | flow-worker | execution | responsive-practice-resize`, and `pending | flow-reviewer | final_review | Final detailed review`.
- OpenCode SQLite session `ses_1ed8964d4ffeIv5uDwzroTMhaU` is titled `Phaser resizing on window resize`, directory `/Users/vriesd/projects/soft-focus`, created `2026-05-10T15:17:03Z`, updated `2026-05-10T15:30:23Z`. It has 46 messages and 194 parts, including 37 reasoning parts, 57 tool parts, and 15 `flow_review_record_final` tool calls.
- All 15 `flow_review_record_final` calls in that OpenCode session returned JSON `status: "error"`. The first failed argument validation (`behaviorChecks.0.oracleRefs` mismatch); later attempts failed final-review coverage or `reviewScopeLedger` grounding/accounting validation. None persisted a final approval.
- Both observed `flow_run_complete_feature` calls also returned JSON `status: "error"` due `reviewScopeLedger` validation (`src/main.ts` not grounded, then missing `evidenceRefs`). The final assistant message accurately said the code change and checks were complete, but Flow rejected final completion persistence.
- The OpenCode session messages show `agent: flow-auto` and provider/model `openai` / `gpt-5.5`; the session table stores no explicit model/reasoning for this session. The database did store 37 reasoning parts, so reasoning text was visible/recorded, but the DB evidence does not prove lane-specific `reasoningEffort` values were applied per Flow subagent.

### Git archaeology
- `56e8b132e081d716695ea04a35803609b2c24a0b` (`2026-05-10 16:27`) added lane-aware OpenCode `reasoningEffort` metadata: fast=`low`, balanced=`medium`, deep=`high`; planner/reviewer/auditor/research lanes deep/high; worker/control fast/low; auto balanced/medium. It intentionally did not set model/provider defaults.
- `6207fd57d83fd545f3c750caa4cc9860374931df` (`2026-05-10 17:11`) added `/flow-doctor detail` validation/reporting for command routing and per-agent `reasoningEffort` mismatches.
- `9fd6a9dd94b78a9cace03d05ae1054ccfac40232` (`2026-05-08 23:51`) made singleton retries safe and documented repeated review rows as host/model retries plus requested metadata, not an internal runtime retry loop.

### Current OpenCode docs/release context
- Official OpenCode docs/release lookup on 2026-05-10 confirms model/provider options can include `reasoningEffort`; agent config can pass provider-specific options; `/thinking` toggles reasoning display, not reasoning enablement.
- Current OpenCode session status concepts include `idle`, `busy`, and `retry`; tool parts have states such as `pending`, `running`, `completed`, and `error`.
- The docs do not explicitly define whether a custom tool row label represents requested metadata or persisted plugin state. The reliable evidence remains the tool output JSON and Flow session files, not the row label alone.

## Investigator Findings
<!-- Pair investigator appends structured findings here. -->

### 2026-05-10 - Code-path verification pass

#### Question
Verify whether the observed OpenCode `flow_review_record_final` repeats and still-running UI are explained by requested metadata being shown before guarded Flow mutations, with completion persistence blocked by final-review / `reviewScopeLedger` validation, and whether lane-aware `reasoningEffort` is configured but not proven from the observed OpenCode DB row.

#### Ranked synthesis

| Rank | Explanation | Confidence | Basis |
| --- | --- | --- | --- |
| 1 | The repeated `flow_review_record_final` rows are best interpreted as repeated host/model tool attempts whose OpenCode row metadata reflected requested review status, not persisted reviewer approval. | High | The tool emits `requestedTaskStatus` / `requestedReviewStatus` and `persistedReviewStatus: null` before calling the guarded mutation; tests assert metadata has no authoritative `status`. |
| 2 | The Flow session stayed running because `flow_run_complete_feature` only reaches completed-session persistence after successful completion validation; validation failure returns an error before `recordWorkerResult()`, `finalizeSuccessfulCompletion()`, or completed-session storage. | High | `completeExecutionRun()` calls `validateNormalizedSuccessfulCompletion()` first and immediately returns `fail(...)` on validation error; only successful transitions are saved and only completed sessions route to completed storage. |
| 3 | The observed failures are consistent with `reviewScopeLedger` / final-review coverage validation, including final reviewer ledger grounding/accounting requirements. | High | Completion validation directly fails on `describeReviewScopeLedgerFailure()` and final-review/final-reviewer decision failures; the domain validator requires approved final reviewer decisions to include `reviewScopeLedger` and validates ledger entries. |
| 4 | Lane-aware `reasoningEffort` is configured and covered by tests/doctor output, but the observed OpenCode database evidence does not prove those per-agent values were surfaced or persisted by OpenCode for that run. | Medium-high | Flow injects per-agent `reasoningEffort`, tests and `/flow-doctor detail` assert/report it, but the repo evidence only proves Flow config construction, not OpenCode DB/UI persistence. |

#### Evidence

- `src/adapters/opencode/tool-surface/runtime-tools/execution-tools.ts:60-101` — `flow_run_complete_feature` emits OpenCode metadata first, including `taskStatus: "active"`, `requestedTaskStatus`, `requestedWorkerStatus`, and `persistedTaskStatus` / `persistedWorkerStatus` as `null`, then calls `executeGuardedSessionMutation(...)`.
- `src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts:68-116` — `flow_review_record_final` similarly emits metadata first with `requestedTaskStatus`, `requestedReviewStatus`, and `persistedReviewStatus: null`, then calls the guarded mutation with `{ decision: input }`.
- `src/adapters/opencode/tool-surface/runtime-tools/shared.ts:33-42` — the guarded mutation performs mutable-workspace permission checking and then executes the Flow Core command; this happens after metadata emission in both tools.
- `tests/runtime-tools-metadata.test.ts:229-240` and `tests/runtime-tools-metadata.test.ts:320-327` — tests assert completion/review metadata carries requested statuses, `persisted*` fields are null, and `metadata.status` is undefined, confirming metadata is not authoritative persisted state.
- `src/runtime/application/session-actions.ts:230-238` and `src/runtime/application/session-actions.ts:283-294` — `complete_run` calls `completeRun(session, worker)` and JSON-stringifies the dispatched mutation response; errors return `status: "error"` with summary/recovery.
- `src/runtime/application/session-engine.ts:205-238` — failed transitions without a session return a failure response without saving, while successful transitions call `runtime.saveSessionState(...)` and sync artifacts.
- `tests/runtime-tools.test.ts:289-291` and `tests/runtime-tools.test.ts:451-456` — tool tests parse the returned JSON and assert authoritative error statuses/recovery, corroborating that tool output JSON, not row metadata, determines success/failure.
- `src/runtime/transitions/execution-completion-validation.ts:169-184` — `validateNormalizedSuccessfulCompletion()` is the completion gate for normalized worker results.
- `src/runtime/transitions/execution-completion-finalization.ts:181-207` — for `status === "ok"`, `completeExecutionRun()` validates first and returns `fail(validation.message, validation.recovery)` before `recordWorkerResult()` / `finalizeSuccessfulCompletion()` when validation fails.
- `src/runtime/transitions/execution-completion-finalization.ts:18-37` and `src/runtime/transitions/execution-completion-finalization.ts:58-82` — successful finalization marks the feature complete and, when policy targets are complete, calls `markSessionCompleted()` to set `status: "completed"`, closure, `activeFeatureId: null`, and `completedAt`.
- `src/runtime/session-persistence.ts:66-75` and `src/runtime/session-persistence.ts:109-127` — persistence routes only sessions whose status is `"completed"` to completed-session persistence/artifact sync; other sessions remain in active/open persistence.
- `src/runtime/recovery/session-recovery-service.ts:33-49` — completed-session persistence writes the completed session and moves the active session directory to completed storage when the active ID matches.
- `src/runtime/transitions/execution-completion-validation.ts:229-247`, `src/runtime/transitions/execution-completion-validation.ts:291-311`, and `src/runtime/transitions/execution-completion-validation.ts:316-349` — completion validation fails on worker `reviewScopeLedger`, final-review, and final reviewer decision/ledger problems before returning success.
- `src/runtime/domain/review-scope-accounting.ts:714-765` — worker completion `reviewScopeLedger` must account for declared review scope and validates ledger entries against changed artifacts, validation commands, review context, and closures.
- `src/runtime/domain/review-scope-accounting.ts:767-817` — approved final reviewer decisions require `reviewScopeLedger`; missing or structurally invalid ledger entries return explicit failure messages.
- `src/runtime/domain/final-review-coverage.ts:324-330` — final-review coverage failures are aggregated by `describeFinalReviewCoverageFailure(...)`.
- `src/config-shared.ts:1-21` — Flow defines `reasoningEffort` as `low | medium | high` and maps fast/balanced/deep to low/medium/high.
- `src/adapters/opencode/config.ts:37-48`, `src/adapters/opencode/config.ts:52-114`, and `src/audit/config.ts:20-28` — Flow agents receive lane-aware `reasoningEffort`: planning/reviewer/auditor deep/high, worker/control fast/low, auto balanced/medium.
- `src/adapters/opencode/config.ts:177-214` and `src/adapters/opencode/plugin.ts:118-126` — Flow clones/merges core and audit agents into the OpenCode config hook exposed by the plugin.
- `tests/config/plugin-surface.test.ts:376-411` and `tests/mode-contracts.test.ts:200-228` — tests assert command routing and per-agent `reasoningEffort`, and explicitly assert no provider-specific `model`, `variant`, or `reasoning` fields are emitted.
- `src/runtime/application/doctor-checks.ts:35-43`, `src/runtime/application/doctor-checks.ts:85-118`, and `src/runtime/application/doctor-report.ts:130-147` — `/flow-doctor detail` evaluates expected per-agent reasoning budgets and includes full check details in detailed output.
- `tests/runtime-operator-tools.test.ts:197-213` and `tests/runtime-operator-tools.test.ts:238-268` — doctor tests assert detailed output includes the full `agentReasoningEffort` map and reports reasoning/route mismatches.

#### Conclusions

- **Evidence:** OpenCode metadata rows for these tools are requested/provisional UI hints emitted before guarded mutations. They intentionally include `persisted*` fields as `null` and omit authoritative `metadata.status`.
- **Evidence:** Completion persistence is gated by `validateNormalizedSuccessfulCompletion()`. If that validation rejects the worker payload, the transition failure contains no session to save, so completed-session state and completed-session storage are never reached.
- **Inference:** The live `soft-focus` active session remaining `running` is the expected result when final completion attempts return JSON `status: "error"` from validation failures, even if the assistant text says the implementation/checks were complete.
- **Inference:** The repeated final-review rows are not evidence of successful final approvals or an internal Flow retry loop. They are consistent with the model/host repeatedly attempting the tool with requested approval metadata while Flow rejected the payloads.
- **Evidence:** Flow now configures lane-aware `reasoningEffort` and can report it through `/flow-doctor detail`.
- **Unknown:** The repository evidence does not establish whether OpenCode persisted or displayed the specific per-agent `reasoningEffort` values for the observed session; that remains an OpenCode host/database visibility question.

#### Eliminated hypotheses

- **Eliminated:** “The OpenCode row label/status proves final-review approval persisted.” The code and tests show row metadata is request-time/provisional and persisted review status remains null until the guarded mutation succeeds.
- **Eliminated:** “Flow marks completion before validation and later fails cleanup.” The code validates first; failure returns before worker result recording, successful finalization, saving, or completed-session storage.
- **Eliminated:** “The observed repeated final-review rows require an internal Flow retry loop.” The traced code path performs one guarded mutation per tool call; repeated rows can be explained by repeated host/model tool invocations with request metadata.
- **Not eliminated:** “OpenCode accepted `reasoningEffort` at config time but did not surface it in the observed DB/UI.” Flow-side config/tests support the setting, while observed DB visibility remains unproven.

#### Improvement opportunities

- Make OpenCode tool metadata titles/fields more explicit, for example “Final reviewer requested approved (pending persistence)” and `metadataAuthority: "requested_only"`, to reduce UI misinterpretation.
- Consider adding final tool-return metadata or guidance that distinguishes requested status from persisted session/reviewer status after mutation completion.
- Add a focused regression test for validation-failure completion attempts that asserts no completed-session persistence path is called when `validateNormalizedSuccessfulCompletion()` rejects due to `reviewScopeLedger` / final-review coverage.
- Extend `/flow-doctor detail` or a diagnostic command to state that it verifies Flow-injected config only, not OpenCode host persistence/display of per-agent `reasoningEffort`.
- If OpenCode exposes a supported runtime/session API for effective agent options, add a future read-only diagnostic that compares Flow-injected `reasoningEffort` to host-observed effective options.

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** The symptoms may combine OpenCode host presentation/state, Flow final-review retry behavior, and plugin prompt/model/reasoning metadata that may not be surfaced by the OpenCode UI.
**Findings:** Prior repo investigation already established that repeated `flow_review_record_final` rows can come from request-derived metadata plus recovery/retry behavior rather than an internal runtime retry loop.
**Evidence:** `docs/investigations/final-review-record-repeat-2026-05-08.md`.
**Conclusion:** Need to inspect the latest code paths and the live `soft-focus` run artifacts/logs before concluding.

## Root Cause

### Direct evidence
- Flow did not persist final completion for the observed `soft-focus` run. The active Flow session remained `status: "running"`, with active feature `responsive-practice-resize`, no execution history, and only a feature-scope reviewer decision persisted.
- In the OpenCode session `ses_1ed8964d4ffeIv5uDwzroTMhaU`, all 15 `flow_review_record_final` tool calls returned JSON `status: "error"`; both `flow_run_complete_feature` calls also returned `status: "error"`.
- The code path validates completion before persistence: `completeExecutionRun()` returns validation failure before worker-result recording, finalization, `markSessionCompleted()`, or completed-session storage (`src/runtime/transitions/execution-completion-finalization.ts:181-207`).
- OpenCode metadata rows are request-time/provisional: `flow_review_record_final` and `flow_run_complete_feature` call `context.metadata()` before guarded mutation, carrying requested status and null persisted status (`src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts:68-116`, `src/adapters/opencode/tool-surface/runtime-tools/execution-tools.ts:60-101`).
- The observed failures match final-review and `reviewScopeLedger` validators that reject ungrounded/missing evidence refs and incomplete scope accounting (`src/runtime/domain/review-scope-accounting.ts:714-817`, `src/runtime/transitions/execution-completion-validation.ts:229-349`).
- Flow now injects lane-aware `reasoningEffort` in OpenCode config and covers it with tests/doctor reporting (`src/config-shared.ts:1-21`, `src/adapters/opencode/config.ts:37-114`, `src/audit/config.ts:20-28`, `tests/config/plugin-surface.test.ts:376-411`, `tests/runtime-operator-tools.test.ts:197-268`).

### Inference
The code change itself may have been implementation-complete and locally validated, but Flow completion persistence failed because the final review / review-scope-ledger payloads did not satisfy the strict runtime contract. Therefore OpenCode showing the task as still in progress was consistent with Flow state, while the repeated approved-looking final-review rows were misleading presentation of repeated requested tool calls.

### What worked as intended
- Flow did not mark a session complete after failed validation.
- Failed final-review/completion attempts did not overwrite active state or move the session to completed storage.
- Strict review gates caught under-grounded final-review and scope-ledger evidence.
- Reasoning-effort configuration is present, tested, and doctor-reportable on the Flow side.

### What did not work well
- The OpenCode row presentation made requested approval look like persisted approval.
- Recovery guidance for `reviewScopeLedger` was difficult for the model to operationalize; it retried many similar invalid payloads.
- The final assistant message separated code completion from Flow completion, but the UI/status distinction remained easy to miss.
- The observed DB/UI does not expose enough evidence to confirm effective per-agent `reasoningEffort` settings.

## Recommendations
1. Make review/completion tool metadata labels explicitly provisional, e.g. “requested approved (pending persistence)” and/or `metadataAuthority: "requested_only"`.
2. Surface post-mutation JSON result status and latest failure category more prominently in operator/status output so `status: "error"` is hard to miss.
3. Improve `reviewScopeLedger` recovery guidance with concrete grounding examples and warnings not to replay scaffold/example values.
4. Add a diagnostic summary for the latest failed final-review/completion attempts by validator category.
5. Clarify `/flow-doctor detail` wording: it verifies Flow-injected config, not OpenCode host-effective or UI-displayed `reasoningEffort`.
6. If OpenCode exposes effective agent options, add a read-only diagnostic comparing Flow-injected `reasoningEffort` with host-observed settings.

## Preventive Measures
- Keep tests that assert requested-vs-persisted metadata remains explicit and non-authoritative.
- Add regression coverage that failed completion validation does not enter completed-session persistence.
- Add prompt/runtime guidance to stop repeated final-review retries after repeated same-category `reviewScopeLedger` failures and inspect `/flow-status`/recovery details instead.
- Document the operator distinction between “implementation validated” and “Flow session completed/persisted.”
