# Jev advice for autonomous Flow decisions

Research date is 2026-09-21. The inspected revision is `c9813f9a87b9b7438671658cfd523adcd89f3098` on `main`.
This document explains the recommendation. [The phased plan](README.md) contains the execution checklist.

## Recommendation

Use Jev to classify a blocker and select among concrete, authorized recovery options. Keep action authorization in Flow code. Let the manager investigate and propose remedies. Keep validation and the independent reviewer authoritative.

The useful target is unattended completion within a delegated policy. An instruction to act autonomously can authorize routine choices in advance. A model score cannot supply missing credentials, satisfy an unrun validation gate, expand an immutable plan, or grant release authority.

This design can remove repeated human decisions about repair strategy and bounded retries. It cannot promise completion for every blocker. A task with unavailable evidence or an unresolved product requirement can still end at a clear checkpoint. Flow must report that outcome honestly.

## What Flow does today

| Decision point | Current behavior | Proposed delegated behavior |
| --- | --- | --- |
| Initial plan approval | Prior autonomous implementation authority can already cover approval. | Preserve that path. Do not add a Jev approval ceremony. |
| First in-scope failed review | One automatic reset and retry. | Preserve deterministic behavior. Jev need not approve an already permitted retry. |
| Second failed review | Requires explicit direction for another attempt. | Permit a bounded extra attempt when an explicit recovery policy covers it and a concrete revised remedy exists. |
| Scope blocker | Requires direction. Historical scope findings remain relevant. | Keep scope expansion blocked. Gather evidence or continue an eligible independent feature if policy permits that exact action. |
| Ready state with only failed candidates | Requires an exact feature selection. There is no blocked run left to reset. | Use a guarded `flow_run_start(featureId)` after a policy decision. |
| Missing declared evidence | Running `await-user-direction`. No reset or review. | Try an already authorized evidence command in its required environment. Never substitute a model opinion for evidence. |
| Alternative planned feature | Explicit direction selects a dependency-independent feature. | Allow exact selection under policy. Reset invalidation and dependency checks still apply. |
| Defer or abandon | Requires an explicit user choice. | Keep outside the first release. Add only through a separately approved outcome policy. |
| Git, PR, merge, or release | Delivery grants no external action authority. | Keep separate authorization. |
| Plugin restart | The continuation lease disappears. | Preserve this default. Durable unattended restart is a separate design. |

Evidence comes from [Flow context](../../../CONTEXT.md), [blocked-review guidance](../../../skills/flow-run/SKILL.md), [planning guidance](../../../skills/flow-plan/SKILL.md), and [ADR 0008](../../../docs/adr/0008-bounded-auto-continuation.md).

`blockedFeatureProjection` derives failure counts and scope blockers from feature history. `nextAction` maps the second failure or scope blocker to `await-user-direction`. See [session-projection.ts](../../../src/application/session-projection.ts).

The host's `decideOnIdle` only continues mechanical start and close actions. Checkpoint resumption depends on observed user-message lineage and accepted mutation progress. See [auto-drive-decision.ts](../../../src/platform/opencode/auto-drive-decision.ts) and [auto-drive.ts](../../../src/platform/opencode/auto-drive.ts).

The important gap is enforcement. `resetFeature` checks revision, plan approval, current run, dependencies, and idempotency. It does not check the second-failure direction rule. The tool guard observes an accepted mutation after execution. Guidance and continuation provenance currently carry that part of the policy. See [transitions.ts](../../../src/domain/transitions.ts) and [tool-guard.ts](../../../src/platform/opencode/tool-guard.ts).

Autonomous recovery therefore needs a pre-mutation authorization check. Relaxing the prompt or forging a human reply would not provide one.

## What Jev provides

Jev evaluates supplied state against typed questions. Choice selects from supplied alternatives. Noul returns a probability for a yes-or-no proposition. Score evaluates an ordered rubric. Jev does not generate a repair plan or explanatory prose. The API accepts structured state and returns answers under caller-selected question IDs. [TypeSafe API reference](https://docs.typesafe.ai/api).

Choice confidence describes the shape of the returned distribution. It is not a measured probability that a Flow action is safe. Thresholds need workload-specific evaluation. A clear winner among bad candidates is still a bad candidate. Include an abstain option and test absolute suitability separately from relative ranking. [TypeSafe confidence](https://docs.typesafe.ai/confidence).

TypeSafe's skill-suggestion cookbook demonstrates a relevant pattern. A first pass ranks candidates and a second inspects the shortlist, with the option to reject every candidate. Its published results concern a different task and older Jev version. They do not establish blocker-resolution quality for Flow. [Skill suggestion cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion).

TypeSafe documents weaknesses with indirect reasoning, irrelevant context, arithmetic, and adversarial content. State containing injected instructions can change an answer. Keep exact counts, budgets, dependencies, and permissions in code. Give Jev a small evidence packet. Treat findings and candidate text as untrusted input. [Jev 1.13 limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md#jev-1-13-jaggedness).

The documented stable model is `jev-1.13.0`. The `jev-latest` alias can move. Pin the evaluated version and record the version actually returned. Current input pricing is $0.042 per million tokens, with free output tokens. Rate and context limits are documented but can change. These facts justify measuring cost and latency rather than assuming either. [TypeSafe models](https://docs.typesafe.ai/models).

The official API documents `429` and `529` backoff. A runtime adapter also needs a deadline, bounded attempts, strict parsing, cancellation, and a provider-unavailable outcome. Those additional controls are this report's engineering recommendation. [TypeSafe API reference](https://docs.typesafe.ai/api).

## What the existing Jev evaluator proves

The repository has an eval-only adapter at [jev.ts](../../../evals/alignment-corpus/jev.ts) and [jev-run.ts](../../../evals/alignment-corpus/jev-run.ts). Its input is the active goal plus a user request. Eight corpus cases test goal continuation and expansion.

The adapter maps a score of at least 1.6 and confidence of at least 0.6 to continuation. Those are existing experiment settings, not validated blocker thresholds. Its response parser does not retain the resolved model, full distribution, or usage. The runner has no request deadline.

`shadowNewScopeVeto` maps errors and abstentions to a non-veto result. That convention measures an advisory veto. It must not become permission to execute a recovery action. A production decision failure must produce no new authorization.

The latest [release qualification note](../15-alignment-examples-release/README.md) explicitly leaves Jev eval-only. Its offline qualification does not establish live model behavior. No current `jev-alignment-v1.json` result was found by the code explorer.

## Proposed decision contract

These are proposed domain concepts, not existing exports.

| Record | Contents and owner |
| --- | --- |
| RecoveryPolicy | The host captures explicit delegated actions, applicable session and goal, extra-attempt limits, call and time budgets, and revocation. The manager cannot enlarge it. |
| DecisionPacket | The application supplies session ID, revision, feature and attempt, current source identity, review assignment and findings, evidence references, policy identity, and a bounded candidate list. |
| RecoveryCandidate | A stable candidate ID, exact action and feature, proposed remedy, supporting evidence, expected effect, and affected feature set. |
| DecisionAdvice | A validated Jev response, requested and resolved model, rubric version, packet digest, probabilities, latency, usage, and candidate choice or abstention. It carries no execution authority. |
| AuthorizedRecovery | The host binds one permitted action to the live policy, packet identity, revision, source, and operation ID. It is consumed or invalidated at execution. |

Keep policy and pending authorization process-local for the first release. Reuse Session v5 operations for accepted mutations. Diagnostic decision records may be saved outside canonical state, but they cannot resume authority after restart. If durable restart later becomes a requirement, define a versioned persisted authority contract first.

The coordinator follows this sequence.

1. Read the typed checkpoint and determine its reason. Do not route every `await-user-direction` the same way.
2. Apply deterministic exclusions and enumerate legal actions. No Jev call is needed when no judgment remains.
3. Let the manager gather evidence and propose at most three concrete remedies. A proposal must say what changes after the previous failed attempt.
4. Ask Jev atomic questions about goal preservation, whether evidence supports the remedy, and which eligible candidate best addresses the finding. Include `abstain` explicitly.
5. Apply calibrated, action-specific acceptance rules. Contradictory answers or missing evidence cause abstention. Do not multiply correlated answers into a fictitious safety probability.
6. On abstention, permit one bounded evidence-gathering or stronger-reasoning pass within existing authority. Then reassess once. Never retry the same packet until it produces a preferred answer.
7. Re-read state after the network call. Reject changed revision, source, policy, host, cancellation, or candidate identity.
8. Check authorization before every affected mutation, including direct manager tool calls. Preserve distinct paths for the existing first retry, explicit user direction, and delegated recovery. Execute an exact reset-and-start or ready-state start with existing operation replay rules.
9. Run full validation and independent review. Jev cannot change findings, clear a veto, complete a feature, or lower the evidence requirement.
10. Record the result and remaining budgets. Continue independent authorized work where the existing lifecycle permits it. Otherwise report the precise unresolved checkpoint.

A scope-blocker flag is not evidence that the user approved new scope. Do not let Jev clear that flag. The initial action set excludes autonomous plan amendments, defer, abandon, deployment, and destructive operations.

## Compare the alternatives

| Design | Benefit | Cost or failure mode | Judgment |
| --- | --- | --- | --- |
| Deterministic policy only | Small, predictable, no provider dependency. | Cannot assess nuanced repair proposals. | Required baseline. Retain it if Jev adds no measured value. |
| Manager reasoning under the same policy | Can investigate and propose new remedies. | More inference cost and possible repeated ineffective fixes. | Required comparator and bounded fallback. |
| Jev replaces human replies | Superficially simple. | Conflates model judgment with authorization and breaks lineage semantics. | Reject. |
| Host policy plus manager proposals plus Jev advice | Separates authority, reasoning, and bounded selection. | Needs new evaluations and cancellation handling. | Recommended experiment. Promote only on evidence. |
| General council, durable blocker scheduler, or automatic replanning | Broader autonomy. | Expands Flow's lifecycle and creates unrelated recovery problems. | Defer. The first release should prove one bounded recovery path. |

## Measure whether decisions improve

Compare today's behavior with two systems using the same delegated authority. One uses the manager alone. The other adds Jev advice. Otherwise an improvement caused by allowing another retry could be mistaken for better Jev judgment.

Freeze labeled blocker episodes before tuning. Split by originating task or repository, not by paraphrase. Include repairable failures, repeated ineffective remedies, missing evidence, scope expansion, invalid dependencies, and adversarial findings. Separate model-quality cases from transport and lifecycle fault injection.

Report unsafe accepted actions, false escalations, abstention, completion, new regressions, extra attempts, active runtime, user wait time, provider latency, and total cost. Evaluate admitted actions separately from all decisions. High abstention must not hide low coverage.

Proposed promotion gates are zero forbidden mutations, zero unsafe accepted actions on the holdout, and enough independent accepted cases to bound observed risk. Require the gate separately for each promoted action class. With zero errors in 300 independent accepted cases, the one-sided 95% binomial upper bound is approximately 1%. This is a statistical gate, not a guarantee about unseen tasks. Do not treat paraphrases as independent cases.

For a paired live pilot, propose at least 100 distinct episodes across the two policy-enabled arms. Require at least 20% fewer human interruptions than the manager-only arm, no more than a 5 percentage-point completion loss, and no more than 15% median active-runtime growth. Report uncertainty and retain shadow mode when results are inconclusive. The 100 paired episodes do not replace the 300 accepted cases per action class. Samples from separate phases may combine only when the evaluated decision system is unchanged and the episodes are disjoint. These are proposed product targets, not vendor claims or current measurements. Freeze budget and acceptance rules before buying live runs.

## Evidence and limitations

Exa located current public sources. Its bounded research run completed with eight official source URLs and supported the same division between typed advice and application control. Ref supplied the official model, API, confidence, and limitations documentation. Several Ref cookbook results returned navigation only. Exa fetched the skill-suggestion body separately. Unofficial Jev mirrors were excluded from technical conclusions.

The independent repository explorer used a shared read-only checkout. The parent inspected the critical projection, transition, guard, coordinator, and adapter code directly. The delegate model was inherited and not independently identified.

[Auto-drive baseline](evidence/auto-drive-tests.txt) records 59 passing tests across two files on installed Bun 1.3.14. The repository requests Bun 1.4.0. [The combined attempt](evidence/baseline-tests.txt) also records two Jev test-file load failures because `zod` is absent. No product tests were edited.

No live Jev probe ran because `TYPESAFE_API_KEY` is absent. No live OpenCode recovery run, calibration campaign, provider cost measurement, or latency baseline was claimed. Those remain explicit phase gates. Research supports the architecture recommendation. It does not prove Jev improves Flow decisions.

## Principles that changed this recommendation

Model the Domain led to separate policy, advice, and authorized-action records. Redesign from First Principles led to a real mutation-boundary policy instead of synthetic human messages. Make Operations Idempotent led to exact operation reuse and stale-response rejection.

Sequence Work into Verifiable Units put offline comparison and shadow advice before mutation authority. Prove It Works kept model-quality claims unproven and tied source claims to actual code. Never Block on the Human let this research and plan proceed without a preference questionnaire.

Build the Lever adds a rerunnable plan-check wrapper. Encode Lessons in Structure uses the installed plan checker to enforce verification blocks instead of relying on prose review alone.
