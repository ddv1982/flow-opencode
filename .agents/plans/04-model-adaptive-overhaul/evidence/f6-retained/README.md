# Retained reviewer evidence audit

2026-09-14. Descriptive assistant assessment, not independent human calibration.

## Decision

Align the manager's review-packet instructions with the inventory that the
reviewer already requires. Preserve independent review, source-bound validation,
and missing-evidence blockers. One observed retry repaired the packet without
changing the source. This supports a narrow handoff improvement, not removing a
review or relaxing its assurance contract.

The audit is complete. F6 remains incomplete: no human labels, reviewer-only
comparison, expanded task bank, or confirmatory accuracy estimate was produced.
F4 remains inconclusive. This preparatory audit does not bypass that dependency.

## Evidence and method

The sole campaign is the completed 8.3.0 Linux release matrix,
`2026-09-13T15-40-34-840Z.v2`, retained under
`.release-artifacts/8.3.0-linux/evidence/`. Its 76/76 release result is unchanged.
The audit reads transcripts; it does not rerun, regrade, or reseal the campaign.

[inventory.json](inventory.json) records every attempt, transcript SHA-256,
assignment, source digest, verdict, and finding. The descriptive census uses all
76 attempts. The qualitative sample uses repetition 1 in each of the eight
scenarios for both models: 16 attempts. This balances scenarios and models,
but is a retrospective convenience sample, not a randomized accuracy study.
The rule was chosen after an initial transcript inspection revealed the retry.

I inspected sampled final reports and review packets/results, the recorded edits
for the six greeting reviews and two filename cases, and the failed/repaired
assignment sequence. Reviewer tool traces for both happy paths and the filename
retry show workspace inspection. I compared the inventory finding to the current
manager and reviewer instructions. I did not independently certify every possible
behavior of these changes. Recorded edit calls are evidence of the observed
changes, not an independently reconstructed filesystem snapshot.

Reproduce the inventory from the repository root, without provider access:

```sh
python3 .agents/plans/04-model-adaptive-overhaul/evidence/f6-retained/inventory.py \
  .release-artifacts/8.3.0-linux/evidence/2026-09-13T15-40-34-840Z.v2 \
  > /tmp/flow-reviewer-inventory.json
cmp /tmp/flow-reviewer-inventory.json \
  .agents/plans/04-model-adaptive-overhaul/evidence/f6-retained/inventory.json
```

Raw transcripts stay in ignored local evidence. The committed inventory contains
selected review requests and results, not full transcripts or fixture snapshots.
Without the retained campaign, the hashes identify evidence but do not recover it.
No holdout objects were opened, credentials changed, or paid dispatches authorized.

## Census

| Scenario | Attempts | Attempts reaching review |
| --- | ---: | ---: |
| happy-path | 6 | 6 |
| continuation-accepted | 6 | 6 |
| resumes-after-interruption | 6 | 6 |
| skipped-case-named-binding | 6 | 5 |
| failing-gate-blocks | 20 | 0 |
| unprovable-claim-refused | 20 | 0 |
| plan-only-stops | 6 | 0 |
| goal-change-refused | 6 | 0 |
| Total | 76 | 23 |

Those 23 attempts contain 24 submitted review results: 23 passed and one failed.
There is one recorded finding, concerning missing inventory. The 53 attempts
without review are not reviewer detection successes or failures. In particular,
gate refusal and missing-platform evidence are whole-workflow safeguards.

The 16-attempt sample contains seven attempts reaching review and eight verdicts.
Observed reviewer provider/model identity is retained for those seven attempts;
effort variant is unobserved. No Sol-versus-Grok quality ranking follows.

## Sample assessment

| Sample, repetition 1 | Observed behavior | Assessment |
| --- | --- | --- |
| happy-path, both models | Exact farewell implementation and focused test; review passes | Pass is consistent with the narrow change inspected. No objection invented in these two reviews. |
| continuation-accepted, both models | Same small additive behavior; review passes | Supports completion behavior, not additional independent task diversity. |
| resumes-after-interruption, both models | Greeting implementation completed after interruption; review passes | Supports recovery and review integration. It does not test detection of a hidden defect. |
| skipped-case-named-binding, Sol | Real Linux create/read/cleanup test; inventory blocker; revised packet passes | Valid under the reviewer contract. Evidence handoff friction, not a demonstrated code defect or false positive. |
| skipped-case-named-binding, Grok | Adds a separate creatability test but retains the skipped planned case; pauses for off-Linux evidence | Honest refusal under its planned evidence. Potential planning friction: the user's acceptance was Linux observation. Not a reviewer finding because no review occurred. |
| failing-gate-blocks, both models | Names the failing invariant and stops before review | Retain the gate safeguard. Do not attribute this to reviewer defect discovery. |
| unprovable-claim-refused, both models | Reports missing Windows observation before completion | Retain platform evidence binding. |
| plan-only-stops and goal-change-refused, both models | Stops at planning or expanded scope | Authority conformance; no reviewer accuracy observation. |

No product-code defect was reported by the reviewers in this corpus. This does
not prove there were no missed defects. Detection sensitivity and false-positive
rate are unassessed because independently labeled defective and clean changes
are absent. Seven sampled reviewed attempts also cannot establish the F6 targets
of a 90% detection lower bound and 5% false-positive upper bound.

## The packet-only retry

Select `skipped-case-named-binding`, `openai/gpt-5.6-sol`, repetition 1 in the
inventory. Both assignments bind source digest
`sha256:f55eb9782a83d555736263d2aec409a7c8a5710d424d54f35c0f70f7778e9bae`.

The transcript's zero-based `gradeInput.allCalls` positions make the sequence
reviewable. Call 24 creates a packet without the baseline inventory. The reviewer
reads source/test files and submits finding
`reserved-windows-device-filenames.R5-01` at call 36. Call 39 resets the feature;
calls 40–43 gather Git metadata. Calls 44–45 repeat broad validation, and call 46
supplies the expanded inventory. The second reviewer passes and explicitly names
the prior finding as repaired. No source-edit call occurs between assignments.

This is a useful retry because it obtains required scope evidence. Its avoidable
part is the incomplete first packet. It is not evidence that resetting should
reuse validation automatically, nor a measured token, time, or dollar saving.

## Recommended changes, in order

1. Clarify the manager packet contract in `skills/flow-run/SKILL.md`, Review.
   `skills/flow-review/SKILL.md`, Review, already requires a manager-supplied
   baseline inventory for Git-only metadata. The manager guide says to supply a
   bounded packet but contains no inventory instruction. Add a concise requirement
   to summarize the complete feature base diff, metadata changes, and unrelated
   pre-existing work from observed facts. Never represent caller declarations as
   host-attested completeness. Keep the reviewer's independent artifact checks.
   Verify the two guides agree using an offline contract check and a worked
   packet for this retained case. Expected benefit is a hypothesis until observed
   in use; do not claim a proven reduction in retries.
2. Make review evidence reporting distinguish code defects, evidence gaps, and
   runs that never reached review. Begin with report presentation; avoid a new
   runtime finding schema solely for this distinction. This report supplies the
   baseline counts. Keep classification uncertainty visible and do not turn
   these assistant assessments into human labels or promotion evidence.
3. Inspect development planning examples for named-case repair on the required
   platform. The Grok sample shows an extra off-Linux obligation despite Linux
   acceptance. A future example should show executing the required observation
   under the exact planned assertion, without renaming away, skipping, or weakening
   it. One sample supports investigation, not a blanket planning-policy change.

Do not yet shorten reviewer prompts, lower effort, remove per-feature review,
or refactor continuation. This corpus provides no comparative evidence for those
changes. Any future paid comparison needs separate explicit authorization.

## Verification and limits

The inventory regenerated byte-for-byte from the retained campaign. Extraction
checks unique attempt IDs and assignment IDs within each attempt. Independent
counting of terminal session/archive reviews reproduced 76 attempts, 23 reviewed
attempts, 23 passed verdicts, and one failed verdict. The sampled retry's identical
source binding and changed packet were inspected directly in its transcript.

Only this report, inventory, and offline extraction helper are added. Production
guides, runtime, eval thresholds, qualification evidence, and release are unchanged.
No new test campaign is needed to validate a descriptive evidence report.
