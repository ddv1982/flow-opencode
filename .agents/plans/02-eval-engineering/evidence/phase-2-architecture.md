# Phase 2 architecture synthesis

## Grounding

The legacy qualifier reads report summaries and stays unchanged until Phase 5.
Phase 2 consumes only `ValidatedReport` and `ValidatedCaseCatalog`. Frozen plan
cells define coverage. Atomic product outcomes define scored rows. Caller-supplied
provenance remains independent of the report.

## Arena

- `gpt-5.6-terra` produced the selected small pure-analysis base.
- `gpt-5.6-luna` made paired artifact comparison explicit but exposed a premature
  directional paired estimate.
- `gpt-5.5` provided the strongest requested-versus-actual model contract but
  treated every failed product row as an unconditional release failure.
- `gpt-5.4` did not complete a candidate and is recorded as a dropout.
- An independent `gpt-5.4` judge selected Terra with 21 of 25 points. Luna and
  `gpt-5.5` each scored 17 of 25.

## Selected shape

`evals/analysis.ts` owns four pure entry points.

- `deriveReleaseDecision` derives a three-valued release decision from required
  catalog policy, frozen cells, atomic attempts, and exact release provenance.
- `compareExpectedProvenance` compares exact release artifacts or the unordered
  allowed artifact set for paired evidence. Requested and actual models are
  separate expectations. An unobserved actual model needs an explicit exception.
- `analyzeReviewer` derives fixed-label detection and false-positive counts,
  rates, unsubmitted counts, and Wilson 95 percent intervals.
- `analyzePairs` derives eligible, complete, incomplete, tie, and opaque-arm win
  counts. It cannot express candidate direction, risk difference, or an interval.

Release policy is evaluated per required case and per represented scheduled
provider. Every represented provider must reach the case sample and rate floor.
The distinct-provider count must reach `minProviders`. Product failures contribute
to the measured rate. False completion, unsubmitted review, exact-provenance drift,
an unplanned required case, or a sufficiently sampled rate below its floor is
`NOT VERIFIED`. Stops, missing attempts, unscored outcomes, and insufficient
provider or sample evidence are `INCONCLUSIVE`. Hard failures take precedence.
The scheduled `routeProvider` is the coverage denominator. Actual observed model
identity is compared separately as provenance.

## Grafts and rejections

The selected base takes explicit release and paired provenance variants from
`gpt-5.5` and unordered paired artifact membership from Luna. It rejects a
report-wide artifact exception, pooled provider rates, individual product-failure
vetoes, first-arm risk differences, and nullable placeholder inputs for later
phases.

Canary input remains Phase 9. Allocation commitments, masked analysis,
candidate-minus-baseline direction, and bootstrap intervals remain Phase 7.
Phase 3 computes expected provenance; Phase 2 only compares a supplied value.

## Verification contract

Synthetic fixtures must cross the Phase 1 parser before analysis. A table-driven
monotonicity check removes or downgrades every required row and proves the result
cannot remain `VERIFIED`. Release tests live in `tests/atomic-analysis.test.ts` and
reviewer and paired tests live in `tests/advisory-analysis.test.ts`. The legacy
qualifier tests remain unchanged and every file stays below 1,000 lines.
