# Report retained review observations

Run from the repository root:

```sh
bun evals/review-report.ts CAMPAIGN_DIRECTORY [ASSESSMENTS.json]
```

The command reads the campaign's report, catalog, and referenced transcripts and
prints JSON to stdout. Redirect stdout to save a separate report. It does not
launch OpenCode, call providers, modify evidence, regrade, or publish anything.
No runtime or qualification schema changes are required.

## Read the counts

- `reviewObserved`: attempts with at least one retained review assignment.
- `noReviewObserved`: readable session/archive evidence contains no assignment.
  This is not proof that no activity occurred outside that evidence.
- `unassessed`: a transcript is missing, uses an unsupported shape, or lacks
  readable session/archive evidence. Never treat these attempts as clean reviews.
- `passed`, `failed`, and `pending`: recorded assignment outcomes, including retry
  occurrences. Per-assignment terminal dispositions remain visible; a recorded
  failed result can represent observed-but-unsubmitted work.
- `codeDefects` and `evidenceGaps`: finding occurrences explicitly classified by
  an assessor. These are attributed assessments, not verified truth.
- `unclassifiedFindings`: findings without an assessment, regardless of wording.

The three attempt counts partition attempted runs. They do not include scheduled
cells that never produced an attempt. Review verdicts count assignments, not
independent tasks. A repaired retry does not erase the earlier finding.

## Supply an assessment

Use a JSON array with one object per assessed finding. Each object contains
`attemptId`, `transcriptSha256`, `assignmentId`, `findingId`, `category` (either
`code-defect` or `evidence-gap`), `assessor`, and `rationale`. Copy identities from
the unclassified output after inspecting the evidence. Omit uncertain findings.
An assessment with a changed digest, unmatched identity, or duplicate key fails.
The command does not establish an assessor's identity or human-label provenance.
Never use this file as calibration or promotion evidence.

[finding-assessments.json](finding-assessments.json) supplies the assistant's
assessment of the one inventory finding in the retained 8.3.0 campaign. It is
separate from the original transcripts and release report.

```sh
bun evals/review-report.ts \
  .release-artifacts/8.3.0-linux/evidence/2026-09-13T15-40-34-840Z.v2 \
  .agents/plans/04-model-adaptive-overhaul/evidence/f6-retained/finding-assessments.json
```

The observed result is 76 attempts: 23 with review, 53 with no review observed,
and none unassessed. There are 23 passed verdicts and one failed verdict, with
one assessed evidence gap. Without the assessment file that finding remains
unclassified. The 76/76 release conformance result is untouched.

## Verification and boundaries

Offline tests exercise missing evidence, unsupported session shapes, retries,
pending assignments, changed transcript bytes, swapped attempt identities,
duplicate records, and stale/unmatched/duplicate assessments. The actual retained
campaign was rendered with and without the assessment file, reproducing the
earlier audit counts without a model call.

The reader validates report/catalog semantics, transcript hashes and attempt
bindings, and rejects transcript symlinks escaping the campaign directory.
Retained sessions are redacted; live session operation-digest invariants therefore
do not apply. A dedicated observation schema validates the fields counted here.
Hash agreement proves consistency with the supplied report, not independent
authenticity. Unsupported transcript formats remain unassessed.

This implements audit recommendation 2. Reviewer accuracy, human calibration,
prompt efficiency, and qualification decisions remain outside this report.
