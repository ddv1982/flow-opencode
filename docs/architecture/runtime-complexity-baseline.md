# Runtime Complexity Baseline

This document captures measurable simplification baselines and the recurring Phase 4 delete-first loop.

## Measurement window

- Baseline date: 2026-05-04
- Churn window: trailing 30 days (`FLOW_SIMPLIFICATION_WINDOW_DAYS`)
- Source of truth: local repo metrics script + CI checks
- Collector: `bun run report:runtime-simplification-metrics`
- Runtime subdomain breakdown: diagnostic-only `runtime.subdomains` in the metrics report (`application`, `domain`, `transitions`, `lifecycle`, `recovery`, `rendering`, `root`, and any future `src/runtime/<subdomain>/` directory)

## KPI baseline table (captured 2026-05-24)

Current canonical snapshot (captured `2026-05-24T12:31:45.180Z`): runtime files `128`, runtime LOC `17,850`, runtime files >= 300 LOC `3`, top-5 LOC share `8.5%`, architecture seam violations `0`. The May 24 simplification pass accepted a small runtime file-count and total-LOC increase to move review-gate, history-presenter, detailed-final-review, and behavior-schema internals behind stable facades while cutting hotspot concentration.

Historical same-pass snapshots remain useful for trend comparison only. The 2026-05-13 current snapshot was runtime files `107`, runtime LOC `17,040`, runtime files >= 300 LOC `14`, top-5 LOC share `14.1%`, architecture seam violations `0`. The preceding 2026-05-13 baseline was runtime files `105`, runtime LOC `17,005`, runtime files >= 300 LOC `14`, top-5 LOC share `15.0%`, with `final-review-behavior-risks.ts` as the largest hotspot at `571` LOC.

Historical pass snapshots are retained in investigation logs; this document tracks the current planning baseline. Historical/archive docs under `docs/releases/**` and `docs/investigations/**` may preserve old names or measurements; current architecture docs and `docs/maintainer-contract.md` are the source of truth for active contracts.

| KPI | Baseline | Target direction | Measurement method | Notes |
| --- | --- | --- | --- | --- |
| Architecture seam violations | `0` | Hold at `0` | `bun run check:architecture-seams:enforce` | Enforced in CI |
| Runtime TypeScript file count | `128` | Down | `report:runtime-simplification-metrics` | Current refactors trade more files for smaller hotspots |
| Runtime LOC | `17,850` | Down | `report:runtime-simplification-metrics` | Fresh local measurement on 2026-05-24 |
| Runtime files >= 300 LOC | `3` | Down | `report:runtime-simplification-metrics` | Improved from `7` on 2026-05-14 |
| Top-5 runtime-file LOC share | `8.5%` | Down | `report:runtime-simplification-metrics` | Improved from `9.7%` on 2026-05-14 |
| Runtime churn hotspot leader | `src/runtime/schema.ts` (17 touches / 30d) | Down | `git log` via metrics script | Next churn leaders: `session-presenters.ts` (13), `domain/index.ts` (13), `session-actions.ts` (11), `transitions/plan.ts` (11) |
| Runtime subdomain LOC/file distribution | See 2026-05-24 subdomain snapshot below | Down or localized by touched subdomain | `report:runtime-simplification-metrics` | Diagnostic-only; helps prove localized improvement without adding a hard gate |
| Fast test lane runtime | `~0.22s` local | Hold low | timed `bun run test:fast` | Keep this as refactor safety lane |
| Replay/integration lane runtime | `~0.15s` local | Hold low | timed `bun run test:replay` | Keep replay lane stable |

## 2026-05-24 runtime simplification snapshot

Largest runtime files after the latest runtime simplification pass:

1. `src/runtime/application/session-actions.ts` — `326` LOC
2. `src/runtime/transitions/completion-gates.ts` — `308` LOC
3. `src/runtime/application/doctor-checks.ts` — `305` LOC
4. `src/runtime/transitions/execution-completion-normalization.ts` — `295` LOC
5. `src/runtime/transitions/plan.ts` — `292` LOC

Runtime subdomain snapshot (`fileCount` / `totalLoc` / large files):

| Subdomain | Files | LOC | Files >= 300 LOC |
| --- | ---: | ---: | ---: |
| `application` | `35` | `4,885` | `2` |
| `domain` | `31` | `4,254` | `0` |
| `json` | `2` | `431` | `0` |
| `lifecycle` | `1` | `34` | `0` |
| `recovery` | `2` | `153` | `0` |
| `rendering` | `1` | `8` | `0` |
| `root` | `42` | `5,470` | `0` |
| `transitions` | `14` | `2,615` | `1` |

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

1. `src/runtime/application/session-actions.ts` (large file: `326` LOC)
2. `src/runtime/transitions/completion-gates.ts` (large file: `308` LOC)
3. `src/runtime/application/doctor-checks.ts` (large file: `305` LOC)
4. `src/runtime/transitions/execution-completion-normalization.ts` (near-threshold file: `295` LOC)
5. `src/runtime/schema.ts` (highest churn: `17` touches / 30d)

## Guardrails

- Seams remain enforced (`check:architecture-seams:enforce`).
- Generated drift remains enforced (`check:generated-drift`).
- Boundary report remains informational (`check:boundary-report`) alongside enforced seam checks.
