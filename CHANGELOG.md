# Changelog

## [1.0.25] - 2026-04-29

Shrink the global Flow tool surface so ordinary OpenCode requests stay stable

Flow 1.0.25 is a stability patch aimed at the plugin itself. This release moves the heaviest Flow tool payloads behind thin JSON-string wrapper fields, preserves strict runtime validation after decode, rejects malformed or duplicate-key JSON wrapper payloads, and adds a schema-budget regression so the plugin cannot quietly reintroduce a global tool-definition payload large enough to destabilize ordinary OpenCode requests.

Constraint: Keep zod aligned with the plugin SDK's effective contract and preserve tool-boundary compatibility without adding dependencies
Constraint: Preserve runtime validation semantics while materially shrinking the SDK-facing tool schema surface seen by OpenCode
Rejected: Add new runtime state or split Flow into more plugins | unnecessary complexity when the main issue was the global tool-schema payload size
Confidence: medium
Scope-risk: moderate
Reversibility: clean
Directive: If future Flow tools need large structured payloads, keep the SDK-facing schema thin and validate the decoded object inside the runtime boundary
Tested: `bun run typecheck`; `bun run check`
Not-tested: Live OpenCode interactive stability under the user’s exact workload; live GitHub-hosted `release.yml` run for tag `v1.0.25` before push

## [1.0.24] - 2026-04-29

Remove audit-lane prompt contradictions before the next audit release

Flow 1.0.24 is a narrow audit-lane patch. It resolves the contradiction that told the auditor to stay read-only while also persisting reports, clarifies that `flow_audit_write_report` is the single sanctioned export write, keeps persisted artifact paths out of the audit report contract, and makes the contract examples schema-valid so the audit lane teaches one consistent output shape.

Constraint: Audit export must remain the only sanctioned write from the audit lane without widening execution or session-mutation permissions
Constraint: Final audit output must stay a single contract-valid JSON object even when persistence returns extra metadata
Rejected: Add artifact-path fields to the audit contract | would widen the chat/output contract instead of fixing the contradictory guidance
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: If the audit lane keeps export metadata, keep it in tool responses and persisted artifacts rather than widening the audit report payload
Tested: `bun test tests/config.test.ts tests/prompt-eval-corpus.test.ts tests/runtime-tools.test.ts tests/session-engine.test.ts tests/audit-report-contracts.test.ts`; `bun run report:prompt-eval`; `bun run check`
Not-tested: Live GitHub-hosted `release.yml` run for tag `v1.0.24` before push

## [1.0.23] - 2026-04-29

Make saved audit comparisons more trustworthy before cutting the next audit-capable release

Flow 1.0.23 turns the new saved-audit lane into a releaseable surface. This patch adds structured compare output for persisted audits, keeps compare in the read-only control lane, improves rename and retitle handling so obvious churn does not degrade into noisy add/remove output, and exposes match provenance so operators can see when a diff came from an exact key versus a heuristic pairing.

Constraint: Audit comparison must stay read-only and must not add new workflow state or execution lanes
Constraint: Tool arg schemas must remain aligned with the plugin SDK's effective zod contract while still accepting the full persisted audit contract
Rejected: Add a separate semantic-identity subsystem for audit diffs | too much new state and complexity for a patch release
Confidence: medium
Scope-risk: moderate
Reversibility: clean
Directive: If compare matching grows beyond evidence/category heuristics, add an explicit stable audit item identity before widening the algorithm further
Tested: `bun run report:prompt-eval`; `bun run check`
Not-tested: Live GitHub-hosted `release.yml` run for tag `v1.0.23` before push

## [1.0.22] - 2026-04-29

Restore release confidence after the v1.0.21 packaging-gate regression

Flow 1.0.22 is a narrow corrective patch release. It keeps the prompt-system and eval infrastructure introduced on `main`, but fixes the release-blocking pack-invariants regression that came from hardcoding the previous version in the packaging test happy path. The goal of this release is to make the current fixed `main` state the official tagged release without introducing new behavioral scope.

Constraint: Packaging and changelog version checks must stay aligned with the active package version at release time
Constraint: This patch should avoid widening the prompt/runtime surface beyond the already-verified `main` state
Rejected: Retag `v1.0.21` in place | rewriting an already-pushed tag is riskier and less auditable than a clean patch release
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Keep release-version assertions dynamic anywhere a test derives expectations directly from `package.json`
Tested: `bun run report:prompt-eval`; `bun run check`
Not-tested: Live GitHub-hosted `release.yml` run for the new tag before push

## [1.0.21] - 2026-04-29

Improve prompt-system reliability with adaptive context and first-party eval coverage

Flow 1.0.21 turns the recent prompt work into a first-party, CI-visible release surface. This release adds adaptive system-context injection grounded in persisted runtime state, expands prompt coverage across command, prompt, and contract surfaces, splits the eval corpus into maintainable first-party fixtures, and publishes a reusable prompt-eval coverage summary artifact for CI validation and inspection.

Constraint: Runtime semantics, completion gates, and recovery behavior remain runtime-owned rather than moving into prompt-only logic
Constraint: Prompt evals must stay first-party and must not depend on `.factory` artifacts
Rejected: Add a model-graded prompt harness in this release | higher complexity before the static corpus and coverage model fully matured
Confidence: high
Scope-risk: moderate
Directive: Expand corpus coverage before adding materially more prompt complexity, and keep any new eval fixtures grouped by surface under `tests/__fixtures__/prompt-evals/`
Tested: `bun run report:prompt-eval`; `bun run typecheck`; `bun run build`; `bun run lint`; `bun test tests/prompt-eval-corpus.test.ts tests/config.test.ts tests/runtime-tools.test.ts`
Not-tested: Live GitHub Actions artifact upload path in GitHub-hosted CI

## [1.0.20] - 2026-04-28

### Highlights

Flow 1.0.20 preserves the plugin’s strong autonomous core while reducing how much workflow machinery users have to think about. This release makes compact status and doctor summaries more action-oriented, clarifies that repo scripts are the primary execution contract, trims prompt-law duplication where runtime already owns semantics, and relaxes a small amount of architecture-coupled test friction without weakening safety or completion guarantees.

### Added

- Added compact operator-summary guidance that prioritizes current action, blocker, next step, and next command over workflow taxonomy.
- Added stronger script-first prompt coverage so planner, worker, and autonomous coordinator paths treat `package.json` scripts as the primary execution contract.
- Added explicit prompt/schema reminders that planning-only context such as package-manager ambiguity belongs in `planning`, not inside `plan`.

### Changed

- Changed compact status and doctor output to emphasize what Flow is doing now and what the operator should do next, while keeping richer runtime detail in structured and detailed views.
- Changed planner/worker/auto wording to invoke existing package scripts through the detected package manager or repo convention before falling back to raw manager-specific commands.
- Trimmed prompt-law and contract duplication where runtime already enforces completion, recovery, and gating semantics.
- Relaxed a subset of wording- and partition-coupled tests so future maintenance can focus more on behavior and invariants than on exact prose or file ownership narratives.

### Fixed

- Fixed the remaining prompt ambiguity around script-first behavior so autonomous execution no longer implies that package-manager-native commands should outrank existing scripts.
- Fixed documentation drift introduced by compact operator summaries by clarifying that lane/laneReason detail remains available in structured and detailed views.
- Fixed lite-lane parity coverage regressions introduced during simplification by restoring targeted prompt assertions for lite-lane completion and retry guidance.

## [1.0.19] - 2026-04-28

### Highlights

Flow 1.0.19 makes package-manager detection safer and more repo-aware. This release teaches Flow to detect package-manager evidence from the active subdirectory upward in monorepos, refuses to guess when one directory contains conflicting lockfile families, and records that ambiguity explicitly so execution can stay on known package scripts instead of drifting into Bun-by-default behavior.

### Added

- Added a dedicated runtime package-manager detector that walks from the active tool directory up to the Flow workspace root.
- Added explicit planning-state tracking for ambiguous package-manager evidence so Flow can record uncertainty instead of silently guessing.
- Added regression coverage for monorepo subpackage detection, relative tool directories, root fallback behavior, outside-root rejection, and ambiguous same-directory lockfiles.

### Changed

- Changed `flow_plan_start` to persist the nearest detected package manager for the active package scope instead of always using workspace-root evidence.
- Updated planner, worker, and autonomous coordinator guidance to prefer existing `package.json` scripts and avoid guessing manager-specific commands when package-manager evidence is ambiguous.
- Updated README and development guidance to explain monorepo-aware detection and the new ambiguity-safe behavior.

### Fixed

- Fixed the remaining root bias where monorepo subpackages could inherit the workspace-root package manager even when package-local evidence existed.
- Fixed the relative-directory resolution bug so package-manager detection now resolves relative tool directories against the Flow workspace root instead of `process.cwd()`.
- Fixed the safety gap where conflicting lockfile families in the same directory previously forced an arbitrary precedence-based guess.

## [1.0.18] - 2026-04-28

### Highlights

Flow 1.0.18 improves subagent efficiency without expanding the runtime role model. This release teaches workers to classify feature workstreams up front, normalizes validator-safe command evidence around `bun run check` and `bun run format_check`, surfaces lane-selection reasons more consistently in operator-facing outputs, and documents that true runtime-level parallel feature execution remains intentionally deferred.

### Added

- Added explicit `core-worker` workstream classes for implementation, test-only/coverage/tooling, validation-only, and release/integration work.
- Added a required worker orientation reference to `.factory/library/environment.md` alongside the existing architecture and validation guidance.
- Added stronger protocol-parity coverage for lite-lane semantics, reviewer-persistence requirements, final-completion-path guidance, and recovery/replan expectations.

### Changed

- Normalized worker verification guidance so `bun run check` is the default aggregate proof, with clearer workstream-specific expectations for when scoped sub-checks should be expanded.
- Updated the shared formatter-safe validation alias to use a Biome check command with formatter enabled, linter disabled, and assist enforcement disabled.
- Exposed `laneReason` more consistently in operator-facing runtime summaries and concrete session-detail payloads.
- Clarified maintainer and README guidance around lane visibility, validator-safe commands, and the intentional deferral of runtime-level parallel feature execution.

### Fixed

- Fixed the worker-procedure mismatch that had been forcing implementation, test-only, validation-only, and release/integration work through the same overly rigid checklist.
- Fixed ambiguity around formatter-only validation guidance by aligning the shared alias, environment notes, and validator docs on one canonical command surface.
- Fixed small release-surface/documentation inconsistencies uncovered during the final review pass.

## [1.0.17] - 2026-04-28

### Highlights

Flow 1.0.17 focuses on maintainability rather than new behavior. This release thins the OpenCode tool-schema adapter, moves lite-lane plan auto-approval into the runtime application layer, splits completion-path logic into smaller runtime-owned modules, and converts completion recovery mapping into a descriptor-driven policy while keeping the public tool surface and runtime semantics intact.

### Added

- Added focused completion-path modules under `src/runtime/transitions/` for normalization, validation, and finalization so the protected completion lane is easier to inspect and maintain.
- Added explicit post-refactor verification coverage for the changed runtime/application, completion, recovery, and tool-adapter seams.

### Changed

- Simplified `src/tools/schemas.ts` by removing dead manual tool-arg type exports while preserving the SDK-facing arg-shape surface and the raw-vs-runtime worker schema distinction.
- Moved lite-lane draft-plan auto-approval from tool-layer orchestration into `src/runtime/application/session-actions.ts`, keeping the outward `autoApproved` contract unchanged.
- Split `src/runtime/transitions/execution-completion.ts` into smaller normalization, validation, and finalization modules while preserving completion gate ordering, failure-path persistence, and lite-lane behavior.
- Reworked `src/runtime/transitions/recovery.ts` around a descriptor-driven completion recovery mapping while preserving canonical recovery metadata, error codes, and resolution hints.
- Reduced wording-coupled test assertions where they were locking prose instead of behavior, while preserving semantic contract checks.

### Removed

- Removed dead session-tool root helper exports from `src/tools/session-tools/shared.ts`.
- Removed redundant manual tool-arg type exports from `src/tools/schemas.ts` that were no longer used by the runtime tool surface.

### Fixed

- Preserved the runtime-owned lite auto-approval behavior without requiring a second tool-layer mutation branch.
- Kept completion-path recovery and validation semantics green after the completion module split and recovery refactor.
- Kept the generated dist surface stable at five agents, eight commands, and seventeen tools.

## [1.0.16] - 2026-04-28

### Highlights

Flow 1.0.16 tightens hidden-workspace permission behavior so only Flow's own `.flow` state stays auto-allowed. When the effective mutable workspace root is some other hidden directory such as `.factory`, `.claude`, or `.codex`, Flow now asks for permission before writing `.flow/**` there while still leaving normal project-root `.flow` behavior unchanged.

### Added

- Added a shared mutable-workspace permission gate in `src/tools/mutable-workspace-permission.ts` so mutating Flow tools consistently request approval before writing `.flow/**` under hidden workspace roots other than `.flow`.
- Added targeted runtime-tool coverage for the three key behaviors: hidden workspace roots prompt, normal project roots with hidden subdirectories do not prompt, and `.flow` itself remains auto-allowed.

### Changed

- Routed mutating runtime and session tool entrypoints through the new permission gate instead of silently allowing all hidden workspace roots.
- Updated workspace-safety documentation to explain when Flow prompts for hidden workspace roots versus when it continues writing to the normal project-root `.flow/**` subtree.
- Clarified mutable-root remediation text so `$HOME` rejection explains that Flow needs a real project/worktree subdirectory rather than suggesting a trusted-root override.

### Fixed

- Fixed the remaining mismatch where hidden directories such as `.factory`, `.claude`, or `.codex` could still become mutable Flow roots without an approval prompt.
- Preserved the normal no-prompt path for the standard project-root `.flow/**` state directory and the existing hard block on `$HOME` itself as a mutable root.

## [1.0.15] - 2026-04-28

### Highlights

Flow 1.0.15 restores the default external-directory permission prompt for mutating agents without weakening Flow's mutable workspace-root guard. This release removes the over-broad OpenCode permission override that had turned cross-project access into a hard deny, while also trimming duplication in runtime guidance derivation and session-tool wrapper plumbing.

### Changed

- Removed the explicit `external_directory: "deny"` override from `flow-worker` and `flow-auto` so OpenCode host/default permission prompting can apply again when work legitimately reaches outside the current project.
- Simplified `src/runtime/summary.ts` by routing guidance shaping more directly through `deriveSessionOperatorState(...)` instead of re-deriving the same major phase branches locally.
- Consolidated repeated session-tool read/workspace dispatch boilerplate into narrow helpers in `src/tools/session-tools/shared.ts`, with follow-on cleanup in the history, planning, and lifecycle tool registrations.

### Fixed

- Fixed the regression where recent workspace-safety hardening suppressed the preferred ask-for-permission behavior for external-directory access by forcing a hard deny at the agent config layer.
- Preserved the mutable-root safety boundary enforced by `src/runtime/workspace-root.ts` and `src/runtime/application/tool-runtime.ts`, so suspicious roots like home-level dot-directories still cannot silently host Flow state.

## [1.0.14] - 2026-04-21

### Highlights

Flow 1.0.14 focuses on durability after the recent runtime simplification work. This release removes the last SDK/runtime arg-shape bridge helper by aligning the `zod` contract with the plugin SDK, adds executable dependency and completion-lane guardrails, compresses redundant architecture/governance docs, and simplifies the main runtime hotspots without changing the operator-facing surface.

### Added

- Added `scripts/cross-area/dependency-contract.mjs` plus `tests/cross-area/dependency-contract.test.ts` to verify that the repo and `@opencode-ai/plugin` still share the same effective `zod` contract.
- Added `scripts/cross-area/check-completion-lane.mjs` and the `bun run check:completion-lane` package script so completion-path edits have an explicit protected verification lane.
- Added a documented completion-path protection rule for `src/runtime/transitions/execution-completion.ts`, including a file-level warning and maintainer guidance in `docs/architecture/maintainer-risk-checklist.md`.
- Added a stricter dependency-alignment check to `tests/config.test.ts` so SDK/runtime shape compatibility is guarded by CI instead of maintainer memory alone.

### Changed

- Pinned `zod` to `4.1.8` to align with `@opencode-ai/plugin@1.3.10` and remove the remaining direct tool-arg bridge helper from the runtime tool surface.
- Simplified the runtime application hotspots in `src/runtime/application/session-actions.ts`, `src/runtime/application/session-engine.ts`, and `src/runtime/application/tool-runtime.ts` by deleting duplicated response, dispatch, and workspace-root plumbing.
- Simplified `src/runtime/summary.ts` and `src/runtime/transitions/execution-completion.ts` by centralizing repeated projection and completion-path shaping logic while preserving runtime semantics.
- Clarified the public product surface in the README and development guide without shrinking the current 5-agent / 8-command / 17-tool surface.
- Reframed `docs/migration/v2-tool-contract.md` as the current canonical tool-contract reference instead of a lingering migration note.

### Removed

- Removed the last explicit SDK/runtime arg-shape bridge helper and the scattered direct bridge casts that existed around the runtime tool surface.
- Removed redundant architecture-history documents that were no longer the canonical source of maintainer guidance:
  - `docs/architecture/bridge-hotspots.md`
  - `docs/architecture/bridge-seam-owners.md`
  - `docs/architecture/semantic-invariant-equivalence-matrix.md`
  - `docs/architecture/surface-matrix.md`

### Fixed

- Fixed the residual risk that future dependency bumps could silently reintroduce the `zod` seam without an executable check.
- Fixed stale maintainer guidance that still referenced non-existent response-shaping files after the runtime/application consolidation.
- Reduced the chance that future completion-path edits can land without running the highest-signal contract and runtime suites first.

## [1.0.13] - 2026-04-21

### Highlights

Flow 1.0.13 consolidates the runtime architecture around clearer engine, action, and presentation boundaries while also making small tasks less ceremonial. This release adds runtime-owned read/mutation/workspace action families, splits low-level operator derivation from higher-level session view models, centralizes doctor/status/history presentation in the runtime application layer, and introduces adaptive lite/standard/strict execution guidance with real lite-lane behavior reductions.

### Added

- Added `src/runtime/application/session-engine.ts` as the shared runtime engine for read, mutation, and workspace action execution.
- Added runtime-owned action catalogs for mutation, read, and workspace flows in `src/runtime/application/session-actions.ts`, `src/runtime/application/session-read-actions.ts`, and `src/runtime/application/session-workspace-actions.ts`.
- Added runtime-owned doctor and presenter modules in `src/runtime/application/doctor-checks.ts`, `src/runtime/application/doctor-report.ts`, `src/runtime/application/session-presenters.ts`, and `src/runtime/application/operator-presenters.ts`.
- Added `src/runtime/session-operator-state.ts` to own low-level lane, blocker, and next-command derivation.
- Added `tests/session-engine.test.ts` to verify the named action families and centralized engine boundaries directly.

### Changed

- Introduced adaptive rigor with runtime-owned `lite`, `standard`, and `strict` lanes plus shared operator fields such as `phase`, `blocker`, `reason`, `nextStep`, and `nextCommand`.
- Reduced lite-lane ceremony by auto-approving simple draft plans, accepting in-band final review payloads where appropriate, and returning retryable non-human blockers directly to `ready`.
- Moved status, history, auto-prepare, activation, closure, and doctor reporting onto runtime-owned presenters and action dispatch instead of tool-local orchestration.
- Split high-level session view-model derivation from lower-level operator-state derivation so runtime semantics are easier to maintain and extend.
- Consolidated tiny dispatch-only modules back into the paired action-family modules to reduce glue-file sprawl without reintroducing ambiguous ownership.

### Removed

- Removed obsolete tool-layer response and doctor helper files from `src/tools/session-tools/` now that runtime application presenters own those responsibilities.
- Removed the standalone dispatch-only runtime application files after folding that logic into the corresponding action modules.

### Fixed

- Fixed the remaining mismatch where session-oriented tools still owned their own response/report assembly instead of using runtime-owned presenters.
- Fixed the last architecture drift where operator/status derivation and session view-model derivation were mixed in one place without a clean boundary.
- Reduced the risk of future semantic drift by keeping tool adapters thin and routing runtime behavior through a smaller number of authoritative modules.

## [1.0.12] - 2026-04-20

### Highlights

Flow 1.0.12 hardens workspace safety so Flow can no longer silently create or mutate session state in unrelated directories such as home-level dot-config trees. This release adds explicit mutable-workspace root validation, keeps history/status-style reads non-mutating, denies external-directory access for the mutating agents, and surfaces the resolved workspace root plus rejection reasons in operator-facing tooling.

### Added

- Added `src/runtime/workspace-root.ts` as the shared owner for mutable workspace-root normalization, trusted-root inspection, and explicit rejection errors.
- Added runtime regression coverage in `tests/workspace-root-guard.test.ts` for direct session-layer writes, trusted suspicious roots, and read-only history behavior on empty workspaces.
- Added helper coverage for multi-root `FLOW_TRUSTED_WORKSPACE_ROOTS` configuration using the platform path delimiter.

### Changed

- Split Flow workspace resolution into read-only vs mutating paths so status/doctor/history remain readable while mutating actions require an intentional project root.
- Hardened the runtime/session write surface so `saveSession`, `saveSessionState`, `syncSessionArtifacts`, workspace setup, activation, closure, and delete flows all validate mutable roots instead of trusting arbitrary strings.
- Updated `flow_status` and `flow_doctor` payloads to report the resolved workspace root, its source, whether mutation is allowed, and the concrete rejection reason when Flow blocks a root.
- Denied `external_directory` access for `flow-worker` and `flow-auto` as defense-in-depth at the OpenCode agent permission layer.
- Clarified README guidance for exact trusted-root overrides, including multiple roots via `FLOW_TRUSTED_WORKSPACE_ROOTS`.

### Fixed

- Fixed the accidental ability for Flow to persist `.flow/` state under suspicious roots such as `~/.factory` unless the exact path is explicitly trusted.
- Fixed history and stored-session inspection so read-only commands no longer create `.flow/` directories as a side effect on otherwise empty workspaces.
- Fixed the remaining gap where lower-level runtime session helpers could bypass the tool-layer workspace safety checks.

## [1.0.11] - 2026-04-20

### Highlights

Flow 1.0.11 hardens the new runtime-first simplification work so semantic parity is verified by executable contracts instead of fragile wording checks. This release adds a runtime-owned semantic invariant registry, explicit docs parity markers, stronger protocol/docs parity tests, and supporting architecture artifacts for bridge ownership and strictness.

### Added

- Added `src/runtime/domain/semantic-invariants.ts` as the runtime-owned registry for stable semantic invariant IDs, expectation constants, and owner references.
- Added `tests/runtime/semantic-invariants.test.ts` to verify completion-gate order, completion-policy thresholds, decision-gate surfacing, review-scope payload binding, recovery next-action metadata, and canonical tool-surface invariants.
- Added `tests/docs-semantic-parity.test.ts` and `tests/docs-tool-parity.test.ts` to keep canonical docs and runtime tool surfaces aligned.
- Added architecture references for invariant ownership and rollout planning in `docs/architecture/invariant-matrix.md`, `docs/architecture/strictness-contract.md`, `docs/architecture/semantic-invariant-equivalence-matrix.md`, `docs/architecture/bridge-hotspots.md`, `docs/architecture/bridge-seam-owners.md`, and `docs/architecture/surface-matrix.md`.

### Changed

- Made runtime/domain, runtime/transitions, and runtime/schema the explicit normative owners of Flow workflow semantics, while prompt/contracts/docs now reference runtime-owned invariant IDs instead of re-owning policy.
- Replaced brittle semantic wording checks with runtime-derived invariant coverage and explicit `[semantic-invariant]` markers in the canonical architecture docs.
- Strengthened maintainer/release guidance and phase checklists so semantic parity, docs parity, and bridge strictness are part of the blocking verification path.

### Fixed

- Fixed the remaining semantic-parity drift risk by verifying invariant owner file/symbol references directly from the runtime catalog.
- Fixed the docs semantic-parity gate so it now requires the full runtime-owned invariant catalog, including `tools.canonical_surface.no_raw_wrappers`.
- Reduced false positives in owner-resolution checks by allowing more legitimate declaration/export forms instead of only narrow declaration regex matches.

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
