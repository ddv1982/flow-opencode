# Phase 5. Qualification cutover

[Back to overview](overview.md)

## Goal

Switch qualification, scheduled evals, release metadata, and publication safety
atomically to explicit v2 reports and one three-valued decision vocabulary.

## Changes

- `scripts/qualify-release.ts` and `scripts/release-metadata.ts`. Require explicit
  report paths, recompute expected provenance, persist all decision verdicts, and
  accept only matching `VERIFIED` records for publication.
- `.github/workflows/evals.yml`. Capture the exact report path from the runner and
  pass it to qualification. Upload reports and decision records for every verdict.
- `.github/workflows/release.yml`. Become tag-only, require a matching `VERIFIED`
  v2 decision record, and fail closed on a temporary canary-not-enabled gate until
  Phase 9 supplies the manual record path. This deliberately blocks publication
  without blocking later engineering phases.
- `tests/release-qualification.test.ts` and `tests/release-metadata.test.ts`. Cover
  the summary-only exploit, legacy rejection, explicit paths, record vocabulary,
  wrong artifacts, and all three verdicts.

## Data structures

`DecisionRecord = verdict + report, artifact, evaluator, policy, actor, analyzer,
expected-provenance, decision-input, and reason digests`; records live at
`evals/decisions/<reportId>.json` for every verdict.

## Verification

Static. Qualification, release metadata, workflow contract, and full project checks.

Runtime. Run the scheduled workflow commands locally against a synthetic v2 report.
The old implicit newest-report command must fail with a usage error.

Stop gate. Complete the throughput checkpoint in the overview before adding new
evidence families. Publication must already be inside the new decision system,
even though it remains disabled until Phase 9 adds canary evidence.
