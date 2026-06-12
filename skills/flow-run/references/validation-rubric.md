# Validation evidence rubric

What counts as validation evidence when completing a Flow feature, strongest first. Record the strongest tier you can actually reach, and name the tier honestly.

## Evidence tiers

1. **Executed checks with observed output.** Tests, typecheck, lint, build — actually run, with the command and outcome recorded (e.g. `pnpm test middleware` → 14 passed). New behavior needs at least one check that *fails without the change and passes with it*; a suite that was already green proves nothing about your change.
2. **Manual verification with a reproducible recipe.** You ran the app/CLI/endpoint and observed the new behavior; the evidence records the exact steps and observed result so a reviewer can repeat them. Use when behavior is not practically unit-testable (TUI output, external service wiring).
3. **Indirect verification.** Typecheck/lint/build pass but nothing exercises the changed behavior itself. Acceptable alone only for changes with no behavior (comments, docs, renames fully covered by the compiler).
4. **Inspection only.** You read the code carefully. This is not validation. Record it only as a gap entry: what could not run and why.

## Rules

- **Targeted before completing any feature; broad on the last one.** Targeted = the checks that exercise changed code. Broad = the repo's full standard gate (the commands recorded in the plan's stack profile, e.g. `pnpm typecheck && pnpm test`).
- **Evidence is concrete.** Command, scope, outcome. "Tests pass" is not evidence; `bun test tests/run/ → 23 pass 0 fail` is.
- **Failures are evidence too.** A known-flaky or pre-existing failure must be recorded and identified as pre-existing (verify against an unmodified baseline before claiming that).
- **Gaps are first-class.** When a check cannot run, record: what should have run, why it could not, what you ran instead, and the residual risk. Never silently downgrade.
- **Never fabricate.** No invented outputs, no trimming failures from results, no claiming a run you did not perform. A fabricated pass poisons the session's whole evidence chain.

## Worked examples

**Acceptable (tier 1):**
> Added `RateLimiter.reset()`. New tests in `tests/middleware/rate-limit.test.ts` (4 cases, fail on main, pass here). Ran `pnpm test middleware` → 18 passed / 0 failed; `pnpm typecheck` → clean.

**Acceptable with gap (tier 2 + gap):**
> Wired Redis store. Unit tests with mocked client pass (`pnpm test stores` → 9/9). Gap: no live two-instance check — no Redis in this environment; verified instead that the same mock sequence drives the in-memory store identically. Residual risk: real-Redis serialization differences.

**Not acceptable:**
> Implemented the feature and reviewed the code carefully; it follows existing patterns and should work.

No execution, no recipe, no gap analysis — this is tier 4 and the runtime-recorded evidence must not dress it up as more.
