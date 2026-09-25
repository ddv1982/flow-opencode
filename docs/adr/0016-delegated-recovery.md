# ADR 0016. Evaluate recovery advice before runtime integration

Date is 2026-09-21.

## Status

Accepted for evaluation tooling. Runtime integration remains proposed.

## Context

Flow permits one automatic retry after an in-scope failed review. Later failures
and scope blockers require user direction. The existing Jev experiment measures
goal alignment, not recovery decisions. Its advisory veto cannot grant authority.

## Decision

Keep JEV-1 under `evals/`. Add no Flow command, tool, role, or Session v5 field.
Separate immutable episodes, hidden labels, candidate advice, and observed
outcomes. A pure evaluator regrades retained evidence without provider calls.
Compare manager-only and Jev-assisted decisions under identical policy and inputs.

Freeze task splits, model, rubric, and thresholds before holdout collection.
Count one canonical observation per originating task, separately for each action
class. Synthetic data, missing pairs, and insufficient samples cannot promote.
Imported live receipts require independent review. They are attestations, not
proof of provider execution.

Bound provider attempts, deadlines, response bytes, and spending reservations.
Preserve alignment scoring semantics separately. Missing usage remains unknown.
A correct classification does not establish successful repair or faster work.

## Consequences

A measured negative result can end the Jev proposal. Missing credentials remain
unmeasured evidence. Runtime phases require a passing comparison and later live
qualification. They must preserve explicit user direction and the existing first
retry, while enforcing delegated permission before mutation. Advice grants no
permission. Validation and independent review remain mandatory.

The planned record receives a 2 KB allocation in the decision-record budget.
See the [plan](../../.agents/plans/16-jev-autonomous-decisions/README.md) and
[research](../../.agents/plans/16-jev-autonomous-decisions/research.md) for details.
