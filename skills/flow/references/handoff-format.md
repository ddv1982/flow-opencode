# Flow worker handoff contract

Flow managers merge only the worker's final response. Treat that response as the
worker report of record. End worker prompts with "Return only this Flow
handoff."

<!-- flow-prompt:worker-integrity:start -->
Cite or drop every claim. Label single-source, inferred, and unsettled claims.
When usable evidence exists but named expected coverage could not be checked,
return the required handoff with `## Status` set to `partial` and enumerate the
unchecked items and reasons. If the assignment or required shape is missing,
or no usable coverage can be produced, return the required handoff with
`## Status` set to `blocked` and name the missing elements. Empty or
unstructured output is a failed handoff.
<!-- flow-prompt:worker-integrity:end -->

Sections: evidence/review/validation/audit worker report, verifier worker report,
and candidate implementation worker report.

Status meanings:

- `success`: the assigned scope was covered, or any skipped items are explicitly
  immaterial to the assigned question.
- `partial`: useful evidence was gathered, but material assigned scope remains
  unchecked or unresolved.
- `blocked`: the worker cannot answer the assigned question without missing
  access, input, dependencies, or manager clarification.

## Evidence, review, validation, or audit worker report

Use the one role-specific block that matches the assigned worker.

<!-- flow-prompt:handoff-evidence:start -->
Return only this Flow handoff:
## Status
success | partial | blocked
## Scope
assigned slice
## Pass metadata
pass id, manifest row id, dependencies, write scope
## Coverage
expected, checked, not checked with reasons
## Findings or facts
confidence, atomic claim, citation, corroboration
## Sources
paths, commands, documents, screenshots, or data ranges inspected
## Confidence and verification
verified, single-source, inferred, unsettled, falsifier
## Open questions / gaps
## Manager follow-ups
<!-- flow-prompt:handoff-evidence:end -->

<!-- flow-prompt:handoff-validation:start -->
Return only this Flow handoff:
## Status
success | partial | blocked
## Scope
assigned checks or validation question
## Pass metadata
pass id, manifest row id, dependencies, write scope
## Coverage
expected, checked, not checked with reasons
## Commands and outcomes
exact command, status, raw outcome summary, behavior covered
## Confidence and verification
verified, single-source, inferred, unsettled, falsifier
## Open questions / gaps
## Manager follow-ups
<!-- flow-prompt:handoff-validation:end -->

<!-- flow-prompt:handoff-audit:start -->
Return only this Flow handoff:
## Status
success | partial | blocked
## Scope
assigned paths, risks, or candidate findings
## Pass metadata
pass id, manifest row id, dependencies, write scope
## Coverage
expected, checked, not checked with reasons
## Findings
severity, atomic claim, citation, corroboration, guards checked, refutation result
## Sources
## Confidence and verification
verified, single-source, inferred, unsettled, falsifier
## Open questions / gaps
## Manager follow-ups
<!-- flow-prompt:handoff-audit:end -->

<!-- flow-prompt:handoff-review-slice:start -->
For an assigned review slice, return only this Flow handoff:
## Status
success | partial | blocked
## Scope
assigned files, risk lens, or validation surface
## Pass metadata
pass id, manifest row id, dependencies, write scope
## Coverage
expected, checked, not checked with reasons
## Findings
prefix each `blocking:` or `advisory:`, then severity, claim, citation, and corroboration
## Sources
## Confidence and verification
verified, single-source, inferred, unsettled, falsifier
## Open questions / gaps
## Manager follow-ups
<!-- flow-prompt:handoff-review-slice:end -->

## Verifier worker report

Use this for `flow-verifier-worker`.

<!-- flow-prompt:handoff-verifier:start -->
Return only this Flow handoff:
## Status
success | partial | blocked
## Scope
atomic claim ids, sources or commands checked, acceptance question
## Pass metadata
pass id, manifest row id, dependencies
## Verdict per claim
supported | partly-supported | unsupported | source-not-found; include claim, resolved evidence, confidence, recommended action
## Overall
accept | revise | reject with reason
## Gaps
## Manager follow-ups
<!-- flow-prompt:handoff-verifier:end -->

## Candidate implementation worker report

Use this only with explicit user authorization and isolated or exact-path
ownership.

<!-- flow-prompt:handoff-candidate:start -->
Return only this Flow handoff:
## Status
success | partial | blocked
## Scope
isolated worktree or exact path-owned slice
## Pass metadata
pass id, manifest row id, dependencies, exact-path | isolated-worktree
## Changed or proposed patch
paths, change, reason
## Coverage
assigned, touched, skipped with reasons
## Verification
level, exact command or check, observed outcome
## Confidence and risk
directly checked, still open, risk with reason
## Merge notes
conflicts, user changes, assumptions, deviations
## Manager follow-ups
<!-- flow-prompt:handoff-candidate:end -->

The manager must inspect and validate any candidate patch before recording Flow
completion.

## Manager pass accounting record

The manager, not the worker, may carry bounded records into
`flow_feature_complete.request.result.orchestrationPasses`. Use one record per material pass or
implementation decision; keep handoffs and long artifacts outside `.flow/**`.
The candidate accounting rules — which `candidateEligibility`,
`candidateDecision`, and `decision` combinations validate, and what counts as
candidate execution evidence — live in
`flow/references/parallel-decision.md` under "Implementation pass decision";
note `decision: "parallel"` is not valid on
`implementation-decision` records.

```json
{
  "id": "stable-pass-id",
  "kind": "discovery | audit | review | validation | verification | candidate | implementation-decision",
  "decision": "serial | parallel | candidate-exact-path | candidate-worktree | tournament | skipped",
  "decisionReason": "why this pass shape was chosen",
  "candidateEligibility": "eligible | not_eligible | unknown",
  "candidateDecision": "used | skipped | serial_required",
  "decisionFactors": [
    "shared_state",
    "overlapping_files",
    "small_slice",
    "needs_manager_judgment",
    "independent_surface",
    "validation_available"
  ],
  "modes": ["evidence"],
  "workerCount": 1,
  "candidateWorkerCount": 0,
  "verifierWorkerCount": 0,
  "sliceIds": ["manifest-row-id"],
  "dependsOn": [],
  "writeScope": "none | manager-serial | exact-path | isolated-worktree | mixed",
  "handoffRefs": ["/tmp/flow-handoff.md"],
  "verificationStatus": "not-needed | pending | passed | failed | mixed | downgraded",
  "outcome": "accepted | modified | rejected | partial | not-covered | superseded",
  "synthesisRef": "/tmp/flow-synthesis.md"
}
```
