# Runtime subdomains (Phase 2 foundation)

Date: 2026-05-04

## Intent
Create explicit, low-risk runtime boundaries around current behavior hotspots without broad rewrites.

## Subdomains
- `src/runtime/application/`
  - Flow Core, session action orchestration, workspace-runtime parsing, operator presenters, doctor/package-manager, and stack-standards application services.
- `src/runtime/domain/`
  - Runtime-owned governance, semantic invariants, final-review coverage, workflow policy, and review-scope accounting.
- `src/runtime/transitions/`
  - Planning/execution/review/recovery transition logic (existing bounded area).
- `src/runtime/lifecycle/`
  - Session lifecycle, history, persistence, and workspace-facing lifecycle entrypoints.
- `src/runtime/recovery/`
  - Completed-session storage/retrieval primitives and transition recovery exports.
- `src/runtime/rendering/`
  - Render entrypoints for index/feature docs and session-doc synchronization.
- `src/runtime/root files`
  - Stable public barrels, schemas, session/workspace/persistence helpers, rendering helpers, path/root guards, and shared utilities until they are safely moved behind subdomain facades.

## Entry points
- Runtime subdomain entrypoints are exposed from `src/runtime/lifecycle/index.ts`,
  `src/runtime/transitions/index.ts`, `src/runtime/rendering/index.ts`, and
  `src/runtime/recovery/index.ts`.
- Existing import continuity currently routes via `src/runtime/session.ts` (a thin re-export of `runtime/lifecycle`).

## Incremental migration path
1. Keep existing implementation files stable (no behavior rewrite in this phase).
2. Run `bun run report:runtime-simplification-metrics` before and after each simplification phase.
3. Record top-level runtime deltas plus touched `runtime.subdomains` entries in the PR or phase note; these metrics are diagnostic evidence, not a new merge blocker.
4. Shift import sites to subdomain entrypoints as files are touched.
5. Optionally split large long-lived files behind subdomain facades in later phases.

## Completed simplification notes
- Task-progress projection is now split from the broader summary projection surface behind `src/runtime/summary-task-progress.ts`, keeping summary/view-model behavior behind stable runtime exports.
- Final-review behavior validation is now extracted behind the `final-review-behavior-risks.ts` facade in `src/runtime/domain/final-review-behavior-validation.ts`, preserving the final-review behavior-risk contract while reducing the former largest hotspot.
- The 2026-05-13 post-pass metrics snapshot is diagnostic, not a new gate: runtime files `107`, runtime LOC `17,040`, large files `14`, top-5 LOC share `14.1%`, and seam violations `0`.
- The tradeoff for the completed split was `+2` files and `+35` LOC versus the pre-pass baseline (`105` files, `17,005` LOC), with large-file count unchanged and top-5 concentration reduced from `15.0%`.

## Known coupling hotspots (still unresolved)
- `session-lifecycle.ts` still coordinates filesystem movement + schema mutation + closure defaults in one module.
- `session-persistence.ts` still combines active/stored/completed movement with rendering coordination.
- `session-history.ts` still handles parsing, IO, and projection shaping in one pass.
- `session-presenters.ts`, `review-content-discovery.ts`, `review-scope-ledger-validation.ts`, and `reviewer-decision.ts` are the current largest measured runtime files after the completed projection/validation split.
