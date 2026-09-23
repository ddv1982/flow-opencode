# Flow overhaul investigation

Flow should become easier for current models to drive while preserving the guarantees that make it useful for consequential changes. The strongest direction is a smaller prompt protocol, better model configuration evidence, and evals that measure completed work and review quality. The durable Session v5 runtime already contains substantial working behavior. A replacement of that runtime would spend the existing evidence before the new design has earned it.

This investigation covers repository commit `52ddb8be284f07562ef0f64fe64664e8ae973a30`, Flow 8.2.1, and OpenCode 1.18.6. Research was retrieved on 2026-09-13 through Exa, Ref, and official OpenAI documentation. Production source files were not changed. The four preexisting untracked 8.2.1 canary files were preserved. The [execution plan](overview.md) is the deliverable for the proposed overhaul.

## What Flow does today

OpenCode loads the plugin, registers five commands and the worker and reviewer roles, and routes lifecycle tools into the application layer. The domain layer advances one approved feature at a time. The filesystem layer locks the session, validates persisted input, writes atomically, and publishes an archive without replacing an existing archive. OpenCode hooks capture validation against the workspace. The reserved reviewer submits its own result. The manager integrates work and drives the next feature or closure.

The code already separates state, application use cases, persistence, and host integration. The important boundary is between rules the runtime enforces and judgments the manager or reviewer makes. Goal alignment, task decomposition, the fitness of a declared validation gate, and the substance of a review remain judgments. A successful workflow does not prove the product is correct. See [the guarantees](../../../docs/guarantees.md) and [the maintainer contract](../../../docs/maintainer-contract.md).

## Preserve these strengths

| Strength | Evidence in the repository | Treatment |
| --- | --- | --- |
| Durable state with revisions and exact operation replay | `src/domain/transitions.ts`, `src/domain/session-invariants.ts`, `src/infrastructure/fs/session-repository.ts` | Keep the aggregate and mutation semantics. Add missing terminal capacity checks. |
| Validation belongs to actual workspace content | `src/infrastructure/fs/source-identity.ts`, `src/platform/opencode/validation-capture.ts` | Preserve source binding and rejection after drift. |
| A failing declared command cannot be cleared by another passing command | `src/domain/validation.ts`, ADR 0009 and ADR 0010 | Keep the veto semantics and executable regressions. |
| Named acceptance checks cannot be replaced by an exit code | `src/domain/request-evidence.ts`, `src/domain/test-results.ts`, `src/infrastructure/junit-results.ts` | Keep named assertions and incomplete evidence checks. |
| Reviewer-owned completion and finding continuity | `src/platform/opencode/plugin.ts`, `src/domain/review-findings.ts`, `src/domain/transitions.ts` | Keep independent submission and stable finding IDs. |
| Bounded retries, worker delegation, and continuation | `src/platform/opencode/auto-drive.ts`, `src/config-shared.ts`, ADR 0006 and ADR 0008 | Retain current authority bounds during all prompt experiments. |
| Regradable release evidence tied to package bytes | `evals/report-store.ts`, `evals/qualification-bundle.ts`, `evals/release-policy.ts` | Extend the existing evidence system. Keep release qualification distinct from product-value experiments. |

The useful simplification target is repeated interpretation of these rules. It is not the existence of the rules.

## What the retained evidence proves

The original reproducible inventory is unavailable. Its investigation record found 38 finalized V2 reports containing 1,238 attempts. Every report uses rate analysis. There are no finalized paired reports in this local result set. The repository also contains two committed qualification bundles. Local evidence may be incomplete, so absence here does not prove nobody has run comparisons elsewhere.

The September 5 report is unavailable. Historical investigation notes record 76 of 76 scored conformance passes using `openai/gpt-5.6-sol` and `xai/grok-4.6`. Its artifact came from commit `8a935dedd339a654cd1e4677b3a63dd1fbb0b0f0`, not the current checkout. It is historical evidence, not qualification of this HEAD. There is no sealed 8.2.1 qualification bundle in the inspected bundle directory.

That campaign has 23 review assignments, 23 silent passing reviews, and no findings. This does not show that the reviewer is ineffective. The campaign chiefly tests workflow behavior and includes clean work. It does show why release passes cannot establish defect detection. Full campaign cost is unknown because only 38 of 76 runs report cost. The V2 total correctly remains null. The partial dollar sum in the older summary must not be presented as total spend.

Parent verification during this investigation passed `bun run check`. Its test stage had 828 passes, one opt-in live test skipped, and no failures. The test stage took 45.05 seconds. The separate packed-host smoke then passed all 21 tests on OpenCode 1.18.6 in 6.37 seconds. All 13 replay cassettes reproduced. See [verification](evidence/verification.md). The original replay output and live-host output are unavailable. No paid model campaign was run.

## Fix the measurement before changing the behavior

| Finding | Evidence | Implication |
| --- | --- | --- |
| Paired runs compare Flow against plain OpenCode, not two Flow package versions | `evals/benchmark-run.ts:433`, `:446`, `:462` | Add immutable artifact selection per arm before comparing the old and rewritten plugin. |
| The default power rule needs 265 pairs | `evals/experiment.ts:467`, `evals/experiment-power.ts:15` | Five balanced tasks require 53 repeats and 530 primary attempts. The one-hour and 200,000-output-token defaults in `benchmark-run.ts:311` do not provide a practical general tuning regime. Underpowered results already remain inconclusive, which is correct. |
| Completion claims use different rules for the two arms | `evals/benchmark-run.ts:186` | Plain OpenCode uses an English keyword regex. Flow uses durable closure. Separate workflow completion from an identically graded user-facing completion claim. Include negation, quoted text, partial work, and other languages. |
| Reviewer grading rewards the verdict without checking the defect explanation | `evals/reviewer-run.ts:187` | An unrelated reason to fail can receive credit on a planted-defect task. Match findings to independent defect labels and evidence. |
| Reviewer calibration has one planted defect and one clean fixture | `evals/reviewer-cases.ts:19` | The two hardcoded rater IDs are fixture labels, not evidence that human calibration happened. Add adjudicated cases across actual change types. |
| Full observed model identity is unavailable to reviewer promotion | `evals/reviewer-run.ts:163`, `evals/reviewer-calibration.ts` | Preserve observed route and model facts separately from unknown family, revision, and gateway details. Do not infer independent model families from a configured string. |
| The host collects more usage than V2 attempts retain | `evals/harness.ts:1968`, `evals/report.ts`, `evals/benchmark-run.ts:249` | Preserve available input, reasoning, cache, role, and intervention measurements with their provenance. Never convert unknown cost to zero. |
| The value runner deletes its fixture without retaining a complete regradable product artifact | `evals/benchmark-run.ts:495`, `:583` | Retain the final source and grader-owned result receipt. The current transcript and grade boolean cannot independently reproduce product correctness. |

The existing five hidden executable benchmarks, shuffled paired blocks, masked analysis, immutable attempt files, environment reserves, and report-only policy are useful foundations. Replacing this machinery with an external evaluation platform would not solve the weaknesses above.

## Simplify the actual prompt stack

The original prompt inventory is unavailable. It measured the assembled auto router plus planning and execution guidance at 17,346 bytes and 2,386 whitespace words. These are static text measurements, not tokenizer counts. The 788-byte manager kernel appears twice in that stack. Compaction and continuation can introduce another copy. The reviewer prompt is 7,555 bytes.

Prompt economy tests mostly inspect seven compiled command and role strings. The long planning and execution guides have a combined size test, but are outside the same absolute-rule and duplicate-sentence loops. Several behavior tests also require exact wording. See `tests/prompt-quality.test.ts:395`, `src/guidance/catalog.ts:13`, `src/prompt-surfaces.ts:94`, and `src/platform/opencode/auto-drive.ts`.

There is room to remove repeated procedures, but text size alone is not a quality measure. Test these changes one at a time.

1. Include manager authority and recovery rules once per effective instruction context.
2. Let runtime projections supply exact next actions and operation arguments where the runtime already knows them.
3. Load short phase-specific guidance when needed. Keep outcome criteria, scope, and missing-evidence behavior clear.
4. Remove generic instructions to recheck everything and repeatedly explain state already rendered by the runtime.
5. Replace wording assertions with behavior checks, retaining structural tests for routing, permissions, schema shape, and protected identifiers.

Do not remove the independent reviewer or authoritative validation as part of this prompt subtraction. Those are Flow's product contract. Any experiment that changes review frequency needs separate outcome evidence and an explicit policy decision.

## Treat model configuration as part of the experiment

Flow currently configures the reviewer's optional model and step limit. The manager and worker inherit the host's model selection. A step limit is not reasoning effort. Flow does not expose or preserve an explicit variant contract in automatic continuation. OpenCode 1.18.6's installed types contain variant fields, but Flow's `AutoDriveDelivery` and `promptAsync` forwarding use agent and model fields. This is an untested preservation gap, not proof that the host resets effort.

The installed plugin receives the default SDK client. Its v1 `promptAsync` request type lacks the variant field that the v2 request type exposes. A local type cast cannot prove the live v1 client forwards that setting. F2 must verify the actual client and endpoint, then use the smallest supported adapter change if needed.

The first modern-model probe must establish the complete path from configured model and variant through the initial turn, worker, reviewer, continuation, compaction, and recovery. Record requested configuration, observed host fields, and provider facts separately. A successful short text reply is insufficient proof that tool calling works.

Use a compact experiment matrix after this probe. Preserve GPT-5.6 Sol and Grok 4.6 as historical comparison cells. Add GPT-6 Astra and Claude Opus 5 only through routes the pinned host resolves and the account can call. Start with two supported effort variants per current model. Hold the manager fixed while changing the reviewer, then reverse that experiment. Do not multiply every role, model, effort, prompt, and workflow option into one campaign.

## What current research changes

OpenAI's current guide identifies GPT-6 Astra as the latest model. It calls out stronger sensitivity to skill instructions, approval pauses, delegation choices, and excess testing. The migration guidance requires Responses for tool calls, does not support `none` effort, and removes several sampling parameters. These are host adapter compatibility questions for Flow, since OpenCode owns provider transport. They do not justify adding a second provider client to the plugin. [Official model guidance](https://developers.openai.com/api/docs/guides/latest-model).

Anthropic documents adaptive thinking as the Opus 5 default. Its prompting guide advises removing inherited verification instructions because they can cause redundant work. It also calls for explicit task scope. This supports an ablation of repeated self-verification guidance. It does not establish that Flow's independent review can be removed without losing defect detection. [Opus 5 changes](https://platform.claude.com/docs/en/models/opus-5/whats-new-opus-5?codeTab=Python#what-s-new-in-claude-opus-5), [scope and verification guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5.md#task-scope-and-over-verification).

Anthropic's March 2026 application-development experiment found that a broad simplification lost performance. Removing individual components made their contribution easier to assess. Its newer-model experiment retained planning and final evaluation while removing sprint structure. That is evidence for component ablations, not a universal recommendation to remove feature reviews. The tasks and model versions differ from Flow. [Application development experiments](https://www.anthropic.com/engineering/harness-design-long-running-apps).

Anthropic's context guidance favors a small set of clear instructions, distinct tools, and information loaded when needed. It also warns against encoding a long list of procedural branches in prompts. Flow already has lazy guidance and typed runtime state, which make this direction practical. Measure total delivered context, including schemas and tool output, so moving words into a different channel does not count as a win. [Context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

The agent-eval guidance separates outcomes from transcripts, recommends deterministic checks where possible, and distinguishes difficult capability tasks from regression tasks. Repeated trials measure variability. Flow should preserve its conformance suite and add harder outcome and reviewer suites with independent truth. Report first-attempt success and repeated-run reliability separately. [Agent evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

OpenAI recommends task-specific evals, blinded comparisons, human calibration, and care with position and verbosity bias. Its current documentation also announces retirement of its hosted Evals platform. The general methodology remains useful; a new dependency on that hosted platform would be a poor fit for this overhaul. [Evaluation practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

Ref confirms that OpenCode owns model options, agent configuration, permissions, and compaction hooks. Its models page explicitly warns that the recommended-model list may be stale. Use these pages for host interfaces, then verify model facts with providers and compatibility with the installed host. [OpenCode models](https://opencode.ai/docs/models), [agent options](https://opencode.ai/docs/agents#options), [plugin hooks](https://opencode.ai/docs/plugins).

## Rewrite boundaries worth pursuing

The prompt protocol and eval comparison runner are the highest-priority rewrite candidates. They can change behind existing runtime rules and produce direct measurements. The auto-drive coordinator and evidence admission calculations deserve a narrower refactor that removes repeated decisions while preserving interruption and replay behavior.

Two runtime findings belong in an early correctness phase. An inspect feature may complete with a failed verdict because the requested output is the finding report. The service summary still says the feature is blocked, while assurance expects every review to pass. This is an inconsistency between task completion and code acceptance, not evidence that inspect results falsely receive full assurance. See `src/domain/transitions.ts:687`, `src/application/flow-service.ts:102`, and `src/application/delivery.ts:117`.

A separate boundary exists at the 4,096-operation session limit. A valid session can consume the collection limit and leave no capacity for a new close operation. The original probe is unavailable; [F0 verification](evidence/f0/verification.md) records the boundary and its later fix. Reserve capacity for terminal operations at mutation admission. Do not add an unbounded operation history or erase idempotency records to get past the limit.

Keep Session v5, the storage format, exact command binding, and one active feature through the initial overhaul. A model-adaptive prompt and experiment profile should remain process configuration and eval provenance. It should not become another durable workflow ledger.

Concurrency protection has separate scopes. The filesystem lock serializes state transactions. It does not serialize worktree edits or the full validation command. Validation capture is local to a coordinator instance, and duplicate-plugin detection is local to a process. Foreign-host revision rejection does not prove cross-process command isolation. State these limits before promising broader parallel execution.

## Decisions this investigation cannot settle

The live host smoke proves package integration, not Astra or Opus behavior. No new provider campaign was run. The proposed prompt reductions, review settings, and performance targets remain hypotheses.

The product-value suite needs real tasks that match the consequential changes Flow claims to help. Its first version can combine sanitized past failures with fixed repository snapshots. The task bank needs a hidden holdout and enough distinct tasks to support a claim beyond repeated execution of the same few fixtures.

Review frequency remains a product decision after measurement. Default Flow must continue to mean durable planned work with observed validation and independent review. If data eventually supports a lighter mode, make its assurance contract explicit before a session starts. Do not silently change the contract within an active session.

The plan uses four Poteto principles in concrete ways. Subtract Before You Add puts prompt deletion before new workflow mechanisms. Prove It Works separates host smoke, conformance, product correctness, and reviewer evidence. Sequence Work into Verifiable Units makes each PR depend on its own completed checks. Encode Lessons in Structure motivates behavior graders and the plan validator instead of another collection of prose rules.
