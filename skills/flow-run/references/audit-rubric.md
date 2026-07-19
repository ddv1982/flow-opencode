# Audit findings rubric

What counts as a valid finding when the feature's deliverable is a findings report: a codebase audit, a review-first feature, or any report whose findings a later feature will fix. The commands you run are still governed by `flow-run/references/validation-rubric.md`; this rubric governs the findings themselves.

A findings report is a set of claims about code you did not write. Its failure mode is not "missed something" — it is the confident, accurately-cited finding that is wrong because the mitigating code path was never read. Accurate citations are necessary, never sufficient: a citation proves you found the suspicious site, not that the suspicion survives contact with the rest of the codebase.

## Refute before you report

Before any finding becomes actionable, actively try to kill it:

- **Trace the mitigating paths.** Read the callers of the suspicious site and the code it delegates to. The question is never "could this line misbehave?" but "does anything between input and this line already prevent that?"
- **Cross the layer boundary.** In a multi-layer repo, a finding in one layer is unverified until you have read its counterpart in the other. A frontend finding requires reading the backend handler it calls (it may already validate or dedupe); a library-internals finding requires checking what validation real callers pass through; an API finding requires checking what the client can actually send.
- **Check the surrounding lifecycle.** State that "leaks" or "goes stale" may already be reset by an effect, a guard clause, or an invalidation a few lines away from where you stopped reading.

A finding that survives this pass is worth reporting. A finding you did not try to refute is a guess with a citation.

The audit report is an evidence boundary. It may suggest a bounded fix shape,
but it does not authorize edits and must not turn speculative candidates into a
remediation plan. Only candidates that survive refutation may cross into later
plan features.

## Parallel audit slices

For broad audits, start with `flow/references/parallel-orchestration.md` to split
read-only slices by module, data flow, or risk lens. Workers surface candidates;
the audit author owns the report. Apply its handoff format and verification
gates. Before blocking severity, dedupe, trace guards, fill cross-layer checks,
verify contested or high-stakes claims, and downgrade missing context.

## Audit ledger fields

The machine source of truth is a strict object with only
`version: "audit-ledger/v1"` and `findings`. Each finding uses exactly:

- `id`, `title`, `summary`, and one or more repository-relative
  `sourceLocators` (`file`, optional `symbol`, `line`, and `endLine`).
- `proofState`: `reproduced`, `source_proven`, `invariant_only`,
  `external_assumption`, or `unverified`.
- `reachability`: `normal_path`, `failure_path`, `adversarial_local`,
  `external_consumer`, or `unknown`.
- `deploymentContext`: `exposure` (`deployed`, `distributed`, `not_deployed`, or
  `unknown`) plus `description`.
- `trigger`: concrete input, state, or event sequence.
- `guardsAndRecovery`: `effectiveness` (`effective`, `partial`, `ineffective`,
  `none`, or `unknown`) plus cited `evidence`.
- `disposition`: `confirmed`, `hardening`, `measure_first`, `deferred`, or
  `refuted`.
- `impact`: `level` (`catastrophic`, `major`, `moderate`, `minor`, or `none`)
  plus `description`.
- `severity`: `critical`, `high`, `medium`, `low`, or `informational`;
  `actionPriority`: `fix_now`, `next`, `backlog`, or `none`;
  `confidence`: `high`, `medium`, or `low`; and `falsifier`.
- Optional `remediation`, present exactly when the action priority is not
  `none`.

A refuted finding uses `disposition: "refuted"`, informational severity,
`actionPriority: "none"`, and no remediation. Keep it in the ledger for
traceability; the renderer excludes it from remediation automatically.

## Every blocking finding records guards and recovery

In addition to evidence, why-it-matters, and fix shape, every blocking finding
names the mitigating paths and recovery behavior traced and why they do not
cover this case. Missing `guardsAndRecovery` makes the finding unresolved:
downgrade it and state what was not traced.

## Observed, not hypothesized

- A blocking finding describes behavior the current code exhibits, with the input that triggers it. "If the backend ever returns X" is a hypothesis about code you chose not to read — either read it and confirm, or record the item as a defense-in-depth note (advisory at most).
- Uncertainty after tracing is honest — state it and rate by the realistic worst case. Uncertainty instead of tracing is padding.

## Severity is rated in deployment context

- The report header states the deployment model the product actually has: desktop app, shared server, library consumed by others, CLI, and so on.
- Rate impact within that model. Unbounded memory in a single-user desktop process whose lifetime is one window is not the severity it would be in a long-running shared service. When a finding only matters under a deployment the product does not have, say so explicitly ("becomes blocking if this ships as a shared service") instead of rating for the imagined deployment.

P0 means `severity: "critical"` with `actionPriority: "fix_now"`; it is
exceptional. It requires `proofState: "reproduced"` or `"source_proven"`, a
non-unknown reachable path, deployed or distributed exposure, catastrophic or
ship-blocking impact recorded as `impact.level: "catastrophic"`, and ineffective
or absent guards and recovery. Use
`disposition: "confirmed"` or `"hardening"` and include remediation. If any
element is missing, lower severity or action priority. A plausible severe
outcome, code smell, single citation, or missing test is not enough.

## Render and reconcile

After constructing strict `AuditLedgerV1`, call `flow_audit_render` with
`{ "ledger": <the exact object> }`. Treat a tool error as a schema or
calibration failure and correct the ledger. On success, use the returned derived
summary and canonical Markdown exactly; never hand-edit counts, finding blocks,
or remediation. The ledger remains the source of truth.

Never promote a hypothesis to blocking severity, cite a line you did not read
in context, rate severity against a deployment model the product does not have,
or pad the ledger to look thorough. Six verified findings outrank nine where
three die on first contact.
