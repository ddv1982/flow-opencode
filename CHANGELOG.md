# Changelog

## [1.0.0] - 2026-04-18

### Highlights

Flow 1.0.0 delivers the full six-milestone overhaul proposed for the OpenCode plugin: stricter foundations, correctness hardening for session persistence and validation, schema unification, a transition-layer refactor, measured rendering and bundle work, and final alignment with current OpenCode plugin APIs and release workflows. Measured wins from the shipped benchmarks include a bundled runtime reduced to 455,166 bytes, transition reducers improved by 51.13% to 90.38% versus baseline, and a warm `saveSession` path that stays at 777.70 µs average while the unchanged-session write path remains under the ≤ 1.0 ms release gate.

### Added

- Added the `/flow-history show <session-id>` control command so archived and active stored sessions can be inspected directly by id.
- Added canonical installation support for `~/.config/opencode/plugins/flow.js` while preserving legacy installs at `~/.opencode/plugins/flow.js` when they already exist.
- Added a `mitata` benchmark harness under `bench/` with `bun run bench` for the full suite and `bun run bench:smoke` for the CI-sized reducer smoke gate.
- Added committed benchmark baselines in `bench/BASELINE.md` and post-optimization comparisons in `bench/RESULTS.md`.
- Added golden markdown fixtures under `tests/__fixtures__/render/` for empty, single-feature, mid-execution, 20-feature, all-completed, and 100-feature session shapes.
- Added a pack-invariants verification script and test coverage to keep published package contents and CHANGELOG versioning in sync.
- Added the `experimental.session.compacting` hook so Flow session context is appended during OpenCode session compaction.
- Added metadata emission for all 15 Flow tools through `context.metadata({ title, metadata })` without changing the string-returning tool contract.
- Added plugin-internal logging via `ctx.client.app.log(...)` in the plugin hot path.
- Added a committed `CHANGELOG.md` as a release artifact shipped with the package.
- Added a Migration / Upgrade section to the README to explain the canonical plugin path and legacy compatibility behavior.
- Added a GitHub release workflow that extracts the matching CHANGELOG section and uses it to populate release notes on tag pushes.

### Changed

- Tightened TypeScript with six additional strict flags: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, and `isolatedModules`.
- Adopted Biome as the repo-wide formatter and linter, and wired `bun run lint` plus formatter checks into the project validation flow.
- Consolidated transition logic from the earlier 15-file layout into six transition modules while preserving the public transition surface.
- Unified runtime schemas under `src/runtime/schema.ts` so tool-layer shapes derive from the runtime source of truth instead of duplicating schema definitions.
- Centralized slash-command identifiers and shared error helpers in `src/runtime/constants.ts` and `src/runtime/errors.ts`.
- Reworked session persistence to use atomic temp-file-plus-rename writes with a per-worktree in-process save lock.
- Hardened path handling so session ids, feature ids, and derived paths reject traversal and malformed components before filesystem access.
- Made workspace setup idempotent, including `.flow/.gitignore` maintenance that preserves custom lines while restoring required entries.
- Switched archive naming to millisecond-precision timestamps with collision retry suffixes and matching history parsing.
- Removed repeated runtime reparsing by parsing tool arguments once at the boundary and operating on typed runtime data internally.
- Replaced broad transition cloning with narrower immutable updates in the reducer hot path.
- Added incremental markdown rendering with hash-based `writeDocIfChanged` behavior so unchanged saves skip redundant doc writes.
- Added read caching keyed by session file metadata and workspace-preparation caching to reduce repeated filesystem work.
- Optimized the bundle by externalizing the `@opencode-ai/plugin` peer dependency and building with syntax and whitespace minification plus external sourcemaps.
- Updated `bun run check` ordering so the build step runs before tests, matching fresh-CI release conditions where `dist/` does not exist yet.
- Restricted publishable package contents to `dist/`, `LICENSE`, `README.md`, and `CHANGELOG.md` plus npm's auto-included `package.json`.

### Breaking

- New installs now target `~/.config/opencode/plugins/flow.js` as the canonical plugin path, while legacy `~/.opencode/plugins/flow.js` installs remain compatibility-only.
- The mission intentionally introduced `.flow/` storage and session-format changes, so users may need to restart active Flow sessions after upgrading to 1.0.0.
- Flow tools now emit UI metadata via the `context.metadata({ title, metadata })` side effect and return strings, rather than producing the earlier `{ title, metadata, output }`-style contract.
- The `bun run check` pipeline now builds before testing, which changes the execution order expected by downstream automation.

### Fixed

- Fixed `clearExecution` immutability so transition helpers no longer mutate caller-owned execution state.
- Fixed `toArchiveTimestamp` formatting to strip the trailing `Z` while preserving millisecond precision for archive directory names.
- Fixed recovery resolution-hint parity so recovery metadata remains byte-for-byte aligned with the documented contract.
- Fixed incremental-render idempotency for VAL-PERF-006 by removing the stray `- updated:` line from unchanged index markdown output.
- Fixed fixture determinism by adding `setNowIsoOverride`-based time control for snapshot and benchmark-adjacent tests.

### Performance

- Bundle size dropped from the original pre-mission ~0.99 MB baseline to a 455,166-byte release asset.
- `transition reducer / applyPlan` improved from 19.97 µs to 9.76 µs average (-51.13%).
- `transition reducer / approvePlan` improved from 49.06 µs to 9.64 µs average (-80.35%).
- `transition reducer / startRun` improved from 77.63 µs to 11.82 µs average (-84.77%).
- `transition reducer / completeRun` improved from 139.61 µs to 13.43 µs average (-90.38%).
- `warm saveSession cycle` held at 777.70 µs average with the incremental writer enabled, staying below the release gate for unchanged-session saves.
- `full saveSession cycle / 20-feature plan` measured 3.76 ms average after M5 versus a 3.38 ms baseline, with the cold-path regression explicitly documented as a trade for warm-save wins.
- `session save round-trip` measured 2.45 ms average after optimization work versus 1.91 ms baseline, with the extra cache invalidation and render bookkeeping called out in benchmark notes.
- `markdown render / index` measured 3.87 µs average after the renderer rewrite versus 3.52 µs baseline, with the small fixed-cost increase documented as the price of skipped writes on unchanged saves.
- `markdown render / feature` measured 793.16 ns average after optimization versus 766.81 ns baseline, remaining within the 5% tolerance gate.
