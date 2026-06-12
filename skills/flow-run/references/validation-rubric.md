# Validation evidence rubric

What counts as validation evidence when completing a Flow feature, strongest first. Record the strongest tier you can actually reach, and name the tier honestly.

## Evidence tiers

1. **Executed checks with observed output.** Tests, typecheck, lint, build — actually run, with the command and outcome recorded (e.g. `pnpm test middleware` → 14 passed). New behavior needs at least one check that *fails without the change and passes with it*; a suite that was already green proves nothing about your change.
2. **Manual verification with a reproducible recipe.** You ran the app/CLI/endpoint and observed the new behavior; the evidence records the exact steps and observed result so a reviewer can repeat them. Use when behavior is not practically unit-testable (TUI output, external service wiring).
3. **Indirect verification.** Typecheck/lint/build pass but nothing exercises the changed behavior itself. Acceptable alone only for changes with no behavior (comments, docs, renames fully covered by the compiler).
4. **Inspection only.** You read the code carefully. This is not validation. Record it only as a gap entry: what could not run and why.

## Rules

- **Targeted before completing any feature; broad on the last one.** Targeted = the checks that exercise changed code. Broad = the repo's full standard gate (the commands recorded in the plan's stack profile, e.g. `pnpm typecheck && pnpm test`). The runtime enforces this via `validationScope`: `"targeted"` on a normal feature, `"broad"` on the one that completes the session.
- **Evidence is concrete.** Command, scope, outcome. "Tests pass" is not evidence; `bun test tests/run/ → 23 pass 0 fail` is.
- **Failures are evidence too.** A known-flaky or pre-existing failure must be recorded and identified as pre-existing (verify against an unmodified baseline before claiming that). On a completing call every `validationRun` entry must have `status: "passed"`, so pre-existing failures live in the summary and `featureResult.notes`, never relabeled as passes.
- **Gaps are first-class.** When a check cannot run, record: what should have run, why it could not, what you ran instead, and the residual risk. Never silently downgrade.
- **Never fabricate.** No invented outputs, no trimming failures from results, no claiming a run you did not perform. A fabricated pass poisons the session's whole evidence chain.

## Required tier by change type

- **Behavior change (code paths, APIs, logic):** tier 1, including at least one check that fails without the change.
- **Wiring to externals (services, processes, TUI/CLI surfaces):** tier 1 where mockable, plus tier 2 for the live edge — or an explicit gap.
- **Config / build / CI changes:** tier 2 — actually exercise the configured path (run the build, the affected script, the lint with the new rule) and record what you observed; "the file parses" is tier 3.
- **Docs, comments, renames fully covered by the compiler:** tier 3 suffices (typecheck/lint/build clean).

## Recording evidence in `flow_feature_complete`

Evidence lands in the completion payload: `validationRun` entries of `{command, status, summary}` (summary = scope + observed outcome, e.g. `"18 passed / 0 failed, includes 4 new rate-limit cases"`), `validationScope`, and a `featureReview` you only mark `passed` after genuinely re-reading your own diff. Abridged:

```json
{
  "contractVersion": "1",
  "status": "ok",
  "summary": "Rate-limit middleware: 429 + Retry-After beyond N/min per key.",
  "artifactsChanged": [{ "path": "src/middleware/rate-limit.ts" }],
  "validationRun": [
    { "command": "pnpm test middleware", "status": "passed", "summary": "18 passed / 0 failed; 4 new cases fail on main" },
    { "command": "pnpm typecheck", "status": "passed", "summary": "clean" }
  ],
  "validationScope": "targeted",
  "nextStep": "Start redis-store",
  "featureResult": { "featureId": "rate-limit-middleware", "verificationStatus": "passed" },
  "featureReview": { "status": "passed", "summary": "Diff re-read; scope clean, no debug artifacts.", "blockingFindings": [] }
}
```

## When validation fails mid-feature

- **First failure:** diagnose and fix within the feature, re-run the failed check plus anything the fix touched. A fix-then-revalidate cycle is normal, not a blocker.
- **The failure reveals a wrong assumption** (wrong design, wrong interface, plan-level miss): do not pile patches on it. Reset via `flow_feature_complete` with `{ "reset": true, "featureId": "..." }`, then re-run with the corrected approach or propose a plan revision.
- **Second failure for the same reason:** stop and report to the user — what failed, why, what you tried. Looping a third time burns budget on a problem that needs a human or a replan.
- **Genuinely blocked** (external dependency, missing access, ambiguous requirement): report `status: "needs_input"` with an honest `outcome` (e.g. `kind: "blocked_external"` or `"needs_operator_input"`) instead of forcing a completion.

## Worked examples

**Acceptable (tier 1):**
> Added `RateLimiter.reset()`. New tests in `tests/middleware/rate-limit.test.ts` (4 cases, fail on main, pass here). Ran `pnpm test middleware` → 18 passed / 0 failed; `pnpm typecheck` → clean.

**Acceptable with gap (tier 2 + gap):**
> Wired Redis store. Unit tests with mocked client pass (`pnpm test stores` → 9/9). Gap: no live two-instance check — no Redis in this environment; verified instead that the same mock sequence drives the in-memory store identically. Residual risk: real-Redis serialization differences.

**Not acceptable:**
> Implemented the feature and reviewed the code carefully; it follows existing patterns and should work.

No execution, no recipe, no gap analysis — this is tier 4 and the runtime-recorded evidence must not dress it up as more.
