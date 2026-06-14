# Review rubric

Use this to decide whether a `featureReview` or `finalReview` payload may pass.

## Finding classes

- **correctness**: wrong result, broken state transition, bad edge case, race, data loss, or crash.
- **contract**: public API, CLI, config, persisted data, or documented behavior changed without plan approval.
- **security/privacy**: unsafe input handling, secret exposure, permission bypass, or insecure default.
- **test-coverage**: behavioral change lacks a check strong enough for the risk.
- **maintainability**: complexity or coupling creates concrete future-change risk.
- **ui/accessibility**: user cannot complete the workflow, layout breaks, accessibility basics fail, or visual claims lack evidence.

## Severity

- **blocking**: must fail the review. Includes incorrect behavior, data loss, security risk, unverifiable completion claims, missing validation for behavioral work, or unresolved scope drift.
- **advisory**: worth noting but does not block the current goal.

If unsure whether a finding is real, read more or downgrade it. Do not promote guesses to blockers.

## Feature review checklist

- The work matches the active feature's `summary`, `targets`, and dependencies.
- Plan `requirements` and `decisions` are still honored.
- Changed files were read, not just summarized.
- Validation evidence covers the behavior touched.
- New tests or manual checks would fail or visibly differ without the change where practical.
- No unrelated scope slipped in.
- Public contracts and downstream callers still work.

## Final review checklist

- Every feature is complete and together they satisfy the original goal.
- Broad validation ran and passed.
- The final review depth equals the approved `finalReviewPolicy`.
- Feature-level reviews have no unresolved blocking findings.
- Docs, commands, package metadata, and release surfaces match the delivered behavior.
- Remaining gaps are explicit and do not contradict `kind: "completed"`.

## Payloads

Feature review:

```json
{
  "status": "passed",
  "summary": "Reviewed changed runtime files and focused tests; validation covers the new gate.",
  "blockingFindings": []
}
```

Failed feature review:

```json
{
  "status": "failed",
  "summary": "Validation does not exercise the changed persistence path.",
  "blockingFindings": [
    {
      "summary": "No test covers archive removal of .flow/session.json after close.",
      "severity": "blocking"
    }
  ]
}
```

Final review:

```json
{
  "status": "passed",
  "summary": "Reviewed plan scope, all changed files, broad validation, and release metadata.",
  "blockingFindings": [],
  "reviewDepth": "detailed"
}
```

## Audit report reviews

When reviewing a findings report, verify findings adversarially:

- Check the cited file and surrounding code.
- Trace mitigating paths before accepting blocking severity.
- Confirm the deployment model used for severity.
- Dedupe overlapping findings.
- Downgrade or reject findings that do not survive refutation.

Approve only on evidence actually inspected. A review is a claim of coverage, not a courtesy stamp.
