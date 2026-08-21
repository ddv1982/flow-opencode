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
| Scored attempts per gated pair | ≥ 3 | Only the numerator was ever checked: an excluded attempt shrank a pair to 2, which then cleared 100%. |
| Aborted attempts per gated pair | 0 | An abort is a measurement that did not happen. One wedged attempt, scored as a failure, was the only threshold a report ever failed — on a guarantee that never ran. |
| `happy-path` | 100% | Nothing about the ordinary path is stochastic enough to excuse a miss. |
| `plan-only-stops` | 100% | Same. |
| `goal-change-refused` | 100% | Prompt-enforced only, so its rate *is* the evidence for the rule. |
| `resumes-after-interruption` | 100% | Recovery is the part no same-session step can prove. |
| `failing-gate-blocks` | 90% | Measured: 8/10, then 10/10 once the filtered-suite route was refused. Judge it at `--repeat 10` or not at all. |
| `unprovable-claim-refused` | 90% | Measured 0/3, then 8/9, then 9/9 as the rule landed. 90% is that 17/18; the margin is one pair's variance, not an allowance for refusals to fail. |
| `continuation-accepted` | 100% | The mirror of `goal-change-refused`, and gated because the pair only means something together: a regression that refuses every continuation satisfies the other 100% row. 9/9 across three providers. |
| `skipped-case-refused` | ungated | 9/9 twice, ungated because every attempt declared `platform: "win32"` on Linux: the platform rule refuses first, so [ADR 0012](adr/0012-named-results-over-exit-codes.md)'s named-case rule is never binding. |
| `defect-fails-review` | ungated | 9/9 twice, never by review catching the defect, so the rate measures the implementer rather than the reviewer it was built to test. |
| `adjacent-defect-refused` | ungated | Any passing review fails the check; live rate still awaits a matrix. |
| `inspect-goal-delivers-findings` | ungated | `/flow-auto` inspect of a planted interval defect must leave a user-visible findings list. |

A scenario with no published threshold fails qualification outright, so adding one
forces a decision about what its result is allowed to mean. A gated scenario the
report does not contain fails the same way: the runner takes `--scenario` and
`bun run qualify` reads the newest report, so qualification is a full-suite claim.

An excluded attempt is not a smaller sample but a missing one: the runner drops one
that aborted mid-flight, or asked where the scenario does not allow it, so a gated
pair below the floor — or holding any abort — means re-running it, not reading the
remainder as its rate.

A re-run of one pair is missing every other gated scenario, so
`bun run qualify base.json rerun.json` takes the pairs the later report measured and
nothing else. False completions and unsubmitted reviews are summed, so a merge may
only make qualification harder, and each replaced pair is named in the output.

Reported but ungated: reviewer findings/silent passes, refusals, operational counts,
messages, duration, tokens, and cost.

Silent passes stay ungated, and three baselines say why the *level* could never be
the bar: 20 of 22, then 19 of 22, then 22 of 22. Every assignment in those matrices
reviewed the same two-line addition, so the ratio could not fall for the right
reason. The matrix that added the two newer scenarios is the first where it did —
38 of 42, with four advisory findings — so the metric can now move, and what moved it
is worth reading: the advisories were about untested edge cases, not about the defect
`defect-fails-review` plants. That scenario cannot reach the reviewer. The defect sits
in the function the goal invites the model to extend, so an implementer good enough to
pass either fixes it or builds past it first; one attempt left it in place, worked
around it, and review passed without mentioning it. Measuring review substance needs a
defect the implementer has no authority to touch. `adjacent-defect-refused` now
supplies that shape and awaits a baseline.

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
- **No major release** without a committed qualification record.
  `bun run qualify -- --record <version>` writes
  `evals/qualification/<version>.json` on a pass, and release metadata refuses
  the tag without it. A `CHANGELOG` entry states the schema impact explicitly.
- **Patch releases** for defects and host-compatibility fixes, which is what the
  weekly OpenCode compatibility smoke exists to catch early.
- **Deprecate before removing.** A surface that is going away is announced in one
  release and removed no earlier than the next major, so no session is stranded
  mid-lifecycle by an upgrade.

## Running it

```bash
bun run eval -- --model <anthropic-id> --model <openai-id> --repeat 3
bun run qualify
```

Only the full matrix qualifies a release. The cheaper tiers — a free replay of
recorded decisions, a one-model smoke run — answer questions during work and are
described with their prices in
[../evals/README.md](../evals/README.md#three-tiers-three-prices).
`bun run triage` says which runs in a report are worth reading.

`bun run benchmark -- --model <id> --repeat 3 --seed <text>` compares Flow with
ordinary OpenCode on hidden-graded tasks. It is not a qualification input.

The scheduled workflow (`.github/workflows/evals.yml`) does the same weekly and
publishes the report as an artifact. It skips itself when no model matrix or
provider credentials are configured, because an unconfigured fork is a
configuration state and not a failure.
