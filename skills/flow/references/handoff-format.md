# Flow worker handoff contract

Flow managers merge only the worker's final response. Treat that response as the
worker report of record: it must include the assigned scope, what was actually
covered, the evidence for each useful claim, and the remaining gaps. End worker
prompts with "Return only this Flow handoff."

Empty or unstructured worker output is a failed handoff. If the worker cannot
cover the assigned scope, verify the evidence, or satisfy the handoff shape, it
must return `Status: blocked` with the missing elements, and the manager must
not treat the slice as complete.

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

Use this for `flow-evidence-worker`, `flow-reviewer`,
`flow-validation-worker`, and `flow-audit-worker`.

```markdown
## Status
success | partial | blocked

## Scope
<owned slice: path set, module, command, risk lens, route, data range, or question set>

## Pass metadata
- Pass id: <stable pass id from the manifest>
- Manifest row id: <row id from the manifest>
- Depends on: <upstream row ids or "none">
- Write scope: <none | manager-serial | exact-path | isolated-worktree | mixed>

## Coverage
- Expected: <files, ranges, questions, commands, or findings assigned>
- Checked: <actual coverage, for example "12/12 files" or "command not run">
- Not checked: <items skipped with reason, or "none">

## Findings or facts
- [high|med|low] <claim>; evidence: <file:line | command summary | screenshot path | URL | metric>; corroboration: <N sources or "single source">
- [high|med|low] <claim>; evidence: <...>; corroboration: <...>

## Sources
- <paths read, commands run, docs fetched, data ranges covered, screenshots inspected>

## Confidence and verification
- Verified: <claims directly re-run, recounted, traced, or cross-checked>
- Single-source: <claims with exactly one supporting source>
- Inferred: <claims derived from surrounding evidence rather than directly observed>
- Unsettled: <claims, sources, or citations that could not be resolved>
- Falsifier or missing input: <what would overturn or materially change the result>

## Open questions / gaps
- <ambiguity, missing source, contradiction, skipped item, or out-of-scope dependency>

## Manager follow-ups
- <concrete next tasks, verifier claims, validation commands, or Flow plan targets>
```

Validation workers must include exact command names and raw outcome summaries
for commands they actually ran. Audit workers must include guards checked for
any blocking-severity candidate. Review workers must separate blocking findings
from advisory notes. In the shared `Findings or facts` section, review workers
should prefix review items with `blocking:` or `advisory:` before the claim.

Example evidence quality:

- Good fact: `[high] public Flow command prompts include bundled instructions;
  evidence: src/config-shared.ts:135; corroboration: single source`.
- Weak fact: `[high] prompts look self-contained; evidence: read the config`.
- Good validation: `bun test tests/distribution-and-surface.test.ts`, status
  passed, summary `surface tests passed and covered bundled command prompts`.
- Weak validation: `tests pass`, with no command, status, or raw outcome.

## Verifier worker report

Use this for `flow-verifier-worker`. Give it atomic claims and the cited sources
or commands. Do not include the generator's reasoning unless that reasoning is
the thing being verified, and do not say which worker produced the claim.

```markdown
## Status
success | partial | blocked

## Scope
<claim ids, sources or commands checked, and the acceptance question>

## Pass metadata
- Pass id: <stable pass id from the manifest>
- Manifest row id: <row id from the manifest>
- Depends on: <upstream row ids or "none">

## Verdict per claim
- <claim id>: verdict=<supported | partly-supported | unsupported | source-not-found>
  - claim: <claim text>
  - evidence: <supporting snippet, path plus line, measured value, command result, or "none">
  - source resolution: <URL, path, or command plus whether it resolved>
  - confidence level: high | med | low
  - recommended action: <keep, narrow, rewrite, or remove>

## Overall
<accept | revise | reject> because <brief reason>

## Gaps
- <unavailable source, ambiguous claim wording, missing oracle, or check not run>

## Manager follow-ups
- <narrow recheck, plan adjustment, review finding, or none>
```

## Candidate implementation worker report

Use this only with explicit user authorization, in an isolated worktree or an
exact non-overlapping path-owned slice assigned by the manager.

```markdown
## Status
success | partial | blocked

## Scope
<isolated worktree or exact path-owned slice>

## Pass metadata
- Pass id: <stable pass id from the manifest>
- Manifest row id: <row id from the manifest>
- Depends on: <upstream row ids or "none">
- Write scope: <exact-path | isolated-worktree>

## Changed or proposed patch
- <path>: <what changed and why>

## Coverage
- Assigned: <owned files/modules>
- Touched: <files changed or proposed>
- Skipped: <anything assigned but not changed and why, or "none">

## Verification
live-verified | test-verified | type-check-only | not-verified
- <command, observed outcome, pass/fail counts, or manual check>

## Confidence and risk
- Checked directly: <behavior, files, or commands verified by the worker>
- Still open: <tests, review paths, or integration points the manager must cover>
- Risk: low | medium | high -- <why>

## Merge notes
- <conflicts, nearby user changes, assumptions, or deviations>

## Manager follow-ups
- <merge, reject, rerun check, verifier pass, or replan task>
```

The manager must inspect and validate any candidate patch before recording Flow
completion.

## Manager pass accounting record

The manager, not the worker, may carry compact records into
`flow_feature_complete.orchestrationPasses`. Use one record per material pass or
implementation decision; keep handoffs and long artifacts outside `.flow/**`.
The candidate accounting rules — which `candidateEligibility`,
`candidateDecision`, and `decision` combinations validate, and what counts as
candidate execution evidence — live in
[parallel-orchestration.md](parallel-orchestration.md) under "Implementation
pass decision"; note `decision: "parallel"` is not valid on
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
