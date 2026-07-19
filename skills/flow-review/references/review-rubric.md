# Review rubric

Use this to decide whether a runtime-owned feature or final review assignment may pass.

## Finding classes

- `implementation_defect`: incorrect behavior, unsafe contract, security/privacy
  issue, or concrete maintainability/UI defect.
- `regression_coverage_gap`: changed behavior lacks a check strong enough for its risk.
- `evidence_gap`: supplied evidence cannot support a claimed result or coverage.
- `advisory`: non-blocking improvement that does not invalidate the current goal.

Each typed finding also records `subject`, `requirementOrRisk`,
`evidenceLocator`, `summary`, and `severity`. Flow computes its stable
fingerprint from normalized taxonomy + subject + requirement/risk + evidence
locator, excluding attempt and timing data.

## Severity

- **blocking**: must fail the review. Includes incorrect behavior, data loss, security risk, unverifiable completion claims, missing validation for behavioral work, or unresolved scope drift.
- **advisory**: worth noting but does not block the current goal.

If unsure whether a finding is real, read more or downgrade it. Do not promote guesses to blockers.

## Feature review checklist

- The work matches the assigned feature's `summary`, `targets`, and dependencies.
- Plan `requirements` and `decisions` are still honored.
- Changed files were read, not just summarized.
- Validation evidence covers the behavior touched.
- New tests or manual checks would fail or visibly differ without the change where practical.
- No unrelated scope slipped in.
- Public contracts and downstream callers still work.

## Final review checklist

- The original goal is satisfied by the delivered behavior or artifacts.
- Every approved requirement is either met or explicitly accounted for by an
  accepted gap.
- Plan decisions and scope boundaries still match the implementation.
- Every planned feature is complete, has recorded validation evidence, and
  contributes to the final outcome.
- Feature dependencies were completed in an order that makes the evidence
  trustworthy.
- Changed artifacts match the plan's `targets`; extra changed surfaces are
  explained and reviewed.
- Broad validation ran and passed, or any skipped broad check is justified as a
  non-blocking gap.
- The assignment's runtime-owned final depth equals the approved
  `finalReviewPolicy`; the reviewer does not restate it in the result.
- Feature-level reviews have no unresolved blocking findings.
- Docs, commands, package metadata, and release surfaces match the delivered behavior.
- Remaining gaps are explicit and do not contradict `kind: "completed"`.

## Final convergence scan

Run this scan before returning a passing final-assignment result:

1. Restate the original goal and the approved plan summary in your own words.
2. Map each requirement to delivered evidence, validation output, or an explicit
   accepted gap.
3. Walk every planned feature and confirm its recorded outcome, assignment
   result, and validation level.
4. Compare the changed files, docs, commands, generated surfaces, and package
   metadata to the planned targets and requirements.
5. Check whether the validation evidence would have caught the main failure
   modes introduced by the work.
6. Decide whether remaining gaps are advisory or blocking before setting the
   `verdict`.

Fail the final review when the delivered work cannot be traced back to the
approved goal and requirements, even if each individual feature review passed.

## Payloads

Passing feature or final assignment result:

```json
{
  "assignmentId": "review-assignment:runtime-id",
  "verdict": "passed",
  "findings": [],
  "completedAt": "ISO-8601",
  "terminalDisposition": "submitted"
}
```

Failed result:

```json
{
  "assignmentId": "review-assignment:runtime-id",
  "verdict": "failed",
  "findings": [
    {
      "taxonomy": "evidence_gap",
      "subject": "broad validation",
      "requirementOrRisk": "release behavior must be verified",
      "evidenceLocator": "assignment validation summary",
      "summary": "The supplied gate does not exercise the changed behavior.",
      "severity": "blocking"
    }
  ],
  "completedAt": "ISO-8601",
  "terminalDisposition": "submitted"
}
```

## Audit report reviews

When reviewing a findings report, verify findings adversarially:

- Check the cited file and surrounding code.
- Trace mitigating paths before accepting blocking severity.
- Confirm the deployment model used for severity.
- Require strict `AuditLedgerV1` (`version: "audit-ledger/v1"`) using the exact
  enums in the audit rubric, plus successful `flow_audit_render` output. The
  supplied Markdown and counts must be the canonical tool result, not a second
  model-authored report.
- Accept P0 only as `severity: "critical"` plus
  `actionPriority: "fix_now"`, with reproduced or source-proven evidence,
  reachable deployed/distributed exposure, catastrophic impact, and ineffective
  or absent guards and recovery.
- Dedupe overlapping findings.
- Downgrade or refute findings that do not survive challenge. A refuted entry
  must be informational with action priority `none` and no remediation.

Approve only on evidence actually inspected. A review is a claim of coverage, not a courtesy stamp.
