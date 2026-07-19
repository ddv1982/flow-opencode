---
name: flow-review
description: "Use when Flow work needs an assignment result in the v5 runtime: an active execution awaiting feature review, a final review assignment, or an assigned review slice. Validation evidence gathering stays in flow-test; cleanup judgment stays in flow-deslop."
---

# Flow Review

Use this skill for review. The reviewer is read-only and does not mutate Flow
state. The manager creates the assignment before dispatch and records the
returned terminal result inside `flow_feature_complete`.

If Flow tools, required Flow skills, or required references are unavailable or
stale, perform an advisory review and say that no Flow-gated assignment result
was recorded.

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

- When the assignment id is available, call only
  `flow_status { "request": { "view": "reviewer", "assignmentId": "..." } }`
  and verify that
  the returned assignment is pending. Do not reconstruct reviewer status from
  feature, packet, evidence, revision, or snapshot fields.
- Identify whether the assignment is a feature review or final review.
- Prefer the bounded assignment packet over parent-session memory. The
  assignment projection names the active execution's feature, runtime-owned
  required depth, packet summary, validation evidence count, assigned scope,
  and risk lenses. If the packet is missing important scope or evidence, record
  that as a coverage gap or blocker instead of searching the full conversation
  transcript.
- Read the approved plan fields relevant to the work: `requirements`, `decisions`, feature `targets`, feature `validation`, and dependencies.
- For final review, also compare the original goal, full feature list, completed
  feature evidence, changed artifacts, and final validation against the
  convergence checklist in `references/review-rubric.md`.
- Inspect the actual diff, changed files, tests, and validation output. Do not review only the completion summary.
- In manager context, request `flow-test` through `flow_guidance` for validation-heavy,
  regression-sensitive, browser QA, or unclear coverage reviews. If it is
  unavailable or you are the hidden reviewer, record a coverage gap and treat
  missing validation evidence as a gap or blocker based on user impact.
- Request `flow-review/references/review-rubric.md` from `flow_guidance` for severity, depth, and payload shape.

## Feature Review Depth

- **quick**: docs, comments, config-only changes, or mechanical changes fully covered by tooling.
- **standard**: default feature review. Read every changed file and relevant tests.
- **detailed**: risky behavior, persistence, security, cross-module refactors, migrations, releases, or weak validation.

`quick` and `standard` are feature-review depth descriptions only. Final reviews use `reviewDepth: "broad"` or `"detailed"` to match the plan's `finalReviewPolicy`; these runtime enum values are the canonical final-review terms. Claim only the depth actually performed. Missing evidence is a finding, not a nuisance.

## Output

For every observed dispatch, return exactly one assignment result. Echo only
the runtime-owned `assignmentId`; add `verdict`, typed `findings`,
`completedAt`, and `terminalDisposition`. Do not return attempt id, logical-pass
id, feature/run identity, packet/snapshot/source/evidence identity, start time,
or review depth—the runtime derives those fields from the durable
assignment. Use `terminalDisposition: "observed_unsubmitted"` only for an
observed result that cannot submit normally; it must be failed and include a
blocking finding. Flow computes finding fingerprints.

`completedAt` is reported time. It must not precede the runtime-owned
assignment start or postdate the runtime acceptance time at which the manager
submits the assignment result.

Passing example:

```json
{
  "assignmentId": "review-assignment:runtime-id",
  "verdict": "passed",
  "findings": [],
  "completedAt": "ISO-8601",
  "terminalDisposition": "submitted"
}
```

Blocking example:

```json
{
  "assignmentId": "review-assignment:runtime-id",
  "verdict": "failed",
  "findings": [
    {
      "taxonomy": "implementation_defect",
      "subject": "src/navigation.ts",
      "requirementOrRisk": "stale requests cannot publish terminal state",
      "evidenceLocator": "src/navigation.ts:publishResult",
      "summary": "A superseded request can still publish an error.",
      "severity": "blocking"
    }
  ],
  "completedAt": "ISO-8601",
  "terminalDisposition": "submitted"
}
```

Use `verdict: "failed"` when any blocking finding remains. A pass may include
advisory findings but cannot include a blocking one.

Typed execution findings use exactly `implementation_defect`,
`regression_coverage_gap`, `evidence_gap`, or `advisory` as `taxonomy`, with
`subject`, `requirementOrRisk`, `evidenceLocator`, `summary`, and `severity`.

## Special cases

- Cleanup/refactor: in manager context, request `flow-deslop` through `flow_guidance`; verify the smell was real, refutation paths were checked, and behavior was preserved. If it is unavailable or you are the hidden reviewer, record a coverage gap instead of approving cleanup claims.
- UI/frontend: in manager context, request `flow-ui-quality` through `flow_guidance`; verify state coverage and visual evidence when a local target was available. If it is unavailable or you are the hidden reviewer, record a coverage gap and do not claim visual polish was verified.
- Audit reports: request `flow-run/references/audit-rubric.md` from `flow_guidance`; findings must survive refutation before they can drive fix features.
- Large reviews (manager context only): request
  `flow/references/parallel-orchestration.md` from `flow_guidance` for read-only slices by
  changed-file group, risk lens, or validation surface. If fan-out is selected,
  request the manifest, execution, and synthesis reference ids with the named review, audit,
  evidence, or validation workers; only the manager returns the final assignment
  result. If those references are unavailable
  in the current context (for example in a bundled public Flow
  command that does not include it), review serially and record the skipped
  fan-out as a coverage gap instead of improvising worker contracts. The hidden
  reviewer cannot spawn workers; it reviews its assigned scope directly and
  reports coverage gaps for the rest.

Never approve to unblock completion, fix findings in the review pass, or vouch for validation you did not inspect.
