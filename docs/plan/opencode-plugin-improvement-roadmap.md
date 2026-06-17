# OpenCode Plugin Improvement Roadmap

Status: implemented
Created: 2026-06-18

Implementation note: implemented through Flow session
`d675ab0e-d4ba-417c-b678-d54def2a0d96`. Priority 5 remains a deferred
ergonomics/evaluation backlog.

## Purpose

Research `opencode-plugin-flow` against current OpenCode plugin and skill-file
guidance, then define the evidence-backed improvement plan that drove this
implementation.

## Sources Checked

External sources checked with Exa and Ref MCP:

- OpenCode plugin docs: `https://opencode.ai/docs/plugins/`
- OpenCode skill docs: `https://opencode.ai/docs/skills/`
- OpenCode permissions docs: `https://opencode.ai/docs/permissions`
- OpenCode tools docs: `https://opencode.ai/docs/tools`
- OpenCode agents docs: `https://opencode.ai/docs/agents`
- OpenCode commands docs: `https://opencode.ai/docs/commands`
- OpenCode config plugins section: `https://opencode.ai/docs/config#plugins`
- Claude skill-authoring best practices:
  `https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices`
- `pre-commit` staged-content guidance: `https://pre-commit.com/`
- Node.js TypeScript package publishing guidance:
  `https://nodejs.org/en/learn/typescript/publishing-a-ts-package`
- TypeScript package export/type resolution docs:
  `https://www.typescriptlang.org/docs/handbook/modules/reference`
- GitHub/npm package publishing and trusted publishing docs:
  `https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages`
  and `https://docs.npmjs.com/trusted-publishers/`
- Temporal workflow event history/reset docs:
  `https://docs.temporal.io/workflow-execution/event`

Local evidence checked directly and through four read-only Flow evidence slices:

- Adapter/config: `src/adapters/opencode/**`, `src/index.ts`, `src/config.ts`,
  `src/config-shared.ts`, `docs/development.md`, and architecture docs.
- Runtime/persistence: `src/runtime/**` and runtime/workspace tests.
- Distribution/package: `src/distribution/**`, `src/cli.ts`, `package.json`,
  README, CI/release workflows, and distribution tests.
- Skill/docs: `skills/**`, repo-local `flow-contribution-check`, and existing
  planning docs.

Installed package types checked:

- `@opencode-ai/plugin@1.17.3` exposes `Plugin`, `Hooks`, and `tool()` with Zod
  raw-shape schemas through `node_modules/@opencode-ai/plugin/dist/*.d.ts`.
- `@opencode-ai/sdk` exposes command parts as SDK `Part[]`, including text and
  subtask variants.

## Best-Practice Implications

OpenCode plugin guidance implies:

- A plugin should export a function that receives OpenCode context and returns
  hooks, custom tools, providers, auth, or other extension objects.
- Local or npm plugins are loaded at startup, and package dependencies are
  installed/cached by OpenCode/Bun.
- TypeScript plugins should import types from `@opencode-ai/plugin`.
- Custom tools should use the `tool()` helper with Zod schemas and concrete
  descriptions.
- Structured plugin logging should use `client.app.log()` instead of raw
  `console.log`.

OpenCode skill guidance implies:

- Each skill lives at `<skills-root>/<name>/SKILL.md` with exact `SKILL.md`
  casing.
- Frontmatter must include `name` and `description`; names must be lowercase
  hyphenated and match the directory.
- Descriptions are the primary discovery surface and need both purpose and use
  triggers.
- Skill loading is controlled by `permission.skill`; OpenCode permissions default
  permissive unless narrowed.

General skill-authoring guidance implies:

- Keep `SKILL.md` concise; use progressive disclosure through directly linked
  reference files.
- Use third-person, trigger-rich descriptions.
- Keep references easy to navigate and avoid deeply nested dependency chains.
- Add validation loops for fragile or high-stakes workflows.
- Test skills against representative prompts before adding more metadata or
  invocation machinery.

Adjacent tool and package guidance implies:

- Internal OpenCode subagents should not rely on `hidden: true` for capability
  control. OpenCode documents hidden subagents as hidden only from autocomplete;
  permissions decide what they can do.
- OpenCode custom commands can override built-in commands, so command/agent names
  injected by a plugin need an explicit reservation or collision policy.
- Health/doctor-style CLIs should keep human-readable output but provide JSON and
  meaningful exit-code modes for automation.
- Commit-time checks should avoid unstaged working-tree effects when validating a
  commit boundary. `pre-commit` explicitly warns that running hooks on unstaged
  changes can cause false positives and false negatives.
- Published TypeScript packages should generate declaration files and expose them
  through package metadata when the package has an importable API.
- Workflow reset systems preserve event/audit history separately from current
  mutable state; current status should not be reconstructed from stale chat or
  stale completion summaries.

## Recommended Answers To Open Decisions

### Hidden Worker Skill Loading

Recommendation: deny native skill loading for hidden Flow workers by default.

Rationale:

- OpenCode documents `hidden: true` as a UI/autocomplete concern only; hidden
  subagents can still be invoked when permissions allow.
- OpenCode exposes `permission.skill` and allows per-agent overrides.
- Flow public commands already carry bundled public Flow instructions, and hidden
  worker prompts are intended to operate from manager-provided handoffs rather
  than rediscovering broader skill context.

Implementation direction:

- Add `skill: "deny"` or `skill: { "*": "deny" }` to every hidden Flow worker.
- If a future worker genuinely needs a helper skill, add an explicit allowlist for
  that worker instead of inheriting global skill access.

### Flow Command And Agent Name Policy

Recommendation: treat Flow command and internal agent IDs as reserved while the
plugin is enabled.

Rationale:

- OpenCode custom commands are keyed by name and can override built-ins.
- Flow injects public commands and hidden internal workers as part of the plugin
  contract.
- Current `applyFlowConfig` behavior already gives Flow entries precedence for
  same-named `command` and `agent` keys.

Implementation direction:

- Document `flow-*` public commands and `flow-*` internal workers as reserved
  names for this plugin.
- Prefer a warning or doctor finding when a same-name user command/agent existed
  before Flow injection, but do not silently weaken Flow's command safety path.

### Doctor Exit Codes And Automation

Recommendation: keep default `doctor` human-readable and non-breaking, then add
explicit machine modes.

Rationale:

- The current CLI is already used as an advisory support command.
- General CLI guidance favors `--help`, documented exit codes, and JSON output.
- Doctor-style tools commonly expose `--json` and a quiet/strict mode for CI.

Implementation direction:

- Keep `opencode-plugin-flow doctor` as human-readable output with today's exit
  behavior unless a breaking CLI release is planned.
- Add `doctor --json` for stable machine-readable health output.
- Add `doctor --check` or `doctor --strict` for automation, with documented
  nonzero exits for `sync_required`, `action_required`, and sync failures.
- Keep human progress and remediation text on stderr when stdout is used as JSON.

### Commit Preflight Scope

Recommendation: separate commit-boundary validation from whole-worktree gates.

Rationale:

- `pre-commit` runs commit hooks against staged contents and warns that unstaged
  changes can create false positives and false negatives.
- Flow's commit helper promises to preserve unrelated user work and inspect the
  staged boundary precisely.
- This repository still benefits from a broad `bun run check`, but that command
  validates the current worktree, not just the staged index.

Implementation direction:

- Make commit mode explicitly staged-boundary-safe for diff hygiene, secrets, and
  staged content review.
- Run the broad project gate only after requiring a clean worktree, or label it
  as whole-worktree validation whose result can be affected by unrelated
  unstaged changes.
- Keep push mode as the stronger outgoing-range plus clean-worktree gate.

### Package Typings

Recommendation: publish declaration files and expose them in package metadata.

Rationale:

- The README documents an importable plugin entrypoint.
- The package already uses TypeScript source and peer types from
  `@opencode-ai/plugin`.
- Node.js and TypeScript publishing guidance describe `.d.ts` files as the sidecar
  type information for npm packages; TypeScript also resolves `types` conditions
  in package `exports`.

Implementation direction:

- Generate declarations during build or prepack, without committing generated
  output unless maintainers prefer checked-in dist artifacts.
- Add top-level `types` and an `exports["."].types` condition for the plugin
  entrypoint.
- Include declarations in package smoke tests and verify a small TypeScript
  consumer import.

### Reset History Semantics

Recommendation: preserve history as audit history, but make current-state
summaries clearly authoritative after reset.

Rationale:

- Workflow systems such as Temporal store append-only event histories for audit
  and recovery while maintaining current mutable state separately.
- Flow reset currently reopens feature state but leaves history available for
  audit.
- The risk is not preserved history itself; the risk is consumers mistaking an
  old `latestHistoryEntry` for current feature state after reset.

Implementation direction:

- Document history as audit/provenance, not current state.
- Add tests showing that after reset, `features`, `activeFeature`, `status`, and
  `progress` are authoritative for current work.
- If more clarity is needed, add explicit reset metadata or a reset history entry
  rather than deleting previous completion evidence.

## Current Strengths To Preserve

- The package exports a small default plugin entrypoint through `src/index.ts:1`
  and `src/adapters/opencode/plugin.ts:111-120`.
- The adapter registers OpenCode-supported surfaces: `config`, custom `tool`, and
  `command.execute.before` hooks in `src/adapters/opencode/plugin.ts:116-120`.
- Flow exposes a deliberately minimal seven-tool surface in
  `src/adapters/opencode/tools.ts:53-125`, matching the README and maintainer
  contract.
- Flow uses stable `config.instructions` for generated session context through
  `src/config-shared.ts:392-404`, avoiding default reliance on experimental chat
  or compaction hooks.
- Runtime gates enforce the key Flow invariants: approved-plan immutability, one
  active feature, validation evidence, targeted versus broad validation scopes,
  feature review, final review, and safe completed closure in
  `src/runtime/transitions.ts:211-359`.
- Persistence uses strict JSON parsing, duplicate-key rejection, file locks,
  atomic writes, and generated `.flow/.gitignore` defaults in
  `src/runtime/workspace.ts:90-190` and `src/runtime/workspace.ts:245-300`.
- Distribution sync is conservative with user-owned skills: it hashes managed
  files, skips foreign folders, and backs up edited generated files in
  `src/distribution/sync.ts:78-194`.
- The managed skills are concise. Current `SKILL.md` files are 42-124 lines and
  reference files are 34-129 lines, so the progressive-disclosure structure is
  already healthy.
- Helper boundaries are clear: `flow-test` is evidence-only, `flow-commit` is
  user-triggered only, and public Flow commands avoid direct dependency on stale
  native skill discovery.

## Priority 1: OpenCode Contract Hardening

### Explicit Hidden-Worker Skill Permissions

Evidence:

- Hidden Flow workers deny edit/bash/task and Flow state tools, but their
  permissions do not explicitly include `skill`: `src/config-shared.ts:242-331`.
- OpenCode permissions docs list `skill` as a permission key and state defaults
  are permissive unless configured.
- Public command instructions say required public Flow skills must not be native
  loaded in bundled command mode: `src/config-shared.ts:177-181`.

Plan:

- Implement the recommended default-deny `permission.skill` policy for hidden
  workers.
- Keep any future helper-skill access explicit and worker-specific.
- Update tests in `tests/distribution-and-surface.test.ts` to assert the policy.

Validation:

- `bun test tests/distribution-and-surface.test.ts`
- Direct review that worker prompts and permissions agree.

### Schema-Backed Tool Arguments

Evidence:

- `flow_plan_save` and `flow_feature_complete` expose broad `z.any()` payload
  fields in `src/adapters/opencode/tools.ts:61-104`.
- The installed `@opencode-ai/plugin` `tool()` type expects a Zod raw-shape schema
  for tool arguments.
- Runtime schemas already exist for plan, worker result, reset, close, and run
  start input in `src/runtime/schema.ts` and `src/runtime/api.ts`.

Plan:

- Reuse or export runtime input schemas for OpenCode tool argument definitions
  where practical.
- Keep runtime parsing as the final trust boundary, but improve model/tool-time
  validation and generated tool descriptions.
- Avoid adding new runtime fields while tightening adapter schemas.

Validation:

- Typecheck against `@opencode-ai/plugin@1.17.3`.
- Existing runtime gate tests plus distribution/surface tests.

### Instruction Registration Resilience

Evidence:

- `createConfigHook` computes `instructionPath` only after
  `refreshFlowInstructionFile(root)` succeeds: `src/adapters/opencode/config.ts:15-31`.
- `docs/development.md:24-30` says the path is registered even before the file
  exists so sessions created later can be picked up without config reload.

Plan:

- Resolve the workspace root and instruction path before refresh.
- Register the path whenever root resolution succeeds, even if refresh logs a
  best-effort warning.
- Keep invalid workspace-root failures from registering misleading paths.

Validation:

- Add a focused adapter test that simulates refresh failure and still asserts
  instruction path registration.

### Command Part Typing And Subtask Safety

Evidence:

- `replaceFlowCommandParts` casts `output.parts` to local part variants and
  mutates subtask prompt text: `src/adapters/opencode/plugin.ts:74-95`.
- Installed SDK types define `output.parts` as `Part[]`, with subtask parts that
  include `prompt`, `description`, and `agent` fields.

Plan:

- Replace the local partial union with SDK-aligned type guards where possible.
- Add tests for text-part replacement and subtask prompt replacement that reflect
  the installed SDK shape.
- Treat this as compatibility hardening, not a known behavior bug.

Validation:

- `bun run typecheck`
- `bun test tests/distribution-and-surface.test.ts`

### Flow Command And Agent Collision Policy

Evidence:

- `applyFlowConfig` spreads Flow agents and commands after existing config,
  overriding same-named entries: `src/config-shared.ts:392-404`.
- OpenCode supports user-defined commands and agents with arbitrary configured
  names.

Plan:

- Treat Flow command and internal agent IDs as reserved while the plugin is
  enabled.
- Document that policy in README and maintainer contract.
- Add a warning or doctor finding when user config already had the same
  command/agent name before Flow injection.

Validation:

- Distribution/surface tests for whichever policy is chosen.

## Priority 2: Distribution, CLI, And Release Safety

### Mixed Sync Health Semantics

Evidence:

- `createHealth` uses `action_required` when any foreign managed folder exists,
  even if other skills were installed or updated: `src/distribution/sync.ts:206-235`.
- Tests assert the `action_required` case for one foreign skill but do not require
  restart guidance for simultaneously changed skills:
  `tests/distribution-and-surface.test.ts:694-717`.

Plan:

- Preserve `action_required` when user-owned folders need a decision.
- Also surface changed skills and restart need when mixed results occur.
- Make `flow_status.setup.skills` and command preflight communicate both facts.

Validation:

- Add a test with one foreign managed folder and at least one installed/updated
  managed folder.

### Non-Clobbering Skill Backups

Evidence:

- Edited managed skill backups use a fixed `${path}.backup` suffix:
  `src/distribution/sync.ts:165-167`.

Plan:

- Use a timestamped or content-addressed backup suffix.
- Include the backup path in sync/doctor output when a backup is created.

Validation:

- Add a test that repeated syncs do not overwrite the first backup.

### CLI Automation Contract

Evidence:

- CLI accepts only `doctor`, `sync`, and `uninstall`, and emits human-only output:
  `src/cli.ts:9-59`.
- `doctor` exits successfully even when status is `sync_required` in
  `tests/distribution-and-surface.test.ts:856-866`.

Plan:

- Add `doctor --json` while preserving the existing human-readable default.
- Add an explicit health-gate mode, such as `doctor --check` or
  `doctor --strict`, that exits nonzero for `sync_required` or
  `action_required`.
- Add `--version` and richer `--help` if they fit naturally with the CLI parser
  changes.
- Evaluate `sync --json` separately if automation needs structured sync results.
- Consider a `--home` or `--skills-root` test/support override if it helps local
  debugging without changing normal OpenCode behavior.

Validation:

- CLI tests for JSON output, exit-code mode, and existing human output.

### Package And Release Smoke Gates

Evidence:

- Release checks tag, package version, changelog, `bun run check`, tarball
  creation, npm publish, and GitHub release assets:
  `.github/workflows/release.yml:31-96`.
- README hard-pins versioned install, sync, doctor, and uninstall snippets:
  `README.md:23-26`, `README.md:49-63`, `README.md:84-103`, and
  `README.md:203-205`.
- Tests exercise source CLI through `process.execPath run ./src/cli.ts`, not the
  packed `dist/cli.js`: `tests/distribution-and-surface.test.ts:115-121`.

Plan:

- Add README version-pin validation to release checks.
- Add a pack/install smoke that verifies package contents, `dist/cli.js` shebang,
  and `opencode-plugin-flow doctor|sync|uninstall` from the packed bin.
- Add declaration output plus package `types` metadata for the documented
  importable plugin entrypoint.
- Consider npm provenance with `id-token: write`, `npm publish --provenance`, and
  publish dry-run before release.

Validation:

- New package-smoke script or test.
- Release workflow review plus `bun run check`.

## Priority 3: Runtime Semantics And Persistence Edges

### Reset History Semantics

Evidence:

- Reset reopens affected features and clears closure/completedAt, but leaves
  history intact: `src/runtime/transitions.ts:474-513`.
- Session summary still exposes `latestHistoryEntry` and `historyCount`:
  `src/runtime/transitions.ts:562-600`.

Plan:

- Preserve history after reset as audit/provenance data.
- Document that current status comes from `features`, `activeFeature`, `status`,
  and `progress`, not prior completion entries.
- Add tests for `flow_status` after reset; if ambiguity remains, add explicit
  reset metadata or a reset history entry rather than deleting old evidence.

Validation:

- Focused runtime test for reset followed by `flow_status`.

### Deferred And Abandoned Closure States

Evidence:

- Deferred/abandoned close preserves the previous session status while clearing
  `activeFeatureId`: `src/runtime/transitions.ts:516-558`.
- Tests cover planning-state deferred/abandoned archive but not running or
  blocked close semantics: `tests/workspace-persistence.test.ts:137-166`.

Plan:

- Decide intended archived state for running and blocked sessions closed as
  deferred or abandoned.
- Add tests for those states before changing behavior.

Validation:

- `bun test tests/workspace-persistence.test.ts tests/runtime-gates.test.ts`

### Workspace Root And Persistence Failure Tests

Evidence:

- API mutation paths acquire a lock before `loadSession` and `saveSession` assert
  mutable workspace roots: `src/runtime/api.ts:59-67` and
  `src/runtime/workspace.ts:124-190`.
- Atomic writes are per file, not transactional across session, instruction
  projection, `.flow/.gitignore`, archive write, and session removal:
  `src/runtime/workspace.ts:245-272`.

Plan:

- Normalize/assert the mutable workspace root before lock acquisition or prove the
  adapter always does so.
- Add tests for lock contention, stale lock timeout, malformed JSON beyond
  duplicate keys, archive failure ordering, and projection write failures.

Validation:

- Focused workspace-persistence tests.

### Optional Schema Tightening

Evidence:

- Artifact paths and timestamps are currently non-empty strings:
  `src/runtime/schema.ts:53-57` and `src/runtime/schema.ts:166-211`.
- `isAbsoluteOrTraversal` exists but is not applied to artifact paths:
  `src/runtime/workspace.ts:302-304`.

Plan:

- Keep artifacts informational for now and avoid speculative schema churn.
- If a tool starts consuming artifact paths, reject absolute/traversal paths and
  validate datetime strings in the same change.

Validation:

- Schema tests only if behavior changes.

## Priority 4: Skill And Documentation Alignment

### Retire Or Refresh Stale Planning Docs

Evidence:

- `docs/plan/flow-skill-improvements.md` still describes an older baseline where
  `flow-test` and `flow-commit` do not exist, while current managed skills include
  both.
- `docs/plan/flow-skill-best-practices-review.md` still describes some metadata
  improvements as future work even though current descriptions appear updated.

Plan:

- Mark historical plans as implemented/superseded, or update their baseline
  language.
- Keep this roadmap as the current improvement index.

Validation:

- Docs review for no contradictory baseline claims.

### Tighten `flow-test` And UI Cross-Loading Wording

Evidence:

- `flow-test` is conditionally loaded for browser/UI and validation-heavy work in
  `skills/flow/SKILL.md:17`, `skills/flow-run/SKILL.md:35-38`, and
  `skills/flow-review/SKILL.md:20-22`.
- The trigger matrix distinguishes browser validation evidence from visual/design
  judgment in `docs/plan/flow-skill-trigger-matrix.md:32-47`.

Plan:

- Make `flow-test` load for validation strategy, browser QA, failure triage, and
  evidence summaries.
- Keep `flow-ui-quality` responsible for visual judgment, accessibility/design
  review, and screenshot assessment.

Validation:

- Skill diff review and prompt-trigger matrix review.

### Fix Cross-Reference Navigation

Evidence:

- `flow-review` references `flow-run/references/audit-rubric.md` without the
  sibling-relative `../` prefix used by other cross-skill references:
  `skills/flow-review/SKILL.md:62-67`.

Plan:

- Change the reference to `../flow-run/references/audit-rubric.md` or clarify it
  as a conceptual pointer if direct navigation is not expected.

Validation:

- Manual skill-file review.

### Align Contribution Preflight Semantics

Evidence:

- `flow-contribution-check` says commit mode validates staged/outgoing work in
  `.agents/skills/flow-contribution-check/SKILL.md:10-24`.
- The script also runs `git diff --check` and `bun run check` against the current
  working tree in commit mode: `.agents/skills/flow-contribution-check/scripts/preflight.sh:115-127`.
- `flow-commit` delegates to this preflight when present:
  `skills/flow-commit/SKILL.md:73-83`.

Plan:

- Make commit mode staged-boundary-safe for diff hygiene, secret screening, and
  staged content review.
- Split whole-worktree validation into a clean-worktree gate or label it clearly
  as whole-worktree evidence.
- Align script output, skill wording, validation matrix, and `flow-commit` around
  that contract.

Validation:

- Script tests or manual staged/unstaged smoke checks.

### Clarify Setup-Health Context

Evidence:

- Managed `flow` skill says to report `setup.skills` and stop loading Flow skills
  in the current startup: `skills/flow/SKILL.md:28-38`.
- Public command preflight says bundled public commands report setup state and
  continue with bundled instructions: `src/config-shared.ts:177-181` and
  `docs/maintainer-contract.md:91-104`.

Plan:

- Clarify that native skill loading should stop when setup is stale, while public
  command bundles may continue because they already carry their required public
  Flow instructions.

Validation:

- Skill/docs wording review plus existing command preflight tests.

## Priority 5: Optional Ergonomics And Evaluation

Defer until higher-priority contract and safety work is done:

- Automated skill frontmatter validation as a repo script.
- Prompt-trigger evaluation for managed skills using the trigger matrix.
- Optional `agents/openai.yaml` or equivalent metadata only if real trigger or UI
  display gaps remain.
- Machine-readable docs index for current Flow public surfaces.
- Additional external-doc watchpoints for OpenCode plugin hook changes.

## Suggested Future Flow Feature Split

1. `harden-opencode-contracts`
   - Targets: `src/config-shared.ts`, `src/adapters/opencode/**`, tool schemas,
     distribution/surface tests, README/maintainer contract collision wording.
   - Validation: focused distribution/surface tests and typecheck.
2. `harden-skill-sync-and-cli`
   - Targets: `src/distribution/sync.ts`, `src/cli.ts`, CLI docs/tests.
   - Validation: sync/doctor/uninstall tests, mixed-health test, backup test.
3. `add-package-release-smoke`
   - Targets: release workflow, package smoke script/test, README version guard.
   - Validation: package smoke plus `bun run check`.
4. `settle-runtime-edge-semantics`
   - Targets: runtime transition/workspace tests first, then minimal code changes
     only where tests clarify desired behavior.
   - Validation: runtime/workspace focused tests.
5. `align-skills-and-planning-docs`
   - Targets: `skills/**`, `.agents/skills/flow-contribution-check/**`,
     `docs/plan/**`.
   - Validation: skill frontmatter/static review and distribution/surface test.

## Non-Goals

- Do not expand the seven-tool runtime surface without concrete user need.
- Do not restore v3 compatibility aliases or session migrations.
- Do not move planning, validation, review, cleanup, UI, or commit judgment into
  runtime projections.
- Do not add public `/flow-test` or `/flow-commit` commands unless direct command
  usage evidence shows skill loading is not enough.
- Do not overwrite user-owned skills or local Flow session state silently.

## Implemented And Deferred Choices

- Hidden worker skill permissions use flat `skill: "deny"`, matching the existing
  permission shape used by the generated config tests.
- Collision handling documents Flow command and internal worker IDs as reserved;
  a doctor warning remains deferred until user-config collision evidence appears.
- CLI automation supports both `doctor --json` and `doctor --check`/`--strict`.
  `sync_required` and `action_required` share exit code `1` in check modes.
- Commit preflight is staged-boundary-only in `commit` mode. Whole-worktree
  `bun run check` moved to clean-worktree push mode or explicit separate
  validation evidence.
- Declaration output is emitted by `tsc -p tsconfig.types.json` during `build`,
  with package smoke covering tarball contents, packed CLI behavior, and a
  package-name TypeScript consumer import.
- Reset-history representation is documentation and tests only for now: history
  remains audit/provenance data, while current status comes from the active
  session summary fields.
