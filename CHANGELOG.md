# Changelog

## [Unreleased]

## [2.0.36] - 2026-05-13

Lower runtime hotspot concentration with behavior-locked seams

Flow 2.0.36 continues the runtime simplification line by reducing three concentrated application/root hotspots without changing Flow's public tool surface, command catalog, persisted `.flow/**` state paths, or workflow semantics. The release extracts feature drilldown presentation, task-progress row projection, and generic session read/workspace action-runner plumbing into narrower modules while keeping the established facade imports and runtime response envelopes stable.

Session presentation now delegates feature drilldown collection through `session-presenter-drilldowns.ts`, so active, stored, parked, and completed session responses keep their existing shape while the presenter file no longer owns drilldown lookup details. Task progress now separates shared row modeling from review/validation/failure row builders through `summary-task-progress-model.ts` and `summary-task-progress-review.ts`, with `projectTaskProgress()` remaining the integration point. Session engine read/workspace action envelopes now live in `session-engine-action-runner.ts`, while mutation persistence, failed-attempt clearing, no-op handling, save/sync ordering, and default runtime ports remain owned by `session-engine.ts`.

Fresh simplification metrics after the pass: runtime files `121`, runtime LOC `17,327`, large runtime files `10`, top-5 runtime-file LOC share `10.5%`, and architecture seam violations `0`. The largest runtime files are now `final-review-behavior-validation.ts` (`424` LOC), `schema-review-shared.ts` (`366`), `execution-completion-validation.ts` (`357`), `session-presenters.ts` (`341`), and `session-engine.ts` (`339`). Compared with v2.0.35's release metrics, large runtime files dropped from `11` to `10` and top-5 concentration dropped from `11.4%` to `10.5%`.

The release deliberately does not add slash commands, runtime tools, state paths, package exports, dependencies, installer behavior, or new workflow modes. It also does not move mutation persistence out of `session-engine.ts`; that remains a separate, higher-risk cleanup slice requiring its own behavior lock.

Constraint: Preserve Flow's public tool names, command names, facade imports, `.flow/**` state paths, and runtime response envelopes while lowering hotspot concentration
Constraint: Keep mutation persistence, failed-attempt clearing, no-op semantics, and save/sync ordering owned by `session-engine.ts` during this release
Constraint: Keep `zod` and `@opencode-ai/plugin` aligned at the previously released SDK contract; this release is structural simplification only
Rejected: Move mutation persistence during the action-runner extraction | state-machine movement is higher risk and needs a separate behavior lock
Rejected: Collapse task-progress and presenter extractions into broad runtime redesign | smaller seams are easier to review, verify, and reverse
Rejected: Add package exports or runtime tools for internal helper modules | the helpers are internal structure, not public product surface
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Future simplification should keep facade imports stable, add focused tests before extracting behavior, and record fresh runtime metrics before release
Tested: `bun run report:runtime-simplification-metrics`; `bun test tests/runtime-summary.test.ts`; `bun test tests/session-engine.test.ts`; `bun test tests/runtime-tools.test.ts tests/runtime-tools-metadata.test.ts`; `bun run typecheck`; `bun run lint`; `bun run check:architecture-seams:enforce`; focused RepoPrompt reviews found no blockers for the task-progress and session-engine slices; `bun run check` (639 pass, 0 fail; build, release hygiene, pack invariants, completion lane, full tests, lint, bench smoke, and bench gate passed)
Not-tested: Live OpenCode UI runtime interaction; live GitHub-hosted release workflow run for tag `v2.0.36` before push

## [2.0.35] - 2026-05-13

Upgrade the OpenCode SDK contract without widening Flow's surface

Flow 2.0.35 moves the adapter to the current OpenCode plugin SDK contract by pinning `@opencode-ai/plugin` to `1.14.48`, keeping `zod` aligned at `4.1.8`, and adding the `effect` runtime needed to execute SDK permission prompts. Tool context and result typing now come from the SDK boundary instead of local drift-prone aliases, while Flow's public tool names, command names, state paths, and workflow semantics remain unchanged.

The release hardens permission handling around the SDK 1.14 `context.ask()` contract. Hidden workspace mutations and attachment materialization now run returned `Effect` values through the bundled Effect runner, and regression coverage proves both successful permission effects and denied permission effects before writes occur. Bundle sanity now exercises a production-built permission-gated tool against an injected peer plugin mock and verifies the permission `Effect` body runs exactly once.

The cold-start budget now imports the built package in a release-like isolated package with the real `@opencode-ai/plugin` peer and aligned `zod`, so dependency-resolution evidence tracks the upgraded SDK contract more closely. The bundle remains below budget at `823,737` bytes with the peer dependency externalized and no inlined OpenCode client symbols.

This release also keeps the simplification work moving by extracting auto-prepare presentation into `session-auto-prepare-presenter.ts` and updating maintainer/contributor docs around protocol projections and release evidence. Fresh runtime metrics: runtime files `117`, runtime LOC `17,259`, large runtime files `11`, top-5 runtime-file LOC share `11.4%`, and architecture seam violations `0`. The largest runtime files are now `session-presenters.ts` (`449` LOC), `final-review-behavior-validation.ts` (`424`), `schema-review-shared.ts` (`366`), `summary-task-progress.ts` (`366`), and `session-engine.ts` (`358`).

The release deliberately does not add slash commands, runtime tools, state paths, package exports, installer destinations, or new workflow modes. Backward compatibility with older OpenCode plugin SDK permission shapes is not preserved; this release intentionally upgrades the plugin to the SDK 1.14 contract.

Constraint: Align Flow's adapter with `@opencode-ai/plugin` `1.14.48` while keeping `zod` matched to the SDK's effective `4.1.8` contract
Constraint: Keep the shipped plugin as a single built entry with `@opencode-ai/plugin` externalized and the Effect permission runner bundled
Constraint: Preserve existing Flow tool names, command names, `.flow/**` state paths, and runtime workflow semantics while upgrading the host SDK boundary
Rejected: Keep compatibility with the older promise-like permission mock shape | the plugin is intentionally moving to SDK 1.14 `Effect` permissions
Rejected: Externalize `effect` from the bundle | release-installed single-file plugins need permission prompts to run without resolving an extra runtime peer
Rejected: Change `zod` independently of the OpenCode plugin SDK | tool arg compatibility depends on the SDK's effective schema runtime
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Future SDK upgrades must verify the plugin peer version, effective `zod` version, permission `Effect` execution, bundle peer externalization, and cold-start import evidence before release
Tested: `bun run report:runtime-simplification-metrics`; `bun install`; `bun test tests/runtime-operator-tools.test.ts tests/attachment-materialization.test.ts` (46 pass, 0 fail); `bun run build && node ./scripts/cross-area/bundle-sanity.mjs` (`permissionAskRuns: 1`); `bun run typecheck`; `bun run check:dependency-contract`; `bun run check:cold-start-budget`; `bun run lint`; `bun run check` (634 pass, 0 fail; build, release hygiene, pack invariants, completion lane, full tests, lint, bench smoke, and bench gate passed)
Not-tested: Live OpenCode UI runtime interaction; live GitHub-hosted release workflow run for tag `v2.0.35` before push

## [2.0.34] - 2026-05-13

Keep simplification seams measurable and compatibility-stable

Flow 2.0.34 completes the next simplification pass across adapter projections, review-domain validation, rendering projections, and session live-storage boundaries. The change moves implementation detail into narrower helper modules while preserving the existing OpenCode tool names, runtime action bindings, public schema surfaces, `.flow/**` state paths, and facade imports.

The release makes the OpenCode core-action projection seam explicit through `core-action-projection.ts`, splits final-review context grounding and review-scope ledger validation into focused domain helpers, separates task-progress row selection from render/presenter code, and centralizes active/stored/completed session live-storage helpers. A follow-up compatibility fix keeps `openCodeToolCoreSummary()` tolerant for stale projected core actions by returning `null` instead of throwing, while strict descriptor metadata lookup remains fail-fast.

Fresh metrics after the pass: runtime files `116`, runtime LOC `17,249`, large runtime files `11`, top-5 runtime-file LOC share `12%`, and architecture seam violations `0`. The largest runtime files are now `session-presenters.ts` (`553` LOC), `final-review-behavior-validation.ts` (`424`), `schema-review-shared.ts` (`366`), `summary-task-progress.ts` (`366`), and `session-engine.ts` (`358`).

The release deliberately does not add slash commands, runtime tools, state paths, package exports, dependencies, installer behavior, or workflow semantics. `zod` remains aligned with `@opencode-ai/plugin`; this is internal structure, compatibility preservation, and regression coverage only.

Constraint: Preserve existing OpenCode tool names, schema owners, generated guidance/projection shape, and runtime action bindings while reducing adapter projection duplication
Constraint: Preserve review-domain validation semantics, review decision normalization behavior, and session persistence precedence across active, stored, and completed sessions
Constraint: Keep `.flow/**` path authority and rendered-doc-as-derived-artifact rules unchanged while centralizing live-storage helpers
Rejected: Make projection-summary rendering strict at the public helper boundary | stale generated projection data previously returned `null` and host guidance should stay tolerant
Rejected: Add new runtime surfaces or state paths during simplification | this release is behavior-preserving boundary repair, not product expansion
Rejected: Change `zod` or plugin SDK versions | tool arg compatibility depends on keeping the effective SDK contract aligned
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Future simplification should keep public facades stable, add focused regression coverage for extracted seams, and record fresh runtime metrics before release
Tested: `bun run report:runtime-simplification-metrics`; `bun test tests/config/tool-schemas.test.ts tests/descriptor-family-parity.test.ts` (22 pass, 0 fail); `bun run typecheck`; targeted `bunx biome check` on projection fix files; focused RepoPrompt review found no P0/P1/P2 findings for the compatibility fix; `bun run check` (631 pass, 0 fail; build, release hygiene, pack invariants, completion lane, full tests, lint, bench smoke, and bench gate passed)
Not-tested: Live OpenCode UI runtime interaction; live GitHub-hosted release workflow run for tag `v2.0.34` before push

## [2.0.33] - 2026-05-13

Lower runtime hotspot concentration behind stable facades

Flow 2.0.33 continues the runtime simplification work with two behavior-preserving extractions. Task-progress projection now lives in `src/runtime/summary-task-progress.ts`, while `summary-projections.ts` keeps the existing export path as a compatibility facade. Final-review behavior validation now lives in `src/runtime/domain/final-review-behavior-validation.ts`, while `final-review-behavior-risks.ts` remains the public facade for the existing risk and ledger contract.

The release updates the runtime complexity baseline after the split: runtime files move from `105` to `107`, runtime LOC from `17,005` to `17,040`, large files remain at `14`, and top-5 runtime-file LOC share drops from `15.0%` to `14.1%`. The former largest hotspot, `final-review-behavior-risks.ts`, is no longer a top-five runtime file.

The release deliberately does not add slash commands, runtime tools, state paths, package exports, dependencies, installer behavior, or workflow semantics. `zod` remains aligned with `@opencode-ai/plugin`; this is internal structure, compatibility preservation, and metrics documentation only.

Constraint: Preserve existing imports from `summary-projections.ts` and `final-review-behavior-risks.ts` while relocating implementation details
Constraint: Keep final-review failure ordering, ledger validation semantics, task-progress row projection, and architecture seams unchanged
Constraint: Keep the simplification measurable through `report:runtime-simplification-metrics` rather than adding a new hard gate
Rejected: Rename or remove facade exports | downstream adapters, audit schemas, and tests still depend on the established import paths
Rejected: Reshape session lifecycle or persistence in this release | persisted-state changes carry higher release risk than pure extraction
Rejected: Add new dependencies or package exports | the release is structural simplification only
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Future simplification should keep facade barrels stable, update runtime metrics with fresh command output, and add direct regression coverage before moving persisted-session behavior
Tested: `bun run typecheck`; `bun run report:runtime-simplification-metrics`; `bun test tests/runtime-summary.test.ts tests/cross-area/summarize-goldens.test.ts tests/runtime/final-completion-gates.test.ts tests/runtime/final-review-contracts.test.ts tests/reviewer-decision-scope.test.ts tests/completion-gates.test.ts tests/cross-area/architecture-seams.test.ts tests/cross-area/module-scope-schemas.test.ts` (111 pass, 0 fail); `bun run check`; focused RepoPrompt review found no code/API/architecture issues after docs metric correction
Not-tested: Live OpenCode UI runtime interaction; live GitHub-hosted release workflow run for tag `v2.0.33` before push

## [2.0.32] - 2026-05-13

Make runtime simplification seams explicit

Flow 2.0.32 completes a behavior-preserving simplification pass across the runtime and OpenCode adapter. The release splits the runtime schema barrel into focused schema subdomains, decomposes review-scope accounting into target, validation, recovery, and shared evidence modules, and moves session JSON I/O into a narrow `session-workspace-io` boundary for strict parsing, cache clone isolation, atomic writes, and cache invalidation.

The OpenCode attachment path now has a dedicated `attachment-selection` helper with explicit current-message priority, latest-batch fallback, skipped-only batch reporting, and duplicate filename selector handling. Focused tests lock those extracted behaviors, while schema barrel parity and session I/O tests guard the new seams against drift.

The release deliberately does not add slash commands, runtime tools, state paths, package exports, dependencies, installer behavior, or new workflow semantics. `zod` remains aligned with `@opencode-ai/plugin`; this is structural simplification plus regression coverage only.

Constraint: Preserve public runtime schema imports while moving implementation into narrower subdomain files
Constraint: Keep session persistence semantics unchanged while isolating strict JSON and atomic-write behavior
Constraint: Keep OpenCode attachment materialization behavior stable while making selection rules directly testable
Rejected: Rewrite runtime workflows while simplifying modules | behavior changes would obscure whether the seam extraction was safe
Rejected: Add new package exports or dependencies | the release is internal structure and test hardening only
Rejected: Leave extracted helper behavior covered only through integration tests | narrow seams need direct regression coverage
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Future simplification work should keep facade barrels stable, add focused tests for every extracted seam, and update runtime subdomain metrics when file boundaries move
Tested: `bun test tests/attachment-selection.test.ts tests/session-workspace-io.test.ts tests/schema-equivalence.test-d.ts`; `bun run typecheck`; `bun run lint`; `bun run check` (626 pass, 0 fail; build, architecture seams, dependency contract, completion lane, full tests, lint, bench smoke, and bench gate passed); focused Oracle review reported no must-fix findings
Not-tested: Live OpenCode UI attachment materialization; live GitHub-hosted release workflow run for tag `v2.0.32` before push

## [2.0.31] - 2026-05-10

Make completion-review recovery evidence explicit

Flow 2.0.31 closes the completion/final-review recovery gap found during uncommitted review: `reviewScopeLedger` evidence must now be grounded in changed artifacts or a review context pack instead of passing through file-target self-reference alone, and `retryPolicy.mustChangeEvidenceRefs` now reports whether generated scaffold evidence actually needs replacement.

The release also makes latest failed-attempt recovery safer and easier to operate. Successful retries clear only matching failed tool attempts, explicit reset still clears all failed-attempt state, repeated same-category failures are counted and surfaced, and operator recovery hints are compacted into concise single-line output.

The release keeps the 2.0.29/2.0.30 reasoning-effort posture intact: `/flow-doctor` verifies Flow-injected agent `reasoningEffort` budgets and command routing while explicitly not claiming proof of OpenCode host-effective session reasoning. It deliberately does not add slash commands, runtime tools, state paths, package exports, dependencies, generated skills, installer behavior, or new workflow semantics. `zod` remains aligned with `@opencode-ai/plugin`.

Constraint: Keep final-review and completion recovery evidence grounded in concrete changed artifacts or review context
Constraint: Preserve actionable failed-attempt visibility until the matching failed tool succeeds or reset is explicit
Constraint: Treat reasoningEffort diagnostics as Flow-injected config verification, not host-effective runtime proof
Rejected: Accept file-target self-reference as standalone review evidence | it can make unreviewed targets appear grounded
Rejected: Clear all failed-attempt state on unrelated successful mutations | it can hide still-actionable recovery work
Rejected: Change dependencies, installer surfaces, or OpenCode model/provider ownership | this release is runtime contract and diagnostics hardening only
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Future review-scope recovery changes must keep validation, scaffold examples, retry policy, and operator guidance in lockstep
Tested: `bun run typecheck`; `bun test tests/completion-gates.test.ts tests/runtime/final-review-contracts.test.ts tests/runtime-operator-tools.test.ts tests/runtime-summary.test.ts` (108 pass, 0 fail); scoped Oracle review of implemented fixes found no blockers; `bun run check`
Not-tested: Live OpenCode UI verification of host-effective `reasoningEffort`; live GitHub-hosted release workflow run for tag `v2.0.31` before push

## [2.0.30] - 2026-05-10

Keep release diagnostics and cleanup evidence current

Flow 2.0.30 makes `/flow-doctor detail` report the injected command routing and agent `reasoningEffort` budget map so operators can verify the lane-aware agent configuration introduced in 2.0.29 without inspecting generated config by hand. The config check now fails when `/flow-review` is not routed through `flow-auditor` or when any built-in Flow agent drifts from its expected reasoning budget.

The release also completes a cleanup pass: generated `prompt-exports/` output is ignored, stale benchmark baseline/result rows for removed workflow event/checkpoint/projection/tool benchmarks are deleted, and completed dated reasoning-level plan/review docs are removed after no-reference proof. Prompt/render fixtures, historical release/investigation docs, current benchmark files, package scripts, runtime state, tool schemas, and dependency pins remain intact.

The release deliberately does not add slash commands, runtime tools, state paths, tool payload schemas, package exports, dependencies, generated skills, installer behavior, or Flow workflow semantics. It keeps `zod` aligned with `@opencode-ai/plugin` and treats this as diagnostics plus source-hygiene consolidation only.

Constraint: Keep the 2.0.29 lane-aware agent configuration observable through `/flow-doctor detail`
Constraint: Keep generated prompt-eval exports out of source control while preserving CI generation and upload paths
Constraint: Preserve benchmark gates by pruning only rows with no current benchmark emitter
Rejected: Delete prompt/render fixtures | tests own them as regression corpora and no replacement-coverage proof was established
Rejected: Delete historical release or investigation docs | maintainer policy treats them as historical evidence by default
Rejected: Change package scripts, runtime semantics, tool schemas, or dependencies | this release is diagnostics and cleanup only
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Future cleanup should prove benchmark row coverage both ways: stale rows are absent and every active benchmark has a baseline/result row
Tested: `bun test tests/runtime-operator-tools.test.ts`; `bun run check:fresh-surfaces`; `bun run deadcode`; `bun run typecheck`; `bun run bench:gate`; `bun run check`
Not-tested: Live OpenCode UI verification of `/flow-doctor detail`; live GitHub-hosted release workflow run for tag `v2.0.30` before push

## [2.0.29] - 2026-05-10

Make Flow agent reasoning budgets lane-aware

Flow 2.0.29 adds lane-appropriate OpenCode `reasoningEffort` hints to every built-in Flow agent while preserving user-owned model and provider selection. Planning, planning research, worker review, and standalone audit now receive high reasoning; autonomous coordination receives medium reasoning; focused worker and control lanes receive low reasoning.

Standalone `/flow-review` now runs through a dedicated read-only `flow-auditor` agent instead of the low-reasoning `flow-control` agent. The audit renderer is restricted to the standalone audit mode, control prompts no longer advertise audit rendering, and maintainer docs/tests now lock the audit/control split.

The release deliberately does not add slash commands, runtime tools, state paths, tool payload schemas, package exports, dependencies, generated skills, installer behavior, or Flow workflow semantics. It treats `reasoningEffort` as pass-through OpenCode agent metadata only, with no provider-specific `model`, `variant`, or nested reasoning config emitted by Flow.

Constraint: Keep public command names stable while changing the internal `/flow-review` backing agent
Constraint: Treat `reasoningEffort` as OpenCode-owned pass-through metadata, not Flow runtime behavior
Constraint: Preserve existing task handoff permissions and read-only postures for planner, reviewer, control, and audit agents
Rejected: Bind standalone audit to low-reasoning `flow-control` | audit depth and coverage calibration need a review-class lane
Rejected: Add model or provider defaults | operators and OpenCode config should keep owning model choice
Rejected: Broaden the change into runtime state, tool schemas, generated skills, installers, or dependency updates | this release is adapter config and contract alignment only
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Keep future agent-budget changes tested through command bindings, emitted agent config, read-only permissions, and audit/control tool access boundaries
Tested: `bun test tests/config/plugin-surface.test.ts tests/mode-contracts.test.ts`; `bun test tests/config/prompt-contracts.test.ts`; `bun test tests/mode-contracts.test.ts tests/config/plugin-surface.test.ts tests/prompt-mode-capture.test.ts tests/config/prompt-contracts.test.ts`; `bun run typecheck`; `bun run check`
Not-tested: Live OpenCode UI verification that providers honor each emitted `reasoningEffort`; live GitHub-hosted release workflow run for tag `v2.0.29` before push

## [2.0.28] - 2026-05-10

Make Flow skills install globally with the plugin

Flow 2.0.28 changes the generated OpenCode skill lifecycle from project-local workspace files to the documented global OpenCode skill directory. Source installs and release installs now place `flow-plan`, `flow-run`, and `flow-review` under `~/.config/opencode/skills/**`, matching the global `flow.js` plugin location and making the guidance available without per-workspace `--project` targeting.

The source installer, release installer, release workflow, generated skill docs, README, maintainer docs, and focused lifecycle tests were updated together. Install still preflights same-name skill files before mutating the global plugin, and uninstall removes only intact Flow-generated skills while preserving user-managed global skills with the same names.

The release deliberately does not add commands, tools, runtime modes, package exports, dependencies, state paths, or new Flow workflow semantics. It narrows the installation surface to global OpenCode assets only and removes the `--project` lifecycle option rather than introducing another scope selector.

Constraint: Follow OpenCode's documented global skill discovery path at `~/.config/opencode/skills/<name>/SKILL.md`
Constraint: Keep generated skill overwrite/removal guarded by Flow-owned markers and hashes
Constraint: Preserve user-managed same-name global skills during uninstall
Rejected: Keep project-local skills as the default | the requested release is global-only skill installation
Rejected: Add `project|global|both` scope flags | global-only avoids duplicate skill names and per-workspace install drift
Rejected: Expand workflow semantics | this release changes install location only
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Keep Flow skill install, release asset packaging, generated skill docs, and uninstall safety checks aligned on `~/.config/opencode/skills/**`
Tested: `bun run check` (typecheck, prompt captures, dependency and architecture contracts, fresh-surface terminology, dead-code scan, build, release hygiene, pack invariants, completion-lane gate, runtime replay tests, cold-start budget, bundle sanity, full test suite, Biome lint, bench smoke, and bench gate); focused installer/release lifecycle tests; Oracle review of the global-only install diff
Not-tested: Live `curl .../install.sh | bash` against the GitHub-hosted `v2.0.28` assets before tag push; live OpenCode UI skill discovery after installing from the GitHub release

## [2.0.27] - 2026-05-10

Make the release installer install project-local skills

Flow 2.0.27 fixes the release installer gap exposed after 2.0.26: `curl .../install.sh | bash` now installs both the global `flow.js` plugin and the generated `flow-plan`, `flow-run`, and `flow-review` skills into the current workspace by default. Operators can pass `--project <path>` through Bash to install those skills into another workspace while keeping the plugin in the canonical global OpenCode plugin slot.

The release workflow now publishes a `flow-skills.tar.gz` asset generated from the same source skill bundle used by the Bun installer. The release `install.sh` downloads that asset, preflights existing skill files, refuses to overwrite user-managed or user-edited skill files, then extracts the generated skills. The release `uninstall.sh` mirrors the workspace target behavior and removes only intact generated skills after the same preflight while still clearing the canonical global plugin file.

The release deliberately does not add commands, tools, runtime modes, package exports, dependencies, state paths, or new Flow workflow semantics. It keeps the fix scoped to release asset packaging and install/uninstall parity with the already generated project-local guidance surface.

Constraint: Keep the curl installer useful for users who install outside the plugin repository checkout
Constraint: Generate release skill files from the same source bundle as the Bun installer
Constraint: Preserve user-edited skill files by failing before plugin or skill removal when skill preflight fails
Rejected: Leave release install as plugin-only | README and 2.0.26 behavior promised project-local guidance skills
Rejected: Inline three skill documents directly into `install.sh` | generated tarball assets keep the script smaller and source-owned
Rejected: Add new runtime/plugin behavior | this is release packaging parity, not a workflow expansion
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Keep release install assets and source install skill generation in sync; future release-script changes must test both plugin and skill installation paths
Tested: `bun run check` (typecheck, prompt captures, dependency and architecture contracts, fresh-surface terminology, dead-code scan, build, release hygiene, pack invariants, completion-lane gate, runtime replay tests, cold-start budget, bundle sanity, full test suite, Biome lint, bench smoke, and bench gate)
Not-tested: Live `curl .../install.sh | bash` against the GitHub-hosted `v2.0.27` assets before tag push; live OpenCode UI skill discovery after installing from the GitHub release

## [2.0.26] - 2026-05-10

Make OpenCode guidance installable and uninstall cleanup authoritative

Flow 2.0.26 moves the OpenCode guidance surface into generated project-local skills and makes source installs target an explicit workspace with `--project`. The global plugin remains installed at the canonical OpenCode plugin slot, while `flow-plan`, `flow-run`, and `flow-review` skills are generated under the target workspace so prompt guidance follows the project being operated on rather than the plugin repository checkout.

The install and uninstall lifecycle now snapshots plugin and skill state before mutating either side. If a later step fails, Flow restores the prior plugin file and generated skill files, preventing partial installs or partial removals. Uninstall also clears an incompatible canonical `flow.js` file after skill preflight succeeds, matching the release-script behavior for stale plugin cleanup without silently deleting user-edited generated skills.

Prompt and descriptor guidance were refreshed for the newer OpenCode plugin surface, including tighter tool descriptions, generated skill docs, updated prompt/eval fixtures, and maintainer/development docs that describe the plugin-versus-skill split. The release deliberately keeps the public package export, dependency set, runtime state paths, command names, and Flow workflow semantics unchanged.

Constraint: Keep the global plugin path canonical while making project-local guidance skills install into the operator-selected workspace
Constraint: Preserve user edits by refusing to remove modified generated skills and rolling back plugin/skill lifecycle failures
Constraint: Align source uninstall with release-script stale `flow.js` cleanup without widening package exports or runtime modes
Rejected: Keep installing skills into the plugin repo cwd | source installs need to target the workspace where OpenCode will load guidance
Rejected: Leave partial lifecycle failures for manual cleanup | plugin and skill mutation must be transaction-like for local install safety
Rejected: Add new commands or runtime state paths | this release is install/guidance hygiene, not workflow expansion
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep future OpenCode guidance changes generated, fixture-backed, and project-local; do not re-couple generated skills to the plugin repository checkout
Tested: `bun run check` (typecheck, prompt captures, dependency and architecture contracts, fresh-surface terminology, dead-code scan, build, release hygiene, pack invariants, completion-lane gate, runtime replay tests, cold-start budget, bundle sanity, full test suite, Biome lint, bench smoke, and bench gate)
Not-tested: Live OpenCode UI skill loading in an installed external workspace; live GitHub-hosted `release.yml` run for tag `v2.0.26` before push

## [2.0.25] - 2026-05-09

Make final-review evidence terminology neutral

Flow 2.0.25 removes legacy proof terminology from active final-review, audit, prompt, and fixture contracts. Behavior-risk accounting now uses evidence-oriented names such as `test_evidence_authenticity`, `test_evidence`, `testEvidenceRefs`, and `requireTestEvidenceOrGap`, so reviewers describe what validation proves or leaves as a gap without relying on the previous loaded label.

The runtime preserves compatibility for existing persisted sessions and older tool payloads. Legacy input values are accepted at schema and normalization boundaries, mapped to canonical evidence fields, and rejected when old and new reference arrays conflict. Normalized worker final-review history now drops legacy reference fields before persistence, keeping canonical output clean while preserving read compatibility.

Prompt, audit, generated prompt, eval, render, benchmark, and schema fixtures were updated together. Active source, tests, and generated prompt surfaces no longer contain the old whole-word terminology, while historical docs and dedicated compatibility tests remain the only intentional legacy references.

The release deliberately does not add commands, tools, runtime modes, package exports, dependencies, state paths, or new worker/reviewer payload requirements. It preserves `zod` / `@opencode-ai/plugin` alignment, accepts only a narrow 5 KiB bundle-budget increase for release-bound schema normalization, and treats this as terminology/schema-normalization cleanup rather than a behavioral expansion.

Constraint: Keep final-review behavior accounting semantics unchanged while renaming the active vocabulary
Constraint: Preserve backward input compatibility for persisted sessions and older tool payloads
Constraint: Emit canonical evidence terminology from normalized runtime outputs
Constraint: Preserve `zod` / `@opencode-ai/plugin` alignment and public tool transport shape
Constraint: Accept only a narrow 5 KiB bundle-budget increase for release-bound schema normalization
Rejected: Remove legacy parsing outright | existing persisted sessions and older callers still need read/input compatibility
Rejected: Dual-write legacy fields in new persisted output | that would keep the old vocabulary active instead of making it compatibility-only
Rejected: Broaden the release into new review gates or tool surfaces | the requested change is terminology cleanup with compatibility shims
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep future review evidence terminology canonical in active prompts, schemas, generated surfaces, and fixtures; legacy names should stay confined to compatibility shims/tests
Tested: active terminology searches for source/test/bench and generated prompt surfaces; `bun run typecheck`; `bun run lint`; targeted schema/final-review/worker-result tests; `bun test`; `bun run build`; `bun run check`
Not-tested: Live OpenCode UI final-review submission using legacy payload terms; live GitHub-hosted CI/release workflow run for tag `v2.0.25` before push

## [2.0.24] - 2026-05-09

Make review-scope recovery scaffold-safe

Flow 2.0.24 hardens review and review-and-fix completion recovery around `reviewScopeLedger`. Recovery details now label `exampleReviewScopeLedger` as scaffold-only guidance, and generated example entries carry an explicit scaffold residual-risk placeholder so the runtime can distinguish guidance from reviewer evidence.

The runtime now rejects blind scaffold replay. Worker completion payloads and final reviewer decisions that resubmit the scaffold placeholder unchanged fail with review-scope accounting recovery, while a retry with evidence-grounded scope entries and truthful residual risk succeeds. This keeps structured recovery helpful without allowing the runtime-provided example to become fake review evidence.

Prompt, command, and OpenCode tool guidance now tell workers and reviewers to reassess every declared scope, replace scaffold residual risk, avoid resending identical decisions, and use finding refs only when mapped to the declared scope. The investigation notes also clarify that the observed “runtime provided the missing scope ledger entries” retry wording was expected recovery behavior with misleading prose, not proof that review work had already been done.

The release deliberately does not add commands, tools, runtime modes, package exports, dependencies, state paths, worker/reviewer payload shapes, or automatic finding-ref assignment. It preserves `zod` / `@opencode-ai/plugin` alignment, keeps review-scope recovery as guidance rather than evidence, and records the separate newest-OpenCode-plugin regression investigation as pending documentation only.

Constraint: Treat recovery examples as scaffold-only guidance, never as completed review evidence
Constraint: Require evidence-grounded `reviewScopeLedger` entries with truthful residual risk before review/review-and-fix completion can pass
Constraint: Preserve the existing public tool surface and payload shape while tightening validation semantics
Constraint: Keep dependency and SDK-boundary versions unchanged
Rejected: Let agents replay `exampleReviewScopeLedger` unchanged | that can convert runtime guidance into unsupported review evidence
Rejected: Auto-assign closed finding refs from recovery candidates | candidates still require reliable scope mapping before they become ledger evidence
Rejected: Add a new recovery or review tool | existing structured recovery details and retry paths are sufficient
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep future recovery examples explicitly labeled as non-evidence and pair any scaffold payloads with validation that rejects unchanged placeholders
Tested: `bun test tests/completion-gates.test.ts tests/runtime/final-review-contracts.test.ts tests/runtime-tools.test.ts tests/config/prompt-contracts.test.ts tests/recovery-hint-parity.test.ts tests/protocol-parity.test.ts` (130 pass, 1229 expect calls); `bunx biome check src/runtime/domain/review-scope-accounting.ts tests/completion-gates.test.ts tests/runtime/final-review-contracts.test.ts --files-ignore-unknown=true`; `bun run typecheck`; `bun run check`
Not-tested: Live OpenCode UI final-review recovery retry; live newest-OpenCode-plugin regression reproduction; live GitHub-hosted CI/release workflow run for tag `v2.0.24` before push

## [2.0.23] - 2026-05-08

Make singleton runtime retries idempotent and artifact-repairable

Flow 2.0.23 narrows retry noise around singleton runtime transitions without expanding the public surface. Review, plan approval, and run-start paths now distinguish requested tool metadata from persisted state more clearly, and identical singleton retries no-op instead of rewriting state where the runtime can prove the requested transition is already applied.

The release also makes no-op mutation retries artifact-repairable. A lost-response retry that reloads an already-mutated session still skips the session-state save, but it now runs artifact sync when the action's `syncArtifacts` contract allows it. This preserves idempotent state writes while letting retries repair missing rendered artifacts after a partial save/sync failure.

Execution-start retry handling is now aligned with prompt guidance. An implicit `flow_run_start({})` retry no-ops only when the current active feature is already `in_progress`; explicit attempts to switch to a different feature while one is active still fail. Review-record behavior is documented as current identical-decision no-op behavior plus changed-decision singleton overwrite, with no reviewer-history append.

The release deliberately does not add commands, tools, runtime modes, package exports, dependencies, state paths, worker/reviewer payload shapes, or history-appending completion idempotency. It keeps completion calls non-idempotent without new worker evidence, preserves snapshot-primary runtime persistence, keeps prompts/docs descriptive rather than authoritative over runtime semantics, and accepts a narrow 6 KiB bundle-budget increase for release-bound retry/idempotency metadata and guidance.

Constraint: Treat runtime tool metadata as request progress until the structured response confirms persisted state
Constraint: Preserve singleton no-op behavior only where the runtime can prove the same transition is already applied
Constraint: Keep no-op retries artifact-repairable without saving session state again
Constraint: Preserve completion history semantics; do not make `flow_run_complete_feature` idempotent without new worker evidence
Constraint: Accept only a narrow 6 KiB bundle-budget increase for release-bound retry/idempotency metadata and prompt guidance
Rejected: Make all repeated runtime calls successful no-ops | history-appending completion and changed reviewer decisions carry new evidence/state and must remain explicit
Rejected: Add new runtime status or retry tools | existing status, recovery metadata, and no-op transitions are sufficient
Rejected: Broaden prompt guidance into runtime authority | runtime transitions remain the behavior source of truth; prompts only describe safe retry boundaries
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep future retry/idempotency work transition-specific, test-backed, and explicit about whether artifacts sync, session state saves, or history rows are appended
Tested: `bun test tests/runtime-tools-metadata.test.ts tests/runtime-tools.test.ts tests/config/prompt-contracts.test.ts tests/reviewer-decision-scope.test.ts tests/runtime/plan-and-tool-schema-contracts.test.ts tests/prompt-snapshot.test.ts tests/prompt-eval-corpus.test.ts` (76 pass, 1314 expect calls); focused runtime/prompt/tool/docs gate bundle (133 pass, 2587 expect calls); `bun run eval:prompt-capture:check`; `bun run eval:review-capture:check`; `bun run typecheck`; final focused RepoPrompt review for doc/export blockers; `bun run check`
Not-tested: Live OpenCode UI session exercising lost-response retry rendering; live GitHub-hosted CI/release workflow run for tag `v2.0.23` before push

## [2.0.22] - 2026-05-08

Make attachment materialization runtime-guided and content-policy explicit

Flow 2.0.22 tightens the `/flow-auto` attachment contract introduced in 2.0.21. Auto preparation now exposes attachment availability as runtime-owned `attachmentGuidance`, and prompt/mode contracts instruct coordinators to materialize attachments only when `attachmentGuidance.materializationRequired` is true, using the provided tool and args before planning, repository inspection, or Task/subagent handoff.

The release also clarifies that supported attachment formats are MIME/content-policy based rather than filename-extension trust based. Captured file names are used only for safe slug bases; materialization normalizes MIME, requires matching data URL MIME, verifies image magic bytes, and writes canonical extensions from the validated MIME policy. A JPEG uploaded with a misleading `.png` filename therefore imports as `.jpg`, not as the user-provided extension.

The release deliberately does not expand attachment ingress. It adds no commands, runtime modes, package exports, dependencies, state paths, persisted attachment indexes, SVG support, raw base64 transport, filesystem path imports, `file:` imports, or HTTP URL imports. It keeps binary assets outside `.flow/**`, preserves `zod` / `@opencode-ai/plugin` alignment, and accepts a narrow 4 KiB bundle-budget increase for runtime attachment guidance snapshots and coordinator instructions.

Constraint: Treat attachment materialization as a runtime-guided preparation contract, not a prompt-inferred goal classification
Constraint: Keep the format restriction MIME/content-policy based; never trust the uploaded filename extension for validation or output extension selection
Constraint: Preserve the 2.0.21 ingress boundary: supported `data:` image attachments only, root-bound destinations, no `.flow/**` asset writes, no dependency-version changes, and only a narrow 4 KiB bundle-budget increase
Rejected: Materialize based on whether prose appears attachment-dependent | the runtime already knows current/latest attachment availability and skipped unsupported records
Rejected: Preserve user-supplied filename extensions | filenames are untrusted metadata and may not match the payload MIME or bytes
Rejected: Broaden attachment sources or formats in this patch | SVG, raw base64, filesystem, `file:`, and HTTP sources need separate threat-model review
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep future attachment changes driven by explicit runtime attachment guidance and validated MIME/content policy, not model inference or filename suffixes
Tested: `bun test tests/attachment-materialization.test.ts tests/auto-prepare.test.ts tests/config/plugin-surface.test.ts tests/config/prompt-contracts.test.ts tests/runtime-tool-routing.test.ts tests/prompt-mode-behavior-eval.test.ts tests/docs-stale-reference-policy.test.ts` (86 pass, 1298 expect calls); `bun run typecheck`; `bun run eval:prompt-capture:check`; `bunx biome check ... --files-ignore-unknown=true`; `bun run check`
Not-tested: Live OpenCode UI attachment upload session; live GitHub-hosted CI/release workflow run for tag `v2.0.22` before push

## [2.0.21] - 2026-05-08

Materialize OpenCode image attachments before Flow automation planning

Flow 2.0.21 adds a narrow attachment-ingress bridge for `/flow-auto` goals that depend on user-supplied images. The OpenCode plugin now captures supported chat/file parts for the active session and exposes `flow_attachments_materialize`, a coordinator-only tool that imports PNG, JPEG, WebP, GIF, and AVIF `data:` attachments into explicit workspace asset paths before planning, implementation inspection, or Task/subagent handoff.

The release is a deliberate surface-freeze exception: it adds one public Flow tool because the previous behavior left chat-visible image attachments unavailable as shell-readable project files, forcing manual user file placement. The new tool is bounded to `/flow-auto`, returns workspace-relative paths for plan/evidence handoff, and keeps binary assets outside `.flow/**`; Flow session state remains snapshot-primary and derived docs remain markdown artifacts only.

The materialization path is intentionally conservative. It allowlists image MIME types, keeps SVG unsupported, rejects raw base64, filesystem, `file:`, and HTTP URL sources, enforces data-size limits before decode, sanitizes filenames, prevents traversal and `.flow/**` destinations, rejects symlink destination ancestry, and writes final files exclusively with deterministic collision suffixes. Unsupported or stale attachments are reported as skipped metadata instead of silently falling back to older captured files.

Prompt, mode, descriptor, docs, and schema contracts now teach `flow-auto` to follow the runtime `attachmentGuidance.materializationRequired` field from `flow_auto_prepare`: when true, materialize with the provided tool/args before planning or handoff; when false, do not call the tool. Planner/worker/reviewer handoffs should receive concrete imported paths rather than chat-only attachment references.

The release deliberately does not add commands, runtime modes, package exports, dependencies, state paths, worker/reviewer payload shapes, evidence-packet binary transport, or persisted attachment indexes. It preserves `zod` / `@opencode-ai/plugin` alignment and accepts a narrow bundle budget increase for the release-bound attachment capture, policy, and root-safe materialization guards.

Constraint: Add exactly one narrow `/flow-auto` workspace tool to bridge supported OpenCode image attachments into project asset files
Constraint: Keep imported binary assets outside `.flow/**`; Flow-owned state remains session JSON plus derived markdown docs
Constraint: Preserve worker/reviewer/tool JSON payload contracts except for the explicit `flow_attachments_materialize` raw arg schema
Constraint: Preserve `zod` / `@opencode-ai/plugin` alignment; no dependency-version changes
Constraint: Accept only a narrow bundle budget increase for attachment capture, validation, and exclusive-write safety guards
Rejected: Treat chat attachments as filesystem files without materialization | OpenCode file parts are model-visible context and may not be shell-readable workspace paths
Rejected: Store attachment bytes or imported assets under `.flow/**` | Flow state paths are runtime/session artifacts, not project asset storage
Rejected: Support SVG, raw base64, filesystem paths, `file:`, or HTTP URLs now | those sources need separate trusted-origin and threat-model review
Rejected: Reuse evidence packets or worker artifacts as binary transport | those contracts are metadata references, not attachment byte channels
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep future attachment ingress narrow, permissioned, root-bound, and explicitly documented before expanding formats or source URL support
Tested: `bun test tests/attachment-materialization.test.ts tests/config/plugin-surface.test.ts tests/config/tool-schemas.test.ts tests/runtime-tools-metadata.test.ts tests/config/prompt-contracts.test.ts tests/mode-contracts.test.ts tests/prompt-mode-behavior-eval.test.ts tests/smoke/dist-load.test.ts` (88 pass, 2095 expect calls); `bun run typecheck`; `bun run check` before tag push
Not-tested: Live OpenCode UI attachment upload session; live GitHub-hosted CI/release workflow run for tag `v2.0.21` before push

## [2.0.20] - 2026-05-08

Make feature identifiers drill down to Flow-rendered feature docs

Flow 2.0.20 connects visible `featureId` references in status, history, execution, review, and metadata surfaces to the existing Flow-rendered per-feature markdown artifact. Feature drilldowns are presentation-only targets over `.flow/active`, `.flow/stored`, and `.flow/completed` docs; canonical session state, worker results, reviewer decisions, and tool argument schemas remain unchanged.

The release hardens path handling around explicit drilldown sources. Caller-provided session directories and session paths must resolve under the expected Flow lifecycle root, and malformed or missing docs degrade to unavailable drilldown metadata instead of breaking read-only status/history responses. This preserves passive feature inspection without creating subagent sessions or widening runtime persistence.

Status and history presenters now own the fallback resolver for feature docs. Active, stored, and completed sessions can expose available feature-doc targets when rendered docs exist, while pruned or not-yet-rendered feature docs surface as missing drilldowns that still point at the intended artifact location.

The release deliberately does not add commands, tools, runtime modes, package exports, dependencies, state paths, or worker/reviewer schema changes. It keeps feature drilldowns in summary, presenter, history, and metadata layers, matching the existing Flow artifact lifecycle rather than introducing child-session navigation for passive inspection. It accepts a narrow 5 KiB bundle budget increase for release-bound drilldown presentation and path-hardening code.

Constraint: Treat feature drilldown as a derived presentation model over Flow-owned rendered artifacts and session history
Constraint: Keep active/stored/completed session path derivation root-bound under `.flow/**`
Constraint: Preserve worker/reviewer/tool JSON schemas and persisted session shape; no dependency-version changes
Constraint: Accept only a narrow 5 KiB bundle budget increase for release-bound feature drilldown presentation and path-hardening code
Rejected: Open or create subagent sessions for passive `featureId` inspection | subagents represent delegated planner/worker/reviewer work, while feature docs already provide the passive detail target
Rejected: Add a new persisted drilldown index | status/history can derive the target from existing session roots and feature ids
Rejected: Fail status/history when optional feature docs are malformed or missing | drilldown is presentation-only and must degrade without blocking read surfaces
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep future feature-inspection UX in artifact/presenter metadata layers unless a concrete runtime state requirement justifies schema expansion
Tested: `bun test tests/feature-doc-drilldown.test.ts tests/runtime-operator-history.test.ts tests/runtime-summary.test.ts tests/runtime-tools-metadata.test.ts` (46 pass, 338 expect calls); `bun run typecheck`; `bun run check` before tag push
Not-tested: Live GitHub-hosted CI/release workflow runs for tag `v2.0.20` before push

## [2.0.19] - 2026-05-08

Make subagent work visible without weakening Flow runtime contracts

Flow 2.0.19 adds a derived task-progress projection for Flow sessions so operators can see planning, execution, validation, review, final-review, and recovery work as concise task rows in status summaries, history responses, rendered session docs, and OpenCode action metadata. The projection is presentation-only: worker results, reviewer decisions, tool payloads, and persisted session schemas remain the runtime-owned machine contracts.

The release also updates prompt guidance around role-aware Task/subagent handoffs. Coordinators can split independent planning, implementation, and review work into fresh child contexts, while leaf reviewer/audit roles stay evidence-backed report producers rather than recursive orchestrators. This keeps the investigation recommendation grounded in current runtime ownership: prompts describe orchestration, and Flow tools still own state transitions.

Stored-session history now keeps parked-session UX consistent. When `flow_history_show` displays a non-completed stored session, task-progress rows and operator summaries point to session activation instead of direct work that would not update the parked runtime state. Completed and active session summaries keep their existing task-progress behavior.

The release deliberately does not add commands, tools, runtime modes, state paths, package exports, dependencies, or worker/reviewer schema changes. It accepts a narrow bundle budget increase for the release-bound task-progress presentation code while preserving direct JSON tool contracts, `zod` / `@opencode-ai/plugin` alignment, and snapshot-primary runtime persistence.

Constraint: Keep task/session progress as a derived presentation model over canonical session, history, validation, review, and tool metadata
Constraint: Preserve worker/reviewer/tool JSON schemas and direct OpenCode `tool(...)` arg shapes without stringified or nested transport wrappers
Constraint: Keep `zod` aligned with `@opencode-ai/plugin`; no dependency-version changes in this release
Constraint: Accept only a narrow 8 KiB bundle budget increase for release-bound task-progress projection and presentation code
Rejected: Replace worker/reviewer JSON with prose | runtime schemas, adapter schemas, completion gates, and regression tests depend on strict machine-readable payloads
Rejected: Add first-class child-session tree persistence now | current runtime history is flat and feature/session-oriented, so projection-first UX avoids a schema migration
Rejected: Let parked stored sessions show direct work next steps | direct work outside Flow would not update parked runtime records, so activation must be the visible next action
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep future subagent/task UX improvements in summary, presenter, render, history, and metadata layers unless a concrete runtime requirement justifies persisted child-session modeling
Tested: `bun test tests/runtime-operator-history.test.ts tests/runtime-summary.test.ts tests/runtime-tools-metadata.test.ts tests/runtime-actionable-metadata.test.ts tests/config/prompt-contracts.test.ts` (62 pass, 735 expect calls); `bun run typecheck`; `bun run check` before tag push
Not-tested: Live GitHub-hosted CI/release workflow runs for tag `v2.0.19` before push

## [2.0.18] - 2026-05-08

Restore the hosted generated-drift lane after the Flow Core release

Flow 2.0.18 is a fix-forward release for the hosted CI failure observed immediately after `v2.0.17`. The `v2.0.17` release workflow published successfully, but the main-branch CI generated-drift preflight still invoked Bun with the old test-name pattern `descriptor family parity`. The descriptor suite was intentionally renamed around the smaller OpenCode registry, so the hosted pattern matched zero tests even though the local full `bun run check` path had passed.

This release keeps the Flow Core snapshot-first simplification from `v2.0.17` unchanged. It updates the generated-drift package script to use the renamed descriptor parity suite selector, preserving the same registry/projection/docs parity surface while matching the current test contract.

The release deliberately does not add commands, tools, runtime modes, state paths, package exports, dependencies, or behavior changes. It only restores hosted CI coverage for generated descriptor drift after the descriptor-suite rename.

Constraint: Fix the hosted CI lane without rewriting the already-pushed `v2.0.17` tag or weakening generated-drift coverage
Constraint: Preserve the `v2.0.17` Flow Core snapshot-first product contract unchanged
Constraint: Keep `zod` aligned with `@opencode-ai/plugin`; no dependency-version changes in this patch
Rejected: Force-move `v2.0.17` | the release workflow already succeeded and the tag was pushed, so fix-forward is safer and more auditable
Rejected: Remove descriptor parity from generated-drift checks | that would weaken the release gate that caught the stale test selector
Rejected: Keep the stale `descriptor family parity` selector | it no longer names the active descriptor parity suite and matched zero hosted tests
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Keep generated-drift selectors synchronized with descriptor parity suite names when the suite is renamed
Tested: `bun run check:generated-drift`; `bun run check`
Not-tested: Live GitHub-hosted CI/release workflow runs for tag `v2.0.18` before push

## [2.0.17] - 2026-05-08

Make Flow Core snapshot-first and retire replay infrastructure

Flow 2.0.17 completes the current simplification pass by freezing the supported Flow Core vNext contract around runtime transitions, the session-engine persistence boundary, and snapshot-first active/stored/completed session state. The new Flow Core facade exposes compact command and query names without becoming a second state engine; transitions still own behavior, and the session engine still owns load -> transition -> save -> render synchronization.

The release replaces duplicated OpenCode descriptor/projection metadata with a smaller tool registry that keeps tool names, runtime bindings, mode visibility, descriptions, and docs metadata in one local surface. Generated projections and docs rows now derive from that smaller registry instead of preserving a broader duplicated descriptor family.

Replay/event/checkpoint/projection persistence is intentionally retired as a product-supported surface. The live product path was already snapshot-primary, so the release deletes the core workflow replay wrappers, event/checkpoint/projection stores, replay tests, and event-store benchmark while keeping runtime transition invariants, session history, rendered artifacts, and the new snapshot persistence gate. Historical release and investigation docs may still mention the retired replay architecture as historical evidence.

Strict review governance is narrowed to review/review-and-fix or explicit strict review modes. Ordinary implementation flows keep compact completion safety, while supplied final-review behavior evidence is still sanity-checked so approved/passing final reviews cannot carry `needs_fix`, unsafe refs, or validation refs that were not actually recorded.

The release deliberately does not add commands, tools, runtime modes, package exports, dependencies, or looser completion paths. It retires unsupported replay state surfaces in favor of the documented snapshot-first contract and keeps `zod` / `@opencode-ai/plugin` alignment unchanged.

Constraint: Preserve runtime transition authority and session-engine snapshot persistence while deleting duplicated replay/product metadata surfaces
Constraint: Retire `.flow/events`, `.flow/checkpoints`, and `.flow/projections` as supported product state paths without changing active/stored/completed session snapshots
Constraint: Keep command names, tool names, package exports, dependencies, and `zod` / `@opencode-ai/plugin` alignment stable
Rejected: Keep event/checkpoint/projection stores as dormant compatibility code | dead product surfaces would keep release gates and architecture shaped around unsupported replay behavior
Rejected: Treat the new Flow Core facade as a new state engine | it is only a command/query boundary over existing runtime application handlers and transitions
Rejected: Drop all behavior-evidence checks outside strict review mode | supplied invalid evidence must still fail even when strict completeness is optional
Confidence: high
Scope-risk: broad
Reversibility: moderate
Directive: Keep Flow Core vNext snapshot-first unless a future release deliberately reintroduces event-sourced persistence with migration, public state-path docs, and replay gates
Tested: `bun test tests/runtime-tool-routing.test.ts tests/completion-gates.test.ts` (47 pass, 319 expect calls); `bun run typecheck`; touched-file Biome; `bun run check`
Not-tested: Live GitHub-hosted CI/release workflow runs for tag `v2.0.17` before push

## [2.0.16] - 2026-05-07

Harden review-scope recovery accounting before release

Flow 2.0.16 closes the release-readiness gaps in the review-scope accounting contract. Recovery examples now stay conservative: they list closed finding refs as candidates, but no longer assign every closed finding to every declared scope. Agents must map findings to the specific scope they actually prove before using `finding_closed`.

Completion and reviewer validation now route review-scope failures through structured failure kinds instead of substring matching. Worker completion recovery remains tied to worker evidence, while final-reviewer recovery now points at the recorded final reviewer decision when the reviewer approval ledger is the failing artifact.

Historical completed feature evidence is accepted only when its `reviewScopeLedger` is structurally valid and covers every declared scope for that feature. Recursive glob review targets also use standard globstar semantics, so `src/**/*.ts` grounds both `src/index.ts` and nested TypeScript paths without broadening unsupported bracket or brace glob syntax.

The release deliberately does not add commands, tools, runtime modes, state paths, package exports, dependencies, or looser completion paths. It narrows recovery guidance and historical evidence reuse while preserving the existing review/review-and-fix surface. The bundle sanity ceiling moves from 708 KiB to 716 KiB to account for the added release-critical recovery checks while preserving a fixed budget check.

Constraint: Preserve strict review and review-and-fix completion gates without changing persisted session shape
Constraint: Keep recovery details machine-readable while avoiding automatic closed-finding-to-scope assignment
Constraint: Accept only a narrow 8 KiB bundle budget increase for release-critical recovery/accounting checks
Constraint: Keep `zod` aligned with `@opencode-ai/plugin`; no dependency-version changes in this patch
Rejected: Populate every recovery example scope with all closed finding refs | that overstates which findings were actually mapped to each declared scope
Rejected: Select review-scope recovery by matching error-message substrings | structured failure kinds are safer and keep worker vs final-reviewer recovery targets explicit
Rejected: Let partial historical ledgers or one-directory-only globstar behavior satisfy final accounting | both would silently drop declared review scope evidence
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep review-scope ledgers scoped and evidence-grounded; historical completions can contribute only after every declared feature scope is accounted
Tested: `bun test tests/completion-gates.test.ts tests/runtime-tools.test.ts` (48 pass, 395 expect calls); `bun run typecheck`; targeted Biome; targeted completion/recovery gates and `bun run check` before tag push
Not-tested: Live GitHub-hosted CI/release workflow runs for tag `v2.0.16` before push

## [2.0.15] - 2026-05-07

Preserve review-and-fix closure obligations across planning refreshes

Flow 2.0.15 closes the follow-up release gap in the new `planning.reviewFindings` remediation contract. Active `review_and_fix` sessions can still refresh planning evidence, but they can no longer remove recorded findings through `record_planning_context` while the plan depends on those findings for completion. Final completion now keeps the original remediation obligation intact until every planned finding is closed with fix, test, validation, ledger, final-review, and reviewer-approval evidence.

The release also consolidates review-finding closure policy into a small runtime-domain helper instead of leaving closure ledger checks and planned-finding closure checks split across transition-local helpers. Completion transitions still own recovery routing and gate order, while the domain helper owns the closure-policy text and missing-ref calculation.

Final-review coverage gap accounting now treats whitespace-only `suggestedValidation` entries as missing. If a review context pack records coverage gaps, the final review must carry those gaps forward and provide real follow-up validation guidance rather than satisfying the contract with blank strings.

The release deliberately does not add commands, tools, runtime modes, state paths, package exports, dependencies, or looser completion paths. It narrows the existing review-and-fix contract and keeps the review-first/remediation split from 2.0.14 intact.

Constraint: Preserve strict `review_and_fix` finding closure after planning context refreshes without changing persisted session shape
Constraint: Keep completion/reviewer gate recovery behavior unchanged while moving closure-policy checks into a focused domain helper
Constraint: Keep `zod` aligned with `@opencode-ai/plugin`; no dependency-version changes in this patch
Rejected: Treat empty `planning.reviewFindings` refreshes as valid during active `review_and_fix` execution | this would erase the runtime-owned remediation baseline before final completion
Rejected: Store a new persisted immutable findings baseline in this release | guarding the mutation ingress fixes the bypass without a migration or state-shape change
Rejected: Let whitespace-only suggested validation satisfy coverage gaps | blank follow-up guidance weakens final-review evidence quality
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Do not remove `planning.reviewFindings` from an active `review_and_fix` session unless replanning out of remediation mode first; every planned finding must remain auditable through closure evidence before final completion
Tested: `bun run typecheck`; `bun run lint`; `bun test tests/completion-gates.test.ts tests/runtime/evidence-packets.test.ts tests/runtime/final-review-contracts.test.ts` (63 pass, 405 expect calls); targeted release gates and `bun run check` before tag push
Not-tested: Live GitHub-hosted CI/release workflow runs for tag `v2.0.15` before push

## [2.0.14] - 2026-05-07

Route no-findings review-and-fix work through review-first discovery

Flow 2.0.14 fixes the review-and-fix quality regression where broad codebase review requests with no concrete findings could be planned as a single `review_and_fix` feature and then degrade into repeated completion-payload retries. Planning now has an explicit `planning.reviewFindings` context ledger for concrete existing review findings, and `review_and_fix` plan application fails fast when that ledger is empty.

No-findings review-and-fix requests now stay in `goalMode: review` for audit/discovery first. Once a review produces concrete findings, a remediation replan can use `goalMode: review_and_fix` with those findings recorded in `planning.reviewFindings`, preserving the strict finding-to-fix-to-validation chain.

The release deliberately keeps the existing completion gates strict. Real `review_and_fix` remediation still requires closure evidence, review-scope accounting, final-review evidence, and reviewer approval; this patch changes when remediation mode may start, not what it must prove before completion.

Prompt contracts, planner/auto/planning-researcher guidance, and prompt-mode calibration fixtures now mirror the runtime rule: no findings means review-first discovery, known findings means strict remediation. Regression coverage locks both paths, including inline-only `planning.reviewFindings` acceptance and audit-only no-findings calibration.

Constraint: Add only a narrow planning-context contract for concrete review findings; do not add commands, tools, runtime modes, state paths, package exports, or dependencies
Constraint: Accept a narrow raw tool-schema budget increase for `planning.reviewFindings` while keeping the bundle sanity budget unchanged
Constraint: Preserve strict `review_and_fix` completion gates for actual remediation with known findings
Constraint: Keep `zod` aligned with `@opencode-ai/plugin`; no dependency-version changes in this patch
Rejected: Loosen `reviewFindingClosures`, `reviewScopeLedger`, or final-review requirements for no-change completions | that would make shallow review-and-fix completion easier instead of forcing discovery first
Rejected: Keep broad no-findings review-and-fix as a single remediation feature | it frames the agent around completion accounting before findings exist
Rejected: Infer known findings from natural-language goals alone | `planning.reviewFindings` gives the runtime and prompts a concrete, auditable prerequisite
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Use `goalMode: review_and_fix` only after concrete findings are recorded in `planning.reviewFindings`; broad review-and-fix/codebase-review requests without findings must start as `goalMode: review`
Tested: `bun test tests/config/prompt-contracts.test.ts tests/plan-graph-validation.test.ts tests/prompt-mode-behavior-eval.test.ts tests/prompt-mode-capture.test.ts tests/runtime/plan-and-tool-schema-contracts.test.ts tests/completion-gates.test.ts tests/runtime/evidence-packets.test.ts` (91 pass, 1262 expect calls); `bun test tests/config/tool-schemas.test.ts`; `bun run build` plus bundle sanity at 720706 bytes; `bun run typecheck`; `bun run lint`; Oracle review found no blockers and P2 follow-ups were applied; `bun run check`
Not-tested: Live GitHub-hosted CI/release workflow runs for tag `v2.0.14` before push

## [2.0.13] - 2026-05-07

Dedupe final-completion tool guidance in subagent prompts

Flow 2.0.13 narrows the worker and autonomous subagent prompt surfaces so final-completion tools appear as concrete calls only where they are operationally needed. The hard allowed-tool contract still lists `flow_review_record_final` and `flow_run_complete_feature`, and the workflow steps still name the exact persistence calls for the final-review and completion gates.

The surrounding policy fragments and role examples now refer to the canonical feature/final review-record runtime tool instead of repeating the same literal tool names. This preserves the final-completion path while reducing prompt noise that could make subagents treat the guidance as multiple independent obligations.

Regression coverage now counts rendered worker and auto prompt occurrences for `flow_review_record_final` and `flow_run_complete_feature`, keeping both bounded to two appearances per subagent prompt while preserving presence checks and mode-contract/tool-surface parity.

Constraint: Reduce prompt repetition without renaming tools, adding tools, changing runtime state, or weakening final completion gates
Constraint: Keep the mode contract as the public allowed-tool source of truth
Constraint: Keep `zod` aligned with `@opencode-ai/plugin`; no dependency-version changes in this patch
Rejected: Remove exact tool names from workflow steps | subagents still need precise final-review and completion persistence calls at the point of action
Rejected: Keep all repeated exact names in fragments and role examples | redundant literal mentions increase prompt noise without adding contract clarity
Rejected: Add runtime idempotency changes in this release | the issue addressed here is prompt duplication, not evidence of duplicate runtime registrations
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Keep exact final-completion tool names in allowed-tool contracts and concrete workflow actions; use canonical prose elsewhere unless a literal call is required
Tested: rendered prompt occurrence check for worker/auto subagents; `bun test tests/config/prompt-contracts.test.ts tests/mode-contracts.test.ts`; `bun run typecheck`; `bun run lint`; Oracle review found no blocker; `bun run check`
Not-tested: Live GitHub-hosted CI/release workflow runs for tag `v2.0.13` before push

## [2.0.12] - 2026-05-07

Harden review-scope evidence grounding after false-negative review passes

Flow 2.0.12 closes the false-negative gaps found in the review-scope accounting gates. Review and review-and-fix completions now require each `reviewScopeLedger` entry to cite concrete artifact evidence grounded in the declared scope; validation commands can still supplement evidence, but they can no longer be the only proof for every target.

The release tightens scope matching without expanding the public tool surface. File targets accept line-suffixed artifact refs, glob targets use path-aware `*`, `**`, and `?` matching instead of prefix matching, and unsupported bracket/brace glob syntax is conservatively rejected rather than treated as broad evidence. Domain and surface targets now apply kind-aware grounding, while workflow/custom targets require explicit path-like targets instead of fuzzy substring matches.

Behavior-led final-review evidence was also narrowed so non-concrete declared scope labels such as `runtime` or wildcard targets cannot ground behavior refs. Regression coverage locks the previous misses: unrelated concrete paths for `domain:runtime`, nested/wrong-extension glob refs, validation-only ledger evidence, file line refs, and behavior refs grounded only by non-concrete scope labels.

The bundle sanity ceiling moves from 700 KiB to 704 KiB to account for the additional release-gate safety logic while preserving a fixed budget check.

Constraint: Fix review false negatives without adding commands, tools, state paths, package exports, or dependencies
Constraint: Accept only a narrow 4 KiB bundle budget increase for the new safety checks
Constraint: Keep `zod` aligned with `@opencode-ai/plugin`; no dependency-version changes in this patch
Rejected: Let validation commands alone close every declared review scope | generic commands do not prove which scope was reviewed
Rejected: Keep prefix-only glob matching | it accepts nested and wrong-extension files outside the declared pattern
Rejected: Use non-concrete scope labels as behavior evidence | labels such as `runtime` are audit scope metadata, not artifact refs
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Treat review-scope ledger evidence as concrete scoped proof; use validation commands as supporting evidence, not as a substitute for grounded artifact refs
Tested: `bun test tests/runtime/final-review-contracts.test.ts tests/completion-gates.test.ts` (49 pass, 338 expect calls); `bun test tests/config/tool-schemas.test.ts` (10 pass, 419 expect calls); `bun run typecheck`; `bun run lint`; `bun run check`
Not-tested: Live GitHub-hosted CI/release workflow runs for tag `v2.0.12` before push

## [2.0.11] - 2026-05-06

Require review-scope accounting before broad audit completion

Flow 2.0.11 hardens broad review and review-and-fix workflows with a runtime-owned review scope ledger. Review-shaped plans must now declare an effective scope through `reviewScope` or `fileTargets`, and final completion cannot reduce a full audit request to one closed finding unless every declared target is accounted as reviewed with no findings, finding closed, deferred, out of scope, or blocked with evidence and residual risk.

The release keeps artifact-derived final-review coverage separate from audit-scope closure. `reviewScopeLedger` is carried through worker results, execution history, and final reviewer approvals, while implementation-mode one-file workflows remain valid without the new ledger. Historical completed feature closures can satisfy final review-and-fix scope where appropriate, but failed historical attempts cannot be cited as completion evidence.

The OpenCode adapter, descriptors, prompt contracts, recovery guidance, generated completion-gate projections, architecture notes, and prompt snapshots now surface the new scope-accounting contract. Regression coverage models broad one-file fixes, multi-feature historical closures, failed-attempt evidence rejection, plan scope requirements, effective scope-id collisions, and the preserved implementation-mode path.

Constraint: Add audit-scope completion accounting without requiring edits to every declared target file
Constraint: Keep final-review `reviewedSurfaces` artifact-derived; do not overload it into a whole-audit ledger
Constraint: Keep `zod` aligned with `@opencode-ai/plugin`; no dependency-version changes in this patch
Rejected: Treat broad review completion as mutation-count coverage | legitimate audits may fix one file while still reviewing or deferring the rest of the declared scope
Rejected: Infer audit breadth from natural-language goals at completion time | structured `reviewScope` / `fileTargets` gives the runtime an auditable source of truth
Rejected: Let failed historical attempts satisfy final reviewer `finding_closed` scope entries | rejected attempts can contain unsupported closure refs and must not become completion evidence
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: For `review` and `review_and_fix` plans, declare scope explicitly and close it with `reviewScopeLedger`; use `deferred`, `out_of_scope`, or `blocked` for honest residual-risk accounting rather than narrowing silently
Tested: `bun run lint`; `bun run typecheck`; `bun test` (543 pass, 0 fail, 1 snapshot, 17064 expect calls); Oracle review follow-ups fixed and revalidated with targeted completion, final-review, prompt, plan, schema, protocol, recovery, and snapshot suites
Not-tested: Live GitHub-hosted CI/release workflow runs for tag `v2.0.11` before push

## [2.0.10] - 2026-05-06

Require behavior-grounded final review approvals

Flow 2.0.10 hardens final-review approval from surface accounting into behavior-grounded evidence. Live final-review and `flow_review_record_final` inputs now require explicit `evidenceRefs` while persisted sessions keep their backcompat parse path, and reviewer-decision normalization preserves behavior checks plus validation coverage so approval-time validation can fail fast before shallow approvals are recorded.

The release adds a required behavior-risk ledger for async ordering, lifecycle reentrancy, state rollback, persistence recovery, interaction, accessibility, and test-oracle authenticity risks. Runtime-derived required risks must be passed or gap-recorded with grounded refs and validation coverage, behavior refs are normalized against safe repo-relative evidence, source-only multi-domain app changes now trigger behavior accounting, and audit reports cross-check behavior validation refs against `validationRun` while still allowing grounded `needs_fix` findings.

The release also records the soft-focus final-review miss investigation and removes redundant Knip ignore configuration after deadcode diagnostics proved the ignored type-contract files no longer need explicit suppression.

Constraint: Harden final-review approval contracts without adding commands, tools, state paths, package exports, or dependency versions
Constraint: Keep `zod` aligned with `@opencode-ai/plugin`; no dependency-version changes in this patch
Rejected: Let persisted-session compatibility defaults leak into live `flow_review_record_final` args | omitted evidence refs could parse as present and weaken final-review recording
Rejected: Allow runtime-derived required behavior risks to use prose-only `not_applicable` | shallow approvals could bypass async/lifecycle/state accounting without proof or gap records
Rejected: Reuse final-approval `needs_fix` rejection unchanged for audit reports | audits must be able to report grounded behavior findings that still need fixes
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Treat final-review approval as behavior-ledger validation, not just surface coverage; keep required risks grounded in changed artifacts, context packs, tests, or validation evidence before approving final work
Tested: `bun test tests/runtime/final-review-contracts.test.ts tests/completion-gates.test.ts tests/config/tool-schemas.test.ts tests/runtime/evidence-packets.test.ts` (56 pass, 700 expect calls); `bun run typecheck`; `bun run deadcode`; `bun run check:fresh-surfaces`; `bun test tests/docs-stale-reference-policy.test.ts` (3 pass); `bun run check`
Not-tested: Live GitHub-hosted CI/release workflow runs for tag `v2.0.10` before push

## [2.0.9] - 2026-05-06

Refresh planning evidence packets without preserving stale context

Flow 2.0.9 turns planning context evidence into an explicit durable packet ledger while keeping the workflow surface stable. Planning, execution, review, and final-review schemas can now carry source-backed evidence packets for selected context, exclusions, relationship hypotheses, ambiguity notes, covered findings, and validation evidence, and runtime planning context merges those packets through a shared domain helper instead of duplicating merge behavior across transitions.

The release also closes the review risks found during hardening. Same-id evidence packets now refresh wholesale so replans can retract stale source refs or selected/excluded context instead of unioning obsolete evidence forever. Prompt guidance is split between runtime-owner and read-only roles, so planning researcher and reviewer prompts return evidence for a planner/coordinator/runtime owner to persist rather than telling read-only roles to call planning runtime tools. Tool schema budgets were tightened around the measured evidence-packet growth so future unrelated schema bloat still fails fast.

Constraint: Add source-backed planning/review evidence packets without adding commands, tools, state paths, package exports, or dependency versions
Constraint: Keep `zod` aligned with `@opencode-ai/plugin`; no dependency-version changes in this patch
Rejected: Preserve same-id packet arrays by unioning old and new context | stale refs and selected/excluded context would survive replans and weaken evidence accuracy
Rejected: Reuse one prompt fragment for runtime owners and read-only roles | it gives reviewers/researchers contradictory persistence instructions
Rejected: Leave broad raw-schema ceilings after evidence-packet growth | oversized budgets hide unrelated future tool-schema drift
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Treat same-id evidence packets as refreshes, not append logs; use new packet ids for additive evidence and keep runtime-tool persistence instructions out of read-only prompt surfaces
Tested: `bun run typecheck`; `bun run lint`; `bun test tests/runtime/evidence-packets.test.ts tests/config/tool-schemas.test.ts tests/config/prompt-contracts.test.ts tests/runtime-hooks.test.ts tests/runtime/workflow-core-reducer.test.ts` (54 pass, 950 expect calls); `bun run check`
Not-tested: Live GitHub-hosted CI/release workflow runs for tag `v2.0.9` before push

## [2.0.8] - 2026-05-06

Ground final review coverage in canonical evidence

Flow 2.0.8 hardens final-review coverage by introducing a typed `reviewContextPack` for changed files, connected context, relationship edges, validation evidence, suggested validation, and coverage gaps. Runtime normalization now carries that pack through final-review and worker-completion paths, while prompt, audit, schema, and capture fixtures teach reviewers that changed files are the review seed rather than the review boundary.

The release also closes the main trust-boundary risk in that new evidence ledger. Review surfaces such as tests, release, operator, tooling, docs, shared surfaces, and integration points now need grounded canonical path or relationship evidence instead of self-reported labels. Validation evidence must match actual worker validation commands, and the OpenCode tool surface rejects empty or unknown top-level `reviewContextPack` payloads while keeping the raw schema compact enough for the existing size budget.

Constraint: Improve final-review context discovery without adding new commands, tools, state paths, package exports, or dependency versions
Constraint: Keep `zod` aligned with `@opencode-ai/plugin`; no dependency-version changes in this patch
Rejected: Let reviewer-supplied `includedContext.surface` or `reason` satisfy concrete review surfaces | self-attested labels can spoof coverage and weaken final-review gates
Rejected: Reuse the full runtime `reviewContextPack` schema directly in OpenCode raw tool args | it exceeds the tool schema size budget, so runtime strict parsing owns nested validation while the compact raw schema pins top-level shape
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Treat `reviewContextPack` as a grounded evidence ledger: labels may describe context, but coverage gates must derive concrete surfaces from canonical paths, relationships, and validation commands
Tested: `bun test tests/runtime/final-review-contracts.test.ts tests/config/tool-schemas.test.ts` (18 pass, 444 expect calls); `bun run typecheck`; `bun run lint`; `bun run check` (520 pass in full suite, completion/replay gates, build, release hygiene, pack invariants, lint, bench smoke, and bench gate passed); Oracle review found no blockers and P2 follow-ups were applied
Not-tested: Live GitHub-hosted CI/release workflow runs for tag `v2.0.8` before push

## [2.0.7] - 2026-05-05

Keep broad review-and-fix planning evidence-first

Flow 2.0.7 adds a dedicated read-only `flow-planning-researcher` subagent so broad goals such as full codebase review followed by fixes can gather repository profile, package-manager, stack, standards, and validation evidence before the runtime plan is finalized. The planner and autonomous coordinator now route broad review-and-fix/codebase-review requests through that research surface when findings do not yet exist, preserving the distinction between planning evidence, review findings, and execution fixes.

The release deliberately keeps findings out of the planning phase. The researcher may recommend a review-first decomposition and evidence packet, but it must not invent defects, claim closure evidence, mutate `.flow`, call Flow runtime tools, or edit repository files. Permission and prompt-mode contracts now make the new agent read-only, while config and capture/eval tests prove the handoff path stays bounded.

Constraint: Improve full-codebase review-and-fix planning without letting the planning phase invent findings or bypass runtime-owned review/execution gates
Constraint: Keep `zod` aligned with `@opencode-ai/plugin`; no dependency-version changes in this patch
Rejected: Teach `flow-planner` to both research and speculate fixes for broad review requests | that collapses audit discovery into planning and encourages unsupported findings
Rejected: Add a new command, tool, state path, or runtime mode | a bounded read-only subagent and prompt/permission contracts solve the workflow gap with less public surface churn
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep broad review-and-fix goals review-first: planning may preserve evidence and recommend audit scope, but findings and closure evidence belong only to review/execution records
Tested: `bun run lint`; `bun run typecheck`; `bun test tests/prompt-mode-behavior-eval.test.ts tests/prompt-mode-capture.test.ts tests/config/prompt-contracts.test.ts tests/config/plugin-surface.test.ts tests/mode-contracts.test.ts` (58 pass); `bun run check:generated-drift`; `bun run eval:prompt-capture:check`; `bun run check` (514 pass, bundle sanity 6 agents / 9 commands / 18 tools, bench gate passed)
Not-tested: Live OpenCode Flow session routing through `flow-planning-researcher`; live GitHub-hosted CI/release workflow runs for tag `v2.0.7` before push

## [2.0.6] - 2026-05-05

Enforce strict checkpoint integrity and replay durability over legacy compatibility

Flow 2.0.6 hardens workflow persistence by binding checkpoints to event-log prefixes, validating explicit replay resume offsets, and fsyncing event-log directories after append operations. The release also clarifies post-rename durability error semantics in session writes, keeps strict review-input contracts at the tool boundary, and adds larger replay benchmark coverage plus targeted regression tests.

This release intentionally drops backward compatibility for deprecated checkpoint artifacts that lack integrity metadata. Legacy checkpoints are treated as invalid by design so replay safety does not depend on stale format tolerance.

Constraint: Prioritize replay/checkpoint integrity and durability guarantees over legacy checkpoint compatibility
Constraint: Keep `zod` aligned with `@opencode-ai/plugin`; no dependency-version changes in this patch
Rejected: Accept legacy checkpoints without `eventPrefixHash` fallback | deprecated state formats undermine deterministic replay integrity
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Treat persistence schema hardening as forward-only when it enforces integrity contracts; document intentional incompatibilities in release notes
Tested: `bun test tests/runtime/workflow-persistence.test.ts tests/replay/replay-persistence-gate.test.ts tests/atomic-writes.test.ts tests/runtime/workspace-cache.test.ts tests/runtime/workflow-core-reducer.test.ts tests/runtime/semantic-invariants.test.ts` (40 pass); `bun x tsc --noEmit`
Not-tested: Live GitHub-hosted CI/release workflow runs for tag `v2.0.6` before push

## [2.0.5] - 2026-05-05

Simplify governance surfaces by removing stale audit artifacts

Flow 2.0.5 is a docs-only consolidation release focused on reducing governance drift and maintenance overhead. The oversized deep-audit investigation artifact was removed, the runtime complexity baseline doc was renamed for clearer intent, and gate-matrix wording was corrected so generated-drift coverage is described accurately.

This release does not change runtime behavior, commands, tool schemas, state paths, or dependencies. It narrows the maintenance surface so contract documentation stays executable and easier to keep in sync.

Constraint: Keep release scope docs-only with no runtime/tool/dependency changes
Constraint: Keep `zod` aligned with `@opencode-ai/plugin`; no dependency or SDK-boundary changes in this patch
Rejected: Keep large point-in-time audit logs in-repo as active governance artifacts | they add drift risk and duplicate canonical contract surfaces
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Keep one canonical runtime complexity baseline surface and avoid reintroducing long-lived duplicated audit artifacts
Tested: `bun run check`
Not-tested: Live GitHub-hosted CI/release workflow runs for tag `v2.0.5` before push

## [2.0.4] - 2026-05-04

Harden stored-session parking after missing `.flow/stored` recovery

Flow 2.0.4 fixes a portability risk in session parking during `flow_plan_start` and `flow_session_activate` by ensuring the stored root exists before rename, rather than pre-creating the destination leaf directory. This keeps the missing-`.flow/stored` recovery path robust across filesystems where rename-to-existing-directory behavior is stricter.

The release also updates runtime coverage for the missing-stored-root paths and adjusts workspace mkdir-caching expectations to match the new explicit re-ensure behavior. Prompt-mode capture fixtures are refreshed for providerless metadata wording without changing runtime behavior.

Constraint: Keep runtime behavior stable while fixing cross-platform rename safety when `.flow/stored` is recreated
Constraint: Keep `zod` aligned with `@opencode-ai/plugin`; no dependency or tool-schema expansion in this patch
Rejected: Keep creating `getStoredSessionDir(...)` before rename | destination-leaf precreation can fail rename on stricter filesystem semantics
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: For directory move safety, create parent roots before rename and avoid precreating rename destination leaves
Tested: `bun test` with 509 passing tests; `bun run check` (typecheck, prompt capture checks, dependency contract, architecture seams enforce, deadcode, build, release hygiene, pack invariants, completion-lane gate, replay gates, cold-start budget, full tests, lint, bench smoke, bench gate)
Not-tested: Live GitHub-hosted CI/release workflow runs for tag `v2.0.4` before push

## [2.0.3] - 2026-05-04

Enforce architecture seams and continue runtime simplification

Flow 2.0.3 hardens architecture boundaries and continues runtime decomposition while keeping the public Flow command/tool surface stable. CI now enforces blocked cross-layer imports, runtime/session responsibilities are split into clearer lifecycle/recovery/rendering seams, and simplification metrics are recorded so maintainers can track complexity reduction without guessing.

The release keeps dependency alignment unchanged (`zod` remains aligned with `@opencode-ai/plugin`) and avoids user-facing expansion. This pass is focused on maintainability and guardrails: stronger seam checks, clearer ownership docs, and runtime simplification follow-through with explicit verification.

Constraint: Keep behavior stable while reducing coupling and making architecture drift visible in CI
Constraint: Keep `zod` aligned with `@opencode-ai/plugin`; no dependency-version changes in this simplification pass
Rejected: Keep seam checks report-only after violations reached zero | hard enforcement is required to prevent regression
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Maintain seam enforcement in CI and route new cross-layer shared contracts through seam-safe workflow/runtime boundaries
Tested: `bun run check` (typecheck, dependency contract, architecture seams enforce, fresh-surface policy, deadcode, build, release hygiene, pack invariants, completion lane, replay gates, cold-start budget, full tests, lint, bench smoke, bench gate); `bun test` with 507 passing tests
Not-tested: Live GitHub-hosted CI/release workflow runs for tag `v2.0.3` before push

## [2.0.2] - 2026-05-04

Make workflow contracts descriptor-driven and evidence-aware

Flow 2.0.2 turns the new workflow surface hardening into explicit descriptor and evidence contracts. OpenCode tool metadata now flows through descriptor families that project host tool order, docs rows, prompt visibility, schema ownership, runtime bindings, and verification anchors from one reviewable source instead of relying on parallel hand-maintained lists.

Completion gates now have runtime-owned descriptor projections for feature, final, and review-and-fix paths. The generated guidance ties recovery kinds, required artifacts, predicate owners, and architecture documentation back to the same completion-gate table, while tests prove descriptor parity against runtime recovery metadata, docs output, and semantic invariant order.

Standalone review and audit surfaces now carry optional evidence packets for selected context, exclusions, ambiguity, validation notes, and already-covered findings. The review command, audit contract, schemas, snapshots, and evidence-packet tests keep those packets as read-only support metadata for coverage ledgers and findings rather than a replacement for concrete file evidence.

The release deliberately keeps the public command/tool names, package entrypoint, state paths, dependency versions, and OpenCode plugin SDK/Zod alignment unchanged. The descriptor split adds internal generated surfaces, but the transition-module budget, prompt snapshot, parity tests, and docs contracts now make that expansion explicit and guarded.

Constraint: Improve maintainer confidence in tool, completion, and review contracts without adding user-facing commands, tools, state paths, dependencies, or package exports
Constraint: Keep `zod` aligned with `@opencode-ai/plugin`; this release changes schemas and docs contracts without changing dependency versions
Rejected: Keep descriptor data duplicated across generated projections, docs, prompt guidance, and tests | drift was the primary risk, so one projected contract is easier to review and verify
Rejected: Treat evidence packets as replacement review ledgers | coverage and findings still need concrete evidence; packets only preserve boundaries, exclusions, ambiguity, and validation context
Rejected: Hide the extra transition modules by weakening maintainability checks silently | the module budget now records the intentional completion-gate/projection split instead of allowing unexplained growth
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: When changing tool descriptors, completion gates, or review evidence packets, update the generated projections/snapshots and run the descriptor, completion-gate, evidence-packet, prompt-contract, dependency, and full release gates before tagging
Tested: `bun run typecheck`; `bun test tests/transitions-consolidation.test.ts tests/prompt-snapshot.test.ts tests/runtime/evidence-packets.test.ts tests/config/prompt-contracts.test.ts`; `bun test` with 501 passing tests; `bun run check` before tag
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v2.0.2` before push

## [2.0.1] - 2026-05-03

Make standards research guidance prompt-driven and safer

Flow 2.0.1 simplifies standards guidance around the actual agent workflow: planning and runtime prompts now tell agents to use available MCP research tools first, especially Ref for official documentation and Exa for current ecosystem research, with generic websearch/webfetch only as fallback. This replaces the more complicated detector-oriented approach with prompt-level guidance that fits how agents already decide which tools are available.

The standards profile still records local stack evidence, local guidance, config-derived rules, and research gaps, but the scanner now recognizes OpenCode Plugin SDK and Zod surfaces so planning can ask for relevant official-doc and ecosystem research when those tools appear in the repository. Cached planning context and compaction output include standards summaries without re-scanning every hook path.

The release hardens the standards-profile cache and parser boundaries found during review. Dynamic cached standards snippets are now quoted and framed as generated evidence rather than executable instructions. External standards cache expiry applies to official/external-priority rules as well as recorded external sources, and JSONC config parsing no longer accepts token-spliced or unterminated block-comment inputs as valid standards evidence.

No commands, tools, state paths, runtime modes, dependency versions, or public package entrypoints changed. The release deliberately keeps external research as a prompt instruction instead of adding MCP-server detection or tool availability plumbing to the standards scanner.

Constraint: Improve standards research behavior without adding new commands, tools, state paths, dependencies, or MCP-server detection machinery
Constraint: Keep local repo guidance ahead of official docs, and official docs ahead of broader Exa/websearch synthesis
Constraint: Keep `zod` aligned with `@opencode-ai/plugin`; this release changes guidance and detector evidence only, not dependency versions
Rejected: Detect installed MCP servers in the standards scanner | prompt guidance is enough, avoids stale availability state, and lets agents use the tools actually exposed in their session
Rejected: Store live research results automatically during repository scanning | the scanner should identify stack evidence and research gaps, not perform side-effectful or network-dependent research during local cache refresh
Rejected: Trust cached standards snippets as prompt text | cached profile values can originate from repository-controlled files and must remain quoted/generated evidence
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep standards research prompt-driven unless a future design adds explicit, tested MCP availability contracts; never inject raw repo-derived standards text into system or compaction context without quoting and generated-evidence framing
Tested: `bun test tests/runtime-hooks.test.ts tests/stack-standards-profile.test.ts`; `bun run typecheck`; `bun run lint`; `bun run eval:prompt-capture:check`; `bun run eval:review-capture:check`; Oracle review found an unterminated block-comment parser gap, fixed with regression coverage; `bun run check` end-to-end with 479 passing tests, replay gates, lint, build, release hygiene, pack invariants, cold-start budget, bundle sanity, bench smoke, and bench gate
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v2.0.1` before push

## [2.0.0] - 2026-05-03

Rebuild Flow around a fresh workflow core

Flow 2.0.0 turns the ground-up rewrite investigation into the new architecture. Flow is now organized around a deterministic workflow core with action/event contracts, append-only workflow event logs, replay checkpoints, projection rendering, generated role protocols, generated OpenCode adapter projections, and replay/property release gates.

The OpenCode integration is now a host adapter rather than the semantic center. Core workflow modules own action decisions, events, reducers, invariant mappings, policy facades, and role protocols. OpenCode plugin registration, config injection, tool registration, tool guidance, and SDK raw-shape concerns live under `src/adapters/opencode/**`, with tests guarding that the core does not import the adapter or `@opencode-ai/plugin`.

Persistence now records workflow evolution through `.flow/events/<session-id>.jsonl`, `.flow/checkpoints/<session-id>.json`, and `.flow/projections/<session-id>/`. Session JSON and readable session docs remain user-visible runtime artifacts, while replay/checkpoint/projection tests prove the event model. The release also adds event-store benchmarks and wires replay/fresh-surface gates into `bun run check`.

This major release intentionally removes old transport and internal file surfaces. JSON-string tool transport fields and nested worker payload forms are rejected. Root tool barrels and root tool-guidance indirections were deleted. Active docs, prompts, and tests now point at the fresh adapter/core/persistence/protocol paths, and `check:fresh-surfaces` guards active surfaces against stale terminology and deleted-path drift.

The README was reorganized for end users: `/flow-auto <goal>` is now the clear default path, maintainer details moved under Contributing, and state-on-disk documentation describes events, checkpoints, projections, locks, and workspace-local state without asking users to understand internals first.

Constraint: Ship the fresh-start architecture as a major release instead of preserving old internal surfaces
Constraint: Keep the public package API root-only while allowing internal files, state implementation, and tool transport details to change freely
Constraint: Keep `zod` aligned with `@opencode-ai/plugin` and verify tool argument compatibility after removing string transport fields
Rejected: Preserve root `src/tools/**` barrels as convenience imports | fresh architecture should not keep internal file surfaces alive only for old callers
Rejected: Keep JSON-string tool transport fields | direct schema-first raw object arguments are simpler, stricter, and covered by adapter boundary tests
Rejected: Keep snapshot-compatibility checkpoints | append-only events plus replay checkpoints are the new persistence model and are guarded by replay tests
Rejected: Leave release checks unchanged | the rewrite needs permanent replay and fresh-surface guards so old patterns do not creep back
Confidence: high
Scope-risk: broad
Reversibility: messy
Directive: Do not reintroduce root tool barrels, string transport fields, snapshot-compatibility persistence, or prompt/docs policy duplication without a reviewed replacement decision and release-note rationale
Tested: `bun run check:fresh-surfaces`; `bun run deadcode`; `bun run lint`; `bun run typecheck`; `bun test` with 474 passing tests; `bun run test:replay`; `bun run bench:smoke`; `bun run bench:gate`; `bun run check` end-to-end; dependency contract confirmed `zod=4.1.8` aligned with the OpenCode plugin SDK effective zod
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v2.0.0` before push

## [1.0.63] - 2026-05-03

Preserve rich review packet boundaries

Flow 1.0.63 turns the Dual-flow review investigation into a reusable standalone review-prompt contract. `/flow-review` now treats rich user review packets as structured input instead of loose prose, preserving selected context, exclusions, relationship hypotheses, ambiguities, known exclusions, already-covered findings, evidence requirements, and done-when criteria before deriving findings.

The providerless review-capture harness now models those packet boundaries directly. Capture scenarios can include a `reviewPacket`, generated prompt packets render explicit `<review-packet>` sections, generated capture templates carry packet expectations, and offline scoring can fail captures that ignore selected-context limits or count excluded surfaces as directly reviewed.

The release strengthens prompt-quality eval coverage without expanding runtime schemas, command names, tool names, state paths, dependencies, or public plugin entrypoints. The existing structured review ledger remains the output contract; packet semantics are layered in front of it through prompt wording, capture fixtures, prompt snapshots, and behavior-eval scoring.

Constraint: Improve standalone review input quality without weakening existing output-ledger validation or runtime final-review gates
Constraint: Keep packet semantics prompt/capture/eval scoped; do not add runtime schemas, commands, tools, state paths, dependencies, or public package surface
Rejected: Copy the Dual-flow prompt verbatim | the useful pattern is first-class packet boundaries, not project-specific Phaser/DOM lifecycle wording
Rejected: Expand `ReviewReportSchema` for selected-context or exclusion fields in this release | existing `discoveredSurfaces`, `coverageNotes`, findings, and next steps can carry the evidence while evals prove the prompt-level contract first
Rejected: Score packet preservation only in static prompt snapshots | generated providerless captures also need packet expectations so manual model outputs can be scored against the boundary contract
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: When changing `/flow-review` or review-capture prompts, preserve packet-boundary handling and keep exclusions/ambiguities as coverage/process evidence unless direct code evidence proves a defect
Tested: Targeted prompt/capture/eval/snapshot tests; `bun run eval:review-capture:check`; `bun run typecheck`; `bun run lint`; Oracle review found capture-scoring and exclusion-violation gaps, both fixed; `bun run check`
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v1.0.63` before push

## [1.0.62] - 2026-05-03

Make Flow prompts more concise without weakening gates

Flow 1.0.62 trims prompt wording after the GPT-5.5 prompting review while keeping Flow's runtime contracts unchanged. Planner, worker, reviewer, auto, and command examples now use shorter wording where the prior text repeated the same intent, so the prompt surface stays closer to a compact work contract instead of accumulating ritual phrasing.

The standalone audit prompt now shares one read-only boundary rule between the command and auditor agent surfaces. That boundary is phrased around state mutation rather than tool-name prohibition, so `/flow-review` remains clearly read-only while still allowing the deterministic `flow_review_render` report renderer. The release also keeps the review snapshot and prompt-contract assertion aligned with the clarified boundary.

No commands, tools, state paths, runtime modes, schemas, package dependencies, or public plugin entrypoints changed. This is a prompt-expression cleanup only: runtime policy and transitions remain the source of truth, and the existing prompt/eval harness continues to guard mode boundaries, untrusted argument handling, review/final completion gates, evidence calibration, and release hygiene.

Constraint: Improve prompt concision without changing Flow runtime semantics, command/tool names, state paths, schemas, dependencies, or public package surface
Constraint: Keep `/flow-review` read-only while preserving the `flow_review_render` renderer path
Rejected: Rewrite the prompt stack around a new template shape | the existing structured sections and eval corpus already encode important workflow contracts, so a broad rewrite would add unnecessary regression risk
Rejected: Remove safety/review/finalization rules to save tokens | those gates are release-critical and protected by prompt-mode contracts and behavior evals
Rejected: Add live provider eval automation in this release | useful, but separate from the requested concise prompt cleanup and not needed to ship this wording-only release
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: When making future prompt-concision edits, delete duplicate phrasing before weakening gates; keep shared audit boundary wording compatible with `flow_review_render`
Tested: Fresh implementation subagent; targeted prompt/eval tests; Oracle review found no blocking findings and one wording risk, fixed; `bun run typecheck`; `bun run check`
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v1.0.62` before push

## [1.0.61] - 2026-05-03

Make Flow reviews challenge adversarial failure modes

Flow 1.0.61 turns the missed-review lesson into a general review-quality contract instead of memorizing a project-specific bug. Standalone `/flow-review` audits and the `flow-reviewer` approval gate now require reviewers to select applicable adversarial failure-mode classes before calling behavior clean: lifecycle/reentrancy/idempotency, async race and event ordering, persistence failure and recovery, interaction geometry and hit-testing, accessibility semantics and live regions, and test-oracle authenticity.

The audit contract now asks reviewers to record checked classes or meaningful gaps in the existing coverage ledger, findings, or next steps. Test-surface review must also say whether the evidence exercises a normal product path rather than only a shortcut setup. The reviewer contract uses the existing summary, integration/regression checks, blocking findings, follow-ups, and suggested validation fields, so this strengthens review behavior without adding commands, tools, state paths, package dependencies, or a new result schema.

The release also strengthens the prompt-quality harness. The offline behavior rubric adds `failure_modes_accounted`, raises the structured review capture threshold to 9/9, adds a regression case for otherwise polished reviews that omit failure-mode accounting, and adds a providerless capture scenario focused on adversarial failure-mode coverage. Prompt snapshots and prompt-eval snippets lock the new wording across auditor, command, reviewer, and contract surfaces.

Constraint: Improve review quality generally without hardcoding the PracticeScene incident or adding new public Flow commands, tools, state paths, dependencies, or result-schema fields
Constraint: Keep failure-mode checks applicable and evidence-based so reviewers record checked paths or gaps without inventing irrelevant findings
Rejected: Add a narrow checklist for the reported Phaser/DOM control issues | it would train Flow on one incident instead of reusable review reasoning
Rejected: Add new structured reviewer fields for failure-mode checks | existing summary, integrationChecks, regressionChecks, blockingFindings, followUps, suggestedValidation, coverageNotes, findings, and nextSteps can carry the evidence without schema churn
Rejected: Treat validation success as enough review evidence | the missed issues were lifecycle, interaction, accessibility, and test-oracle reasoning gaps that passing happy-path checks can miss
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: When changing review prompts or behavior evals, keep adversarial failure-mode accounting broad, applicable, and evidence-backed; do not collapse it into a project-specific checklist
Tested: `bun run typecheck`; `bun run eval:review-capture:check`; `bun run eval:prompt-capture:check`; targeted prompt/eval tests; changed-file and package-scope Biome checks; `bun run check`
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v1.0.61` before push

## [1.0.60] - 2026-05-03

Close review findings with runtime evidence

Flow 1.0.60 turns the review-remediation lesson from the Soft Focus investigation into a runtime and prompt contract. Worker results can now carry a `reviewFindingClosures` ledger that maps each reviewed finding to fix references, test references, validation commands, and residual risk. Flow persists that ledger into execution history and renders it in feature docs so review-fix claims are inspectable after the run instead of disappearing into generic decisions.

The completion gate now enforces the ledger for `review_and_fix` sessions. Successful review-fix completion requires closure evidence, requires every closure to be `closed`, requires closed findings to name fix/test/validation evidence, and rejects validation references that were not recorded in the current `validationRun`. Prompt contracts and behavior evals now train workers to produce the ledger and reviewers to reject missing or unsupported closure claims.

The release also clarifies the operator boundary around parked sessions and standalone review. History/show responses label stored non-completed sessions as parked/inactive and warn that direct work outside Flow will not update runtime state, reviewer records, validation records, or completion artifacts. README now documents that `/flow-review` is read-only and that direct Codex/RepoPrompt follow-up fixes bypass Flow runtime records unless remediation proceeds through Flow execution gates. A superseded complexity-reduction investigation note was removed so the current docs do not keep stale maintenance guidance alongside the newer review-remediation contract.

Constraint: Preserve existing command names, tool names, state paths, package API, and dependency versions while adding review-fix evidence accounting
Constraint: Keep `reviewFindingClosures` additive for ordinary implementation sessions and enforce it only where `goalMode` is `review_and_fix`
Rejected: Infer exact original-finding coverage from the latest reviewer projection | reviewer decisions can be overwritten by later approval, so exact all-finding matching needs a first-class original-finding store
Rejected: Allow `partially_closed` or `blocked` closure entries on `status: ok` review-fix completion | successful completion should mean every listed finding is closed; unresolved entries belong in `needs_input` or continued work
Rejected: Treat stale parked session docs as proof of runtime corruption | the actionable fix is clearer parked-session UX and bypass-boundary documentation
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: When changing review remediation, keep the closure ledger tied to code/test/validation evidence and do not let `review_and_fix` completion pass with unresolved findings
Tested: `bun run lint`; `bun run typecheck`; `bun run eval:prompt-capture:check`; targeted runtime, prompt, and operator-history tests; Oracle review found one review-fix closure-status gap and minor assertion/parked-flag improvements, all fixed; `bun run test -- --timeout 30000` with 445 passing tests; `bun run build`; `bun run check`
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v1.0.60` before push

## [1.0.59] - 2026-05-02

Ground Flow planning in cached stack standards evidence

Flow 1.0.59 makes planning context more explicit before execution by recording a runtime-owned stack and standards profile alongside the existing repo profile, package-manager detection, research, and decision logs. Planning now captures local stack evidence, local guidance, standards precedence, and bounded official-doc research gaps so agents can prefer repository rules and existing package scripts before reaching for external assumptions.

The cached profile is reused outside active Flow sessions without making every hook invocation rescan the workspace. The cache is fingerprinted against relevant local evidence, keyed by workspace/start-directory/package-manager context, and external guidance expires after 30 days. The cache writer now stores only the strict stack/standards profile payload, so records written by `flow_plan_context_record` and `flow_plan_apply` remain readable by the strict cache parser.

The release also keeps the OpenCode plugin surface compatible while simplifying read-only agent restrictions: read-only Flow agents now rely on permission-only restrictions instead of the deprecated boolean `tools` config, and tests lock the tool schema, plugin surface, runtime hooks, package-manager detection, and cache read/write contracts.

Constraint: Preserve Flow command names, tool names, state paths, dependency versions, and root package API while enriching planning context
Constraint: Keep `zod` aligned with `@opencode-ai/plugin` and preserve direct SDK arg-shape compatibility
Rejected: Let planning tools cache the whole planning object | strict cache reads reject unrelated planning keys and would silently ignore the profile
Rejected: Recompute stack/standards fingerprints before checking cache existence | no-cache hook paths should stay cheap
Rejected: Keep duplicate workspace-boundary traversal helpers | package detection and profile detection need one containment rule to avoid drift
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: When changing stack/standards profiling, keep cache writes strict, cache reads cheap on the no-cache path, and local repo guidance ahead of official or web guidance
Tested: `bun test tests/auto-prepare.test.ts tests/stack-standards-profile.test.ts tests/package-manager-detection.test.ts tests/runtime-hooks.test.ts`; `bun run typecheck`; `bunx biome check src/runtime/application/package-manager.ts src/runtime/application/stack-standards-profile.ts src/runtime/application/workspace-boundaries.ts src/tools/runtime-tools/planning-tools.ts tests/auto-prepare.test.ts`; Oracle review of scoped fix found no P0/P1/P2 findings; `bun run check` including typecheck, prompt capture checks, dependency contract, deadcode, build, release hygiene, pack invariants, completion-lane gate, cold-start budget, bundle sanity, full test suite, lint, and bench smoke
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v1.0.59` before push

## [1.0.58] - 2026-05-02

Preserve observability while enforcing release hygiene

Flow 1.0.58 narrows the no-console guidance so cleanup does not silently delete meaningful operator or diagnostic signals. Workflow prompts now tell agents to inspect existing logging, telemetry, and CLI-output patterns before changing `console.*`, classify each occurrence, remove only temporary debug noise, and replace intentional observability with the repo's existing logger, telemetry API, injected logger, or explicit stdout/stderr stream writes while preserving severity, message intent, and key context.

The release also makes the guard reviewable. Reviewer contracts now reject release-bound debug artifacts, deleted observability without an equivalent replacement, and newly invented logging or telemetry dependencies unless that dependency was explicitly approved. Maintainer docs and release-hygiene failures explain the same decision tree, while prompt-contract tests and behavior evals lock worker and reviewer regressions for deleted observability and unapproved dependency invention.

Constraint: Preserve Flow's existing command/tool/state surface while improving prompt guidance for observability-safe console cleanup
Constraint: Keep release hygiene focused on debug artifacts, not on reducing production operator diagnostics
Rejected: Keep a delete-only no-console rule | it can lower observability by removing intentional failure and operator signals
Rejected: Add a logging or telemetry dependency | the right replacement depends on each host repo's existing facilities and no dependency was requested
Rejected: Weaken the release-hygiene scanner | raw console/debugger artifacts should still fail release-bound checks; the fix belongs in guidance and review contracts
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: When changing console/release-hygiene guidance, preserve the classify-before-edit rule and keep worker/reviewer behavior evals covering both deleted observability and unapproved dependency invention
Tested: `bun test tests/config/prompt-contracts.test.ts tests/prompt-mode-behavior-eval.test.ts`; `bun run lint`; Oracle review of diff snapshot `2026-05-02/1905` found the remaining test-update and dependency-invention gaps, both fixed; `bun run check` including typecheck, prompt capture checks, dependency contract, deadcode, build, release hygiene, pack invariants, completion-lane gate, cold-start budget, bundle sanity, 431 tests across 78 files, lint, and bench smoke
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v1.0.58` before push

## [1.0.57] - 2026-05-02

Seal Flow review handoffs at prompt and permission boundaries

Flow 1.0.57 hardens the read-only review and fresh-context handoff contracts without adding commands, tools, state paths, dependencies, or public package surface. The autonomous and worker prompts now describe bounded Task-tool handoffs to the planner, worker, and reviewer roles, while the config keeps those handoffs narrow: `flow-auto` may delegate only to the Flow role agents it coordinates, `flow-worker` may delegate only to `flow-reviewer`, and read-only agents explicitly deny Task delegation.

The standalone `/flow-review` prompt now binds its structured ledger to the renderer transport shape directly. It tells the model to call `flow_review_render` with `{ reviewJson: JSON.stringify(ledger), view }` and clarifies that `reviewJson` must be the actual serialized JSON string, not a nested object or the literal pseudo-code text. Prompt contract tests and the committed review snapshot lock that wording so future prompt edits do not reopen the full-codebase review instability.

Constraint: Preserve Flow's existing command/tool/state surface while making fresh-context handoffs and standalone review rendering deterministic
Constraint: Keep read-only agents read-only across edit, bash, and Task/subagent boundaries
Rejected: Add a new review transport compatibility path | strict renderer input is deterministic and the bug was missing model-facing prompt guidance
Rejected: Let read-only agents omit `permission.task` | OpenCode defaults are permissive enough that read-only boundaries should be explicit
Rejected: Document the renderer transport in README | it is an internal prompt/tool contract, not a user-facing command behavior change
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: When changing Flow role handoffs or JSON-renderer prompts, update config permissions, prompt contracts, and snapshots together; do not rely on omitted permissions or implicit model inference at transport boundaries
Tested: `bun test tests/config/plugin-surface.test.ts tests/config/prompt-contracts.test.ts tests/mode-contracts.test.ts tests/prompt-snapshot.test.ts`; `bun run typecheck`; `bun run lint`; Oracle review found no blocker/regression findings after the edits; `bun run check` including typecheck, prompt capture checks, dependency contract, deadcode, build, release hygiene, pack invariants, completion-lane gate, cold-start budget, bundle sanity, 431 tests across 78 files, lint, and bench smoke
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v1.0.57` before push

## [1.0.56] - 2026-05-02

Make Flow uninstall clear the canonical plugin slot

Flow 1.0.56 fix-forwards the install UX repair by making uninstall follow the same canonical-slot contract. The release `uninstall.sh` and `bun run uninstall:opencode` now remove `~/.config/opencode/plugins/flow.js` whenever it exists, regardless of whether the file carries the Flow ownership header.

The previous ownership-marker refusal was too conservative for the actual user path: it could leave users stuck with a stale or incompatible `flow.js` after they explicitly asked Flow to uninstall. There is no backup file and no manual-delete instruction. The command owns exactly one canonical plugin filename and clears that filename simply.

Constraint: The user-facing uninstall command must resolve a blocked canonical `flow.js` slot without requiring manual filesystem cleanup
Constraint: Keep the fix narrow to the OpenCode plugin file; do not alter Flow runtime behavior, commands, tools, state paths, prompt contracts, dependencies, or package surface
Rejected: Keep ownership-marker refusal | it preserves theoretical safety while failing the practical uninstall use case
Rejected: Move unowned files to backup | it adds surprising filesystem behavior and leaves another artifact for users to reason about
Rejected: Add confirmation or force flags | the command is already explicit and extra surface would complicate a single-path cleanup contract
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Treat install and uninstall as authoritative for the canonical `flow.js` plugin slot; do not reintroduce marker-based refusal unless the plugin supports multiple install targets
Tested: `bun test tests/install.test.ts tests/cross-area/install-lifecycle.test.ts`; `bun run check` including typecheck, eval captures, dependency contract, deadcode, build, release hygiene, pack invariants, completion-lane gate, cold-start budget, bundle sanity, 429 tests across 78 files, lint, and bench smoke
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v1.0.56` before push

## [1.0.55] - 2026-05-02

Make Flow install overwrite stale plugin files

Flow 1.0.55 fixes an install-time UX failure where an existing `flow.js` at the canonical OpenCode plugin path blocked installation unless the user manually deleted it first. Installing Flow is now authoritative for that target path: both `bun run install:opencode` and the release `install.sh` overwrite an existing `flow.js` and stamp the replacement with the Flow ownership header.

The uninstall safety boundary stays intact. `uninstall` still refuses to remove files that do not carry the Flow ownership marker, so installation is convenient while destructive removal remains ownership-gated. No commands, tools, runtime workflow semantics, state paths, prompt contracts, dependencies, or public plugin surface changed.

Constraint: The canonical OpenCode plugin filename is `flow.js`, so install must be able to replace stale or incompatible files at that path without manual cleanup
Constraint: Preserve uninstall ownership protection while making install idempotent and user-friendly
Rejected: Keep refusing unowned `flow.js` files | it blocks the expected install path and forces users into manual file deletion
Rejected: Add a new force flag | explicit Flow install is already the user intent, and another option would add surface area for a patch UX fix
Rejected: Weaken uninstall ownership checks | install and uninstall have different risk profiles; deleting unowned files should remain protected
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Treat install as authoritative for the canonical `flow.js` target, but do not let uninstall remove unowned plugin files without an explicit future contract change
Tested: `bun test tests/install.test.ts tests/cross-area/install-lifecycle.test.ts`; `bun run check` including typecheck, eval captures, dependency contract, deadcode, build, release hygiene, pack invariants, completion-lane gate, cold-start budget, bundle sanity, 429 tests across 78 files, lint, and bench smoke
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v1.0.55` before push

## [1.0.54] - 2026-05-02

Lower maintainer risk without changing runtime behavior

Flow 1.0.54 completes the current maintainability-risk pass by making the active contract map and runtime test layout easier to audit. The release keeps `docs/maintainer-contract.md` and `docs/contributor-map.md` as the current-facing source of truth for commands, tools, state paths, invariants, surface-freeze rules, and required checks.

The runtime test suite now carries less review gravity. Operator history/session lifecycle coverage, session persistence/rendering coverage, execution-history rendering, replanning behavior, actionable needs-input metadata, and tool persistence all live in focused behavior-named suites instead of broad catch-all files. The assertions were moved rather than relaxed, and no runtime source, command names, tool schemas, state paths, dependency versions, or public plugin surface changed.

Constraint: Address the framework-complexity review by reducing contributor comprehension risk, not by rewriting runtime architecture
Constraint: Preserve Flow runtime behavior, command names, tool schemas, state paths, dependencies, package surface, and completion/reviewer gates
Rejected: Flatten or rewrite the runtime | the review risk was maintainability and contract drift, not broken workflow semantics
Rejected: Delete or weaken contract tests | coverage is a project strength; the problem was review load per file
Rejected: Add more current-facing documentation layers | the maintainer contract and contributor map should remain the short current truth instead of creating parallel sources
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Keep future runtime and config coverage organized by behavioral concern, and do not expand commands, tools, prompt contracts, state paths, or runtime modes unless the release records the retirement/replacement tradeoff
Tested: `bun test tests/runtime.test.ts tests/runtime-execution-history.test.ts tests/runtime-replanning.test.ts tests/runtime-actionable-metadata.test.ts tests/runtime-tool-persistence.test.ts tests/docs-stale-reference-policy.test.ts tests/docs-semantic-parity.test.ts`; `bun run lint`; `bun run typecheck`; `bun run check` including eval captures, dependency contract, deadcode, build, release hygiene, pack invariants, completion-lane gate, cold-start budget, bundle sanity, 429 tests across 78 files, lint, and bench smoke; Oracle review of diff snapshots `2026-05-02/1527` and `2026-05-02/1540`
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v1.0.54` before push

## [1.0.53] - 2026-05-02

Retire factory artifact lore from the current maintenance surface

Flow 1.0.53 closes the remaining maintainability risk from the repo-local factory artifact cleanup. The release removes the tracked local process artifact tree and its taxonomy document, keeps regenerated local artifacts ignored, and preserves the hidden-workspace permission contract through generic hidden-root tests instead of a named retired directory.

The stale-reference guard is now stricter: the retired factory artifact name may appear only in the policy test and ignore configuration, not in changelog, release, investigation, docs, source, or fixture text. Older historical notes were rewritten to describe the same decisions as retired process-artifact context, so contributors no longer see a deleted artifact tree presented as current project lore.

Constraint: Remove contributor-confusing process artifacts without changing Flow runtime behavior, command names, tool schemas, state paths, dependencies, or public plugin surface
Constraint: Keep hidden-workspace permission coverage after removing the named retired artifact tree
Rejected: Preserve the literal retired artifact name in historical markdown | it kept passing the policy but still looked like current institutional lore to contributors
Rejected: Delete historical release/investigation context wholesale | concise supersession wording keeps the audit trail without reviving a dead surface
Rejected: Weaken stale-reference policy to avoid release-note failures | the policy now has narrower allowances and explicit generated-artifact handling instead
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Do not reintroduce repo-local process artifact directories as source-controlled workflow truth; if a future hidden workspace example is needed, use generic sentinel names in tests and document the actual current owner
Tested: `bun test tests/docs-stale-reference-policy.test.ts`; active grep for retired factory references outside the stale-policy test and ignore configuration; `bun run check` including typecheck, eval captures, dependency contract, deadcode, build, release hygiene, pack invariants, completion-lane gate, cold-start budget, bundle sanity, 429 tests, lint, and bench smoke
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v1.0.53` before push

## [1.0.52] - 2026-05-02

Keep the release-note artifact inside the stale-reference policy

Flow 1.0.52 is a fix-forward release for the `v1.0.51` hosted release failure. The `v1.0.51` tag correctly validated the package/changelog version evidence, but the release job creates a generated `release-notes.md` file from `CHANGELOG.md` before running `bun run check`. The new stale-reference policy test scanned that generated file and rejected the same historical retired-path references that are intentionally allowed in the changelog.

This release keeps the stale-reference guard intact while adding the generated release-note artifact to the same historical-evidence allowlist as `CHANGELOG.md`. The maintainer contract now names that generated artifact explicitly, so future changes do not accidentally treat hosted release notes as current contract documentation. No runtime behavior, command names, tool schemas, state paths, dependency versions, or public plugin surface changed.

Constraint: Preserve the stale-reference policy while allowing the hosted release workflow's generated changelog excerpt
Constraint: Do not force-move the already-pushed failed `v1.0.51` tag
Rejected: Remove stale-reference scanning from `bun test` | the policy is useful and should remain part of the normal release gate
Rejected: Remove stale-reference scanning from generated release notes | the generated artifact follows the changelog and should stay policy-covered
Rejected: Force-move `v1.0.51` | the tag was already pushed and failed in hosted release, so fix-forward keeps history explicit
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Keep generated `release-notes.md` aligned with `CHANGELOG.md` in stale-reference policy decisions because the hosted release workflow materializes it before `bun run check`
Tested: Hosted `v1.0.51` release run failed specifically in `tests/docs-stale-reference-policy.test.ts` against generated `release-notes.md`; `bun test tests/docs-stale-reference-policy.test.ts`; `bun run check` including 427 tests, build, deadcode, release hygiene, pack invariants, completion-lane gate, cold-start budget, bundle sanity, and bench smoke
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v1.0.52` before push

## [1.0.51] - 2026-05-02

Reduce maintainer contract drift after the framework-complexity review

Flow 1.0.51 is a maintenance release that addresses the main remaining risk from the maintainability review: contributor comprehension and contract drift as the plugin has grown into a small workflow runtime. The release replaces scattered current-truth language with `docs/maintainer-contract.md`, adds contributor and process-orientation maps, records the current release posture, and removes stale implementation/migration docs that no longer describe current behavior.

The test cleanup continues the same direction without weakening coverage. The former `tests/config.test.ts` and `tests/runtime-completion-contracts.test.ts` suites are now split by concern, with successor breadcrumbs at the top of each new file. A new stale-reference policy test allows old paths only in historical artifacts or explicit successor breadcrumbs, so release notes and retired validation evidence stay auditable without leaking retired paths back into current docs or source.

Constraint: Address maintainability and contributor-orientation risk without changing runtime behavior, command names, tool schemas, state paths, dependencies, or public plugin surface
Constraint: Preserve historical release evidence without letting retired artifact names look current
Rejected: Keep retired process-artifact names in release notes | those names created more contributor ambiguity than audit value after the artifact tree was removed
Rejected: Keep `IMPLEMENTATION_PLAN.md` and v2 migration docs with banners | the maintainer contract now owns current behavior, and keeping superseded docs would preserve the ambiguity this release is removing
Rejected: Split every large test file at once | this release establishes the pattern on the highest-risk contract suites while avoiding unnecessary churn
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Treat `docs/maintainer-contract.md` as the current contract map; stale retired-path references belong only in historical artifacts or explicit successor breadcrumbs guarded by `tests/docs-stale-reference-policy.test.ts`
Tested: Existing `tests/config.test.ts` behavior locked before the split with 41 passing tests; split config suites preserved 41 passing tests; targeted docs/prompt/config checks passed; `bun run typecheck`; `bun run lint`; `bun test`; stale-reference scan reviewed remaining historical references; Oracle review found no blockers; `bun run check` including 427 tests, build, deadcode, release hygiene, pack invariants, completion-lane gate, cold-start budget, bundle sanity, and bench smoke
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v1.0.51` before push

## [1.0.50] - 2026-05-02

Make runtime-tool tests easier to review

Flow 1.0.50 turns the runtime-tool test cleanup into a release-visible maintenance pass. The former `tests/runtime-tools.test.ts` monolith is now split by concern: operator/control tools, completion and recovery, reviewer/reset behavior, review rendering, metadata, and runtime hooks. The original completion/recovery file is down to a focused 864 lines while the extracted suites keep the same behavioral coverage under targeted and full repo verification.

This release also removes the repeated local `toolContext` test helper from runtime-oriented test files by centralizing it in `tests/runtime-test-helpers.ts`. Per-file temp-directory cleanup remains local so test lifecycle ownership stays explicit, and no runtime source, package dependencies, or public plugin behavior changed.

Constraint: Preserve Flow runtime behavior while reducing test-suite review gravity
Constraint: Keep the cleanup bounded to tests and existing helper surfaces with no new dependencies
Rejected: Split `runtime-operator-tools.test.ts` further | it is still large but cohesive, and further slicing would add churn without a clear reviewability win
Rejected: Centralize temp-directory cleanup | per-file cleanup keeps test lifecycle ownership visible and avoids shared teardown magic
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Keep runtime-tool tests grouped by behavior concern; only introduce shared test helpers when duplication crosses multiple files and the helper has no hidden lifecycle side effects
Tested: `bun test tests/runtime-tools.test.ts tests/runtime-reviewer-reset.test.ts tests/runtime-operator-tools.test.ts tests/runtime-review-render.test.ts tests/runtime-tools-metadata.test.ts tests/runtime-hooks.test.ts`; broader targeted suite including runtime completion, summary, path traversal, and runtime transition tests; grep confirmed no remaining local `function toolContext` definitions under `tests`; Oracle review found no blocking issues; `bun run typecheck`; `bun run lint`; `bun run check` including 426 tests, build, deadcode, release hygiene, pack invariants, cold-start budget, bundle sanity, and bench smoke
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v1.0.50` before push

## [1.0.49] - 2026-05-02

Build release artifacts before randomized CI tests

Flow 1.0.49 completes the randomized-regression CI rollout by making the randomized scripts self-preparing on clean checkouts. The `v1.0.48` release workflow published successfully, but main CI still failed because the randomized-regression job runs from a fresh workspace and the install lifecycle tests load `dist/index.js`; local runs and `bun run check` had passed because they build before running the test suite.

`test:ci` and `test:randomized:regression` now run the existing build step before randomized tests. This keeps the new hosted randomized gate blocking, preserves the explicit 30s timeout and seed coverage, and makes the script match the same build-before-tests assumption already used by the release and full-check paths.

Constraint: Keep randomized-regression blocking on main while making it reliable on clean GitHub-hosted checkouts
Constraint: Reuse the existing build script instead of changing install lifecycle tests or runtime behavior
Rejected: Remove install lifecycle tests from randomized CI | they cover release-bound assets and should remain in the randomized suite
Rejected: Depend on a prebuilt dist artifact in CI | a clean checkout must build the release artifact before tests that load it
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Any CI test script that includes install lifecycle or dist-load coverage must build `dist` first
Tested: `rm -rf dist && bun run test:randomized:regression`; `bun run check`; workflow YAML parse; release guard smoke for `v1.0.49`; hosted `v1.0.48` release run succeeded with release evidence and published assets; hosted `v1.0.48` CI isolated the failure to missing clean-checkout `dist/index.js`
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v1.0.49` before push

## [1.0.48] - 2026-05-02

Keep randomized regression CI stable on hosted Linux

Flow 1.0.48 fixes the post-release CI signal from the new randomized regression job. The `v1.0.47` release workflow published successfully, including the release evidence artifact, but the main-branch randomized regression job exposed that the existing concurrent filesystem stress test can exceed Bun's default 5s test timeout on GitHub-hosted Linux under seed `42` even when its assertions pass locally and under the standard release check.

The randomized scripts now use the repo's established explicit 30s test timeout convention for heavier suites. This preserves randomized ordering and the seed-1/seed-42 regression coverage while avoiding false red builds from a known filesystem-concurrency stress test running slower on hosted infrastructure.

Constraint: Keep randomized regression coverage enabled instead of backing out the new CI job
Constraint: Avoid changing runtime concurrency behavior for a timeout-only hosted test failure
Rejected: Remove the concurrent write test from randomized CI | it is exactly the kind of filesystem safety coverage the regression job should retain
Rejected: Increase only the single test timeout in code | the randomized script is the hosted gate and should carry the heavier-suite timeout consistently across seeds
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Keep randomized CI seeded and timeout-explicit when it includes filesystem stress tests on hosted runners
Tested: `bun run check`; `bun run test:ci`; hosted `v1.0.47` release run succeeded with release evidence and published assets; hosted `v1.0.47` CI isolated the failure to randomized-regression seed `42` timeout in `tests/cross-area/concurrent-writes.test.ts`
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v1.0.48` before push

## [1.0.47] - 2026-05-02

Restore hosted release evidence after the guardrail rollout

Flow 1.0.47 is a fix-forward release for the new release-evidence workflow. The `v1.0.46` tag proved the version/changelog guard and full `bun run check` path on GitHub, but asset preparation failed before publication because the evidence writer embedded nested command substitutions directly inside `echo` strings. This release assigns those evidence values before writing the artifact, making the script parse cleanly under actionlint and Bash.

The release keeps the 1.0.46 hardening intact: completion-lane invariants remain a named gate, randomized test scripts remain explicit, hosted randomized regression coverage remains available, and the package API boundary remains root-only. No runtime behavior or dependency versions changed in this fix-forward pass.

Constraint: Fix the hosted release failure without rewriting the already-pushed `v1.0.46` tag or weakening the new release guards
Constraint: Preserve the release evidence artifact contract while avoiding shell quoting that actionlint cannot parse
Rejected: Force-move `v1.0.46` | the tag was already pushed and should remain an auditable failed release attempt
Rejected: Remove release evidence generation | the evidence artifact is the purpose of the hardening and should be repaired, not bypassed
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Keep workflow shell snippets actionlint-clean; assign complex command substitutions before echoing evidence values
Tested: `bun run check`; `bun run test:ci`; workflow YAML parse; release guard smoke for `v1.0.47`; hosted `v1.0.46` run proved the tag/changelog guard and `bun run check` before failing in asset preparation
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v1.0.47` before push

## [1.0.46] - 2026-05-02

Make release confidence visible before cutting the next tag

Flow 1.0.46 turns the post-review hardening pass into release-visible guardrails. CI now exposes the completion-lane invariant gate directly, `bun run check` includes that gate, and randomized tests have named scripts plus a regression-strength hosted job for main pushes or manual dispatch. The release workflow now refuses mismatched tags, missing changelog headings, empty or heading-only notes, and uploads release evidence before publishing assets.

The release also documents the package boundary in the README and maintainer docs: consumers should import only from `opencode-plugin-flow`, while deep paths remain unsupported internals. Historical evidence docs now call out stale version snapshots explicitly, and the dependency-contract check has a small helper-backed regression for missing plugin `zod` metadata without changing dependency versions.

Constraint: Improve release confidence using existing Bun/GitHub Actions surfaces without adding dependencies or changing Flow runtime behavior
Constraint: Keep the public package API root-only and keep `zod` aligned with the OpenCode plugin SDK contract
Rejected: Add a separate release dry-run workflow | the tag workflow now has local smoke coverage and hosted proof comes from the actual release path
Rejected: Make `test:ci` deterministic-only | CI confidence depends on preserving randomized ordering while adding explicit regression-strength runs
Rejected: Widen package exports for convenience | deep imports would create accidental semver promises for internal runtime modules
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep release notes body-bearing and version-matched; do not bypass the release evidence guard when publishing future tags
Tested: `bun run check`; `bun run test:randomized:regression`; `bun run test:ci`; workflow YAML parse; release guard smoke including heading-only rejection; remote tag resolution for `actions/upload-artifact@v6`, `actions/checkout@v6`, and `actions/setup-node@v6`; Oracle review of the hardening diff
Not-tested: Live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v1.0.46` before push

## [1.0.45] - 2026-05-02

Reduce cleanup complexity while fencing the package API boundary

Flow 1.0.45 turns the complexity-reduction investigation into a guarded cleanup release. Shared final-review fixtures replace repeated completion-gate literals, final-review coverage now uses a centralized surface taxonomy, audit report coverage summaries are normalized in one place, and the legacy application `tool-runtime.ts` adapter has been removed after moving active callers to their owning runtime modules.

The release also makes the supported package boundary explicit. `package.json` now exports only the root plugin entrypoint, and pack invariants fail if future changes widen `main` or `exports` without review. This keeps unsupported deep imports from becoming accidental compatibility promises while preserving the shipped OpenCode plugin surface.

Constraint: Preserve Flow command behavior and final-completion semantics while removing stale internal wrappers and repeated test/report logic
Constraint: Keep the public package API to the root plugin entrypoint instead of reintroducing internal runtime export surface
Rejected: Keep `src/runtime/application/tool-runtime.ts` as a compatibility shim | the package ships a bundled root plugin entrypoint and active internal callers now import owner modules directly
Rejected: Deduplicate prompt policy wording in this pass | those prompt snippets are intentionally product-facing and pinned by prompt/eval tests
Rejected: Treat repo-local process artifacts as package dead code | release checks do not ship those artifacts, but repo tests and process notes still used parts of that tree as fixtures/support context at the time
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Do not widen `package.json#exports` or restore application-barrel compatibility helpers without a reviewed public-API decision and pack-invariant update
Tested: `bun run check`; package import smoke for root `opencode-plugin-flow`; blocked deep-import smoke expecting `ERR_PACKAGE_PATH_NOT_EXPORTED`; targeted pack-invariants and dist-load tests; Oracle review of the cleanup diff
Not-tested: Live GitHub-hosted `release.yml` run for tag `v1.0.45` before push

## [1.0.44] - 2026-05-02

Make dead-code cleanup explicit before the next release

Flow 1.0.44 removes unused internal declarations that had drifted behind the runtime and tool-schema refactors. The cleanup deletes dead command constants, schema/type aliases, path wrappers, transition helpers, render helpers, and a test-only helper type without changing the user-facing Flow commands or runtime behavior.

The configured deadcode gate already had no unused files or dependencies, so this release keeps that gate intact and treats the broader export-level scan as advisory. Only high-confidence in-repository dead declarations were removed; schema barrels and intentionally exported validation surfaces remain in place where the current package structure still relies on them as internal boundaries.

Constraint: Keep the cleanup deletion-only and avoid changing Flow command behavior, package dependencies, or the zod/plugin SDK alignment
Rejected: Remove every export reported by broad `knip` output | many reports are intentional internal schema/barrel surfaces rather than safely deletable runtime code
Rejected: Update README command documentation | the documented `/flow-*` commands and behavior did not change
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Treat `bun run deadcode` as the release gate for unused files/dependencies and broad `knip` export output as advisory unless a symbol has no in-repository use or API reason to remain
Tested: `bun run typecheck`; `bun run deadcode`; `bun test`; `bun run lint`; `bun run build`; targeted README reference search for removed symbols; Oracle review of the cleanup diff
Not-tested: Live GitHub-hosted `release.yml` run for tag `v1.0.44` before push


## [1.0.43] - 2026-05-02

Make release safety explicit while removing deprecated install heuristics

Flow 1.0.43 hardens the release path without adding compatibility shims or speculative layers. Install and uninstall now protect `~/.config/opencode/plugins/flow.js` with an explicit Flow ownership marker, refuse to overwrite or remove unowned plugin files, and write release-installer downloads through temporary files before atomically moving the managed plugin into place. Deprecated unmarked-plugin signature heuristics were removed, so ownership is no longer inferred from brittle tool-name substrings.

Session persistence is safer across process boundaries. Lifecycle operations now share the session save lock, session writes use a filesystem-backed lock in addition to the in-process queue, and lock cleanup is covered by a stricter absence check. Final completion is also stricter: lite-lane final completion now requires a recorded final reviewer decision instead of accepting an in-band worker final review as a substitute.

The release checks now include pack invariants and cold-start budget enforcement in `bun run check`, while the cold-start harness loads the real plugin peer and zod packages instead of maintaining a local shim. The cleanup pass removed test-only runtime export surface and synthetic legacy install tests, keeping the diff smaller and easier to reason about.

Constraint: Ship the hardening work without adding new dependencies, deprecated compatibility branches, or avoidable public API surface
Constraint: Keep zod aligned with the OpenCode plugin SDK's effective zod version while expanding release checks
Rejected: Keep legacy unmarked-plugin detection | substring ownership heuristics can misclassify unrelated plugins and preserve deprecated behavior
Rejected: Let release install write directly to `flow.js` before adding ownership metadata | interrupted installs could leave an unmarked file that future safety checks reject
Rejected: Export queue internals for tests | production barrels should not grow test-only API surface
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep plugin ownership marker-based; do not reintroduce legacy signature ownership detection without a reviewed migration design and false-positive analysis
Tested: `bun run check`; targeted install, lifecycle, atomic write, workspace cache, completion gate, runtime contract, and runtime tool tests
Not-tested: Live GitHub-hosted `release.yml` run for tag `v1.0.43` before push

## [1.0.42] - 2026-05-01

Make coding guidelines enforceable before release instead of relying on reviewer memory

Flow 1.0.42 turns maintainability guidance into a checked workflow contract. Production source now enables Biome's no-console rule, release builds drop bundled console calls, release checks scan `src` and `dist/index.js`, and the installer path uses explicit stdout/stderr stream adapters instead of raw console calls. This means debug-only `console.*` calls and `debugger` statements cannot slip into the release-bound plugin or its built artifact while development scripts and tests can still emit intentional operator output.

The same principle is now present in Flow's planning, execution, autonomous, and review prompts. Planner and worker surfaces explicitly plan and complete against coding guidelines, small diffs, existing scripts/utilities, release hygiene, and test coverage. Reviewer surfaces treat release hygiene and missing tests as review concerns, so workflow approvals should reject debug instrumentation instead of treating it as an afterthought.

Constraint: Convert best-practice guidance into automated release gates and prompt contracts without adding dependencies or weakening the existing Bun-first validation path
Constraint: Preserve intentional CLI output by routing release-bound messages through explicit stdout/stderr adapters rather than banning operator-facing output entirely
Rejected: Rely on prose-only maintainer guidance | release hygiene must fail mechanically before a tag can ship
Rejected: Enable no-console globally for scripts and tests | development-only tooling needs intentional stdout/stderr output and is not part of the shipped plugin artifact
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep future workflow/prompt changes aligned with the coding-guidelines gate; do not reintroduce raw console calls or debugger statements into release-bound source without replacing the gate with an equally strict reviewed alternative
Tested: `bun run check`; `bun test tests/cross-area/release-hygiene.test.ts tests/biome-adoption.test.ts tests/config.test.ts tests/mode-contracts.test.ts`; `bun run build && bun run check:release-hygiene`
Not-tested: Live GitHub-hosted `release.yml` run for tag `v1.0.42` before push

## [1.0.41] - 2026-05-01

Make Flow's long-running modes narrate their work without adding noise

Flow 1.0.41 turns operator feedback into an explicit prompt contract across the main workflow surfaces. `/flow-auto`, `/flow-run`, `/flow-plan`, flow-planner, and flow-worker now require concise phase-boundary progress updates before and after planning, execution, validation, review, recovery/reset, and finalization. The autonomous coordinator also carries a concrete checkpoint list so users can see what phase Flow is in, what action is happening next, why it matters, and what evidence came out of the phase.

The same expectation is now reflected in mode contracts and the read-only `/flow-review` surface: longer reviews should announce mapping, evidence inspection, and rendering phases, while control/history/reset operations should provide one before/after update when they perform multi-step runtime work. The reviewer JSON contract remains intentionally strict so machine-readable approval decisions do not get polluted with user-facing narration.

Constraint: Improve user-visible workflow transparency without weakening runtime-owned state transitions or strict reviewer JSON output
Constraint: Keep feedback concise enough for OpenCode users to understand progress without flooding the transcript with raw tool JSON or minor file-read narration
Rejected: Add a new runtime event-streaming API | prompt-level phase guidance solves the immediate UX gap without expanding the public tool surface
Rejected: Apply progress prose to flow-reviewer output | reviewer decisions must remain exact JSON for downstream runtime gates
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Keep future prompt/mode changes aligned with the shared operator-progress contract so new workflow surfaces explain phase, action, evidence, and next step consistently
Tested: `bun run check`; `bun test --randomize` (seed `2415184663`); `node ./scripts/cross-area/pack-invariants.mjs`; `node ./scripts/cross-area/bench-gate.mjs`; `node ./scripts/cross-area/cold-start-budget.mjs`; targeted prompt/config snapshot and capture checks
Not-tested: Live OpenCode transcript behavior before pushing tag v1.0.41

## [1.0.40] - 2026-05-01

Close review-found correctness and release hardening gaps before the next publish

Flow 1.0.40 turns the full-codebase review findings into runtime, audit, release, and validation guards. Completion thresholds now fail fast when they exceed the active plan size, including narrowed approval/select paths and legacy invalid sessions that reach execution. Session persistence now uses unique atomic-write temp files and validates cached reads by content hash, so same-size external rewrites cannot be served stale. History lookup tolerates stale active pointers by falling back to stored or completed copies, and the compaction hook now uses the same safe session loader as system-context injection.

The release lane is also stricter: source builds no longer require Python, bundle sanity is current with the actual history/config/tool surfaces and is part of `bun run check`, CI runs for docs/bench/config-relevant changes, and generated release install assets are tag-pinned instead of silently fetching `latest`. `/flow-review` now wraps raw arguments in a tagged untrusted-data block, downgrades full-audit claims unless all major surface categories are directly evidenced, and includes synthesized `not_run` validation accounting in structured output as well as the human report.

Constraint: Fix the concrete review findings without adding dependencies or broad rewrites
Constraint: Preserve the existing Flow tool surface and zod/plugin SDK alignment while tightening runtime and release gates
Rejected: Clamp impossible completion thresholds silently | rejecting invalid plans makes the author repair the plan instead of hiding a broken completion contract
Rejected: Keep mtime/size-only session cache validation for performance | correctness across external writers is more important than avoiding the extra read
Rejected: Leave bundle-sanity as a manual side script | release confidence depends on checking the packaged plugin surface after build
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep completion-policy validation paired with any future plan-subsetting path; keep bundle-sanity expected surfaces in lockstep with config/tool additions
Tested: `bun run check`; `bun test --randomize` (seed `1395117911`); `node ./scripts/cross-area/pack-invariants.mjs`; `node ./scripts/cross-area/bench-gate.mjs`; `node ./scripts/cross-area/cold-start-budget.mjs`; targeted regression tests for runtime tools, session cache, atomic writes, install lifecycle, prompt snapshot, and config
Not-tested: Live GitHub-hosted `release.yml` run for tag `v1.0.40` before push

## [1.0.39] - 2026-04-30

Make prompt quality a mode-wide offline contract instead of review-only tuning

Flow 1.0.39 extends the providerless prompt-quality loop beyond `/flow-review` into the main Flow modes. Prompt mode boundaries now live in one canonical contract that records each surface's source files, mutation limits, expected tools, forbidden tools, required behavior, and stop condition. The behavior eval and capture harnesses use that contract to check planner, worker, auto, reviewer, run, and control outputs offline, including structured tool-call intent when available and safer affirmative matching when only prose is captured.

This keeps prompt iteration practical: maintainers can export capture prompts, score real outputs, promote calibrated captures into regressions, and publish combined prompt-eval summaries without adding model-provider credentials or direct API calls. The README and development guide now document that workflow so future prompt changes are treated as product changes, not unreviewed wording edits.

Constraint: Improve prompt quality across Flow modes without adding a model API dependency, new credentials, or new runtime tooling
Constraint: Keep mode safety explicit enough that read-only and mutating surfaces can be mechanically checked against their intended Flow tool boundaries
Rejected: Add live provider-backed evals as the first step | credential requirements and provider variance would make local and CI prompt checks harder to run consistently
Rejected: Keep prompt-mode expectations only in prose fixtures | mode boundaries would drift as prompts, command templates, and tool permissions evolve
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep `src/prompts/mode-contracts.ts`, prompt fixtures, capture scenarios, and config/tool permissions aligned whenever adding or changing a Flow mode
Tested: `bun run check`; `bun run eval:review-capture:check`; `bun run eval:prompt-capture:check`; `bun test tests/prompt-mode-behavior-eval.test.ts tests/prompt-mode-capture.test.ts tests/mode-contracts.test.ts`
Not-tested: Live OpenCode tool-call trace ingestion; live GitHub-hosted `release.yml` run for tag `v1.0.39` before push

## [1.0.38] - 2026-04-30

Keep GitHub Actions on the current Node runtime before the runner deprecation becomes noise

Flow 1.0.38 refreshes the CI and release workflow action surface so the project no longer emits Node 20 deprecation warnings on GitHub-hosted runs. The workflow now uses `actions/checkout@v6`, `dorny/paths-filter@v4`, and `actions/upload-artifact@v6`, with the explicit `pull-requests: read` permission that the paths-filter PR mode documents. This keeps the release lane boring: prompt-quality artifacts still upload, tag releases still build from the same Bun pipeline, and the workflow warnings no longer distract from real failures.

Constraint: Remove GitHub Actions Node 20 deprecation warnings without changing the Bun validation/release commands or adding new release tooling
Constraint: Keep the CI change detector working for pull requests after moving `dorny/paths-filter` to its Node 24 major
Rejected: Silence the warnings with a runner-level Node override | that would hide stale action pins instead of keeping the workflow surface current
Rejected: Replace `paths-filter` with hand-written git diff shell logic | larger behavior change for a release hygiene fix
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Keep workflow action major bumps paired with their documented permission/runtime requirements; do not remove `pull-requests: read` while PR change detection depends on `paths-filter`
Tested: `bun run check`; Ruby YAML parse of `.github/workflows/*.yml`
Not-tested: Local `actionlint` because the Docker daemon was unavailable and no standalone `actionlint` binary was installed; live GitHub-hosted `ci.yml` and `release.yml` runs for tag `v1.0.38` before push

## [1.0.37] - 2026-04-30

Turn Flow review quality into a measurable offline regression loop

Flow 1.0.37 strengthens `/flow-review` from a well-worded prompt into a prompt-quality system. The review lane now carries sharper evidence rules, an explicit `hardening_opportunity` taxonomy for useful non-blocking improvements, stricter schema and normalization guards around full-audit claims, deterministic behavior evals for calibrated versus overconfident outputs, captured real-output fixtures, prompt snapshots, and providerless review-capture packets that can score structured model/plugin output without calling a model API or requiring credentials. The prompt eval report now includes behavior-eval artifacts so prompt changes can be reviewed as testable product surfaces instead of prose-only edits.

Constraint: Improve review output quality and regression detection without adding provider-specific API calls, credentials, or new dependencies
Constraint: Keep `/flow-review` read-only and renderer-backed while making requested depth, achieved depth, coverage evidence, and validation honesty mechanically checkable
Rejected: Add a direct OpenAI live-eval harness | it would introduce credentials and provider lock-in for a workflow that can be captured and scored offline through the actual plugin surface
Rejected: Continue tuning prompt wording without captured-output fixtures | prompt quality would remain subjective and regressions would only be noticed after disappointing real reviews
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: When review output disappoints, capture the structured ledger and promote it into the behavior fixture corpus; keep prompt contracts, schemas, renderer ordering, and eval fixtures aligned when changing review semantics
Tested: `bun run check`; `bun run eval:review-capture:check`; `bun test tests/review-prompt-capture.test.ts tests/prompt-behavior-eval.test.ts`; `bun run typecheck`; `bun run lint`; `bun run report:prompt-eval`
Not-tested: Live GitHub-hosted `release.yml` run for tag `v1.0.37` before push; fully automated live model-in-the-loop evals by design; manual plugin-surface captures from multiple external repositories

## [1.0.36] - 2026-04-30

Simplify the Flow review lane and tighten the user-facing docs without weakening runtime execution gates

Flow 1.0.36 shrinks the standalone `/flow-review` surface again. This release keeps the renderer-backed human report, but reduces review-lane contract and prompt duplication, removes duplicated coverage bookkeeping, trims semantic repair logic back to structural depth calibration, and keeps the stricter boundary that rejects the old review payload shape instead of carrying a compatibility shim the product no longer wants. It also cleans up the README so end users see the practical Flow entry points first (`/flow-auto`, `/flow-plan`, `/flow-review`) without being dropped straight into internal runtime terminology, while keeping maintainer detail in `docs/development.md`. Runtime-owned `flow-auto` completion/review semantics remain intact.

Constraint: Improve review-lane maintainability and end-user clarity without weakening runtime-owned completion, validation, or final-review semantics
Constraint: Keep zod aligned with the plugin SDK's effective contract while preserving the existing canonical tool surface and thin JSON transport boundaries
Rejected: Keep a legacy review-ledger compatibility parser in `flow_review_render` | it preserved an old internal shape the product no longer wants and added code without meaningful user value
Rejected: Re-expand presenter/normalizer heuristics to rewrite reviewer meaning | that would hide simplification gains behind more semantic repair layers instead of making the boundary cleaner
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep `/flow-review` small and human-first, and preserve the boundary where runtime owns execution truth while the review lane owns presentation only
Tested: `bun run check`; `bun test tests/runtime-tools.test.ts tests/config.test.ts tests/smoke/dist-load.test.ts tests/docs-tool-parity.test.ts tests/prompt-eval-corpus.test.ts`; `bunx biome check README.md docs/development.md tests/config.test.ts tests/prompt-eval-corpus.test.ts tests/docs-tool-parity.test.ts --files-ignore-unknown=true`
Not-tested: Live GitHub-hosted `release.yml` run for tag `v1.0.36` before push; long-lived in-flight callers still emitting the pre-simplification review payload shape

## [1.0.35] - 2026-04-30

Render `/flow-review` output through a deterministic human-first presenter instead of raw ledger text

Flow 1.0.35 keeps the structured review ledger for coverage and autonomous use, but stops relying on prompt prose alone for the final review output. This release adds a strict review-report schema, a renderer-backed `flow_review_render` read-only runtime tool, and a deterministic presenter that emits Conclusion, Top findings, Recommended next actions, and Coverage notes by default. The review command surface now builds the structured ledger, passes it through the renderer, and only emits raw structured JSON when explicitly requested.

Constraint: Improve human readability for `/flow-review` without weakening the structured coverage ledger or adding a mutating review subsystem
Constraint: Keep zod aligned with the plugin SDK's effective contract while preserving the existing thin JSON transport boundary and read-only command behavior
Rejected: Keep tuning prompt wording alone | output quality would still depend too heavily on model formatting drift
Rejected: Replace the structured review ledger with free-form markdown only | would weaken machine-readable coverage accounting and reduce autonomous reuse
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep the review ledger as the canonical machine contract, but route user-facing review output through deterministic rendering rather than raw ledger dumps
Tested: `bun run check`; `bun test tests/config.test.ts tests/prompt-eval-corpus.test.ts tests/runtime-tools.test.ts tests/smoke/dist-load.test.ts tests/docs-tool-parity.test.ts`; `bun run typecheck && bun run build`
Not-tested: Live GitHub-hosted `release.yml` run for tag `v1.0.35` before push; real OpenCode review sessions across multiple repositories after the renderer-backed output change

## [1.0.34] - 2026-04-30

Replace the audit-heavy review lane with one clear `/flow-review` surface and make final approval evidence real

Flow 1.0.34 removes the separate audit/report-history product story and replaces it with one user-facing read-only review command. `/flow-review` is now the only review surface Flow exposes, the old saved-audit plumbing and compatibility aliases are gone, and the docs/prompts/status copy now describe review depth directly instead of a parallel audit subsystem. This release also hardens completion: final review policy is runtime-owned, `flow-auto` defaults its final completion gate to a detailed cross-feature review, final reviewer decisions and worker payloads carry explicit depth, typed reviewed surfaces, and artifact-backed evidence refs, and completion rejects claimed coverage that is not grounded in the current run’s changed artifacts and validation commands.

Constraint: Simplify the review UX without weakening the final completion gate or reintroducing prompt-only review semantics
Constraint: Keep zod aligned with the plugin SDK's effective contract while strengthening final-review validation through existing thin JSON tool boundaries
Rejected: Keep separate `/flow-reviews` or legacy `/flow-audit` surfaces for saved-history browsing | they added user-facing complexity without serving the primary product goal of “review now and show the result”
Rejected: Enforce a hard two-phase finalization flow that blocks recording final approval until matching worker evidence is already persisted | stronger in theory, but it reduces workflow flexibility and requires a larger sequencing redesign than this release needs
Confidence: high
Scope-risk: broad
Reversibility: messy
Directive: Keep the public review surface singular and keep final-review rigor runtime-owned; do not reintroduce hidden report-history UX or prompt-only final-review depth claims without fresh evidence
Tested: `bun run check`
Not-tested: Live GitHub-hosted `release.yml` run for tag `v1.0.34` before push; real OpenCode end-to-end sessions exercising both `broad` and `detailed` final-review policies after this release

## [1.0.33] - 2026-04-30

Make Flow audits always available while shrinking the GPT-5.5 audit-history payload

Flow 1.0.33 finishes the audit-surface stabilization work. `flow_audit_reports` now uses a thin `requestJson` transport so OpenCode sends a much smaller provider-facing schema to OpenAI, while the runtime still keeps strict validation and legacy direct-object fallback for internal callers. This release also removes the obsolete audit env-gating and makes `/flow-audit` and `/flow-audits` available by default, updates the control/audit prompts to use the new wrapper contract, and cleans up docs/tests to match the always-on audit surface.

Constraint: Preserve audit behavior and internal direct-call compatibility while shrinking the provider-facing tool contract and removing obsolete audit env-gate complexity
Constraint: Keep zod aligned with the plugin SDK's effective contract while changing only the audit surface that reproduced GPT-5.5 instability
Rejected: Keep the audit env gates and only update docs | would leave the fixed audit surface hidden behind obsolete setup and preserve avoidable runtime/config complexity
Rejected: Split `flow_audit_reports` into multiple new public tools immediately | the thin wrapper solved the GPT-5.5 failure with a smaller blast radius and preserved the existing command UX
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep heavy provider-facing tool inputs on thin JSON-string transports and do not reintroduce raw multiplexed audit schemas or env-gated audit defaults without fresh host evidence
Tested: `bun run check`; `bun test tests/config.test.ts tests/runtime-tools.test.ts tests/smoke/dist-load.test.ts tests/docs-tool-parity.test.ts tests/protocol-parity.test.ts tests/cross-area/install-lifecycle.test.ts tests/cross-area/manual-flow.test.ts tests/cross-area/resume-flow.test.ts tests/cross-area/dependency-contract.test.ts tests/cross-area/pack-invariants.test.ts tests/cross-area/next-command-coverage.test.ts`; live no-env OpenCode `gpt-5.5` runs for `/flow-audits`, `/flow-audits show latest`, `/flow-audits compare latest latest`, `/flow-audits compare latest <older>`, `/flow-audits compare <older> latest`, `/flow-audits compare <reportA> <reportB>`, and `/flow-audit quick smoke audit; do not persist if no findings`; live no-env `gpt-5.4` controls for `/flow-audits show latest` and `/flow-audit quick smoke audit; do not persist if no findings`
Not-tested: Long-running full-surface broad persisted GPT-5.5 audits on a repository with real active Flow session state; live GitHub-hosted `release.yml` run for tag `v1.0.33` before push

## [1.0.32] - 2026-04-29

Flatten the /flow-audit command text so the direct OpenAI path avoids markup-heavy prompts

Flow 1.0.32 keeps the audit-on-control-agent routing from 1.0.31, but removes the remaining XML-style and section-rendered command framing from `FLOW_AUDIT_COMMAND_TEMPLATE`. The audit command now uses a compact plain-text instruction block with the same audited behavior constraints, while leaving the other Flow command surfaces untouched. This narrows the remaining provider-specific risk to a simpler text prompt instead of a markup-heavy command expansion.

Constraint: Preserve the audit command behavior and tested audit semantics while simplifying the provider-facing command text as much as possible
Constraint: Keep zod aligned with the plugin SDK's effective contract and avoid broad prompt-system churn when only the audit command path is under suspicion
Rejected: Convert every Flow command template away from structured sections | unnecessary blast radius when only `/flow-audit` is implicated
Rejected: Keep XML-style task framing on `/flow-audit` while changing only tool/config routing | left the OpenAI-facing audit command payload unnecessarily markup-heavy
Confidence: medium
Scope-risk: narrow
Reversibility: clean
Directive: If provider-specific issues persist, prefer targeted simplification on the implicated surface instead of flattening unrelated Flow prompts
Tested: `bun run check`; `bun test tests/cross-area/pack-invariants.test.ts tests/config.test.ts tests/smoke/dist-load.test.ts tests/prompt-eval-corpus.test.ts`
Not-tested: Actual OpenCode direct OpenAI host behavior on the user's machine after the plain-text `/flow-audit` command change; live GitHub-hosted `release.yml` run for tag `v1.0.32` before push

## [1.0.31] - 2026-04-29

Route /flow-audit through the stable control-agent path instead of a dedicated audit agent

Flow 1.0.31 removes the remaining dedicated primary-agent path from `/flow-audit`. The audit command still uses the same audit command template, tools, and structured contract, but it now runs through the existing `flow-control` agent rather than a separate `flow-auditor` agent. This keeps the audit behavior intact while eliminating one more OpenCode-specific command/agent surface that could diverge on the direct OpenAI provider path.

Constraint: Preserve the audit command behavior and read-only guarantees while removing the extra primary-agent surface from the audit path
Constraint: Keep zod aligned with the plugin SDK's effective contract and avoid adding runtime complexity while isolating a provider-specific failure mode
Rejected: Keep the dedicated flow-auditor path and continue trimming only prompt text | left an extra OpenCode primary-agent path in place even after prompt-surface reduction
Rejected: Merge audit into the normal execution lane | would blur the audit/execution boundary instead of removing only the unstable surface
Confidence: medium
Scope-risk: narrow
Reversibility: clean
Directive: Prefer reusing stable agent surfaces for specialized commands when a separate primary-agent path is not buying real capability
Tested: `bun run build && bun test tests/config.test.ts tests/smoke/dist-load.test.ts tests/prompt-eval-corpus.test.ts tests/docs-tool-parity.test.ts`; `bun run check`
Not-tested: Actual OpenCode direct OpenAI host behavior on the user's machine after routing `/flow-audit` through `flow-control`; live GitHub-hosted `release.yml` run for tag `v1.0.31` before push

## [1.0.30] - 2026-04-29

Trim the audit prompt surface so direct OpenAI audit requests stay within provider limits

Flow 1.0.30 targets the remaining `/flow-audit` instability on the direct OpenAI provider path. The prior releases reduced audit tool registration pressure, but the full audit agent still expanded into a very large command + agent + contract prompt surface. This release removes the large embedded audit-contract examples, trims duplicated audit guidance across the auditor prompt and audit command template, and keeps the tested audit contract semantics while materially shrinking the prompt payload seen by OpenCode when `/flow-audit` is invoked.

Constraint: Preserve the existing audit semantics and tested contract phrases while materially shrinking the direct OpenAI audit prompt surface
Constraint: Keep zod aligned with the plugin SDK's effective contract and avoid introducing new runtime or tool complexity while debugging a provider-specific request failure
Rejected: Keep the oversized embedded audit examples and continue bisecting only tool/config surfaces | the direct OpenAI failure occurs at audit invocation time and the prompt payload was still substantially larger than other Flow surfaces
Rejected: Replace the audit contract with a looser summary-only prompt | would reduce size by weakening the structured audit guarantees instead of preserving them
Confidence: medium
Scope-risk: narrow
Reversibility: clean
Directive: Keep future audit prompt additions compact; if a new audit requirement needs long examples, prefer test fixtures and docs over embedding large examples into the provider-facing prompt surface
Tested: `bun test tests/config.test.ts tests/prompt-eval-corpus.test.ts`; `bun run check`
Not-tested: Actual OpenCode direct OpenAI host behavior on the user's machine after the audit prompt trim; live GitHub-hosted `release.yml` run for tag `v1.0.30` before push

## [1.0.29] - 2026-04-29

Split the audit-tool gate so host instability can be isolated to one remaining tool

Flow 1.0.29 narrows the OpenCode instability diagnosis further. The prior patch reduced the audit tool surface from four tools to two, but `FLOW_ENABLE_AUDIT_TOOLS=1` still reproduced the host failure. This release keeps the umbrella audit-tools flag, but adds separate `FLOW_ENABLE_AUDIT_REPORTS_TOOL=1` and `FLOW_ENABLE_AUDIT_WRITE_TOOL=1` gates so the remaining failure can be isolated to the saved-audit read tool, the audit artifact write tool, or only their combined registration.

Constraint: Preserve the current audit behavior while adding the smallest possible host-bisect surface around the two remaining audit tools
Constraint: Keep zod aligned with the plugin SDK's effective contract and avoid widening runtime semantics just to add finer diagnostic control
Rejected: Leave the two-tool audit surface unsplit | not enough information to isolate whether one remaining tool or the combined registration breaks OpenCode
Rejected: Add more runtime or prompt complexity before isolating the exact failing tool presence | the next useful signal is host bisecting, not more internal machinery
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Use the new reports-tool and write-tool gates to identify whether OpenCode breaks on one remaining audit tool or only on the combined audit-tools surface before changing the default again
Tested: `bun run build && bun test tests/smoke/dist-load.test.ts tests/config.test.ts tests/docs-tool-parity.test.ts`; `bun run check`
Not-tested: Actual OpenCode host stability on the user's machine for `FLOW_ENABLE_AUDIT_REPORTS_TOOL=1`, `FLOW_ENABLE_AUDIT_WRITE_TOOL=1`, or `FLOW_ENABLE_AUDIT_TOOLS=1`; live GitHub-hosted `release.yml` run for tag `v1.0.29` before push

## [1.0.28] - 2026-04-29

Reduce audit tool registration pressure without dropping audit functionality

Flow 1.0.28 keeps the audit lane available, but trims the host-facing audit tool surface that was destabilizing OpenCode when `FLOW_ENABLE_AUDIT_TOOLS=1` was enabled. This release collapses the three saved-audit read tools into one multiplexed `flow_audit_reports` tool, keeps `flow_audit_write_report` as the separate permissioned write boundary, and lazy-loads audit runtime modules from those tool entrypoints so the audit runtime is not pulled in eagerly just because the tool surface is registered.

Constraint: Preserve audit functionality while reducing the global tool surface seen by OpenCode when audit tools are enabled
Constraint: Keep zod aligned with the plugin SDK's effective contract and avoid widening runtime behavior just to shrink the audit entrypoints
Rejected: Keep four separate audit tools and only tweak wording or guidance | did not address the host-facing tool registration surface implicated by `FLOW_ENABLE_AUDIT_TOOLS=1`
Rejected: Remove audit tools again from the default diagnostic path | would preserve stability at the cost of leaving the real audit-tools regression unresolved
Confidence: medium
Scope-risk: moderate
Reversibility: clean
Directive: If OpenCode still destabilizes with `FLOW_ENABLE_AUDIT_TOOLS=1`, investigate host interaction with the remaining two audit tools before re-expanding the audit surface
Tested: `bun test tests/config.test.ts tests/runtime-tools.test.ts tests/smoke/dist-load.test.ts tests/docs-tool-parity.test.ts`; `bun run check`
Not-tested: Actual OpenCode host stability on the user's machine with `FLOW_ENABLE_AUDIT_TOOLS=1`; live GitHub-hosted `release.yml` run for tag `v1.0.28` before push

## [1.0.27] - 2026-04-29

Add a diagnostic audit-surface matrix so host instability can be bisected cleanly

Flow 1.0.27 keeps the safer core-only default from 1.0.26, but adds fine-grained audit reintroduction switches so host instability can be isolated instead of argued about. This release introduces independent config, tools, and guidance gates for the audit lane, updates the built-dist and config coverage to exercise those partial combinations, and documents the matrix so host testing can identify the smallest unstable audit surface.

Constraint: Preserve the stable core-only default while making audit reintroduction granular enough to diagnose host-side instability
Constraint: Keep zod aligned with the plugin SDK's effective contract and avoid widening runtime complexity just to add diagnostic knobs
Rejected: Re-enable the full audit lane by default immediately | unsafe without host evidence about which audit sub-surface causes instability
Rejected: Leave only one all-or-nothing audit flag | insufficient for meaningful host bisecting
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Use the new audit config/tools/guidance gate matrix to identify the smallest unstable OpenCode surface before changing the default again
Tested: `bun run build && bun test tests/config.test.ts tests/smoke/dist-load.test.ts tests/docs-tool-parity.test.ts`; `bun run check`
Not-tested: Actual OpenCode host behavior on the user’s machine across the diagnostic gate combinations; live GitHub-hosted `release.yml` run for tag `v1.0.27` before push

## [1.0.26] - 2026-04-29

Keep Flow stable by making the audit lane an explicit opt-in surface

Flow 1.0.26 finishes the audit-lane stability correction. This release extracts audit behavior into a dedicated boundary, removes audit agents, commands, tools, and audit-specific guidance from the default plugin surface, keeps ordinary Flow behavior on the smaller core-only path, and preserves the full audit lane behind the explicit `FLOW_ENABLE_AUDIT_SURFACE=1` opt-in. It also tightens host-safety behavior so the plugin’s system and compacting hooks no-op when no usable workspace context exists.

Constraint: The default OpenCode plugin surface had to shrink materially without removing the audit feature entirely
Constraint: Keep zod aligned with the plugin SDK's effective contract and preserve existing Flow core behavior while moving audit behind an opt-in gate
Rejected: Leave audit enabled by default and only trim prompt text | insufficient to reduce the host-visible global surface that was destabilizing OpenCode
Rejected: Remove audit entirely | the feature remains useful when explicitly enabled
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep audit opt-in unless real host-side evidence shows the default Flow surface can safely absorb that extra global footprint again
Tested: `bun run check`; `bun test tests/runtime-tools.test.ts tests/smoke/dist-load.test.ts tests/cross-area/install-lifecycle.test.ts`; `bun test tests/cross-area/manual-flow.test.ts tests/cross-area/autonomous-flow.test.ts tests/cross-area/resume-flow.test.ts`; `bun test tests/protocol-parity.test.ts tests/package-manager-detection.test.ts tests/runtime-summary.test.ts`; `bun test tests/docs-tool-parity.test.ts tests/transitions-consolidation.test.ts tests/prompt-eval-corpus.test.ts`; `bun test tests/runtime/render-snapshot.test.ts tests/runtime/render-incremental.test.ts`; `bun test tests/cross-area/module-scope-schemas.test.ts tests/helpers.test.ts tests/workspace-root-guard.test.ts`; `bun run report:prompt-eval`; direct source/dist/plugin hook gate inspections
Not-tested: Actual OpenCode host behavior on the user’s machine with this build installed; live GitHub-hosted `release.yml` run for tag `v1.0.26` before push

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
Constraint: Prompt evals must stay first-party and must not depend on external process artifacts
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
- Added a required worker orientation reference alongside the existing architecture and validation guidance. This referred to a repo-local process artifact tree that has since been retired.
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

Flow 1.0.16 tightens hidden-workspace permission behavior so only Flow's own `.flow` state stays auto-allowed. When the effective mutable workspace root is another hidden directory, Flow now asks for permission before writing Flow state there while still leaving normal project-root `.flow` behavior unchanged.

### Added

- Added a shared mutable-workspace permission gate in `src/tools/mutable-workspace-permission.ts` so mutating Flow tools consistently request approval before writing `.flow/**` under hidden workspace roots other than `.flow`.
- Added targeted runtime-tool coverage for the three key behaviors: hidden workspace roots prompt, normal project roots with hidden subdirectories do not prompt, and `.flow` itself remains auto-allowed.

### Changed

- Routed mutating runtime and session tool entrypoints through the new permission gate instead of silently allowing all hidden workspace roots.
- Updated workspace-safety documentation to explain when Flow prompts for hidden workspace roots versus when it continues writing to the normal project-root `.flow/**` subtree.
- Clarified mutable-root remediation text so `$HOME` rejection explains that Flow needs a real project/worktree subdirectory rather than suggesting a trusted-root override.

### Fixed

- Fixed the remaining mismatch where hidden directories could still become mutable Flow roots without an approval prompt.
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

- Fixed the accidental ability for Flow to persist state under suspicious hidden roots unless the exact path is explicitly trusted.
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
