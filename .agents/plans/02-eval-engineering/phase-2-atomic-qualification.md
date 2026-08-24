# Phase 2. Atomic analysis

[Back to overview](overview.md)

## Goal

Derive release, reviewer, and paired decisions from validated synthetic v2
attempts without cutting over any CLI or workflow.

## Changes

- `evals/analysis.ts`. Add pure release, reviewer, and paired derivation over
  `ValidatedReport`, including external expected-provenance comparison.
- `tests/release-qualification.test.ts`. Cover missing cells, scored escalations,
  immutable product failures, evaluator and infrastructure stops, completion
  causes, reviewer truth, pair ties, and mismatched expected provenance.

## Data structures

`ReleaseDecision = Verdict + DecisionReason[] + derived counts`; every verdict
can become an immutable decision record.

## Verification

Static. `bun test tests/eval-report.test.ts tests/release-qualification.test.ts`.

Runtime. The malformed report shape must be rejected before analysis. Complete
synthetic matrices exercise all three verdicts. Legacy report behavior is recorded
as historical evidence only and is not compared through a fake conversion.

Stop gate. No live v2 emission until property tests show that deleting or changing
required evidence cannot improve a decision.
