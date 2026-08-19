# Phase 6. Reviewer budget

Back-link. [Overview](overview.md).

## Goal

Ordinary feature review stays a change gate. It does not run an unbounded
concurrency matrix unless the packet asked for one. Uncertainty stays
advisory. `adjacent-defect-refused` still fails a rubber-stamp pass.

## Changes

- `skills/flow-review/SKILL.md`. Continue the matrix after one blocker only
  when `assignment.packet.riskLenses` is non-empty or the feature packet
  summary includes a matrix. Otherwise inspect the changed artifacts, the
  supplied validation, and live `priorFindings`. Still report every
  problem. Still fail unprovable outcome claims.
- `tests/prompt-quality.test.ts`. Lock the conditional matrix sentence. Do
  not lower the reviewer absolute-rule budget in a way that drops
  `scopeBlocker` or `findingId`.

Use Cursor `create-skill`. Do not set a default `OPENCODE_FLOW_REVIEWER_STEPS`
in this phase. That is host policy and fights evals until phase 8 has a
baseline.

## Data structures

None. Packet remains `{ summary, riskLenses }`. The runtime still does not
parse a matrix.

## Verification

**Static.** `bun test tests/prompt-quality.test.ts`. Replay
`evals/cassettes` that pin `flow_feature_complete` on
`adjacent-defect-refused`.

**Runtime.** Cassette replay is the surface. A passing review of the
planted adjacent defect must still fail the scenario. The skill must no
longer tell every reviewer to finish a matrix that the packet did not
supply.
