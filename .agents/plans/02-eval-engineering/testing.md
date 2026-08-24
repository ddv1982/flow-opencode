# Testing

[Back to overview](overview.md)

## Project

Run `bun run check` after every phase. Keep `bun run replay` green whenever replay
or shared report code changes. Run `bun run smoke:live` for packed-host or release
boundary changes.

## Per phase

| Phase | Static gate | Runtime gate |
| --- | --- | --- |
| 0 | probe and live-smoke contract | pinned host field map or explicit unsupported capability |
| 1 | report and catalog tests | strict parse of valid v2 and refusal of legacy or partial evidence |
| 2 | report and analysis tests | synthetic rows exercise all three verdicts and scored escalation |
| 3 | reporting tests and full check | one paid case binds actual tarball and observed actor limits |
| 4 | reporting tests and full check | injected crashes resume without replacing or truncating evidence |
| 5 | qualification, release metadata, workflow tests | explicit-path weekly command reaches v2 decision |
| 6 | reviewer eval and full check | paid defect and clean pilot, still report-only |
| 7 | paired experiment and full check | label-scanned low-budget paired pilot |
| 8 | benchmark reporting and full check | equal semantics compare across different artifacts |
| 9 | release metadata and full check | maintainer completes exact-artifact OpenCode canary and tag dry-run |

## Verdicts

Each phase records `VERIFIED`, `NOT VERIFIED`, or `INCONCLUSIVE` in the decision
trail. Only `VERIFIED` advances, except the final Phase 9 canary can remain pending
without invalidating the already verified infrastructure phases. Phase 9 alone
requires a human OpenCode session. Phases 3, 6, and 7 are paid automated pilots.
