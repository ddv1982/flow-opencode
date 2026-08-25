# Phase 4. Crash-safe campaign emission

[Back to overview](overview.md)

## Goal

Freeze case cells before launch, write one immutable attempt per cell, and emit a
complete v2 campaign from the existing live runner.

## Changes

- `evals/report-store.ts`. Use canonical JSON, temporary files, file sync, atomic
  rename, directory sync, byte-identical replay, and final reconciliation. Ignore
  uncommitted temporary files after a crash.
- `evals/run.ts`. Build a campaign from the typed catalog, adapt current outcomes
  and provenance to v2, and finalize terminal cause plus observed budgets.
- `tests/eval-reporting.test.ts`. Inject failures before write, after file sync,
  after rename, and before directory sync. Cover resume, duplicate ids, reserve
  activation, deterministic order, and unknown-cost stops.
- `tests/report-store.test.ts`. Isolate persistence faults, concurrent claims,
  transcript binding, immutable replay, and truncated-ledger finalization.

## Data structures

`AttemptDirectory = plan.json + attempts/<attemptId>.json + completion.json +
report.json`; `AnalysisPolicy` is frozen inside the plan.

## Verification

Static. Reporting, report, and full project checks.

Runtime. Interrupt a fixture campaign at each persistence boundary, resume it,
and prove no scored attempt is replaced and no truncated ledger looks complete.

Stop gate. No qualifier cutover until one live v2 report validates without
placeholder provenance or policy.

Evidence. [Final paid v2 pilot](evidence/phase-4-pilot.json) and
[Interrogate review](evidence/phase-4-review.md).
