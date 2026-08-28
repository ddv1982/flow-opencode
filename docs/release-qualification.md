# Release qualification and cadence

Two policies live here: the numbers a release has to clear, and how often releases
happen. Both exist because the previous answer to each was a judgment call made
once, by one person, from one model's output.

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

A new scenario needs an explicit release-policy decision. Any required canonical
case missing from the report fails qualification.

A non-product attempt never shrinks the required sample. Provider or host failure,
or an unallowed ask, leaves an evidence gap. Evaluator failure is `NOT VERIFIED`;
persistence failure stops without a finalized report. Re-run only external gaps.

Repository code owns the ordered release catalog. Persisted `catalog.json` is only a
witness and must match it exactly. The two-provider grid contains 76 cells; ordinary,
narrowed, or merged summary reports cannot qualify.

Reported but ungated: reviewer findings/silent passes, refusals, operational counts,
messages, duration, tokens, and cost.

Silent passes stay ungated. Three same-change baselines moved from 20/22 to 19/22 to
22/22, so the level did not track reviewer value. `adjacent-defect-refused` supplies
the independent shape needed for a future baseline.

Token and cost totals are provider-shaped. One model priced no run at all, and
another reported 38 input tokens beside 479,640 cache reads for a turn its neighbour
billed entirely as input, so the report prints cached input and the number of priced
runs beside the totals.

## Cadence

Flow's audience cannot absorb a hard cutover — there is no migration layer, and an
active session must be finished or closed before a version change in either
direction. The cadence follows from that:

- **Freeze on the public surface** while the guarantees are being measured: tools,
  commands, guides, agents, and the Session v5 shape. Additive optional fields are
  allowed; removals and renames are not.
- **No release** without a sealed V2 qualification bundle and fresh canary.
  The bundle retains every attempt, transcript, grader source, and exact artifact
  needed to reproduce its decision. Release metadata independently regrades those
  bytes before publication. A `CHANGELOG` entry states the schema impact explicitly.
- **Patch releases** for defects and host-compatibility fixes, which is what the
  weekly OpenCode compatibility smoke exists to catch early.
- **Deprecate before removing.** A surface that is going away is announced in one
  release and removed no earlier than the next major, so no session is stranded
  mid-lifecycle by an upgrade.

## Running it

```bash
bun run eval -- --release --model <anthropic-id> --model <openai-id>
bun run eval:canary -- prepare --report <campaign-dir>/report.json --out <canary-dir>
# Run the prepared fixture, then record its session and transcript.
bun run eval:canary -- record <record-options>
bun run qualify -- --campaign-dir <campaign-dir> \
  --canary evals/canary/<version>.json
```

Only the full matrix qualifies a release. The cheaper tiers — a free replay of
recorded decisions, a one-model smoke run — answer questions during work and are
described with their prices in
[../evals/README.md](../evals/README.md#three-tiers-three-prices).
`bun run triage` says which runs in a report are worth reading.

`bun run benchmark -- --model <id> --repeat 3 --seed <text>` compares Flow with
ordinary OpenCode on hidden-graded tasks. It is not a qualification input.

The scheduled workflow runs the paid campaign weekly and publishes its complete
campaign directory. Sealing waits for the exact-artifact canary, so the workflow
reports qualification as inconclusive rather than manufacturing a partial bundle.
It skips itself when no model matrix or provider credentials are configured.
