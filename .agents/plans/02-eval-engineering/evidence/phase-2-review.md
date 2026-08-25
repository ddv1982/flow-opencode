# Phase 2 Interrogate review

## Intent

Phase 2 must derive release, reviewer, and paired analysis from validated atomic
rows without cutting over the legacy qualifier, CLI, or workflows. Required case
policy and caller-supplied provenance must determine the release verdict.
Reviewer and paired outputs remain advisory.

## Reviewers

- `gpt-5.6-terra` reviewed the first implementation and corrected diff.
- `gpt-5.6-luna` reviewed the first implementation and corrected diff.
- `gpt-5.5` reviewed the first implementation and corrected diff.
- `gpt-5.4` independently judged the architecture and reviewed the corrected diff.

## Acted on

- Release provenance, stop gaps, false completion, and unsubmitted review checks
  now consider required cells only. Report-only failures cannot change a release
  verdict.
- Provider attribution uses the frozen scheduled model and falls back to the
  required atomic actor when the plan carries no model.
- Expected attempt and actor role sets are unique and bidirectional. Extra,
  missing, duplicated, or mismatched provenance fails closed.
- Reviewer analysis exposes incomplete assignments. Reviewer and paired entry
  points return zero metrics for incompatible campaign kinds.
- Pair analysis counts primary and activated reserve blocks only. Incomplete
  blocks cannot donate a winner.
- The monotonicity test now deletes an attempt while preserving the original
  frozen plan. The parser and analyzer together prevent a downgraded row from
  remaining `VERIFIED`.
- The v2 release and advisory suites are separate so every changed TypeScript
  file remains below 1,000 lines.

## Lead judgment

- Scheduled `routeProvider` remains the provider-coverage denominator. Actual
  identity is a separate exact provenance claim. A gateway may observe a different
  downstream model without changing which scheduled route the experiment covered.
- Public `compareExpectedProvenance` compares a complete report. The release
  decision uses the same primitive over required cells only. This preserves a
  reusable full-report audit without allowing report-only rows to gate release.
- Product failures remain rate inputs. Only a sufficiently sampled rate below its
  policy floor is `NOT VERIFIED`.

## Verdict

`VERIFIED`. All four rechecks reported no unresolved blocker after lead judgment.
The focused gate passes 59 tests. The full repository gate passes 448 tests, one
intentional live-host skip, and zero failures.
