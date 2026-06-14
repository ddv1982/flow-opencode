# ADR: Source ownership and layer seams

Date: 2026-05-04  
Status: accepted (current-layer enforcement; simplified 2026-06-14)

## Context

Flow currently has meaningful code in `src/runtime`, `src/adapters`, `src/distribution`, and shared root config files. Earlier seam rules reserved empty `src/core` and `src/workflow` owners, but those owners made the architecture look larger than the code that exists. The checker now enforces only current layers. Add a new owner when code exists and the dependency rule is worth enforcing.

## Decision

Define the architectural seam contract as directed dependencies between source owners:

- `shared` (`src/config-shared.ts`) **must not** import from `runtime`, `distribution`, `adapters`, or root entrypoints.
- `runtime` **must not** import from `distribution`, `adapters`, or root entrypoints.
- `distribution` **must not** import from `runtime`, `adapters`, or root entrypoints.
- `adapters` **must not** import from root entrypoints.
- Root entrypoints (`src/index.ts`, `src/config.ts`, `src/cli.ts`) may compose outward for package exports and binaries, but inner layers may not import them as shortcut facades.
- `adapters` may depend on `runtime`, `distribution`, and `shared`.

Interpretation:

- `shared` owns host-neutral config projection and constants used by runtime, distribution, and adapters. It must stay pure and must not import implementation layers.
- `runtime` owns execution/session behavior and host-independent runtime logic.
- `distribution` owns package startup sync, ownership markers, update notice, and uninstall behavior. It may use shared config constants but must not depend on runtime or adapters.
- `adapters` own host/tool/plugin integration and bind host surfaces to runtime, distribution, and shared config.
- Root entrypoints are package API or binary entry files only. They are not dependency targets for implementation code.

## Enforcement mechanism

Use repo-native script checks (no new lint dependency):

- `scripts/cross-area/architecture-seams.mjs`
- Script scans `src/**` for relative import edges and classifies `shared`, `runtime`, `distribution`, `adapters`, and root entrypoints.
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

`src/prompts/**` and `src/audit/**` were governed projection surfaces outside this checker; both were deleted in the skills-first overhaul ([ADR 0001](../adr/0001-skills-first-flow-architecture.md)). Guidance now lives in hand-authored `skills/**` content, which is not a code layer in this seam graph.

## Notes and limitations

- The checker resolves **relative** imports, including common TypeScript/JavaScript file extensions and directory `index.*` imports. Non-relative alias imports are ignored.
- Type-only imports still count as layer dependencies by design.
- Source paths not classified into the owners above are ignored by this checker. Add a classification and tests before relying on this guardrail for a new source owner.
