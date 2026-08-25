# Phase 8. Coverage promotion and trends

[Back to overview](overview.md)

## Goal

Expand hidden outcome coverage and compare reports only across stable measurement
semantics, with artifact identity as the intended comparison axis.

## Changes

- `evals/benchmarks.ts`. Add organic multi-file tasks only with mutation-tested
  hidden oracles and contamination notes.
- `evals/report-render.ts`. Render evidence cards, intervals, provenance, failures,
  and comparable baseline deltas from validated reports.
- `tests/benchmark-reporting.test.ts`. Define the compatibility key and reject
  changed case, policy, oracle, evaluator, or host semantics while allowing the
  candidate artifact to differ.

## Data structures

`ComparisonKey = case + policy + oracle + evaluator + host semantics`; artifact is
the treatment axis, not part of equality.

## Verification

Static. Benchmark reporting tests and `bun run check`.

Runtime. Compare two v2 reports with equal semantics and different artifacts, then
change one compatibility-key field and prove comparison refuses.

Stop gate. Legacy reports are never backfilled. A case becomes a release regression
only after its calibration predicate is recorded.

## Outcome

Implemented and verified. Five benchmark cases now carry versioned contamination
notes and twelve executable mutation controls. Structured cards expose missing and
failed evidence. Strict parsed-report comparisons allow different candidate
artifacts while refusing case, policy, oracle, evaluator, host, actor, or
instruction drift. Every case remains report-only and no legacy report is
backfilled. See `evidence/phase-8-review.md`.
