# Changelog

## [1.0.10] - 2026-04-19

### Highlights

Flow 1.0.10 makes the control surfaces easier to scan without weakening the runtime tool contract. This release adds `flow_doctor`, introduces runtime guidance plus canonical operator summaries for status-oriented surfaces, defaults `/flow-status` and `/flow-doctor` to compact operator-friendly views, and keeps the fuller structured view available on demand.

### Added

- Added the `flow_doctor` runtime/control surface for non-destructive readiness checks covering install health, command injection, workspace writability, session artifacts, and current next-step guidance.
- Added runtime-owned `guidance` and canonical `operatorSummary` fields for `flow_status`, `flow_history_show`, and `flow_doctor`.
- Added compact vs detailed status/doctor view support so the default command path is easier for humans to scan while the detailed machine-readable shape remains available.

### Changed

- Updated `/flow-status` and `/flow-doctor` command/control guidance to prefer compact operator-facing summaries by default, with `detail`/`detailed`/`full`/`json` forms opting into the fuller structured view.
- Aligned `flow_history_show` next-action guidance so `guidance.nextCommand`, `operatorSummary`, and the top-level `nextCommand` now point to the same follow-up action.
- Improved control-surface summaries so `flow-doctor` now leads with doctor-specific warn/fail/ok outcomes instead of reusing a session-only status summary.

### Fixed

- Fixed the previous mismatch where history/show responses could present different next commands depending on whether the caller looked at `guidance`, `operatorSummary`, or the top-level response.
- Reduced compact-mode payload cost by emitting minified JSON for compact `flow_status` and `flow_doctor` responses.
- Reduced test duplication around doctor/install setup while keeping full release-gate coverage green.

## [1.0.9] - 2026-04-19

### Highlights

Flow 1.0.9 turns the new workflow semantics into explicit runtime behavior. This release adds a runtime `decisionGate`, requires structured replan reasons, makes session close outcomes explicit through `flow_session_close`, and updates Flow’s prompts, summaries, and docs to match the stricter workflow model.

### Added

- Added runtime-owned decision-gate derivation so blocking planning decisions are surfaced in session summaries as `decisionGate`.
- Added structured replan metadata requirements: `replanReason`, `failedAssumption`, and `recommendedAdjustment`.
- Added explicit session closure metadata for `completed`, `deferred`, and `abandoned` outcomes.

### Changed

- Replaced the old session-close flow with explicit `flow_session_close` semantics and made the closure kind required.
- Updated runtime summaries, rendered session docs, and reviewer records to expose decision gates, closure state, and review purpose more clearly.
- Updated planner/auto contracts and README/development docs to describe runtime-backed decision taxonomy, delivery policy, and active/stored/completed history behavior.

## [1.0.8] - 2026-04-19

### Highlights

Flow 1.0.8 finishes the session-storage redesign around explicit `active/`, `stored/`, and `completed/` directories. This release removes the old pointer-file model, aligns runtime/tool/test terminology with the new completed-history behavior, and simplifies completed-session storage logic so the filesystem layout, runtime behavior, and docs all say the same thing.

### Changed

- Replaced the old `.flow/active` pointer plus `.flow/sessions/` and `.flow/archive/` layout with directory-based `.flow/active/<session-id>/`, `.flow/stored/<session-id>/`, and `.flow/completed/<session-id>-<timestamp>/`.
- Updated session persistence, activation, history lookup, render syncing, and control-tool payloads to use `stored` and `completed` terminology consistently.
- Centralized completed-session naming, collision handling, and lookup logic in a shared runtime storage helper to reduce duplication and layering drift.

### Removed

- Removed the active-session pointer-file model from runtime persistence.
- Removed the remaining archive-oriented runtime/test terminology in favor of completed-session wording.
- Removed the redundant whitespace-only goal regression file after folding that coverage into the path-traversal suite.

## [1.0.7] - 2026-04-19

### Highlights

Flow 1.0.7 simplifies the plugin around a canonical-only runtime and install surface. This release removes deprecated raw-wrapper guidance, deletes the unused `requireFinalReview` knob, tightens prompt/runtime parity coverage, clarifies session-tool ownership boundaries, and drops legacy install/session-migration compatibility paths in favor of the current canonical layouts.

### Changed

- Simplified Flow's canonical tool guidance, runtime boundaries, and session-tool module structure with stronger guardrails and protocol-parity coverage.
- Removed the legacy `requireFinalReview` completion-policy field while keeping final review enforced by the final completion path.
- Updated README, maintainer docs, and migration notes to reflect the current canonical-only behavior and risk checklist.

### Removed

- Removed legacy raw-wrapper guidance and the unused contract-normalization seam.
- Removed legacy install-path compatibility; Flow now installs and uninstalls only at `~/.config/opencode/plugins/flow.js`.
- Removed legacy `.flow/session.json` auto-migration support; Flow now expects the current session-history layout only.

## [1.0.5] - 2026-04-19

### Highlights

Flow 1.0.5 restores reliable curl-based uninstall behavior from release artifacts by making uninstall idempotent and user-friendly when no plugin file is present.

### Fixed

- Fixed `uninstall.sh` from release downloads to always succeed cleanly when Flow is already absent.
- Added an explicit informational message when no plugin file is found at canonical or legacy install paths.

## [1.0.4] - 2026-04-19

### Highlights

Flow 1.0.4 cleans up the deterministic planning-context release by restoring the changelog structure and simplifying the new planning-context tool implementation. This keeps the 1.0.3 feature behavior intact while tightening release metadata and runtime-tool maintainability.

### Changed

- Restored the missing markdown heading structure for the 1.0.2 changelog entry.
- Simplified `flow_plan_context_record` by removing the redundant raw-input cast and consolidating schema imports.
- Revalidated the full release suite after the cleanup.

## [1.0.3] - 2026-04-19

### Highlights

Flow 1.0.3 adds deterministic planning context capture before planning, including repo-profile persistence, optional research notes, and decision logging. Autonomous mode now pauses on meaningful unresolved decisions with a recommended path, and the README workflow docs/diagram now reflect that behavior.

### Added

- Added `flow_plan_context_record` to persist repo profile, research, implementation approach, and planning decision logs into the active session.
- Added planning decision schemas and decision-log rendering in Flow session summaries.

### Changed

- Updated planner and autonomous prompts to detect stack context first and research only when local repo evidence is insufficient for a high-confidence path.
- Restricted explicit decision gating to `/flow-auto`, where unresolved meaningful decisions now stop with options, rationale, and a recommended path.
- Updated `README.md` prose and Mermaid workflow diagram to document deterministic planning context, research triggers, and `/flow-auto` decision pauses.

## [1.0.2] - 2026-04-19

### Highlights

Flow 1.0.2 extends strict malformed-JSON hardening to persisted session loading and legacy session migration. Session files now reject duplicate keys and other malformed object shapes consistently before runtime schema validation.

### Changed

- Reused the strict JSON object parser for persisted `.flow` session loading and legacy session migration.
- Added regression tests covering duplicate-key failures in active and legacy session JSON.
- Reduced remaining production malformed-JSON exposure to local tooling/script parse sites rather than runtime session ingestion.

## [1.0.1] - 2026-04-19

### Highlights

Flow 1.0.1 hardens reviewer and worker contract ingestion so malformed raw JSON can no longer silently leak into runtime persistence. The release adds strict object scanning, duplicate-key detection, clearer malformed-payload recovery codes, and safer raw wrapper tools for reviewer/final-review/worker completion ingestion.

### Added

- Added `src/runtime/contract-normalization.ts` with strict raw JSON contract parsing and normalization for reviewer and worker payloads.
- Added raw-ingestion runtime tools for feature review, final review, and worker completion persistence.
- Added regression coverage for duplicate keys, trailing text, non-object payloads, schema failures, and raw-wrapper recovery behavior.

### Changed

- Updated Flow worker/auto command guidance to route reviewer and worker persistence through the safer `*_from_raw` tools.
- Marked direct structured persistence tools as low-level/internal so the safer raw-ingestion wrappers are the preferred path.
- Improved malformed-payload recovery metadata to surface precise error codes such as `duplicate_json_key`, `trailing_text`, `non_object_payload`, and `schema_validation_failed`.

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
