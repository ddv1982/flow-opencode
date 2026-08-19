# Phase 8. Eval

Back-link. [Overview](overview.md).

## Goal

A scenario fails when `/flow-auto` on an inspect goal ends with no
user-visible findings list. The suite starts measuring the workflow the
user actually ran.

## Changes

- `evals/scenarios.ts`. Add `inspect-goal-delivers-findings`. Fixture a
  small repo with one planted, observable defect. Command is `/flow-auto`
  asking for a review of that area, no implementation authority to fix it.
  The check fails if `finalText` and any close `delivery.report` both omit
  the defect, and if compact `findingsDigest` is empty at stop. Asking the
  user how to close after listing the finding is an accepted end.
- `tests/eval-scenario-checks.test.ts`. Unit-test that check against
  synthetic outcomes. Pass with a digest that names the plant. Fail with
  a completed close and `terminal findings: none`. Fail with a checkpoint
  and empty compact digest.
- `evals/README.md`. One row in the scenario table. Ungated until a
  matrix exists, same pattern as other new scenarios.

Do not weaken `adjacent-defect-refused`.

## Data structures

Reuse compact `findingsDigest` and `delivery.report`. The grader reads
those plus `finalText`. No new Session field.

## Verification

**Static.** `bun test tests/eval-scenario-checks.test.ts`. `bun run check`.

**Runtime.** The scenario check function on fixtures is the surface. A
paid cassette can wait. Land a hand-written cassette only if replay needs
one to pin a refusal, as `plan-only-stops` does for workers.
