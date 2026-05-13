# Runtime Complexity Baseline

This document captures measurable simplification baselines and the recurring Phase 4 delete-first loop.

## Measurement window

- Baseline date: 2026-05-04
- Churn window: trailing 30 days (`FLOW_SIMPLIFICATION_WINDOW_DAYS`)
- Source of truth: local repo metrics script + CI checks
- Collector: `bun run report:runtime-simplification-metrics`
- Runtime subdomain breakdown: diagnostic-only `runtime.subdomains` in the metrics report (`application`, `domain`, `transitions`, `lifecycle`, `recovery`, `rendering`, `root`, and any future `src/runtime/<subdomain>/` directory)

## KPI baseline table (captured 2026-05-13)

Current canonical snapshot (captured `2026-05-13T06:00:43.783Z`): runtime files `107`, runtime LOC `17,040`, runtime files >= 300 LOC `14`, top-5 LOC share `14.1%`, architecture seam violations `0`.

The preceding same-pass baseline was runtime files `105`, runtime LOC `17,005`, runtime files >= 300 LOC `14`, top-5 LOC share `15.0%`, with `final-review-behavior-risks.ts` as the largest hotspot at `571` LOC. The completed task-progress projection split and final-review behavior validation extraction traded `+2` runtime files and `+35` LOC for the same large-file count, lower top-5 concentration, and a former largest hotspot split behind its facade.

Historical pass snapshots are retained in investigation logs; this document tracks the current planning baseline. Historical/archive docs under `docs/releases/**` and `docs/investigations/**` may preserve old names or measurements; current architecture docs and `docs/maintainer-contract.md` are the source of truth for active contracts.

| KPI | Baseline | Target direction | Measurement method | Notes |
| --- | --- | --- | --- | --- |
| Architecture seam violations | `0` | Hold at `0` | `bun run check:architecture-seams:enforce` | Enforced in CI |
| Runtime TypeScript file count | `107` | Down | `report:runtime-simplification-metrics` | Current pass accepted `+2` files for smaller hotspots |
| Runtime LOC | `17,040` | Down | `report:runtime-simplification-metrics` | Current pass accepted `+35` LOC for lower concentration |
| Runtime files >= 300 LOC | `14` | Down | `report:runtime-simplification-metrics` | Unchanged from pre-pass baseline |
| Top-5 runtime-file LOC share | `14.1%` | Down | `report:runtime-simplification-metrics` | Improved from `15.0%` pre-pass |
| Runtime churn hotspot leader | `src/runtime/schema.ts` (26 touches / 30d) | Down | `git log` via metrics script | Next churn leaders: `transitions/plan.ts` (18), `session-lifecycle.ts` (17), `session-workspace.ts` (17), `summary.ts` (14) |
| Runtime subdomain LOC/file distribution | See 2026-05-13 subdomain snapshot below | Down or localized by touched subdomain | `report:runtime-simplification-metrics` | Diagnostic-only; helps prove localized improvement without adding a hard gate |
| Fast test lane runtime | `~0.22s` local | Hold low | timed `bun run test:fast` | Keep this as refactor safety lane |
| Replay/integration lane runtime | `~0.15s` local | Hold low | timed `bun run test:replay` | Keep replay lane stable |

## 2026-05-13 runtime simplification snapshot

Largest runtime files after the task-progress projection split and final-review behavior validation extraction:

1. `src/runtime/application/session-presenters.ts` — `553` LOC
2. `src/runtime/domain/review-content-discovery.ts` — `485` LOC
3. `src/runtime/domain/review-scope-ledger-validation.ts` — `469` LOC
4. `src/runtime/domain/reviewer-decision.ts` — `465` LOC
5. `src/runtime/domain/final-review-behavior-validation.ts` — `424` LOC

Runtime subdomain snapshot (`fileCount` / `totalLoc` / large files):

| Subdomain | Files | LOC | Files >= 300 LOC |
| --- | ---: | ---: | ---: |
| `application` | `30` | `4,644` | `4` |
| `domain` | `21` | `4,006` | `5` |
| `json` | `2` | `431` | `0` |
| `lifecycle` | `1` | `34` | `0` |
| `recovery` | `2` | `172` | `0` |
| `rendering` | `1` | `8` | `0` |
| `root` | `37` | `5,140` | `2` |
| `transitions` | `13` | `2,605` | `3` |

## Phase 4 execution loop (delete-first simplification)

Repeat weekly (or each simplification PR):

1. Run `bun run report:runtime-simplification-metrics`.
2. Pick **one** hotspot file (largest LOC or highest churn).
3. Apply smallest safe simplification pass:
   - delete dead branches/helpers,
   - move stable contracts to seam-safe modules,
   - split only when split reduces coupling and file size.
4. Verify with `bun run test:fast` + targeted suite for touched area.
5. Record before/after deltas in PR description.

For each simplification phase, capture the metrics report immediately before and after the change. Record deltas for the top-level runtime fields (`fileCount`, `totalLoc`, `largeFileCount`, `top5LocSharePercent`, `largestFiles`, `topChurnFiles`) and the touched entries under `runtime.subdomains`. The report uses deterministic ordering for file lists, largest-file ties, churn ties, and subdomains so PR deltas can be reviewed without order noise. Treat subdomain movement as diagnostic evidence only: it explains the local effect of a refactor, while `check:architecture-seams:enforce` remains the hard seam gate.

## Current top hotspot candidates

1. `src/runtime/application/session-presenters.ts` (largest file: `553` LOC)
2. `src/runtime/domain/review-content-discovery.ts` (large file: `485` LOC)
3. `src/runtime/domain/review-scope-ledger-validation.ts` (large file: `469` LOC)
4. `src/runtime/domain/reviewer-decision.ts` (large file: `465` LOC)
5. `src/runtime/schema.ts` (highest churn: `26` touches / 30d)

## Guardrails

- Seams remain enforced (`check:architecture-seams:enforce`).
- Generated drift remains enforced (`check:generated-drift`).
- Boundary report remains informational (`check:boundary-report`) alongside enforced seam checks.
