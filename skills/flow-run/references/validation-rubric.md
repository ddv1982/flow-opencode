# Validation evidence rubric

Use this before creating a reviewer assignment with `flow_review_start`.

## Evidence tiers

1. **Behavioral automated test**: a targeted unit/integration/e2e test exercises the changed behavior and fails without the change.
2. **Manual reproducible check**: you ran the app, CLI, endpoint, or workflow and recorded exact steps plus observed result.
3. **Indirect automated check**: typecheck, lint, build, or compile proves shape but not behavior. Acceptable alone only for docs, comments, renames fully covered by tooling, or purely mechanical changes.
4. **Static inspection**: reading code without running anything. This is a gap, not passing-outcome evidence for behavioral work.

Use the strongest practical tier. For risky work, combine tiers.

## Recording rules

- Each validation observation has `command`, `summary`, `startedAt`,
  `completedAt`, numeric `exitCode`, `outputDigest`, and `environmentKeys`.
- `startedAt` and `completedAt` are reported times. They must satisfy
  `feature-run start <= startedAt <= completedAt <= review-assignment start <=
  runtime acceptance time`.
- `flow_review_start` accepts only passing observations (`exitCode: 0`). Failed
  or skipped checks must be resolved or reported as blockers before assignment.
- Do not claim a command was run unless it was run in this session or directly reported by a trusted worker with raw output.
- Worker-reported command output must satisfy the acceptance and verification
  rules in `../../flow/references/parallel-synthesis.md`: exact command, status,
  raw outcome summary, coverage, and manager acceptance.
- Include scope in the summary: what behavior, files, routes, or states the check covered.
- UI work should include browser or screenshot evidence when the app can run locally.
- Cleanup/refactor work should show behavior preservation, not only formatting success.

## Scope

- Use `validationScope: "targeted"` for an ordinary feature outcome.
- Use `validationScope: "broad"` only when the session is on its final feature and the project-level gate was run.

For final review, broad validation must start no earlier than the bound passing
feature-assignment result's reported time. Rerun broad validation if that order
cannot be established.

Broad validation usually means the repo's full check command, full relevant test suite, build, or equivalent release gate. If the broad gate cannot run, do not submit a passing final feature outcome; submit a `blocked` result or fix the blocker.

## Good nested review-start fragment

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
    "validations": [
      {
        "command": "bun test tests/runtime-gates.test.ts",
        "summary": "Covered approval immutability, active runs, and feature-outcome gates.",
        "startedAt": "2026-07-19T10:00:00.000Z",
        "completedAt": "2026-07-19T10:00:08.000Z",
        "exitCode": 0,
        "outputDigest": "sha256:<64 lowercase hex characters>",
        "environmentKeys": []
      },
      {
        "command": "bun run typecheck",
        "summary": "TypeScript accepted the runtime and adapter changes.",
        "startedAt": "2026-07-19T10:00:09.000Z",
        "completedAt": "2026-07-19T10:00:12.000Z",
        "exitCode": 0,
        "outputDigest": "sha256:<64 lowercase hex characters>",
        "environmentKeys": []
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
