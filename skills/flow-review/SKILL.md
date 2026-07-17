---
name: flow-review
description: "Use when Flow work needs a review verdict in the v4 runtime: a completed feature awaiting its featureReview, a final session review, or an assigned review slice. Validation evidence gathering stays in flow-test; cleanup judgment stays in flow-deslop."
---

# Flow Review

Use this skill for review. The reviewer is usually read-only and does not mutate Flow state. The manager records the returned review payload inside `flow_feature_complete`.

If Flow tools, required Flow skills, or required references are unavailable or
stale, perform an advisory review and say that no Flow-gated review payload was
recorded.

## Execution contexts

These instructions run in two contexts, and only one of them can load helpers:

- **Manager context**: the manager reviews inside the Flow loop (the `flow` or
  `flow-run` skills, or a bundled public Flow command) before recording
  evidence. The manager may load helper skills and fan out read-only workers.
- **Hidden reviewer context**: `/flow-review` runs as the `flow-reviewer`
  subagent, whose permissions deny skill loading, shell commands, and
  subagents. In this context, skip every "load" and "fan out" instruction
  below: judge from the diff, the plan fields, and the recorded validation
  evidence, and record a coverage gap for any judgment that would have needed
  a helper skill or a command run. The bundled hidden reviewer prompt uses the
  canonical role-safe contract in
  `references/hidden-reviewer-contract.md`.

## Start

- Call `flow_status` when available.
- Identify whether this is a feature review or final review.
- Prefer the manager's bounded review packet over parent-session memory. The
  packet should name the active feature, minimum `reviewDepth`, changed files,
  diff summary, validation evidence, and targeted paths or risk lenses. If the
  packet is missing important scope or evidence, record that as a coverage gap
  or blocker instead of searching the full conversation transcript.
- Read the approved plan fields relevant to the work: `requirements`, `decisions`, feature `targets`, feature `validation`, and dependencies.
- For final review, also compare the original goal, full feature list, completed
  feature evidence, changed artifacts, and final validation against the
  convergence checklist in `references/review-rubric.md`.
- Inspect the actual diff, changed files, tests, and validation output. Do not review only the completion summary.
- In manager context, load `flow-test` for validation-heavy,
  regression-sensitive, browser QA, or unclear coverage reviews. If it is
  unavailable or you are the hidden reviewer, record a coverage gap and treat
  missing validation evidence as a gap or blocker based on user impact.
- Load `references/review-rubric.md` for severity, depth, and payload shape.

## Feature Review Depth

- **quick**: docs, comments, config-only changes, or mechanical changes fully covered by tooling.
- **standard**: default feature review. Read every changed file and relevant tests.
- **detailed**: risky behavior, persistence, security, cross-module refactors, migrations, releases, or weak validation.

`quick` and `standard` are feature-review depth descriptions only. Final reviews use `reviewDepth: "broad"` or `"detailed"` to match the plan's `finalReviewPolicy`; these runtime enum values are the canonical final-review terms. Claim only the depth actually performed. Missing evidence is a finding, not a nuisance.

## Output

For a feature review, return a packet the manager can copy into
`flow_feature_complete`:

```json
{
  "featureReviewDepth": "standard",
  "featureReview": {
    "status": "passed",
    "summary": "what was reviewed and why it is acceptable",
    "blockingFindings": []
  }
}
```

`featureReviewDepth` must be at least the feature's planned `reviewDepth`.
Use the actual depth performed: `quick`, `standard`, or `detailed`.

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

- Cleanup/refactor: in manager context, load `flow-deslop`; verify the smell was real, refutation paths were checked, and behavior was preserved. If it is unavailable or you are the hidden reviewer, record a coverage gap instead of approving cleanup claims.
- UI/frontend: in manager context, load `flow-ui-quality`; verify state coverage and visual evidence when a local target was available. If it is unavailable or you are the hidden reviewer, record a coverage gap and do not claim visual polish was verified.
- Audit reports: use `../flow-run/references/audit-rubric.md`; findings must survive refutation before they can drive fix features.
- Large reviews (manager context only): start with
  `../flow/references/parallel-orchestration.md` for read-only slices by
  changed-file group, risk lens, or validation surface. If fan-out is selected,
  use `../flow/references/parallel-manifest.md`,
  `../flow/references/parallel-execution.md`, and
  `../flow/references/parallel-synthesis.md` with the named review, audit,
  evidence, or validation workers; only the manager returns the final
  `featureReview` or `finalReview` payload. If those references are unavailable
  in the current context (for example in a bundled public Flow
  command that does not include it), review serially and record the skipped
  fan-out as a coverage gap instead of improvising worker contracts. The hidden
  reviewer cannot spawn workers; it reviews its assigned scope directly and
  reports coverage gaps for the rest.

Never approve to unblock completion, fix findings in the review pass, or vouch for validation you did not inspect.
