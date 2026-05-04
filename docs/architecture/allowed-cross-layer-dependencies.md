# ADR: Core/runtime/adapter layer seams (Phase 1)

Date: 2026-05-04  
Status: accepted (Phase 1 baseline, report-first)

## Context

Flow currently has meaningful code in `src/core`, `src/runtime`, and `src/adapters`. We need explicit seams that can be checked mechanically so drift is visible before it becomes expensive.

## Decision

Define the architectural seam contract as directed dependencies between layers:

- `core` **must not** import from `runtime`.
- `core` **must not** import from `adapters`.
- `runtime` **must not** import from `adapters`.
- `adapters` may depend on `runtime` and `core`.

Interpretation:

- `core` owns domain/protocol/workflow contracts and should stay host-agnostic.
- `runtime` owns execution/session behavior and host-independent runtime logic.
- `adapters` own host/tool/plugin integration and bind host surfaces to runtime/core contracts.

## Enforcement mechanism (Phase 1)

Use repo-native script checks (no new lint dependency):

- `scripts/cross-area/architecture-seams.mjs`
- Script scans `src/core`, `src/runtime`, `src/adapters` for relative import edges.
- It reports blocked cross-layer edges listed above.

Modes:

- **Report-only (default)**: `bun run check:architecture-seams`
  - Always exits success, prints violations.
- **Hard-fail**: `bun run check:architecture-seams:enforce`
  - Fails on any violation.

## Why report-first

The current tree contains known pre-existing seam violations (especially `core -> runtime`). Report mode makes drift visible immediately while allowing phased remediation.

## Switch-to-enforce path

1. Run `bun run check:architecture-seams` and capture baseline violations.
2. Remove violations by extracting shared types/contracts from runtime-owned files into seam-safe modules (likely `src/core` or neutral boundary modules).
3. Keep running targeted runtime/core tests during each slice.
4. When violations reach zero, switch CI/check pipeline to `check:architecture-seams:enforce`.
5. Keep report command for local diagnostics.

## Notes and limitations

- Phase 1 checker currently resolves **relative** imports; non-relative alias imports are ignored.
- Type-only imports still count as layer dependencies by design.
- This ADR scopes only `core`/`runtime`/`adapters` seams; other areas (for example `prompts`, `audit`, `persistence`) are unchanged in this phase.
