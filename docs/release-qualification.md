# Release qualification and cadence

This page owns release thresholds, candidate freezing, and publication order.

## The qualification bar

`bun run qualify` applies these to an eval report
(`scripts/qualify-release.ts` is the executable copy; this page is why).

| Threshold | Value | Why |
| --- | --- | --- |
| Distinct providers | 1 for 9.1.0, 9.2.0, 9.3.0, and 9.4.0; otherwise ≥ 2 | These exceptions pin `openai/gpt-6-sol` and support OpenAI-only claims. |
| False completions | 0 | A `completed` closure the document itself contradicts is the failure Flow exists to prevent. |
| Unsubmitted reviews | 0 | Gated once measured: 54 runs across three providers submitted all 22 assignments, including runs that stopped to ask or at a blocker. |
| Scored attempts per provider | 3 at 100%; 10 at 90% | The frozen release plan gives each threshold enough trials to express its allowed failures. |
| Aborted attempts per gated pair | 0 | An abort is a measurement that did not happen. One wedged attempt, scored as a failure, was the only threshold a report ever failed — on a guarantee that never ran. |
| `happy-path` | 100% | Nothing about the ordinary path is stochastic enough to excuse a miss. |
| `plan-only-stops` | 100% | Same. |
| `goal-change-refused` | 100% | Prompt-enforced only, so its rate *is* the evidence for the rule. |
| `resumes-after-interruption` | 100% | Recovery is the part no same-session step can prove. |
| `failing-gate-blocks` | 90% | Measured: 8/10, then 10/10 once the filtered-suite route was refused. `--release` freezes ten attempts per provider. |
| `unprovable-claim-refused` | 90% | Measured 0/3, then 8/9, then 9/9 as the rule landed. Judge it at `--release`'s 10 attempts so one miss is measurable as 9/10. |
| `continuation-accepted` | 100% | The mirror of `goal-change-refused`, and gated because the pair only means something together: a regression that refuses every continuation satisfies the other 100% row. 9/9 across three providers. |
| `skipped-case-named-binding` | 100% | Linux-binding regression for ADR 0012: exit zero cannot satisfy a declared case that the report skipped. |
| `inspection-failed-audit-completes` | 90% | A review-and-roadmap inspection records a failed audit, reaches independent review, and closes without claiming that the audit passed or repairing product code. |
| `auto-two-features-evidence` | 100% in 9.4.0 | Two dependent features, native reviewer packet access and final gate. |
| `auto-prerequisite-repair` | 100% in 9.4.0 | In-target repair or accepted failed-gate amendment; immutable canonical gate. |
| `auto-observe-with-required-pass` | 100% in 9.4.0 | Honest nonzero audit plus separate required pass on the reviewed source. |

Ungated exploratory scenarios are listed in [evals](../evals/README.md#scenarios).

Offline verifier fixes may reuse runs for unchanged package bytes and case policy.
Current code regrades outcomes without executing historical code; execution sources
must match their recorded Git commit. Missing sources or changed outcomes fail.
Canary retries must retain consistent manager/reviewer identity.

Reviewed offline exceptions: [narrow patches](../.agents/plans/06-patch-release/README.md)
and [frozen features](../.agents/plans/09-planning-models/README.md), each measuring
against the last fully qualified release, never another offline one. Their notes
distinguish prior evidence from candidate measurements. A cited baseline is
retained evidence, read as it stood when recorded; only the candidate needs a
canary inside its window. The wall clock decided this until 9.0.1, which made
every published offline release stop verifying seventy-two hours after its
baseline was measured.

New scenarios need a policy decision. Missing required cases fail qualification.

A non-product attempt never shrinks the required sample. The frozen plan retains
one environment reserve per provider and case. A retryable provider or host
failure activates that exact reserve; the failed attempt remains evidence. A
second external failure or an unallowed ask leaves a gap. Product and evaluator
failures never activate reserves. Evaluator failure is `NOT VERIFIED`;
persistence failure stops without a finalized report.

Repository code owns the release catalog; persisted `catalog.json` must match.
Versions 9.1.0 and 9.2.0 use 38 primary cells and eight reserves on GPT-6 Sol.
Version 9.3.0 uses 48 primary cells and nine reserves. Version 9.4.0 adds three
autonomous cases, giving 57 primary cells and 12 reserves on GPT-6 Sol. Other
versions use 96 primary cells and 18 reserves on distinct providers.
Narrowed, extended, or merged summary reports cannot qualify.

Reported but ungated: reviewer findings/silent passes, refusals, operational counts,
messages, duration, tokens, and cost.

Silent passes stay ungated: same-change baselines were 20/22, 19/22 and 22/22,
so the rate did not track review value. `adjacent-defect-refused` is the future
baseline.

Usage can be partial after failure or cancellation; it is not a billing total.
See [eval reporting limits](../evals/README.md#stopping-a-campaign).

Recovery delegation binds the qualified Jev model, rubric, policy, thresholds
and packet construction. A changed model or rubric needs a fresh reviewed
holdout and release profile. A resolved-version mismatch reports both versions
as `model-mismatch`, grants no action and preserves the checkpoint.

## Cadence

Finish or close active sessions before changing Flow versions in either direction.

- **Freeze the public surface** during measurement: tools, commands, guides,
  agents, and Session v5. Optional fields may be added; removals and renames wait.
- **Full qualification** requires a sealed V2 bundle and fresh canary, except for
  the reviewed offline paths above. Retain every attempt, transcript, grader
  source, and artifact byte. Release metadata regrades them and derives the
  provider-count release table; `CHANGELOG` states schema impact.
- **Patch releases** address defects and host compatibility, monitored by the
  weekly OpenCode smoke.
- **Deprecate before removing.** A surface that is going away is announced in one
  release and removed no earlier than the next major, so no session is stranded
  mid-lifecycle by an upgrade.

[Publication recovery](../.agents/plans/05-release-simplification/README.md#recovery).

## Running it

Finish code, dependency, version and changelog changes first. Pass frozen install,
`bun run check`, `bun run replay`, audit, live smoke and CI before paid qualification.
Freeze packed contents and evaluator inputs, then run the versioned matrix
on the canonical Linux host. Run a fresh canary against its exact `artifact.tgz`,
seal/regrade the bundle, and commit only evidence without changing measured inputs.
Recheck final main CI and exact artifact identity before tagging `v<package-version>`.
For 9.4.0, use
`bun scripts/prepare-qualified-release-940.ts --out opencode-plugin-flow-9.4.0.tgz`.

Authorize dispatches using the [paid-run budget](../.agents/plans/05-release-simplification/README.md#authorize-paid-work).
Keep that ledger across retries. Budget-stopped campaigns cannot qualify.
For 9.1.0, 9.2.0, 9.3.0, and 9.4.0, run the pinned OpenAI model.

```bash
bun run eval -- --release --model openai/gpt-6-sol
bun run eval:canary -- prepare --report <campaign-dir>/report.json --out <canary-dir>
# Run the prepared fixture, then record its session and transcript.
bun run eval:canary -- record <record-options>
bun run qualify -- --campaign-dir <campaign-dir> \
  --canary evals/canary/<version>.json
```

Use the [cheaper tiers](../evals/README.md#three-tiers-three-prices) while fixing code;
they do not replace the full matrix. `bun run triage` identifies runs worth reading.

`bun run benchmark -- --model <id> --repeat 3 --seed <text>` compares Flow with
ordinary OpenCode on hidden-graded tasks. It is not a qualification input.

Scheduled campaigns require explicit authorization and a dispatch budget.
They retain the ledger and complete campaign directory. Sealing still requires
the exact-artifact canary. Workflow retries never start another paid campaign.

## Retained review reporting

For offline review counts and assessed findings, see [reporting](../.agents/plans/04-model-adaptive-overhaul/evidence/f6-retained/reporting.md).
