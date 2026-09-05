# Release qualification and cadence

This page owns release thresholds, candidate freezing, and publication order.

## The qualification bar

`bun run qualify` applies these to an eval report
(`scripts/qualify-release.ts` is the executable copy; this page is why).

| Threshold | Value | Why |
| --- | --- | --- |
| Distinct providers | ≥ 2 | Every report recorded before this policy was single-model, so "works with Flow" meant "worked once, with one provider". |
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
| `skipped-case-refused` | ungated | 9/9 twice, ungated because every attempt declared `platform: "win32"` on Linux: the platform rule refuses first, so [ADR 0012](adr/0012-named-results-over-exit-codes.md)'s named-case rule is never binding. |
| `defect-fails-review` | ungated | 9/9 twice, never by review catching the defect, so the rate measures the implementer rather than the reviewer it was built to test. |
| `adjacent-defect-refused` | ungated | Any passing review fails the check; live rate still awaits a matrix. |
| `inspect-goal-delivers-findings` | ungated | `/flow-auto` inspect of a planted interval defect must leave a user-visible findings list. |
| `project-gate-discovery` | ungated | Report-only until two provider baselines show whether planning selects the explicit whole-repository command over a narrower script. |
| `task-risk-lenses` | ungated | Measures whether the manager supplies the relevant full review questions. It does not measure defect detection or false blockers. |

A new scenario needs an explicit release-policy decision. Any required canonical
case missing from the report fails qualification.

A non-product attempt never shrinks the required sample. The frozen plan retains
one environment reserve per provider and case. A retryable provider or host
failure activates that exact reserve; the failed attempt remains evidence. A
second external failure or an unallowed ask leaves a gap. Product and evaluator
failures never activate reserves. Evaluator failure is `NOT VERIFIED`;
persistence failure stops without a finalized report.

Repository code owns the ordered release catalog. Persisted `catalog.json` is only a
witness and must match it exactly. The two-provider grid has 76 primary cells and
16 predeclared environment reserves; ordinary, narrowed, dynamically extended, or
merged summary reports cannot qualify.

Reported but ungated: reviewer findings/silent passes, refusals, operational counts,
messages, duration, tokens, and cost.

Silent passes stay ungated. Three same-change baselines moved from 20/22 to 19/22 to
22/22, so the level did not track reviewer value. `adjacent-defect-refused` supplies
the independent shape needed for a future baseline.

Usage is provider-shaped and may be partial after failure or cancellation, not a
billing total. See [eval reporting limits](../evals/README.md#stopping-a-campaign).

## Cadence

Finish or close active sessions before changing Flow versions in either direction.

- **Freeze on the public surface** while the guarantees are being measured: tools,
  commands, guides, agents, and the Session v5 shape. Additive optional fields are
  allowed; removals and renames are not.
- **No release** without a sealed V2 qualification bundle and fresh canary.
  The bundle retains every attempt, transcript, grader source, and exact artifact
  needed to reproduce its decision. Release metadata independently regrades those
  bytes before publication and derives the provider-count evidence table added to
  the release notes. A `CHANGELOG` entry states the schema impact explicitly.
- **Patch releases** for defects and host-compatibility fixes, which is what the
  weekly OpenCode compatibility smoke exists to catch early.
- **Deprecate before removing.** A surface that is going away is announced in one
  release and removed no earlier than the next major, so no session is stranded
  mid-lifecycle by an upgrade.

## Running it

Finish code, dependency, version and changelog changes first. Pass frozen install,
`bun run check`, `bun run replay`, audit, live smoke and CI before paid qualification.
Freeze packed contents and evaluator inputs, then run the full two-provider matrix
on the canonical Linux host. Run a fresh canary against its exact `artifact.tgz`,
seal/regrade the bundle, and commit only evidence without changing measured inputs.
Recheck final main CI and exact artifact identity before tagging `v<package-version>`.

For 8.2.1, strict exact-artifact qualification remains in force. A dev-only manifest
change still changes the packed artifact; evidence reuse needs a separate policy
decision. Stop for fixes rather than silently restarting paid runs. Operator or
budget-stopped campaigns cannot qualify, even if retained scores meet the target.

```bash
bun run eval -- --release --model openai/gpt-5.6-sol --model xai/grok-4.6
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

The scheduled workflow runs the paid campaign weekly and publishes its complete
campaign directory. Sealing waits for the exact-artifact canary, so the workflow
reports qualification as inconclusive rather than manufacturing a partial bundle.
It skips itself when no model matrix or provider credentials are configured.
