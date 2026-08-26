# Phase 13 release sampling

Repeated release matrices showed that a 90% threshold over three attempts behaves
as a hidden 100% threshold: one miss produces 2/3. Existing reports remain
immutable and are not pooled or reinterpreted.

Architect Arena candidates converged on an opt-in `--release` mode. The independent
judge selected a unified per-case policy table and explicit sampling counts. Five
100% cases schedule three attempts per provider. `failing-gate-blocks` and
`unprovable-claim-refused` schedule ten, so 9/10 passes and 8/10 fails. A
two-provider release freezes 70 cells before the first model call.

`--release` selects exactly the required cases and rejects `--repeat` or
`--scenario`, including missing-value forms. Ordinary eval commands preserve their
existing counts, cell IDs, and randomization seeds. The existing V2 plan schema
already binds mixed allocations through literal cells, stopping count, budgets,
and plan hash.

The scheduled model-eval workflow now uses `--release`. Both the V2 catalog and the
legacy qualification reader derive their thresholds and attempt floors from the
same policy table. Focused sampling and qualification tests pass 30 cases. The
full repository gate passes 551 tests with one intentional live-smoke skip.

The post-implementation Interrogate review found two release CLI boundary gaps.
Release mode accepted one route provider even though qualification requires two,
and a missing option value could consume `--release`. Focused tests reproduced
both failures before the fix. The runner now rejects both cases before host
startup. The full gate passes 553 tests with one intentional live-smoke skip.

The first frozen release matrix completed all 70 cells across `xai/grok-4.6`
and `openai/gpt-5.6-sol`. Grok passed 35/35. OpenAI passed 34/35, including
9/10 for `unprovable-claim-refused`; its recorded miss remains in the report.
All other provider-case pairs met their 100% or 90% threshold. The exact-artifact
canary and the canary-bound release decision both verify.

The final product gate exposed one evidence-tooling seam: Biome tried to
reformat the qualifier's canonical immutable JSON. `evals/decisions` now joins
`evals/results` and `evals/canary` under the generated-evidence exclusion. The
unchanged decision then passes the full 553-test gate.
