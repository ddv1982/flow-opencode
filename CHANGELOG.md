# Changelog

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
