---
name: flow-review
description: Review Flow work in the v4 runtime: inspect feature or final-session changes, classify findings, and return featureReview or finalReview payloads for flow_feature_complete.
---

# Flow Review

Use this skill for review. The reviewer is usually read-only and does not mutate Flow state. The manager records the returned review payload inside `flow_feature_complete`.

If Flow tools are unavailable, perform an advisory review and say that no Flow-gated review payload was recorded.

## Start

- Call `flow_status` when available.
- Identify whether this is a feature review or final review.
- Read the approved plan fields relevant to the work: `requirements`, `decisions`, feature `targets`, feature `validation`, and dependencies.
- Inspect the actual diff, changed files, tests, and validation output. Do not review only the completion summary.
- Load `references/review-rubric.md` for severity, depth, and payload shape.

## Depth

- **quick**: docs, comments, config-only changes, or mechanical changes fully covered by tooling.
- **standard**: default feature review. Read every changed file and relevant tests.
- **detailed**: final review, risky behavior, persistence, security, cross-module refactors, migrations, releases, or weak validation.

Claim only the depth actually performed. Missing evidence is a finding, not a nuisance.

## Output

For a feature review, return:

```json
{
  "status": "passed",
  "summary": "what was reviewed and why it is acceptable",
  "blockingFindings": []
}
```

For a final review, return:

```json
{
  "status": "passed",
  "summary": "session-level review summary",
  "blockingFindings": [],
  "reviewDepth": "detailed"
}
```

Use `status: "failed"` when any blocking finding remains. Advisory findings may be included in the prose summary, but `blockingFindings` contains only blockers.

## Special cases

- Cleanup/refactor: load `flow-deslop`; verify the smell was real, refutation paths were checked, and behavior was preserved.
- UI/frontend: load `flow-ui-quality`; verify state coverage and visual evidence when a local target was available.
- Audit reports: use `flow-run/references/audit-rubric.md`; findings must survive refutation before they can drive fix features.
- Large reviews: use `../flow/references/parallel-orchestration.md` for
  read-only slices by changed-file group, risk lens, or validation surface.
  Use the named review, audit, evidence, or validation agents from that
  reference instead of generic subagents. Apply its handoff format and
  verification gates; only the manager returns the final `featureReview` or
  `finalReview` payload.

Never approve to unblock completion, fix findings in the review pass, or vouch for validation you did not inspect.
