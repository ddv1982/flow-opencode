# Review rubric

Taxonomy, severity rules, and report format for Flow reviews. The decision (`approved` / `needs_fix` / `blocked`) follows mechanically from the findings: any blocking finding forbids approval.

## Finding classes

- **correctness** — wrong behavior, broken edge case, unhandled error path, race condition.
- **security** — injection, authz/authn gaps, secret exposure, unsafe deserialization, path traversal.
- **data-safety** — destructive operations without guard or rollback, lossy migrations, silent overwrite.
- **regression** — existing behavior or API contract changed without intent; removed observability (logging/metrics that operators rely on).
- **test-coverage** — new behavior without a test that exercises it; validation evidence below the rubric tier the change requires.
- **release-hygiene** — debug artifacts left in, commented-out code, dead flags, missing changelog/docs where the repo requires them, version/lockfile drift.
- **style** — convention deviations that linters did not catch. Style alone is advisory, never blocking.

## Severity

- **blocking** — would cause incorrect behavior, data loss, a security hole, or an unverifiable claim of success (missing/fabricated validation evidence is *always* blocking). Blocks approval.
- **advisory** — worth fixing but safe to ship; recorded so it is not lost, does not block.

Severity rules:
- Severity comes from impact, not effort-to-fix. A one-line fix for data loss is still blocking.
- When genuinely uncertain whether a finding is real, say so in the finding and rate by the realistic worst case — but verify first; do not pad reports with speculative findings.
- Do not inflate advisory style nits into blockers to look thorough; do not wave through a blocker because the feature "mostly works".

## Every finding needs

1. Class and severity.
2. Location — file path (line if possible).
3. What is wrong — observed, not hypothesized ("X returns null when Y", not "X might have issues").
4. Why it matters — the concrete failure it causes.
5. For blocking findings: what fixed looks like (one sentence, not an implementation).

## Report format

```
decision: approved | needs_fix | blocked
depth: quick | standard | deep        (the depth you actually achieved)
coverage: what you read/ran; what you did NOT cover and why
findings:
  - [blocking|advisory] class — file:line — what / why it matters / (if blocking) what fixed looks like
evidence-check: verdict on the validation evidence vs the validation rubric
(final scope only) done-condition: does the completed work deliver the planned outcome? broad validation run?
```

## Honesty rules

- Approve only on evidence you have seen, at the depth you claim. Re-runnable checks beat trust.
- An empty findings list after a shallow read is not an approval — it is a coverage gap; downgrade `depth` and say so.
- `needs_fix` loops back to the same feature; reserve `blocked` for things a fix cannot resolve (ambiguous requirements, missing access, human decisions).
- Review the work, not the narrative: read the diff and the evidence, not just the completion summary.
