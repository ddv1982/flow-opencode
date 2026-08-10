# ADR 0013: Derived Assurance and Paired Value Measurement

Date: 2026-08-10

## Status

Accepted.

## Context

Close delivery did not label evidence tiers. Evals measured Flow conformance, not
whether Flow improved task correctness enough to justify its ceremony.

## Decision

Every close derives `delivery.assurance` from the closed Session or archive. Checks
label enforced, host-attested, and declared facts; limitations name model judgments.
Completion is supported or unsupported by recorded evidence. Other closures make no
claim; missing legacy declarations are not applicable.

Eval honesty stays independent. Reports add ungated operational counts.

`bun run benchmark` seed-shuffles the same hidden-graded model/task through Flow and
ordinary OpenCode. Durable closure versus an explicit control marker identifies
completion claims. Reports compare correctness, false completion, and cost. No delta
is gated before repeated baselines.

## Simplicity boundary

No Session v5 field, command, tool, score, or artifact is added. Measurements live
only in eval reports.

## Consequences

Close handoffs expose support without claiming universal correctness. Exact replay
yields the same view. An adjacent-defect scenario isolates review substance.

## Rejected alternatives

Persisted assurance duplicates state; a numeric confidence score mixes incomparable
evidence; visible model-written tests are not an independent benchmark oracle.
