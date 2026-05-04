# Runtime Complexity Baseline

This document captures measurable simplification baselines and the recurring Phase 4 delete-first loop.

## Measurement window

- Baseline date: 2026-05-04
- Churn window: trailing 30 days (`FLOW_SIMPLIFICATION_WINDOW_DAYS`)
- Source of truth: local repo metrics script + CI checks
- Collector: `bun run report:runtime-simplification-metrics`

## KPI baseline table (captured 2026-05-04)

Current canonical snapshot (latest same-day capture): runtime files `89`, runtime LOC `11,700`, runtime files >= 300 LOC `1`, top-5 LOC share `12.7%`.

Historical pass snapshots are retained in investigation logs; this document tracks the current planning baseline.

| KPI | Baseline | Target direction | Measurement method | Notes |
| --- | --- | --- | --- | --- |
| Architecture seam violations | `0` | Hold at `0` | `bun run check:architecture-seams:enforce` | Enforced in CI |
| Runtime TypeScript file count | `89` | Down | `report:runtime-simplification-metrics` | Reduce surface area where possible |
| Runtime LOC | `11,700` | Down | `report:runtime-simplification-metrics` | Delete-first before adding abstractions |
| Runtime files >= 300 LOC | `1` | Down | `report:runtime-simplification-metrics` | Primary simplification pressure metric |
| Top-5 runtime-file LOC share | `12.7%` | Down | `report:runtime-simplification-metrics` | Hotspot concentration metric |
| Runtime churn hotspot leader | `src/runtime/schema.ts` (19 touches / 30d) | Down | `git log` via metrics script | Use for next split/deletion candidate |
| Fast test lane runtime | `~0.22s` local | Hold low | timed `bun run test:fast` | Keep this as refactor safety lane |
| Replay/integration lane runtime | `~0.15s` local | Hold low | timed `bun run test:replay` | Keep replay lane stable |

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

## Current top hotspot candidates

1. `src/runtime/schema.ts` (highest churn)
2. `src/runtime/session-workspace.ts` (high churn)
3. `src/runtime/session-lifecycle.ts` (high churn)
4. `src/runtime/transitions/plan.ts` (high churn)
5. `src/runtime/render-index-sections.ts` (high churn)

## Guardrails

- Seams remain enforced (`check:architecture-seams:enforce`).
- Generated drift remains enforced (`check:generated-drift`).
- Boundary report remains informational (`check:boundary-report`) alongside enforced seam checks.
