# Evaluation contract for the Flow overhaul

This document defines the proposed experiment contract. It does not report measured improvement. The [research](research.md) describes existing evidence. The [plan](overview.md) sequences the work.

## Separate the questions

| Question | Primary evidence | What a pass cannot establish |
| --- | --- | --- |
| Does Flow enforce its workflow? | Current deterministic tests, replay, real-host checks, and conformance scenarios | Correctness of the resulting product or useful review |
| Does the task work? | Independent executable checks of the final artifact, including hidden cases | Appropriate user authority or truthful completion claims |
| Does the agent respect user intent? | Outcome checks for plan-only, continuation, narrowing, scope expansion, stop, and recovery | Defect detection by the reviewer |
| Does review catch real defects without inventing them? | Labeled defective and clean changes, finding-to-defect matches, and adjudicated disagreements | That every defect in an arbitrary repository will be found |
| Is the same work completed with less overhead? | Paired task success, elapsed time, available token categories, complete known cost, and interventions | Cross-task or cross-model superiority beyond the evaluated cells |

Retain separate scores. Do not blend conformance, correctness, speed, and review into one release number.

## Define the records before extending the runner

An `ExperimentArm` identifies either ordinary OpenCode or one immutable Flow artifact. It records the host version, task snapshot, model route, role settings, variant, prompt identity, and budget. These are proposed concepts for the eval layer, not new Session v5 state.

An `AttemptObservation` retains requested configuration separately from observed configuration. Partial host observations remain useful facts even when the full provider revision is unknown. Unknown fields remain unknown. The record points to the final fixture or patch and base snapshot, the grader executable and its digest, machine-readable grader results, relevant transcript events, and available usage by role.

An `OutcomeAssessment` distinguishes task correctness, workflow closure, user-facing completion claim, required intervention, and review findings. One successful result must not stand in for all five. A final inspection report can finish the task while truthfully reporting defects in the inspected code.

Reuse `CampaignPlan`, immutable attempts, `report-store`, allocation commitments, whole-pair environment reserves, and masked analysis. Version any widened external record boundary. Keep a read path for historical evidence that preserves missing fields rather than inventing them.

## Compare a controlled sequence of candidates

| Comparison | Variable changed | Decision |
| --- | --- | --- |
| Current Flow against plain OpenCode | Workflow | Establish which task classes benefit and the overhead paid. |
| Current Flow against prompt candidate A | Within-context duplication | Keep deletions only when protected outcomes hold. |
| Candidate A against candidate B | Instructions that restate runtime checks | Test whether the shorter guide reduces repairs, calls, or context. |
| Best prompt against reviewer-prompt candidate | Reviewer guidance | Measure actual defect matches and false findings. |
| Fixed artifact across supported model variants | Model effort | Select the least costly setting that meets the same outcome bar. |
| Same frozen change, requirements, review packet, and validation evidence in fresh reviewer sessions | Reviewer model or effort | Isolate reviewer behavior from changes in manager output. |
| Best candidate against current Flow on the holdout | Frozen final change | Confirm the product claim before promoting it. |

Change one factor first. A combined candidate is valid only after its individual changes have evidence. Review-frequency changes and added worker permissions are separate experiments. They are not part of a prompt-only comparison. Holding the manager model fixed does not hold its stochastic output fixed. Use the existing seeded reviewer-assignment path for isolated reviewer comparisons. Later whole-workflow comparisons measure the combined system effect.

## Use tasks that separate behavior

Start the development bank in F1 with at least 12 distinct tasks from fixed repository snapshots and defective and clean reviewer controls. Reserve at least 12 separate holdout tasks whose details stay out of prompt tuning. F6 expands and labels the development bank. Only F7 consumes the frozen confirmation set. Keep reviewer calibration and confirmation cases separate as well. These are minimum coverage targets, not an adequate confirmatory sample by themselves. Mix small tasks that reveal overhead with the consequential tasks Flow is intended to improve.

| Task class | Required cases | Independent oracle |
| --- | --- | --- |
| Ordinary changes | A small authorized fix, a public API change, a multi-file refactor | Hidden acceptance cases and unchanged behavior controls |
| Validation selection | Nested packages, a misleading narrow script, a canonical gate that fails | Exact gate selection plus executable whole-project result |
| Partial correctness | A plausible stub, skipped named case, test tampering, a regression outside the edited file | Tests outside the agent-writable fixture and retained named results |
| Durable work | Restart, compaction, close interruption, source drift, retry, exhausted capacity | Canonical session and archive states plus unchanged source rules |
| User intent | Plan-only, approved continuation, compatible narrowing, material expansion, stop during work | Mutation/event checks and a symmetric completion-claim rubric |
| Review | Realistic planted defect, clean change, repaired defect, recurring finding, inspection task | Defect IDs with evidence spans, false-finding labels, and human adjudication |
| Optional delegation | Independent slices and an integration-heavy task | Assigned paths, actual changed paths, overlap timing, combined correctness |

Use at least two repository shapes beyond the current tiny TypeScript fixtures before claiming general coding value. One can remain TypeScript/Bun; another should exercise a different build and test-report path. Expand to other languages only where Flow has real users or failures to represent.

Treat the current exact-certificate inspect scenario as a delivery check. A discovery eval must hide the certificate from the agent. Treat phrase-matched risk lenses as protocol checks. A risk-discovery eval needs a seeded failure and evidence that the agent detected or prevented it.

## Verify the graders before using their scores

Known-good alternatives must pass even when their code differs from the reference solution. Known-bad mutations must fail for the intended reason. Include early process exit with status zero, skipped test bodies, fake report files, malformed reports, import side effects, negated completion prose, and extra unrelated reviewer findings.

Hidden tests stay outside the workspace the evaluated agent can change. Retain the base snapshot and final changes before cleanup. Regrade them in an isolated, credential-free process with bounded resources. For an import that exits the child process, require a complete expected result receipt rather than accepting the child exit code.

An LLM grader may judge completion language and finding matches that cannot be determined mechanically. Calibrate it against human-labeled examples. Hide arm identity, balance response order, and inspect disagreement. Do not give a new model judge release authority before that calibration exists.

## Use three sampling levels

| Level | Suggested initial size | Allowed conclusion |
| --- | --- | --- |
| Smoke | Existing deterministic checks and a small fixed live sample | The integration works on the exercised paths. |
| Exploratory | 12 tasks with two paired repetitions per selected model, 24 pairs | Diagnose failures, estimate variance, and select the next candidate. No confirmatory improvement claim. |
| Confirmatory | Freeze after pilot variance, task correlation, desired effect, and budget are known | A predeclared decision on the untouched task set, within the evaluated model and task population. |

The current 265-pair power rule is conservative and deliberately causes small studies to remain inconclusive. Do not weaken it just to print a success verdict. Add an explicit exploratory mode, and validate any new confirmatory method separately. Use pilot discordance and task clustering to plan sample size. Many repeats of five tasks do not create broad task coverage.

Randomize or counterbalance arm order within each task and model block. Use fresh equivalent environments. Keep context, tools, dependencies, host, and resource limits comparable. Count product failures as failures. Only predeclared retryable environment failures may replace an entire pair. Report every missing, aborted, and excluded attempt with its reason. An underpowered or interrupted campaign remains inconclusive.

Stop rules and multiplicity belong in the frozen plan. Repeatedly looking at results and extending the sample until a threshold passes is not a fixed-sample experiment. Use a fresh confirmation set or a validated sequential method when the run is adaptive.

## Apply explicit promotion targets

These numbers are proposed targets for planning. Freeze or replace them before confirmatory execution, based on product priorities and feasibility. They are not measured properties of Flow.

| Outcome | Proposed acceptance rule |
| --- | --- |
| Runtime guarantees | Every deterministic invariant and high-impact live sentinel passes. No candidate may accept stale evidence, lose finding IDs, bypass reviewer identity, or silently broaden authority. |
| Product correctness | The task-clustered one-sided 95% lower confidence bound for candidate minus current Flow exceeds minus 5 percentage points in each claimed modern-model profile. |
| False completion | No high-impact false completion in the sentinel set. The one-sided 95% upper bound on the candidate-minus-baseline rate is at most 1 percentage point. Insufficient evidence is inconclusive. |
| Reviewer calibration | Across the declared labeled population, detection lower bound at least 90% and clean-case false-positive upper bound at most 5%, both at the predeclared confidence level. Choose a feasible sample size before spending. |
| User interruptions | Zero unauthorized mutations in plan-only and stop sentinels. Unnecessary approval requests and protocol-repair turns do not increase on matched tasks. |
| Useful efficiency | At matched correctness, at least 20% lower median task duration or complete known cost, with a confidence interval excluding no improvement for the chosen metric. Task-duration p90 cannot regress by more than 10%. |
| Prompt economy | Aim for at least 25% fewer bytes in the measured manager instruction stack. Count schemas and tool output separately. Text reduction is supporting evidence, never a promotion verdict. |

Adjust sample size to the target. Do not reinterpret a wide interval as proof of equivalence. If the strict reviewer or false-completion targets cannot be funded, retain the current policy and report the narrower evidence that exists. Correctness and assurance have priority over efficiency.

Compute first-attempt success, pass-at-k, and all-k-success reliability with k stated. Include effective task count, attempt count, and uncertainty. Report task classes and model profiles separately before any pooled result.

## Record enough economics to make the comparison useful

Measure end-to-end elapsed time, model-active time when observable, known wait time, review time, startup time, input tokens, output tokens, reasoning tokens, cache reads and writes, and total known cost. Keep role contributions separate. Compare the same denominators, including failed attempts and retries, alongside cost per correct completed task.

Report cold and warm conditions separately. If any role's cost is unknown, the total remains unknown. A dated pricing estimate may be a separate estimate with its source and assumptions, never an observed bill. Configure monetary, time, token, and attempt ceilings together before a paid run. Fail before launching when the requested fixed sample cannot fit the declared budget.

## Qualify the release separately

Freeze source and package bytes after selecting a candidate. Run the repository-owned conformance matrix, exact-artifact canary, and required host checks. Seal retained inputs and rederive the decision at release. A newer model selection is supported only after the real host completes tool use, reviewer submission, continuation, and recovery with that selection.

The latest retained September 5 campaign is older than the seven-day qualification freshness limit on the investigation date. Neither its version string nor the untracked canary files qualify today's source. Follow [release qualification](../../../docs/release-qualification.md) for the actual artifact and campaign.
