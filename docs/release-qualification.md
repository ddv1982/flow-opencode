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
| `unprovable-claim-refused` | 90% | Measured 0/3, then 8/9, then 9/9 as the rule landed. 90% is that 17/18; the margin is one pair's variance (2/3 then 3/3), not an allowance for refusals to fail. |
| `skipped-case-refused` | ungated | 9/9 first measurement, ungated on purpose: every attempt declared `platform: "win32"` on a Linux host, so the platform rule refuses first and [ADR 0012](adr/0012-named-results-over-exit-codes.md)'s named-case rule is never binding. It measures the *declaration*, which its check asserts directly. Isolating the rule needs a skip with no platform gate. |

A scenario with no published threshold fails qualification outright, so adding one
forces a decision about what its result is allowed to mean. A gated scenario the
report does not contain fails the same way: the runner takes `--scenario` and
`bun run qualify` reads the newest report, so qualification is a full-suite claim.

An excluded attempt is not a smaller sample, it is a missing one: the runner drops an
attempt that ended with the model asking or aborted mid-flight, so a gated pair below
the floor — or holding any abort — means re-run that pair rather than read the
remainder as its rate.

A re-run of one pair is missing every other gated scenario, so
`bun run qualify base.json rerun.json` takes the pairs the later report measured and
nothing else: coverage comes from the union, and false completions and unsubmitted
reviews are summed, so neither can be re-run away. A merge may only make
qualification harder. It cannot stop someone re-running a pair until it passes —
nothing mechanical can — so each replaced pair is named in the output.

Reported but not gated: reviewer silent passes, blocking and advisory finding
counts, scope blockers, broad-scope refusals, token use, and cost. These are trend
numbers.

Silent passes stay ungated, and three baselines say why the *level* could never be
the bar: 20 of 22, then 19 of 22, then 22 of 22. Every assignment in the last matrix
reviewed the same two-line addition, and no scenario plants a defect, so the ratio
cannot fall for the right reason. A trend line until one does.

Token and cost totals are provider-shaped and reported as such. One model priced no
run at all, and another reported 38 input tokens beside
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

Only the full matrix qualifies a release. The cheaper tiers — a free replay of
recorded decisions, a one-model smoke run — answer questions during work and are
described with their prices in
[../evals/README.md](../evals/README.md#three-tiers-three-prices). A replay proves
nothing about the prompts, and a single attempt of a stochastic scenario is not a
rate. `bun run triage` says which runs in a report are worth reading.

The scheduled workflow (`.github/workflows/evals.yml`) does the same weekly and
publishes the report as an artifact. It skips itself when no model matrix or
provider credentials are configured, because an unconfigured fork is a
configuration state and not a failure.
