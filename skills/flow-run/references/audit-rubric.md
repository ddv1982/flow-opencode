# Audit findings rubric

What counts as a valid finding when the feature's deliverable is a findings report: a codebase audit, a review-first feature, or any report whose findings a later feature will fix. The commands you run are still governed by `validation-rubric.md`; this rubric governs the findings themselves.

A findings report is a set of claims about code you did not write. Its failure mode is not "missed something" — it is the confident, accurately-cited finding that is wrong because the mitigating code path was never read. Accurate citations are necessary, never sufficient: a citation proves you found the suspicious site, not that the suspicion survives contact with the rest of the codebase.

## Refute before you report

Before any finding earns blocking severity (P1/P2 or equivalent), actively try to kill it:

- **Trace the mitigating paths.** Read the callers of the suspicious site and the code it delegates to. The question is never "could this line misbehave?" but "does anything between input and this line already prevent that?"
- **Cross the layer boundary.** In a multi-layer repo, a finding in one layer is unverified until you have read its counterpart in the other. A frontend finding requires reading the backend handler it calls (it may already validate or dedupe); a library-internals finding requires checking what validation real callers pass through; an API finding requires checking what the client can actually send.
- **Check the surrounding lifecycle.** State that "leaks" or "goes stale" may already be reset by an effect, a guard clause, or an invalidation a few lines away from where you stopped reading.

A finding that survives this pass is worth reporting. A finding you did not try to refute is a guess with a citation.

## Parallel audit slices

For broad audits, start with `../../flow/references/parallel-orchestration.md` to split
read-only slices by module, data flow, or risk lens. Workers surface candidates;
the audit author owns the report. Apply its handoff format and verification
gates. Before blocking severity, dedupe, trace guards, fill cross-layer checks,
verify contested or high-stakes claims, and downgrade missing context.

## Every blocking finding records "guards checked"

In addition to evidence, why-it-matters, and fix shape, every blocking finding names the mitigating paths you traced and why they do not cover this case ("`suggest_mappings()` enforces one-to-one via `used_a`/`used_b` — but nothing dedupes after the frontend re-sorts" reads very differently from silence). No guards-checked line means the finding is unverified: downgrade it to advisory and say what you did not trace.

## Observed, not hypothesized

- A blocking finding describes behavior the current code exhibits, with the input that triggers it. "If the backend ever returns X" is a hypothesis about code you chose not to read — either read it and confirm, or record the item as a defense-in-depth note (advisory at most).
- Uncertainty after tracing is honest — state it and rate by the realistic worst case. Uncertainty instead of tracing is padding.

## Severity is rated in deployment context

- The report header states the deployment model the product actually has: desktop app, shared server, library consumed by others, CLI, and so on.
- Rate impact within that model. Unbounded memory in a single-user desktop process whose lifetime is one window is not the severity it would be in a long-running shared service. When a finding only matters under a deployment the product does not have, say so explicitly ("becomes blocking if this ships as a shared service") instead of rating for the imagined deployment.

## Report shape

```
header: scope audited; deployment context; validation commands actually run
findings, strongest first, each with:
  - class and severity
  - evidence — file:line actually read
  - guards checked — mitigating paths traced and why they fall short (blocking findings)
  - why it matters — the concrete failure, with triggering input
  - fix shape — one sentence, not an implementation
positive findings — what is genuinely solid, so fixes do not regress it
follow-up order — correctness and persisted/user-input surfaces first
```

Never: promote a hypothesis to blocking severity; cite a line you did not read in context; rate severity against a deployment model the product does not have; pad the report to look thorough — six verified findings outrank nine where three die on first contact.
