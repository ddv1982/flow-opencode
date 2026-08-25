# Phase 6. Reviewer-only calibration

[Back to overview](overview.md)

## Goal

Measure reviewer defect detection and false positives without manager selection
or repair confounding the sample.

## Changes

- `evals/reviewer-cases.ts`. Define opaque fixed defect and clean candidate states
  with executable truth checks and versioned human labels.
- `evals/reviewer-run.ts`. Seed deterministic assignments and drive the real packed
  reviewer directly while recording observed model identity when available.
- `tests/reviewer-eval.test.ts`. Cover every confusion-matrix cell, fixture drift,
  unsubmitted review, identity limits, and named interval fields.

## Data structures

Reviewer evidence lives inside the attempt union as truth, verdict, findings, and
submission. Calibration records name case version, raters, agreement metric, sample
size, frozen plan hash, calibration report, observed confidence bounds, thresholds,
artifact and reviewer identities. A later catalog version references the external
promotion record. The calibration plan itself never contains its future record hash.

## Verification

Static. Reviewer eval tests and `bun run check`.

Runtime. Run a paid pilot containing defect and clean controls. This pilot is
measurement, not calibration by itself.

Stop gate. Release promotion needs a preregistered human-labelled set, at least two
raters per case, Krippendorff alpha at or above 0.8, and confidence bounds that meet
the recorded detection and false-positive thresholds.

## Outcome

Implemented and verified. The packed-host pilot exercised two real reviewer child
assignments with durable submissions and exact fixed labels. It detected the
planted defect and passed the clean control, but remains advisory because the
sample is below the preregistered floor, confidence bounds miss promotion
thresholds, and the pinned host cannot expose a full reviewer identity. See
`evidence/phase-6-review.md` and `evidence/phase-6-pilot.json`.
