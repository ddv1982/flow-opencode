# Parallel Orchestration

Use when Flow work is broad but splits into independent read-only planning,
research, migration, audit, review, or validation slices. Skip small,
overlapping, shared-state, or locally blocked work.

Parallel work is not a runtime mode. The manager owns synthesis and every
state-changing `flow_*` call.

## Manager loop

1. `flow_status` if a session exists.
2. Profile serially: scripts, structure, state paths, files, tests, docs,
   constraints.
3. Pick one split axis: path/module, risk lens, research stream, data range, or
   validation command.
4. Give each worker one slice, exclusions, and the handoff format.
5. Reconcile candidate evidence; run second waves only for material gaps.
6. Synthesize one Flow artifact; never forward raw handoffs.

Worker rules: read-only; never edit `.flow/**`; never call `flow_plan_save`,
`flow_plan_approve`, `flow_run_start`, `flow_feature_complete`,
`flow_review_record`, or `flow_session`; never approve, complete, record
reviews, close sessions, decide severity, or compare sibling slices. One worker
= one slice = one handoff.

Parallel implementation needs isolated worktrees or disjoint ownership; the
manager routes the chosen result through one active feature.

## Handoff

Ask for exactly: `Status` (`success|partial|blocked`), `Scope`, `Findings and
evidence`, `Sources`, `Open questions / gaps`, `Suggested Flow follow-ups`.
Evidence needs file:line, command summary, URL, version, or metric.

- Planning: save evidence only to profile, research, findings, requirements,
  decisions, targets, scopes, or notes.
- Execution: evidence informs the active feature; completion is manager-owned.
- Validation: count runs only with command, scope, environment, outcome.
- Review: workers gather evidence; reviewer owns severity, dedupe, refutation,
  and `flow_review_record`.
- Audit: suspicious lines stay candidates until mitigations are traced.

Execution stays serial: one approved feature until complete, blocked, or reset.
