# Validation evidence rubric

Use this before creating a reviewer assignment with `flow_review_start`.

## Evidence tiers

1. **Behavioral automated test**: a targeted unit/integration/e2e test exercises the changed behavior and fails without the change.
2. **Manual reproducible check**: you ran the app, CLI, endpoint, or workflow and recorded exact steps plus observed result.
3. **Indirect automated check**: typecheck, lint, build, or compile proves shape but not behavior. Acceptable alone only for docs, comments, renames fully covered by tooling, or purely mechanical changes.
4. **Static inspection**: reading code without running anything. This is a gap, not passing-outcome evidence for behavioral work.

Use the strongest practical tier. For risky work, combine tiers.

## Recording rules

- Immediately before the exact Bash command, call `flow_validation_start` with
  current `expectedRevision`, `expectedSnapshotId`, `featureId`, the exact
  `command`, `coverageScope` (`focused`, `broad`, or `artifact`), and environment
  key names. The next Bash command must match byte-for-byte.
- After Bash finishes, collect the complete object appended after
  `[flow-validation-receipt]`. Its kind is `validation_receipt_ref_v1`; pass the
  object unchanged in `flow_review_start.request.validationRefs`.
- The model never supplies validation times, exit status, output digests, or
  per-command summaries. Flow derives them from host hooks and verifies the
  immutable receipt against the active run and current source.
- Accept only receipt refs from commands whose actual outcome you inspected and
  that passed. Resolve failed, missing, mismatched, expired, or unreceipted
  captures before assignment.
- Worker-returned refs must satisfy the acceptance rules in
  `flow/references/parallel-synthesis.md`; never reconstruct a ref from prose.
- UI work should include browser or screenshot evidence when the app can run locally.
- Cleanup/refactor work should show behavior preservation, not only formatting success.

## Scope

- Use `validationScope: "targeted"` for an ordinary feature outcome.
- Use `validationScope: "broad"` only when the session is on its final feature and the project-level gate was run.

Use this schedule instead of rerunning every gate after every step:

1. A diagnostic baseline before edits is advisory only; it locates pre-existing
   failures but is not completion evidence for changed source.
2. After changes, run focused checks for the behavior and artifacts touched.
3. For artifact-only work, run the complete applicable artifact gate, such as
   docs, generated output, package shape, or static checks.
4. On the final feature, run the broad gate once, after the feature review has
   passed and after the final edit.

Validation applies only to the exact feature run and source identity it
observed. A source edit or new run invalidates prior applicability. Never reuse
or relabel targeted evidence as broad validation; broad is a distinct final
execution.

For final review, broad validation must start no earlier than the bound passing
feature-assignment result's reported time. Rerun broad validation if that order
cannot be established.

Broad validation usually means the repo's full check command, full relevant test suite, build, or equivalent release gate. If the broad gate cannot run, do not submit a passing final feature outcome; submit a `blocked` result or fix the blocker.

## Good validation capture and review-start fragments

Call this immediately before Bash:

```json
{
  "expectedRevision": 7,
  "expectedSnapshotId": "sha256:<64 lowercase hex characters>",
  "featureId": "final-feature-id",
  "command": "bun run check",
  "coverageScope": "broad",
  "environmentKeys": []
}
```

Run exactly `bun run check` next. Copy the appended immutable ref into the
review request:

```json
{
  "request": {
    "operationId": "review-final-runtime-operation",
    "expectedRevision": 7,
    "expectedSnapshotId": "sha256:<64 lowercase hex characters>",
    "featureId": "final-feature-id",
    "reviewKind": "final",
    "validationScope": "broad",
    "packet": {
      "summary": "Review the final feature against its approved scope.",
      "riskLenses": ["lifecycle ordering", "regression coverage"]
    },
    "featureReview": {
      "assignmentId": "review-assignment:feature-runtime-id",
      "verdict": "passed",
      "findings": [],
      "completedAt": "2026-07-19T09:59:00.000Z",
      "terminalDisposition": "submitted"
    },
    "validationRefs": [
      {
        "kind": "validation_receipt_ref_v1",
        "digest": "sha256:<64 lowercase hex characters>",
        "byteLength": 1234
      }
    ]
  }
}
```

## Blockers and resets

- If validation fails due to a code bug, fix it and rerun.
- If validation reveals a wrong design or interface assumption, call `flow_feature_reset` and rerun from the corrected approach.
- If validation needs external access, missing credentials, or ambiguous user
  input, stop before assignment and report the blocker honestly.

Never trim failing output, relabel a failed command as passed, or use "not run" as passing-outcome evidence.
