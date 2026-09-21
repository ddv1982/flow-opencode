# Review calibration and qualification evidence

Use these offline commands after registering a reviewed corpus and collecting the
manager and Jev observations. They make no provider calls. Every output remains
qualification-inconclusive.

## Prepare fixed-policy calibration

Create a bundle with `authoredBy`, `registration`, `manager`, and `jev`. Embed the
actual registration and arm objects, not their filenames. Use a calibration-split
registration and the arm formats from [Run a frozen decision comparison](run-comparison.md).

```sh
bun run eval:recovery calibration-prepare bundle.json NEW-calibration-draft.json
```

The command recomputes the comparison through the runtime controller. It evaluates
the frozen 0.9 choice, 0.95 goal, and 0.95 suitability thresholds. It does not tune
alternative thresholds or interpret choice confidence as a safety probability.

## Bind an independent review

Have an independent reviewer inspect the raw evidence and report. Create a review
object with `reviewedBy`, `reviewedAt`, `evidenceDigest`, `verdict: "approved"`, and
`notes`. Set `evidenceDigest` to `datasetDigest(draft)`, the evaluator's canonical
JSON hash. The reviewer must differ from `authoredBy`.

```sh
bun run eval:recovery calibration-review draft.json review.json NEW-calibration-evidence.json
```

Set the holdout configuration's `calibrationEvidenceDigest` to the canonical hash
of the reviewed evidence. Register the holdout from the same full corpus and
manager configuration. Verify the connection before collecting the holdout.

```sh
bun run eval:recovery calibration-bind evidence.json holdout-registration.json NEW-binding.json
```

This checks the reviewed artifact, complete corpus, source hashes, manager settings,
and Jev configuration. A hash in `campaign-register` alone does not perform this
check. Existing registration and collection commands do not automatically require
this separate binding artifact. The qualification report repeats the binding check
from the actual evidence. Reviewer identity and origin remain attestations.

## Report the remaining qualification gates

Create an evidence bundle with the following fields.

- `calibrationEvidence`. The reviewed calibration artifact, or `null` when absent.
- `decisions`. An object with embedded `registration`, `manager`, and `jev` inputs.
- `episodes`. An object with embedded episode `registration`, `manager`, and `jev` inputs.
- `proposedActionClasses`. A nonempty list of `retry`, `independent-feature`, or both, without duplicates.

```sh
bun run eval:recovery qualification-report bundle.json NEW-qualification-report.json
```

The command recomputes both reports. It checks holdout splits, configuration
bindings, reviewed calibration, declared live origins, primary coverage, separate
300-sample action-class requirements, 100 live episode pairs, reviewed safety
counts, and the frozen episode targets with their exploratory intervals.

Missing labels and observations remain unknown. An observed unsafe action or
failed target is a failure. A simulated origin cannot satisfy a live-origin gate.

Cross-phase independence, statistical review, complete budget reconciliation, and
operator and release review remain explicit unknown gates. This command provides
diagnostics for that review. It never populates the production qualification
registry or authorizes spending. All outputs refuse overwrite.
