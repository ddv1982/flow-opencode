# ADR: Core/runtime/adapter layer seams

Date: 2026-05-04  
Status: accepted (enforced baseline with diagnostic report mode)

## Context

Flow currently has meaningful code in `src/core`, `src/runtime`, and `src/adapters`; the seam checker also classifies `src/workflow` so removed facade paths cannot return as hidden bridges. We need explicit seams that can be checked mechanically so drift is visible before it becomes expensive. The repository has already reached the zero-violation baseline, so seam enforcement is now part of the hard maintainer gate rather than future work.

## Decision

Define the architectural seam contract as directed dependencies between layers:

- `core` **must not** import from `workflow`.
- `core` **must not** import from `runtime`.
- `core` **must not** import from `adapters`.
- `workflow` **must not** import from `runtime`.
- `workflow` **must not** import from `adapters`.
- `runtime` **must not** import from `adapters`.
- `adapters` may depend on `runtime` and `core`.

Interpretation:

- `core` owns host-agnostic protocol contracts. Shared IDs/types needed by core belong in `src/core/**`, not behind runtime-backed facades.
- `workflow` is reserved for future host-agnostic workflow contracts and must not bridge into runtime or adapters. Removed bridge facades must not be reintroduced as hidden `core -> workflow -> runtime` paths.
- `runtime` owns execution/session behavior and host-independent runtime logic.
- `adapters` own host/tool/plugin integration and bind host surfaces to runtime/core contracts.

## Enforcement mechanism

Use repo-native script checks (no new lint dependency):

- `scripts/cross-area/architecture-seams.mjs`
- Script scans `src/core`, `src/workflow`, `src/runtime`, and `src/adapters` for relative import edges.
- It reports blocked cross-layer edges listed above.

Modes:

- **Diagnostic report**: `bun run check:architecture-seams`
  - Exits success and prints any blocked edges for local investigation.
  - Does not define the pass/fail contract for mainline; enforce mode does.
- **Hard enforcement**: `bun run check:architecture-seams:enforce`
  - Fails on any blocked cross-layer import.
  - Runs inside the canonical local/mainline contract through `bun run check` and is also safe as a focused CI fast-fail lane.

## Operating policy

Seam enforcement is active now. Do not describe blocked seams as an accepted transitional baseline. A change that needs a new dependency edge must either move the shared contract into a seam-safe owner or update this ADR, the checker, and tests in the same reviewed change.

Use report mode for diagnosis and local inventory only. Use enforce mode when proving merge readiness, release readiness, or mainline health.

## Projection surfaces outside this seam checker

`src/prompts/**` and `src/audit/**` were governed projection surfaces outside this checker; both were deleted in the skills-first overhaul (`docs/plans/skills-first-overhaul-2026-06-12.md`). Guidance now lives in hand-authored `skills/**` content, which is not a code layer in this seam graph.

## Notes and limitations

- The checker currently resolves **relative** imports; non-relative alias imports are ignored.
- Type-only imports still count as layer dependencies by design.
- This ADR scopes only `core`/`workflow`/`runtime`/`adapters` seams; other areas (for example `persistence`) are unchanged in this policy.
