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

## Depth escalation

Starting depth comes from the skill's risk table (quick / standard / deep). Escalate mid-review when reality outgrows the label — and never the reverse:

- A "docs-only" or "mechanical" change turns out to touch behavior → quick becomes standard.
- Any security, data-safety, or concurrency finding at standard depth → finish at deep for the affected surface; trace beyond the diff.
- Validation evidence below the rubric tier the change requires → at minimum a finding; if the change is behavioral, also escalate, because you can no longer lean on the evidence.

Record the depth you finished at, not the one you started with.

## Every finding needs

1. Class and severity.
2. Location — file path (line if possible).
3. What is wrong — observed, not hypothesized ("X returns null when Y", not "X might have issues").
4. Why it matters — the concrete failure it causes.
5. For blocking findings: what fixed looks like (one sentence, not an implementation).

## Context-pack checks

Before approving, compare the implementation and validation evidence to the plan context:

- `planning.repoProfile` and `planning.research`: were the relevant files, tests, docs, CI scripts, and local rules actually inspected?
- `plan.requirements`: did the work satisfy the user-visible constraints without adding undeclared scope?
- `plan.architectureDecisions`: did the implementation keep the chosen boundaries, or did it introduce a shortcut the plan did not discuss?
- Feature `fileTargets` and `reviewScope`: were all named surfaces changed or intentionally left alone, and did validation cover them?
- `plan.notes`: did the implementation respect the out-of-scope and unknown-context entries?

Missing or stale context is not a documentation nit when it changes the review claim. Mark it blocking when it means the reviewer cannot tell what was inspected, what changed, or why the validation evidence applies.

## Parallel review synthesis

For very large reviews, read `../../flow/references/parallel-orchestration.md`;
split read-only discovery by module, changed surface, or risk lens. Workers
gather candidates; the reviewer owns the verdict. Before `flow_review_record`,
reconcile duplicates, verify blocking findings at the claimed depth, and treat
missing worker coverage as a gap.

## Report format

```
decision: approved | needs_fix | blocked
depth: quick | standard | deep        (the depth you actually achieved)
coverage: what you read/ran, including plan context checked; what you did NOT cover and why
findings:
  - [blocking|advisory] class — file:line — what / why it matters / (if blocking) what fixed looks like
evidence-check: verdict on the validation evidence vs the validation rubric
(final scope only) done-condition: does the completed work deliver the planned outcome? broad validation run?
```

## Recording the decision: `flow_review_record` shapes

A feature decision uses `scope: "feature"` and puts the feature payload under
`featureReview`:

```json
{
  "scope": "feature",
  "featureReview": {
    "featureId": "rate-limit-middleware",
    "status": "needs_fix",
    "summary": "Limit logic correct; concurrent-refill race loses tokens under load.",
    "blockingFindings": [
      { "summary": "correctness — src/middleware/rate-limit.ts:84 — read-modify-write on the counter is not atomic; parallel requests under-count. Fixed looks like: single atomic INCR with TTL." }
    ],
    "followUps": [
      { "summary": "Retry-After rounds down to 0s near window end", "severity": "advisory" }
    ],
    "suggestedValidation": ["pnpm test middleware --repeat 20 (race is timing-sensitive)"]
  }
}
```

A final decision uses `scope: "final"` and puts the session-level payload under
`finalReview`. It omits `featureId`; `reviewDepth` must equal the plan's
`deliveryPolicy.finalReviewPolicy` (`broad` or `detailed`) or the runtime
rejects completion:

```json
{
  "scope": "final",
  "finalReview": {
    "status": "approved",
    "summary": "All three features deliver the done condition; broad gate green.",
    "reviewDepth": "detailed",
    "reviewedSurfaces": ["changed_files", "tests", "validation_evidence", "docs_and_prompts"],
    "evidenceSummary": "Re-ran pnpm typecheck && pnpm test (212 passed); spot-checked rate-limit cases fail on main.",
    "validationAssessment": "Tier 1 on both code features; docs feature tier 3 as the rubric allows.",
    "remainingGaps": ["No live two-instance Redis check in this environment"],
    "evidenceRefs": {
      "changedArtifacts": ["src/middleware/rate-limit.ts", "src/middleware/stores/redis.ts", "README.md"],
      "validationCommands": ["pnpm typecheck && pnpm test", "pnpm test middleware"]
    }
  }
}
```

`blockingFindings` entries are `{summary}` — pack class, location, what/why, and the fix shape into that summary as the report format shows. `followUps` are the advisory ledger so nothing is lost. List only `reviewedSurfaces` you actually covered; `remainingGaps` is where honesty about coverage lives.

## Reviewing audit deliverables

When the artifact under review is a findings report (produced under the flow-run audit rubric), the review is an adversarial verification pass over the findings, not a read of the prose:

1. **Attempt to refute every blocking-severity finding.** For each, trace what the author should have: the callers of the cited site, the cross-layer counterpart (a frontend finding is unverified until the backend handler it calls has been read, and vice versa), and the surrounding guards, resets, and validation. Spot-checking that cited lines exist catches nothing — wrong findings cite real code accurately.
2. **Give each a verdict**: *confirmed* (the failure is reachable and no traced guard prevents it), *refuted* (a mitigating path the report missed already covers it), or *uncertain* (state what you could not trace). Refuted findings, and blocking findings with no guards-checked line, are blocking findings against the report itself — the decision is `needs_fix` so they are dropped or downgraded before the report ships.
3. **Check the report-level requirements** from the audit rubric: deployment context stated in the header and severities rated within it; no hypothesized blocking findings ("if X ever…"); validation commands actually run.

Advisory findings get a plausibility read, not full refutation — but promote anything that looks confirmed-blocking under tracing.

## Honesty rules

- Approve only on evidence you have seen, at the depth you claim. Re-runnable checks beat trust.
- An empty findings list after a shallow read is not an approval — it is a coverage gap; downgrade `depth` and say so.
- `needs_fix` loops back to the same feature; reserve `blocked` for things a fix cannot resolve (ambiguous requirements, missing access, human decisions).
- Review the work, not the narrative: read the diff and the evidence, not just the completion summary.
