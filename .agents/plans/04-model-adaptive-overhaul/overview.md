# Flow model adaptation plan

Flow users get fewer unnecessary steps while retaining durable plans, observed validation, and independent review.
Maintainers get reproducible comparisons that distinguish working software from a completed workflow.
Preserve Session v5 and the current assurance contract through this overhaul.
Deliver F0, F1, F2, F3, F4, F5, F6, and F7 in dependency order.
Implementation began on 2026-09-13. Track local phase progress in [the implementation checklist](implementation.md). No paid campaign has started.
Read [the investigation](research.md) for findings and [the evaluation contract](eval-design.md) for experiment rules.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its evidence exists. Evidence is a source diff, log, screenshot, executable result, model receipt, or immutable artifact identity. The body is a how-to. The appendices explain and record.

Run the installed Poteto `figure-it-out/SKILL.md` for the overall overhaul. Use `poteto-mode/playbooks/feature.md` for changed behavior, `poteto-mode/playbooks/refactoring.md` for preserved behavior, and `poteto-mode/playbooks/eval.md` for experiments. Resolve these from the installed plugin listed in Appendix D. The operator owns merge decisions. F0, F2, F3, F4, and F5 require interaction review and stop at merge-ready.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

Use each phase's checks while developing. At its review head, run the applicable full gate once. Repeat checks after a meaningful change or a new concern. The ten live cases below are required coverage, not a demand for ten simultaneous model runs or statistical evidence of reliability. Preserve captured artifacts as the primary proof. Screenshots explain visible behavior.

The ten-case, screenshot, and video structure comes from the installed Poteto multi-phase-plan playbook. It is a proposed verification workflow, not a finding that Flow needs ten model workers. F5 is conditional. A documented no-change decision satisfies its phase decision without creating a PR or claiming that unexecuted checks passed.

## Program checklist

### Arm the program

- [x] Start implementation only when the operator requests execution of this plan. Append an authorization row to `decisions.tsv`.
- [ ] Do not create a goal or a 30-minute heartbeat unless the operator explicitly requests a long autonomous run. For ordinary execution, use this checklist and a queue table in progress updates.
- [ ] Read current repository contracts before each phase with `git show origin/main:CONTEXT.md`, `git show origin/main:docs/maintainer-contract.md`, and `git show origin/main:docs/development.md`. Record the base SHA.
- [ ] Re-resolve the installed Poteto runtime and playbooks from Appendix D. Do not invent repository paths for plugin files.
- [ ] Freeze the [evaluation contract](eval-design.md), task selection, exclusions, stopping rule, model variants, and resource estimate before each paid campaign. Record the operator-authorized budget. Do not launch an unfunded fixed sample.
- [ ] Preserve the four preexisting untracked 8.2.1 canary files. Record existing worktree changes before any code edit.
- [ ] On a hold or stand-down, cancel pending dispatch and give active owners a zero-writes order. Inspect partial artifacts before any replacement.

### Spawn owners

- [ ] Use one owner per active PR, with exclusive paths or its own worktree. Record ownership before parallel writes.
- [ ] Land F0 first. Start F1 and F2 independently from F0. Start F3 after F1 and F2. Start F4 after F3. Decide F5 after F4. Start F6 after F4 and any F5 changes included in the selected candidate. Start F7 after every required predecessor passes.
- [ ] Keep eval-only work in `evals/**`, corresponding tests, and its docs. Keep runtime work within the paths listed by its phase. Review any overlap before dispatch.
- [ ] Record model and effort as observed or inherited. Use generic agents if custom profiles are unavailable. Never claim model diversity from role names.
- [ ] Queue excess lanes. Keep one authoritative parent for integration, checks, decisions, and external actions.

### PR mechanics, for every PR

- [ ] Run the repository contribution preflight before any authorized commit, push, or GitHub-visible change. Record the exact command and output from `.agents/skills/flow-contribution-check/SKILL.md`.
- [ ] Run `bun run check` and `bun run replay` at the review head. Run `bun run smoke:live` for host, tool, package, or prompt wiring changes. Save output under the phase evidence directory.
- [ ] Apply the installed cleanup and technical-writing skills before review. Retain only tests that prove a contract or behavior.
- [ ] Open a review-ready PR only within the operator's requested repository-write scope. Include the concrete behavior, artifact SHA, completed checks, and remaining limits.
- [ ] Triage review comments against the actual diff and evidence. Re-run affected checks after fixes. Do not relabel a failed eval as an environment failure to make it pass.

### Verdict and merge, for every PR

- [ ] Have an independent reviewer inspect the exact head, required artifacts, and decision trail. The reviewer reports PASS, ISSUES, or BLOCKED.
- [ ] Compare with the baseline before accepting the phase. A missing live capability or incomplete campaign remains unverified.
- [ ] Keep F0, F2, F3, F4, and F5 at merge-ready until the operator reviews their changed interaction. Prepare screenshots and a short video for that review.
- [ ] Reconcile the reviewed SHA with the merge candidate. A changed patch needs fresh relevant checks and review. The operator merges unless authority is explicitly delegated later.
- [ ] Record a rollback boundary per PR. Roll back only with no incompatible active session. Preserve failed attempts and artifacts.

### Boot recipe, for every live lane

Run each case in an isolated fixture or worktree at the PR head. Use the existing packed `EvalHost` and isolated XDG directories for programmatic command checks. Use an available terminal control capability for visible OpenCode interactions. Use native or browser control for any added visible UI. No new UI is proposed here.

- [ ] Pack exact candidate bytes using the repository's existing packaging path. Record the tarball digest, source SHA, host version, and fixture identity.
- [ ] Start the pinned OpenCode host and wait for both health and project readiness. Reuse the established smoke deadlines and failure classification.
- [ ] Drive real slash commands or the real runner CLI. Read `.flow/session.json`, archives, named grader results, and the sanitized host transcript as evidence.
- [ ] For visible interactions, capture a terminal screenshot at the named path. If capture is unavailable, retain logs and mark the visual lane unverified. Never fabricate a screenshot or claim code inspection as live proof.
- [ ] Save artifacts under `.agents/plans/04-model-adaptive-overhaul/evidence/<phase>/lane-<n>/`. Keep secrets and raw user data out. Save at least the named PNG plus machine-readable or transcript proof.
- [ ] Stop the host and preserve the final graded artifact before cleaning temporary state. Require a complete cleanup receipt.

## Protect terminal recovery and define completion (F0)

**Depends on.** None.

**Files.**

- [ ] Edit `src/domain/transitions.ts`, `src/domain/limits.ts`, and `src/application/schema.ts` only as required for terminal headroom.
- [ ] Edit `src/application/flow-service.ts`, `src/application/delivery.ts`, and `src/application/session-projection.ts` to align inspect reporting.
- [ ] Edit focused lifecycle, assurance, and persistence tests. Update `CONTEXT.md`, `docs/guarantees.md`, and the maintainer contract.

**Build.**

- [ ] Promote `evidence/capacity-probe.ts` into a focused regression. Reserve sufficient operation and byte capacity for a terminal close before accepting nonterminal mutations. Record the recovery decision for already-full v5 documents without discarding accepted operation IDs.
- [ ] Keep previously valid full v5 documents readable. Apply new headroom checks at mutation admission, not by tightening hydration. Define the supported terminal payload allowance and test both schema and file-reader byte limits. Recovered archives must remain readable and replayable.
- [ ] Derive feature outcome text from feature kind, run state, and review verdict. Treat a completed inspection with defects as a completed inspection with negative findings. Preserve the distinction from accepted implementation.
- [ ] Write a contract matrix for plan-only authority, named evidence, source drift, retries, reviewer identity, inspect outcomes, archive replay, request anchoring, and concurrent host assumptions. Map each row to tests or an explicit limitation.
- [ ] Keep tool names and Session v5 shape stable. If full-ledger recovery needs a bounded read/write compatibility exception, document its exact old-document, new-write, archive, and rollback behavior before coding. That exception does not authorize a general schema rewrite.

**You see.**

- [ ] A near-limit session can still defer or abandon through a normal close. Its archive retains accepted operations.
- [ ] An inspect task returns completed findings without saying the run is blocked or implying that the inspected code is defect-free.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add capacity, exact-replay, already-full-state, and inspect-summary cases. Run `bun test tests/domain-transitions.test.ts tests/runtime-close.test.ts tests/assurance-projection.test.ts tests/workspace-persistence.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head. If that profile is unavailable, inherit the parent and record the fallback. Queue work within actual capacity.

- [ ] Lane 1. Fill a pending session to the last allowed nonterminal operation and defer it. Save `evidence/f0/lane-1/result.png` and its underlying trace or result file. Pass when the archive exists once and retains prior operation identities.
- [ ] Lane 2. Load an already-full v5 fixture and take the documented terminal recovery path. Save `evidence/f0/lane-2/result.png` and its underlying trace or result file. Pass when recovery does not require hand-editing state or dropping replay records.
- [ ] Lane 3. Repeat the exact accepted close after archive publication is interrupted. Save `evidence/f0/lane-3/result.png` and its underlying trace or result file. Pass when one matching archive remains and no replacement session is closed.
- [ ] Lane 4. Run an inspect task with a real blocking finding. Save `evidence/f0/lane-4/result.png` and its underlying trace or result file. Pass when the task finishes and the finding remains visible with limited assurance.
- [ ] Lane 5. Run a clean inspect task. Save `evidence/f0/lane-5/result.png` and its underlying trace or result file. Pass when completion and review facts agree across status, delivery, and archive.
- [ ] Lane 6. Run an implementation task whose review fails. Save `evidence/f0/lane-6/result.png` and its underlying trace or result file. Pass when the implementation remains blocked and cannot claim successful completion.
- [ ] Lane 7. Submit a plan-only request. Save `evidence/f0/lane-7/result.png` and its underlying trace or result file. Pass when no source edits occur and approval does not imply implementation authority.
- [ ] Lane 8. Fail the declared gate, then pass an unrelated command. Save `evidence/f0/lane-8/result.png` and its underlying trace or result file. Pass when the original failure still prevents review.
- [ ] Lane 9. Change source after validation. Save `evidence/f0/lane-9/result.png` and its underlying trace or result file. Pass when review requires fresh evidence for the changed source.
- [ ] Lane 10. Approach the session byte bound with large allowed findings. Save `evidence/f0/lane-10/result.png` and its underlying trace or result file. Pass when nonterminal admission leaves capacity for the declared terminal path.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Terminal operation count, operation-replay preservation, close latency, and persisted bytes.
- [ ] Probe. Run the capacity fixtures and a close/replay loop on the base and head with the same generated sessions. Save raw observations.
- [ ] Baseline. Record the reproduced 4,096-to-4,097 failure and measure at least 30 local close operations before the patch.
- [ ] Rule. Fail on any lost accepted operation or uncloseable admitted session. Investigate a median close-latency increase above 10% before acceptance.

**Review gate.** The operator reviews the changed interaction before merge.

- [ ] Prepare the relevant lane screenshots and a 30 to 60 second video under `evidence/f0/review/`.
- [ ] Show the operator the screenshots, video, observed outcome, and limitations. Stop at merge-ready for the operator review.

**Merge.**

- [ ] Record the parent's clean verdict and independent review at the exact head SHA in `decisions.tsv`.
- [ ] Resolve all blocking findings and complete the applicable contribution preflight.
- [ ] Confirm that the reviewed patch is unchanged after rebasing. The operator merges within the authorized scope.

## Make outcome and reviewer grades independently checkable (F1)

**Depends on.** F0.

**Files.**

- [ ] Edit `evals/benchmarks.ts`, `evals/benchmark-run.ts`, `evals/reviewer-run.ts`, and `evals/reviewer-cases.ts`.
- [ ] Edit the corresponding report and grader schemas only when required for retained evidence.
- [ ] Create development fixtures and a sealed holdout manifest under `evals/` before prompt ablations use them.
- [ ] Extend `tests/benchmark-reporting.test.ts`, `tests/reviewer-eval.test.ts`, and oracle mutation tests. Create a retained-artifact regrade entry point under `evals/`.

**Build.**

- [ ] Retain the final fixture or base-plus-patch, exact grader inputs, grader source identity, and complete result receipt before fixture cleanup. Make offline regrading reproduce the original outcome.
- [ ] Separate workflow closure from task correctness and user-facing completion claims. Apply the same completion-language assessment to both arms. Add negation and partial-work cases.
- [ ] Require reviewer findings to identify the planted defect with supporting evidence. Preserve clean controls and reject unrelated findings as detection credit.
- [ ] Replace synthetic human-label provenance with explicit synthetic labels. Define an import format for real independent labeling and adjudication records.
- [ ] Harden hidden executable grading against early exit, skipped cases, report spoofing, and fixture tampering. Keep valid alternative implementations passing.
- [ ] Create at least 12 distinct development tasks with independent outcome checks before F4 uses the bank. Reserve at least 12 separate holdout tasks in a sealed manifest that prompt tuning cannot read. F6 expands the bank and validates label quality.

**You see.**

- [ ] A maintainer can explain and reproduce a failed grade from retained files after the original host has stopped.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `bun test tests/benchmark-reporting.test.ts tests/reviewer-eval.test.ts tests/grader-input.test.ts tests/report-artifact.test.ts`. Include known-good, known-bad, unrelated-finding, missing-receipt, and transcript-negation cases.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head. If that profile is unavailable, inherit the parent and record the fallback. Queue work within actual capacity.

- [ ] Lane 1. Grade a known-good alternative implementation through the real runner. Save `evidence/f1/lane-1/result.png` and its underlying trace or result file. Pass when all hidden behavioral results pass and the retained artifact can be regraded.
- [ ] Lane 2. Grade a plausible incomplete implementation. Save `evidence/f1/lane-2/result.png` and its underlying trace or result file. Pass when the missing behavior fails independently of Flow closure.
- [ ] Lane 3. Grade a child process that exits zero before completing checks. Save `evidence/f1/lane-3/result.png` and its underlying trace or result file. Pass when the missing result receipt makes the grade fail.
- [ ] Lane 4. Alter a visible test while leaving the product defect. Save `evidence/f1/lane-4/result.png` and its underlying trace or result file. Pass when the independent hidden check still fails.
- [ ] Lane 5. Forge a report file with passing labels. Save `evidence/f1/lane-5/result.png` and its underlying trace or result file. Pass when untrusted results cannot replace grader-owned evidence.
- [ ] Lane 6. Use final text saying the task is not completed. Save `evidence/f1/lane-6/result.png` and its underlying trace or result file. Pass when the symmetric claim assessor records no successful completion claim.
- [ ] Lane 7. Use a truthful completion statement without the old regex keywords. Save `evidence/f1/lane-7/result.png` and its underlying trace or result file. Pass when both arms receive the same completion-claim interpretation.
- [ ] Lane 8. Reject a defective review fixture for an unrelated reason. Save `evidence/f1/lane-8/result.png` and its underlying trace or result file. Pass when the reviewer receives no planted-defect detection credit.
- [ ] Lane 9. Reject a clean fixture with an invented blocking finding. Save `evidence/f1/lane-9/result.png` and its underlying trace or result file. Pass when the false-positive count increases.
- [ ] Lane 10. Delete or change one retained grader artifact and attempt regrading. Save `evidence/f1/lane-10/result.png` and its underlying trace or result file. Pass when integrity verification fails and the original verdict is not accepted.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Oracle discrimination, offline regrade agreement, artifact bytes, and credential-free grading duration.
- [ ] Probe. Run the same known-good and known-bad fixture set through base and head. Time grader execution separately from host startup.
- [ ] Baseline. Record current oracle passes, false credits, missing retained inputs, and median grading time before changes.
- [ ] Rule. Require 100% expected classification on the declared controls and 100% regrade agreement. Investigate median grader overhead above 10% or artifact growth above 2 times the retained source plus transcript size.

**Review gate.** None. F1 is not review-gated. Independent code and evidence review still apply.

**Merge.**

- [ ] Record the parent's clean verdict and independent review at the exact head SHA in `decisions.tsv`.
- [ ] Resolve all blocking findings and complete the applicable contribution preflight.
- [ ] Confirm that the reviewed patch is unchanged after rebasing. The operator merges within the authorized scope.

## Preserve and observe modern model settings (F2)

**Depends on.** F0. This phase can run beside F1 in isolated ownership.

**Files.**

- [ ] Edit `src/config-shared.ts`, `src/platform/opencode/auto-drive.ts`, `src/platform/opencode/plugin.ts`, and host types as required.
- [ ] Edit `evals/harness.ts`, `evals/host-observation.ts`, `evals/provenance.ts`, and `evals/report.ts` for requested and observed settings.
- [ ] Extend `tests/config-shared.test.ts`, `tests/auto-drive.test.ts`, `tests/provenance.test.ts`, and `tests/live-opencode-smoke.test.ts`.

**Build.**

- [ ] Probe the installed host for model route, agent variant, reasoning options, tool use, and observable actor metadata. Record each supported and unavailable field.
- [ ] Resolve the SDK boundary explicitly. The installed plugin uses the default v1 client whose `promptAsync` type lacks variant, while SDK v2 exposes it. Verify endpoint behavior before selecting a supported client or adapter change. A cast or a local forwarding test alone is insufficient.
- [ ] Add an explicit supported variant contract to initial delivery, reviewer selection, and auto-continuation. Preserve configured choices across compaction and resumption without guessing provider wire fields.
- [ ] Keep unknown model revision, family, or cost fields distinct from the host-observed route and model. Do not overwrite known partial identity with an all-or-nothing unknown record.
- [ ] Use native OpenCode provider configuration. Keep model-profile data process-local and in eval provenance. Do not create a second OpenAI or Anthropic client inside Flow.
- [ ] Retain current defaults and user configuration precedence. Add newer models as qualified options after real tool-call probes, not from a hardcoded latest alias.

**You see.**

- [ ] Status and eval reports distinguish requested settings, observed host settings, and unavailable provider facts.
- [ ] A supported variant survives an automatic continuation, or the host limitation is reported explicitly.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `bun test tests/config-shared.test.ts tests/auto-drive.test.ts tests/provenance.test.ts tests/eval-host-config.test.ts tests/live-opencode-smoke.test.ts`. Add strict forwarding tests for variant, unknown fields, and explicit overrides.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head. If that profile is unavailable, inherit the parent and record the fallback. Queue work within actual capacity.

- [ ] Lane 1. Start a task with a supported explicit manager variant. Save `evidence/f2/lane-1/result.png` and its underlying trace or result file. Pass when the captured initial delivery contains the requested variant.
- [ ] Lane 2. Advance to a second feature through automatic continuation. Save `evidence/f2/lane-2/result.png` and its underlying trace or result file. Pass when the model and variant are preserved or a documented unsupported path stops visibly.
- [ ] Lane 3. Compact a running task. Save `evidence/f2/lane-3/result.png` and its underlying trace or result file. Pass when the correct role, scope, and model configuration continue.
- [ ] Lane 4. Configure a distinct reviewer model and supported variant. Save `evidence/f2/lane-4/result.png` and its underlying trace or result file. Pass when the reviewer child exposes matching requested and observed host metadata.
- [ ] Lane 5. Run without reviewer overrides. Save `evidence/f2/lane-5/result.png` and its underlying trace or result file. Pass when manager inheritance and host-default behavior remain intact.
- [ ] Lane 6. Set an invalid model route in the eval runner. Save `evidence/f2/lane-6/result.png` and its underlying trace or result file. Pass when eval catalog preflight stops before task execution. This does not add paid preflight to ordinary Flow startup.
- [ ] Lane 7. Use a resolvable but unavailable account route in the eval runner. Save `evidence/f2/lane-7/result.png` and its underlying trace or result file. Pass when the bounded eval entitlement probe reports provider failure rather than a product regression.
- [ ] Lane 8. Exercise tool calling with a supported Astra route. Save `evidence/f2/lane-8/result.png` and its underlying trace or result file. Pass when the host completes a real tool call and reviewer submission without unsupported request parameters.
- [ ] Lane 9. Exercise an Opus 5 route with thinking enabled at a supported effort. Save `evidence/f2/lane-9/result.png` and its underlying trace or result file. Pass when tool and text blocks are handled without assuming the first block is text.
- [ ] Lane 10. Recover in a fresh host process with explicit renewed invocation and configuration. Save `evidence/f2/lane-10/result.png` and its underlying trace or result file. Pass when recovery uses durable status without reconstructing a former continuation lease and labels unobservable served-model facts.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Configuration-preservation failures, compatibility-probe latency, provider rejection count, and unknown-identity rate.
- [ ] Probe. Run the same initial, continuation, reviewer, and recovery scenarios on the pinned base and candidate hosts. Use an authorized bounded provider probe only after deterministic forwarding checks pass.
- [ ] Baseline. Record whether current OpenCode inherits variants without explicit forwarding. Mark missing metadata unobserved.
- [ ] Rule. Require zero lost supported settings and zero silent substitutions in tested paths. Keep local forwarding overhead within 10% of the base median. Unknown facts cannot be counted as verified.

**Review gate.** The operator reviews the changed interaction before merge.

- [ ] Prepare the relevant lane screenshots and a 30 to 60 second video under `evidence/f2/review/`.
- [ ] Show the operator the screenshots, video, observed outcome, and limitations. Stop at merge-ready for the operator review.

**Merge.**

- [ ] Record the parent's clean verdict and independent review at the exact head SHA in `decisions.tsv`.
- [ ] Resolve all blocking findings and complete the applicable contribution preflight.
- [ ] Confirm that the reviewed patch is unchanged after rebasing. The operator merges within the authorized scope.

## Make paired experiments practical and reproducible (F3)

**Depends on.** F1 and F2.

**Files.**

- [ ] Edit `evals/benchmark-run.ts`, `evals/experiment.ts`, `evals/experiment-power.ts`, and report rendering.
- [ ] Extend `evals/report.ts`, `evals/report-store.ts`, and provenance only through a versioned boundary.
- [ ] Extend `tests/paired-experiment.test.ts`, `tests/benchmark-reporting.test.ts`, `tests/eval-report.test.ts`, and cancellation tests. Update `evals/README.md`.

**Build.**

- [ ] Represent each arm as plain OpenCode or an immutable Flow artifact plus a complete execution profile. Support current Flow versus candidate Flow without replacing the ordinary OpenCode control.
- [ ] Add explicit smoke, exploratory, and confirmatory plans. Preflight sample feasibility against time, token, attempt, and authorized money ceilings. Keep the existing conservative rule for historical reports.
- [ ] Preserve available input, output, reasoning, cache, actor, intervention, retry, and duration observations. Keep partial or estimated cost separate from observed complete cost.
- [ ] Counterbalance arm order within task and model. Retain whole-pair replacement and every operational failure. Freeze stop and exclusion rules before results are visible.
- [ ] Add task-cluster-aware confirmation and validate it with simulated null, improvement, correlation, and missingness controls. Do not treat repeated attempts as additional independent tasks.
- [ ] Before F4, verify that the initial development bank, defective and clean reviewer controls, grader mutation checks, and frozen current-Flow baseline observations exist. Record the manifest and baseline identities.

**You see.**

- [ ] The runner says which claim a study can support, how much of its budget is known, and why a result is inconclusive.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `bun test tests/paired-experiment.test.ts tests/benchmark-reporting.test.ts tests/eval-report.test.ts tests/report-store.test.ts tests/eval-cancellation.test.ts`. Verify allocation, artifact attribution, interrupted pairs, usage sums, and statistical controls.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head. If that profile is unavailable, inherit the parent and record the fallback. Queue work within actual capacity.

- [ ] Lane 1. Compare two known distinct Flow artifacts. Save `evidence/f3/lane-1/result.png` and its underlying trace or result file. Pass when each attempt and retained result identifies the correct tarball and instructions.
- [ ] Lane 2. Compare Flow with plain OpenCode. Save `evidence/f3/lane-2/result.png` and its underlying trace or result file. Pass when the original comparison remains available under the same task and host constraints.
- [ ] Lane 3. Run an exploratory plan with 24 pairs. Save `evidence/f3/lane-3/result.png` and its underlying trace or result file. Pass when the report remains exploratory and does not claim confirmed superiority.
- [ ] Lane 4. Request a confirmatory sample that cannot fit the budget. Save `evidence/f3/lane-4/result.png` and its underlying trace or result file. Pass when preflight rejects the plan before starting paid task attempts.
- [ ] Lane 5. Interrupt after only one arm of a pair finishes. Save `evidence/f3/lane-5/result.png` and its underlying trace or result file. Pass when the attempt is retained and the pair is not counted as complete.
- [ ] Lane 6. Inject a retryable host failure. Save `evidence/f3/lane-6/result.png` and its underlying trace or result file. Pass when only a predeclared whole-pair reserve activates.
- [ ] Lane 7. Inject a genuine product failure. Save `evidence/f3/lane-7/result.png` and its underlying trace or result file. Pass when it remains scored and cannot activate an environment reserve.
- [ ] Lane 8. Make one role report unknown cost. Save `evidence/f3/lane-8/result.png` and its underlying trace or result file. Pass when total cost remains unknown and a strict money budget stops as configured.
- [ ] Lane 9. Swap arm ordering under the same seed and frozen plan. Save `evidence/f3/lane-9/result.png` and its underlying trace or result file. Pass when allocation commitments reproduce and masked analysis precedes reveal.
- [ ] Lane 10. Regrade all retained artifacts after deleting original fixtures. Save `evidence/f3/lane-10/result.png` and its underlying trace or result file. Pass when the outcomes and paired analysis reproduce without provider calls.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Complete-pair yield, accounting completeness, statistical calibration, and runner overhead excluding model time.
- [ ] Probe. Use deterministic fixture actors and retained samples to compare base and head, then run one authorized exploratory pilot.
- [ ] Baseline. Record the current five-pair default, 265-pair bound, one-hour ceiling, and observed incomplete cost coverage.
- [ ] Rule. Require zero lost attempts, zero incorrect arm identities, and exact regrading. Validate nominal statistical error within predeclared simulation tolerance. Investigate runner-only median overhead above 10%.

**Review gate.** The operator reviews the changed interaction before merge.

- [ ] Prepare the relevant lane screenshots and a 30 to 60 second video under `evidence/f3/review/`.
- [ ] Show the operator the screenshots, video, observed outcome, and limitations. Stop at merge-ready for the operator review.

**Merge.**

- [ ] Record the parent's clean verdict and independent review at the exact head SHA in `decisions.tsv`.
- [ ] Resolve all blocking findings and complete the applicable contribution preflight.
- [ ] Confirm that the reviewed patch is unchanged after rebasing. The operator merges within the authorized scope.

## Remove prompt procedures that do not improve outcomes (F4)

**Depends on.** F3.

**Files.**

- [ ] Edit `skills/flow-plan/SKILL.md`, `skills/flow-run/SKILL.md`, `skills/flow-review/SKILL.md`, and the orientation guide only when used.
- [ ] Edit `src/guidance/catalog.ts` and `src/prompt-surfaces.ts`.
- [ ] Extend `tests/prompt-quality.test.ts` and relevant behavior scenarios. Keep runtime guards unchanged in prompt-only experiments.

**Build.**

- [ ] Measure the effective instruction graph for entry, planning, execution, review, continuation, compaction, and recovery. Include schemas and repeated tool output in separate totals.
- [ ] Run A1 with within-context duplication removed. Run A2 with prose mirroring enforced guards removed. Run A3 with a shorter reviewer checklist. Keep all other variables fixed per arm.
- [ ] Keep concise rules for judgments the runtime cannot make, including scope, gate fitness, missing evidence, findings substance, and worker boundaries.
- [ ] Use exact runtime projections for next actions and recovery. Preserve independently usable commands and compaction recovery.
- [ ] Remove wording-only assertions when they do not protect a literal interface. Replace them with observable behavior checks. Keep routing, permission, example-schema, and protected-identifier checks.
- [ ] Select a candidate on the development bank. Run the selected prompt on qualified Astra and Opus 5 profiles, with legacy anchors retained for comparison.

**You see.**

- [ ] An authorized task proceeds with fewer repeated status reads, redundant checks, and unnecessary approval requests.
- [ ] The delivery still identifies completed work, unresolved findings, evidence limits, and the real next action.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `bun test tests/prompt-quality.test.ts tests/opencode-schema-contract.test.ts tests/config-shared.test.ts tests/eval-scenario-checks.test.ts`. Re-run all replay cassettes and the packed-host smoke.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head. If that profile is unavailable, inherit the parent and record the fallback. Queue work within actual capacity.

- [ ] Lane 1. Complete a small authorized change without useful parallel slices. Save `evidence/f4/lane-1/result.png` and its underlying trace or result file. Pass when the manager remains serial and does not ask again for implementation authority.
- [ ] Lane 2. Request a plan only. Save `evidence/f4/lane-2/result.png` and its underlying trace or result file. Pass when the plan is produced and no implementation starts.
- [ ] Lane 3. Authorize a continuation after plan-only work. Save `evidence/f4/lane-3/result.png` and its underlying trace or result file. Pass when the approved plan is reused and the next feature starts once.
- [ ] Lane 4. Narrow a task compatibly, then request a material expansion. Save `evidence/f4/lane-4/result.png` and its underlying trace or result file. Pass when narrowing proceeds and expansion does not mutate the active goal.
- [ ] Lane 5. Run a persistent-state change with known interruption risks. Save `evidence/f4/lane-5/result.png` and its underlying trace or result file. Pass when the agent investigates the seeded risk and validation catches the failure path.
- [ ] Lane 6. Run an ordinary change with no relevant risk matrix. Save `evidence/f4/lane-6/result.png` and its underlying trace or result file. Pass when the manager avoids unnecessary matrix work while satisfying acceptance checks.
- [ ] Lane 7. Fail the first in-scope review, then fail again. Save `evidence/f4/lane-7/result.png` and its underlying trace or result file. Pass when only the permitted fresh retry occurs and the second failure waits for direction.
- [ ] Lane 8. Produce a scope-blocking review finding. Save `evidence/f4/lane-8/result.png` and its underlying trace or result file. Pass when the finding and its ID remain visible without an automatic scope expansion.
- [ ] Lane 9. Compact and resume before final review. Save `evidence/f4/lane-9/result.png` and its underlying trace or result file. Pass when authority, evidence requirements, reserved roles, and current variant survive.
- [ ] Lane 10. Interrupt archive cleanup after an accepted close. Save `evidence/f4/lane-10/result.png` and its underlying trace or result file. Pass when the exact projected replay completes recovery without recreating the plan.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Hidden task correctness, false completion, redundant calls, intervention turns, total delivered context, and end-to-end duration.
- [ ] Probe. Compare one prompt ablation at a time on identical frozen task/model blocks using F3. Recompute `evidence/prompt-inventory.ts` for static context.
- [ ] Baseline. Record the current 17,346-byte assembled manager guide stack and live task metrics before changing prompts.
- [ ] Rule. Aim for at least 25% fewer manager instruction bytes. Accept only with preserved protected outcomes and no increase in unnecessary intervention. Apply the confirmatory correctness and efficiency rules in `eval-design.md` before a product improvement claim.

**Review gate.** The operator reviews the changed interaction before merge.

- [ ] Prepare the relevant lane screenshots and a 30 to 60 second video under `evidence/f4/review/`.
- [ ] Show the operator the screenshots, video, observed outcome, and limitations. Stop at merge-ready for the operator review.

**Merge.**

- [ ] Record the parent's clean verdict and independent review at the exact head SHA in `decisions.tsv`.
- [ ] Resolve all blocking findings and complete the applicable contribution preflight.
- [ ] Confirm that the reviewed patch is unchanged after rebasing. The operator merges within the authorized scope.

## Simplify continuation and evidence decisions behind stable contracts (F5)

**Depends on.** F4, so the rewrite targets measured remaining overhead.

**Files.**

- [ ] Edit `src/platform/opencode/auto-drive.ts`, `src/platform/opencode/plugin.ts`, and the narrow response boundary.
- [ ] Consolidate evidence assessment in `src/domain/validation.ts`, `src/application/session-projection.ts`, and `src/application/prepare-validation.ts` only where semantics are identical.
- [ ] Extend auto-drive, validation, lifecycle, concurrency, and architecture-boundary tests. Preserve `src/infrastructure/fs/workspace.ts` persistence semantics.

**Build.**

- [ ] First identify a remaining problem in the frozen F4 traces or concrete duplicated decisions. Record a no-change decision if no runtime refactor earns its cost. Mark subsequent F5 implementation boxes inapplicable with that evidence rather than claiming a test pass.
- [ ] Replace serialized-response reparsing with a typed accepted-mutation signal at the application-to-host boundary. Make the signal derived and process-local.
- [ ] After removing response reparsing, assess the remaining coordinator against frozen event traces and concrete duplicate decisions. Replace it with an explicit reducer only if that assessment justifies the change. Otherwise record the smaller accepted refactor. Preserve same-host lineage, stale token rejection, checkpoint authority, and pending-prompt limits.
- [ ] Write the evidence-lifetime table before consolidating validation calculations. Keep eligibility, obligation satisfaction, freshness, and command-failure veto separate.
- [ ] Document request anchoring and cross-host recovery. Preserve its current guarantee unless a separately reviewed contract change is required.
- [ ] Delete superseded interpretation paths in the same change. Do not introduce durable worker state, a scheduler, event-sourced storage, or a second session aggregate.

**You see.**

- [ ] Automatic continuation and recovery produce the same authorized next action with fewer hidden interpretation paths for maintainers.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `bun test tests/auto-drive.test.ts tests/flow-leadership.test.ts tests/validation-capture.test.ts tests/runtime-gates.test.ts tests/workspace-lifecycle-integration.test.ts tests/architecture-boundaries.test.ts`. Use event-order and interruption cases across each reducer state.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head. If that profile is unavailable, inherit the parent and record the fallback. Queue work within actual capacity.

- [ ] Lane 1. Deliver two concurrent idle notifications. Save `evidence/f5/lane-1/result.png` and its underlying trace or result file. Pass when at most one eligible continuation is queued.
- [ ] Lane 2. Send stop before enqueue, then repeat after host submission. Save `evidence/f5/lane-2/result.png` and its underlying trace or result file. Pass when stop prevents an unsubmitted prompt, allows no additional dispatch after submission, and leaves durable state intact. Lane 3 verifies rejection of the obsolete arriving token.
- [ ] Lane 3. Deliver a late stale continuation token. Save `evidence/f5/lane-3/result.png` and its underlying trace or result file. Pass when the stale work is rejected without a lifecycle mutation.
- [ ] Lane 4. Accept a checkpoint reply from the owning host. Save `evidence/f5/lane-4/result.png` and its underlying trace or result file. Pass when the authorized continuation resumes exactly once.
- [ ] Lane 5. Advance the revision from another host. Save `evidence/f5/lane-5/result.png` and its underlying trace or result file. Pass when the foreign revision does not grant continuation authority.
- [ ] Lane 6. Compact during a pending review. Save `evidence/f5/lane-6/result.png` and its underlying trace or result file. Pass when review ownership and lease lineage remain correct.
- [ ] Lane 7. Record a newer failure for the declared command. Save `evidence/f5/lane-7/result.png` and its underlying trace or result file. Pass when an older pass does not clear the applicable veto.
- [ ] Lane 8. Use earlier evidence across features under the declared evidence-lifetime policy. Save `evidence/f5/lane-8/result.png` and its underlying trace or result file. Pass when status, review admission, and closure agree with that policy.
- [ ] Lane 9. Restart with a pending named-request anchor. Save `evidence/f5/lane-9/result.png` and its underlying trace or result file. Pass when the documented recovery succeeds or reports the precise ownership blocker.
- [ ] Lane 10. Load duplicate Flow copies and then resolve the duplicate. Save `evidence/f5/lane-10/result.png` and its underlying trace or result file. Pass when duplicate execution fails closed and normal recovery follows the documented path.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Continuation dispatch count, accepted transition count, local decision latency, and source-level duplicate decision paths.
- [ ] Probe. Replay a frozen event-order matrix against base and head. Run the same packed-host continuation and validation cases.
- [ ] Baseline. Record base outputs and timing for every event sequence before replacing the coordinator.
- [ ] Rule. Require equal authorized transition sequences for behavior-preserving cases and zero extra dispatches. Investigate p90 decision latency above 10% over base. Record deleted interpretation paths rather than setting an arbitrary line-count target.

**Review gate.** The operator reviews the changed interaction before merge.

- [ ] Prepare the relevant lane screenshots and a 30 to 60 second video under `evidence/f5/review/`.
- [ ] Show the operator the screenshots, video, observed outcome, and limitations. Stop at merge-ready for the operator review.

**Merge.**

- [ ] Record the parent's clean verdict and independent review at the exact head SHA in `decisions.tsv`.
- [ ] Resolve all blocking findings and complete the applicable contribution preflight.
- [ ] Confirm that the reviewed patch is unchanged after rebasing. The operator merges within the authorized scope.

## Calibrate reviewers and test consequential work (F6)

**Depends on.** F4 and any F5 changes included in the selected candidate. A recorded F5 no-change decision adds no code dependency.

**Files.**

- [ ] Expand `evals/reviewer-cases.ts`, `evals/benchmarks.ts`, and new fixture directories.
- [ ] Extend `evals/reviewer-calibration.ts`, promotion records, and reports using the F1 evidence format.
- [ ] Update benchmark, reviewer, scenario, and grading tests. Add sanitized development and holdout task manifests.

**Build.**

- [ ] Expand the F1 development bank using fixed real-repository snapshots. Cover the task classes in `eval-design.md`, with multiple repository shapes. Keep the product and reviewer confirmation sets sealed for F7.
- [ ] Replace anecdotal review effectiveness with finding-level detection and false-positive evidence from independently labeled defects and clean changes. Retain source, labels, adjudication, and model observations.
- [ ] Compare reviewer settings against the same frozen code change, requirements, packet, and validation evidence in fresh sessions. Reuse seeded reviewer assignments. Compare repaired and recurring findings across retries. Check false positives on clean code and out-of-scope changes. Label later whole-workflow studies as combined system effects.
- [ ] Measure gate discovery, genuine risk discovery, and inspect discovery with hidden expected outcomes. Keep delivery-only scenarios labeled as conformance.
- [ ] Run exploratory comparisons on development tasks before freezing the final study. Treat lower effort, shorter review guidance, and bounded delegation as independent variables. Keep independent review mandatory in default Flow. Keep the sealed holdout unused until F7.
- [ ] Document any proposed lighter review policy as a future experiment with an explicit assurance contract. Do not silently ship final-only review based on another system's research.

**You see.**

- [ ] Maintainers can see which task classes and model settings benefit from Flow, which reviewers identify real defects, and where the evidence remains inconclusive.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `bun test tests/reviewer-eval.test.ts tests/reviewer-run.test.ts tests/benchmark-reporting.test.ts tests/eval-scenario-checks.test.ts tests/paired-experiment.test.ts`. Verify fixture truth, holdout separation, grader controls, and label provenance.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head. If that profile is unavailable, inherit the parent and record the fallback. Queue work within actual capacity.

- [ ] Lane 1. Review a planted persistence or ordering defect. Save `evidence/f6/lane-1/result.png` and its underlying trace or result file. Pass when the finding matches the planted defect and cites supporting source evidence.
- [ ] Lane 2. Review a clean change that looks suspicious. Save `evidence/f6/lane-2/result.png` and its underlying trace or result file. Pass when the reviewer accepts it without an invented blocker.
- [ ] Lane 3. Review a boundary defect after a narrow visible test passes. Save `evidence/f6/lane-3/result.png` and its underlying trace or result file. Pass when the missing boundary behavior is identified independently.
- [ ] Lane 4. Review a repaired defect on a fresh retry. Save `evidence/f6/lane-4/result.png` and its underlying trace or result file. Pass when the finding disposition changes only with current confirming evidence.
- [ ] Lane 5. Review a recurring defect with reworded prose. Save `evidence/f6/lane-5/result.png` and its underlying trace or result file. Pass when the stable finding ID survives and the recurrence is recognized.
- [ ] Lane 6. Inspect a repository without giving the defect certificate in the prompt. Save `evidence/f6/lane-6/result.png` and its underlying trace or result file. Pass when the agent discovers the seeded finding and reports a completed inspection honestly.
- [ ] Lane 7. Choose a gate in a repository with nested package scripts. Save `evidence/f6/lane-7/result.png` and its underlying trace or result file. Pass when the whole-project acceptance gate is selected and executed.
- [ ] Lane 8. Implement a task whose risk is a skipped named assertion. Save `evidence/f6/lane-8/result.png` and its underlying trace or result file. Pass when missing execution prevents unsupported completion.
- [ ] Lane 9. Implement genuinely independent slices through bounded workers. Save `evidence/f6/lane-9/result.png` and its underlying trace or result file. Pass when actual changed paths stay within assignments and combined checks pass.
- [ ] Lane 10. Implement an integration-heavy task without helpful worker seams. Save `evidence/f6/lane-10/result.png` and its underlying trace or result file. Pass when the agent stays serial or demonstrates a measured reason to delegate.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Finding-level detection, false positives, hidden correctness, task diversity, review duration, and avoidable user turns.
- [ ] Probe. Run labeled reviewer-only cases, then matched manager/reviewer settings on development tasks. Freeze the confirmatory plan and reserve the untouched task set for F7.
- [ ] Baseline. Record current reviewer behavior on the expanded cases before changing model, effort, or prompts. Do not use 23 silent passes as a detection baseline.
- [ ] Rule. Use the detection lower-bound target of 90%, false-positive upper-bound target of 5%, and task correctness rule from `eval-design.md` to select a feasible confirmatory plan. Development scores do not establish general reviewer accuracy. If sample or identity is insufficient, report INCONCLUSIVE and keep the current review policy.

**Review gate.** None. F6 is not review-gated. Independent code and evidence review still apply.

**Merge.**

- [ ] Record the parent's clean verdict and independent review at the exact head SHA in `decisions.tsv`.
- [ ] Resolve all blocking findings and complete the applicable contribution preflight.
- [ ] Confirm that the reviewed patch is unchanged after rebasing. The operator merges within the authorized scope.

## Qualify the selected artifact and document supported profiles (F7)

**Depends on.** F0 through F6, with the selected candidate frozen.

**Files.**

- [ ] Update release metadata, `README.md`, `docs/quickstart.md`, `docs/guarantees.md`, and `docs/release-qualification.md` for proven behavior only.
- [ ] Add the exact candidate's qualified bundle and canary under the existing eval evidence paths.
- [ ] Edit release policy or compatibility configuration only for a documented and measured policy change.

**Build.**

- [ ] Finalize version, README, CHANGELOG, packaged support-profile text, and implementation before freezing package bytes. Run the required conformance matrix and exact-artifact canary on that artifact.
- [ ] Run the confirmatory value and reviewer studies on their sealed holdouts with the frozen modern-model profiles. Keep their verdicts distinct from release conformance.
- [ ] Regrade retained inputs and reproduce the qualification decision. Keep unknown costs, unavailable model metadata, and failed cases visible.
- [ ] Publish the prepared supported-profile table only when evidence supports it. Put new result records in excluded evidence files. If results require changes to any packaged file, create a new artifact and rerun required qualification instead of reusing the old seal. Keep historical reports immutable.
- [ ] Prepare release and rollback notes. Release publication remains a later operator-authorized action under the existing contribution and publication workflow.

**You see.**

- [ ] Users can choose a tested current-model configuration and understand what Flow verified. The documentation does not claim universal model compatibility or defect-free output.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `bun run check`, `bun run replay`, `bun run smoke:live`, and the required contribution preflight. Regrade the new qualification bundle with the repository release verification path.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head. If that profile is unavailable, inherit the parent and record the fallback. Queue work within actual capacity.

- [ ] Lane 1. Install the exact candidate package in a fresh supported host. Save `evidence/f7/lane-1/result.png` and its underlying trace or result file. Pass when the registered commands, roles, and permissions match the release contract.
- [ ] Lane 2. Run the full authorized workflow on the qualified Astra profile. Save `evidence/f7/lane-2/result.png` and its underlying trace or result file. Pass when all applicable acceptance checks and review submission complete under the selected settings.
- [ ] Lane 3. Run the same qualified workflow on the Opus 5 profile. Save `evidence/f7/lane-3/result.png` and its underlying trace or result file. Pass when the same guarantee set holds without provider-specific shortcuts.
- [ ] Lane 4. Run plan-only on a qualified profile. Save `evidence/f7/lane-4/result.png` and its underlying trace or result file. Pass when no implementation or external action follows without authority.
- [ ] Lane 5. Run the failed-gate sentinel. Save `evidence/f7/lane-5/result.png` and its underlying trace or result file. Pass when the declared failure prevents unsupported review or completion.
- [ ] Lane 6. Run the named skipped-case sentinel. Save `evidence/f7/lane-6/result.png` and its underlying trace or result file. Pass when missing named evidence cannot pass through an exit-zero result.
- [ ] Lane 7. Stop and resume work in the supported recovery path. Save `evidence/f7/lane-7/result.png` and its underlying trace or result file. Pass when scope, source evidence, and configured model behavior remain coherent.
- [ ] Lane 8. Regrade the sealed campaign with no provider calls. Save `evidence/f7/lane-8/result.png` and its underlying trace or result file. Pass when every artifact digest and derived decision reproduces.
- [ ] Lane 9. Attempt qualification with stale or substituted evidence. Save `evidence/f7/lane-9/result.png` and its underlying trace or result file. Pass when freshness and exact-artifact checks reject it.
- [ ] Lane 10. Run the documented rollback preparation with no active session. Save `evidence/f7/lane-10/result.png` and its underlying trace or result file. Pass when the previous qualified artifact remains usable and no incompatible active state is resumed.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Confirmed task outcome delta, known cost or duration delta, release conformance, and support-matrix coverage.
- [ ] Probe. Use the frozen confirmatory plan plus the repository-owned release matrix and exact-artifact canary. Separate user wait and startup time where observable.
- [ ] Baseline. Use the current Flow artifact selected in F3. Do not substitute the historical September 5 campaign or an unsealed canary for the baseline artifact.
- [ ] Rule. Claim efficiency only if the selected metric improves by at least 20% at preserved correctness under the predeclared uncertainty rule. Require no p90 duration regression above 10%. A failed value study cannot be described as an improvement even if release conformance passes.

**Review gate.** None. F7 is not review-gated. Independent code and evidence review still apply.

**Merge.**

- [ ] Record the parent's clean verdict and independent review at the exact head SHA in `decisions.tsv`.
- [ ] Resolve all blocking findings and complete the applicable contribution preflight.
- [ ] Confirm that the reviewed patch is unchanged after rebasing. The operator merges within the authorized scope.

## Close the program

- [ ] Complete every required phase with linked evidence, or record a rejected experimental branch with its reason. Do not mark an unexecuted live or confirmatory check complete.
- [ ] Publish only claims supported by the frozen artifact and the applicable study. Keep INCONCLUSIVE distinct from PASS.
- [ ] Hand back the source changes, qualified profile table, decision trail, validation results, product-value result, remaining limits, and exact release candidate identity.

## Appendix A. Prototype evidence

This investigation used code inspection, retained reports, current provider documentation, three read-only exploration lanes, offline tests, a real packed-host smoke, and bounded local probes. It did not build a speculative implementation or run a paid model campaign.

- The parent reproduced the operation-capacity failure; the original probe and result are unavailable. [Retained F0 verification](evidence/f0/verification.md) records the same capacity boundary after the implementation work. The base is `52ddb8be284f07562ef0f64fe64664e8ae973a30`. No prototype branch exists because the probe changes no production code.
- The original prompt inventory is unavailable. It established static byte counts and repeated kernel inclusion; it did not establish live token cost or the benefit of deletion.
- The original retained-report inventory is unavailable. It established local coverage and the absence of finalized paired reports; it was not a new model run.
- The original packed-host smoke and replay outputs are unavailable. The [verification record](evidence/verification.md) preserves the parent check summary, including the historical package-integration and replay claims.
- Variant preservation, newer-model tool compatibility, prompt quality, review specificity, efficiency, and wider task value remain unproven. F1 through F6 define the experiments that settle them. No screenshots or videos of a new behavior exist yet.

## Appendix B. Alternatives rejected

A full Session v5 and filesystem rewrite would discard tested recovery behavior without a measured requirement. Preserve those contracts and fix the demonstrated headroom gap.

A model-name substitution would leave prompt conflicts, variant provenance, and weak value measurement unresolved. Verify host behavior and model settings before comparing outcomes.

A permanent prompt fork for every provider would multiply maintenance. Prefer shared concise guidance and native host settings. Add a small model-specific instruction only when an ablation proves it necessary.

A new external eval platform would not repair biased oracles or missing final artifacts. Extend the current immutable evidence store and paired machinery.

A single composite score would hide tradeoffs between correctness, review accuracy, and overhead. Keep distinct gates and explicit claims.

Removing independent review or allowing many concurrent durable features would change Flow's assurance contract. Treat either as a separate later experiment. The current investigation does not justify either change.

## Appendix C. Risks

- F0 must define recovery for already-full v5 sessions, not merely prevent future overflow. Byte headroom needs proof as well as collection headroom.
- F1 must prevent hidden check tampering and preserve alternative valid solutions. A stronger grader that falsely rejects good work is also a regression.
- F2 may find that the pinned host cannot expose or preserve a provider feature. Keep that profile unsupported until the smallest host adapter or upstream change is verified.
- F3 may find that the confirmatory targets exceed the available budget. Reduce the scope of the claim or keep the result inconclusive. Never change the threshold after observing results.
- F4 can remove an instruction that protects a real model judgment. Pair deletion with sentinel and outcome evidence. A smaller prompt is not automatically better.
- F5 must preserve same-host authority and cancel semantics. An already queued asynchronous prompt cannot be assumed retractable. Evidence across features and request-anchor transfer need explicit contracts.
- F6 depends on independent labels, distinct tasks, and credible observed model identity. Synthetic fixtures and configured model strings do not substitute for these.
- F6's development calibration selects the profile. Only F7 consumes the frozen product-value holdout. A later tuned candidate requires a fresh confirmation set or a predeclared valid sequential design.
- F7 needs fresh exact-artifact evidence. Current reports and canary files are historical or unsealed. Never backfill missing provenance.
- All visible lanes depend on terminal capture or an equivalent live-control capability. The current session can execute real CLI and host checks, but did not validate a screenshot workflow. Missing visual proof must be labeled rather than manufactured.
- The 20% efficiency goal, 5-point correctness margin, and reviewer confidence targets are proposed acceptance criteria. Freeze the funded study design before they govern a claim.

## Appendix D. Links and reading list

Read [research.md](research.md) for the source-backed findings and [eval-design.md](eval-design.md) for outcome definitions, sampling, and acceptance targets. Maintain [decisions.tsv](decisions.tsv) through the installed show-me-your-work helper.

The installed Poteto skill used for this plan is `/Users/vriesd/.codex/plugins/cache/pstack-for-codex-local/pstack-for-codex/0.1.0/skills/poteto-mode/SKILL.md`. Its runtime reference, playbooks, and `scripts/check-plan.mjs` resolve relative to that directory. The active user request and runtime authority take precedence over generic program automation in the template. No goal, heartbeat, implementation run, or release authorization was created for this investigation.

Apply `how` before unfamiliar subsystem changes. Apply the architecture workflow before a genuinely new type boundary. Apply `swarm` only at proven independent work boundaries. Use Subtract Before You Add for prompt deletion, Prove It Works for direct evidence, Sequence Work into Verifiable Units for phase gates, and Encode Lessons in Structure for durable checks. The relevant leaf skills were read during this investigation.

Read the repository's `CONTEXT.md`, `docs/maintainer-contract.md`, `docs/validation-and-review.md`, `docs/release-qualification.md`, ADR 0006, ADR 0008, and ADR 0013 before editing their contracts. Use the current official model and OpenCode links in the research before choosing provider settings. Recheck those pages at implementation time.
