# Runtime subdomains (Phase 2 foundation)

Date: 2026-05-04

## Intent
Create explicit, low-risk runtime boundaries around current behavior hotspots without broad rewrites.

## Subdomains
- `src/runtime/lifecycle/`
  - Session lifecycle, history, persistence, and workspace-facing lifecycle entrypoints.
- `src/runtime/transitions/`
  - Planning/execution/review/recovery transition logic (existing bounded area).
- `src/runtime/rendering/`
  - Render entrypoints for index/feature docs and session-doc synchronization.
- `src/runtime/recovery/`
  - Completed-session storage/retrieval primitives and transition recovery exports.

## Entry points
- Runtime subdomain entrypoints are exposed from `src/runtime/lifecycle/index.ts`,
  `src/runtime/transitions/index.ts`, `src/runtime/rendering/index.ts`, and
  `src/runtime/recovery/index.ts`.
- Existing import continuity currently routes via `src/runtime/session.ts` (a thin re-export of `runtime/lifecycle`).

## Incremental migration path
1. Keep existing implementation files stable (no behavior rewrite in this phase).
2. Shift import sites to subdomain entrypoints as files are touched.
3. Optionally split large long-lived files behind subdomain facades in later phases.

## Known coupling hotspots (still unresolved)
- `session-lifecycle.ts` still coordinates filesystem movement + schema mutation + closure defaults in one module.
- `session-persistence.ts` still combines active/stored/completed movement with rendering coordination.
- `session-history.ts` still handles parsing, IO, and projection shaping in one pass.
