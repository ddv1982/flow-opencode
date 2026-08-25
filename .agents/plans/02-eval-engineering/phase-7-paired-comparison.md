# Phase 7. Blinded paired comparison

[Back to overview](overview.md)

## Goal

Turn the current benchmark into a randomized complete-pair experiment with a
frozen statistical contract and honest blinding limits.

## Changes

- `evals/experiment.ts`. Add seeded block assignment, whole-pair replacement,
  complete-pair accounting, risk difference, task-stratified paired bootstrap,
  ties, budgets, fixed stopping, a deterministic bootstrap seed, opaque arm tokens,
  allocation commitments, masked analysis records, controlled unblinding, and
  power metadata.
- `evals/benchmark-run.ts`. Run candidate and ordinary arms from one plan without
  evaluation labels, fixture-purpose names, or asymmetric completion markers.
- `tests/paired-experiment.test.ts`. Cover arm-order invariance, missing arms,
  aborts, fixed stopping, budget stops, power-policy validation, and known effects.

## Data structures

`AnalysisPolicy = primary outcome + estimand + interval + alpha + target power +
minimum detectable effect + tie rule + bootstrap seed + version digest`.

## Verification

Static. Paired experiment tests, reserved-label lint, and full project check.

Runtime. Run a low-budget pilot. A transcript scanner grades evaluation-label
leakage and ground-truth access against a versioned rubric. A human spot-check is
secondary. Masked analysis is hashed before the allocation record is revealed. The
report states that the model cannot be blinded to Flow tool presence.

Stop gate. No claim from incomplete pairs, an invalid analysis policy, scanner
failures, or intervals wider than the preregistered decision bound.

## Outcome

Implemented and verified. The accepted one-pair packed-host pilot produced a
strict v2 report, transcript-bound clean scans, a durable masked record before
allocation reveal, and no unresolved pair. Both arms passed, so the descriptive
effect is zero. The result remains `inconclusive` because one planned pair misses
the 265-pair power requirement. See `evidence/phase-7-architecture.md`,
`evidence/phase-7-review.md`, and `evidence/phase-7-pilot.json`.
