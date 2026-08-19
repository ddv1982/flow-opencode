# Phase 3. Delivery uses the same digest

Back-link. [Overview](overview.md).

## Goal

Close delivery stops pretending the last passing review is the survey.
`formatReport` prints the phase 1 digest. Historical blockers survive a
later pass.

## Changes

- `src/application/delivery.ts`. `DeliveryProjection` includes the same
  digest. `formatReport` lists live rows first, then historical rows. Keep
  per-feature attempt and latest state lines.
- `tests/runtime-close.test.ts`. A completed close after a failed then
  passing retry must not print only `terminal findings: none`. A deferred
  close of a blocked run must list the blockers. Untouched features stay
  empty.

Do not persist delivery. Recompute from the closed session, as today.

## Data structures

Reuse `FindingsDigest`. Drop the per-feature `terminalFindings` strip if
every caller can read the digest. If a test still names
`terminalFindings`, keep it as a view over live rows of that feature so
this phase stays two files plus tests, not a caller migration.

## Verification

**Static.** `bun test tests/runtime-close.test.ts`. `bun run typecheck`.

**Runtime.** In-memory close harness is the surface. Completed close after
retry. Deferred close while blocked. Both reports include the blocking
summary from the failed attempt.
