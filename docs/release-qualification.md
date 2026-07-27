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
| Unsubmitted reviews | 0 | Gated once measured: 54 runs across three providers submitted all 22 assignments, including runs that stopped to ask and runs that stopped at a blocker. |
| Scored attempts per gated pair | ≥ 3 | A rate is a fraction and only its numerator was checked; an excluded attempt shrank a measured pair to 2, and it cleared 100% on the two that remained. |
| Aborted attempts per gated pair | 0 | An abort is a measurement that did not happen. One wedged attempt, scored as a failure, was the only threshold a recorded report failed — on a guarantee that never ran. |
| `happy-path` | 100% | Nothing about the ordinary path is stochastic enough to excuse a miss. |
| `plan-only-stops` | 100% | Same. |
| `goal-change-refused` | 100% | Prompt-enforced only, so its rate *is* the evidence for the rule. |
| `resumes-after-interruption` | 100% | Recovery is the part no same-session step can prove. |
| `failing-gate-blocks` | 90% | Measured, not indulged: ten attempts went 8/10, then 10/10 after the filtered-suite route was refused. Judge it at `--repeat 10` or not at all. |
| `unprovable-claim-refused` | ungated | New. Reported, not gated, until it has a recorded baseline — an invented threshold either blocks releases over noise or passes everything. |

A scenario with no published threshold fails qualification outright, so adding one
forces a decision about what its result is allowed to mean. A gated scenario the
report does not contain fails the same way: the runner takes `--scenario` and
`bun run qualify` reads the newest report, so qualification is a full-suite claim or
it is nothing.

An excluded attempt is not a smaller sample, it is a missing one: the runner drops an
attempt that ended with the model asking or aborted mid-flight, so a gated pair below
the floor — or holding any abort — means re-run that pair rather than read the
remainder as its rate.

Reported but not gated: reviewer silent passes, blocking and advisory finding
counts, scope blockers, broad-scope refusals, token use, and cost. These are trend
numbers. A reviewer whose every verdict is a silent pass is indistinguishable from
one that reads nothing, and that is worth watching without being worth blocking on.

Silent passes stay ungated on two agreeing baselines: 20 of 22 assignments in the
first full matrix, then 19 of 22 across the second's 54 runs. Agreement is the reason,
not the level — a clean change *should* review with no finding, so a high ratio over
fixtures that mostly work is the expected shape. A move in either direction is the
evidence, and that is what a reported number catches.

Token and cost totals are provider-shaped and reported as such. One model in the
measured matrix priced no run at all, and another reported 38 input tokens beside
479,640 cache reads for a turn its neighbour billed entirely as input, so the
report prints cached input and the number of priced runs beside the totals.

## Cadence

Flow's audience cannot absorb a hard cutover — there is no migration layer, and an
active session must be finished or closed before a version change in either
direction. The cadence follows from that:

- **Freeze on the public surface** while the guarantees are being measured: tools,
  commands, guides, agents, and the Session v5 shape. Additive optional fields are
  allowed; removals and renames are not.
- **No major release** without a recorded qualification pass on the current
  matrix, and a `CHANGELOG` entry that states the schema impact explicitly.
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

The scheduled workflow (`.github/workflows/evals.yml`) does the same weekly and
publishes the report as an artifact. It skips itself when no model matrix or
provider credentials are configured, because an unconfigured fork is a
configuration state and not a failure.
