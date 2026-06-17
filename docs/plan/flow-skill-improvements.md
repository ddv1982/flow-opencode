# Flow skill improvement plan

Status: implemented / superseded
Created: 2026-06-16

Implementation note: this historical plan was implemented by the Flow v4.1 skill
layer. The current managed skill set includes `flow-test` and `flow-commit`, and
the current improvement index is `docs/plan/opencode-plugin-improvement-roadmap.md`.

## Purpose

Improve Flow's skill layer based on the repository research by adding first-class
testing guidance and safer commit preparation guidance, while preserving the v4
architecture: skills own judgment, runtime owns only the minimal state ledger and
hard gates.

This is a plan only. It intentionally does not make code, skill, test, or runtime
changes.

## Evidence basis

The plan is based on the attached research plus a read-only verification pass
over the repository.

Historical baseline at planning time:

- Current managed skills are `flow`, `flow-plan`, `flow-run`, `flow-review`,
  `flow-deslop`, and `flow-ui-quality` (`docs/maintainer-contract.md`,
  `README.md`, `src/distribution/flow-skill-definitions.ts`).
- Current public commands are `flow-auto`, `flow-plan`, `flow-run`,
  `flow-review`, and `flow-status` (`src/config-shared.ts`,
  `tests/distribution-and-surface.test.ts`).
- Validation guidance currently lives in `flow-run` and
  `skills/flow-run/references/validation-rubric.md`; there is no
  `skills/flow-test` directory.
- UI visual validation guidance exists in `flow-ui-quality`, but browser-driving
  mechanics are not first-class testing guidance.
- `.agents/skills/flow-contribution-check` is repo-local contribution preflight,
  not a managed Flow skill.
- The canonical repository gate is `bun run check`.

Confidence notes:

- The need for `flow-test` is high confidence: it is backed by existing local
  validation docs and the absence of a first-class testing skill.
- The need to keep `flow-commit` outside runtime state is high confidence: it is
  backed by the maintainer contract, ADR, README, and contribution preflight.
- Exact Playwright MCP wording should be verified against current official docs
  before implementation if the final skill includes setup snippets.

## Recommended direction

Add `flow-test` and `flow-commit` as managed helper skills, but do not add new
public `/flow-test` or `/flow-commit` commands in the first implementation pass.

Rationale:

- `flow-test` should be available to existing Flow skills during planning,
  execution, review, and UI verification without expanding runtime state.
- `flow-commit` is useful as bundled judgment, but it must remain explicitly
  user-triggered and must never become part of the autonomous Flow loop.
- Avoiding new commands keeps the public command surface stable while still
  allowing the managed skill set to improve.

Deferred option:

- Add `/flow-test` and `/flow-commit` later only if users need direct command
  entry points. That would require `src/config-shared.ts`, README command docs,
  and command-surface tests to change.

## Non-goals

- Do not add runtime tools or session fields.
- Do not move validation, commit, or review heuristics into `src/**`.
- Do not make commits part of `flow_feature_complete`.
- Do not auto-commit, push, amend, rebase, publish, or mutate releases.
- Do not commit `.flow/**` state unless a maintainer explicitly asks.
- Do not rewrite existing skills beyond small cross-loading and guardrail edits.

## Phase 1: Add `flow-test`

Create `skills/flow-test/SKILL.md`.

Responsibilities:

- Plan validation from changed-surface risk.
- Select targeted, integration, browser/e2e, package/build, docs, cleanup, and
  broad project gates.
- Run or recommend concrete checks with exact command/status/summary evidence.
- Classify failures before editing: product failure, test failure, environment
  failure, pre-existing failure, flake, or unrelated failure.
- Require a short failure hypothesis before fix attempts.
- Define browser-based validation guidance and make missing browser evidence an
  explicit gap.
- Cover exploratory QA and regression-after-fix workflow.
- Return a `validationRun` array and human-readable test summary that the
  manager can record through `flow_feature_complete`.

Boundaries:

- `flow-test` must not mutate Flow state.
- It must not approve plans, complete features, close sessions, or substitute
  for review.
- It should defer final recording of evidence to the manager.

Acceptance criteria:

- Frontmatter uses `name: flow-test`.
- The skill states that it produces validation evidence only.
- The skill preserves the existing `validationRun` shape.
- Browser claims are phrased as evidence requirements, not guaranteed coverage.

## Phase 2: Add `flow-commit`

Create `skills/flow-commit/SKILL.md`.

Responsibilities:

- Inspect `git status --short`, unstaged diff, staged diff, and untracked files.
- Choose commit boundaries by intent.
- Stage explicit paths only; avoid `git add .` and `git add -A` as defaults.
- Screen staged changes for secrets, local config, `.env`, generated artifacts,
  and `.flow/**` state.
- Run appropriate validation, preferring `bun run check` for this repository.
- Defer to `.agents/skills/flow-contribution-check` when present instead of
  duplicating its preflight.
- Propose a commit message with context, changes, validation, and risk.
- Create a commit only when the user explicitly asks.

Boundaries:

- `flow-commit` must not be loaded automatically by `flow`.
- A commit never substitutes for `flow_feature_complete`.
- It must stop before secrets, unrelated files, failing validation, push,
  amend, rebase, squash, reset, force-push, release, or publish unless the user
  explicitly authorizes the specific operation.

Acceptance criteria:

- Frontmatter uses `name: flow-commit`.
- The skill states it is user-triggered only.
- The skill explicitly preserves unrelated user work.
- The skill references repo-local contribution preflight as validation, not as
  commit-boundary or message-authoring logic.

## Phase 3: Cross-load from existing skills

Apply minimal edits only.

Recommended edits:

- `skills/flow/SKILL.md`
  - Add a `flow-test` pointer around validation-heavy work.
  - Add a commit guardrail: do not commit/push/amend/rebase/publish during
    autonomous Flow; load `flow-commit` only when the user asks.
- `skills/flow-plan/SKILL.md`
  - Load `flow-test` for complex validation, regression-sensitive changes, or
    browser/UI workflows.
  - Require feature validation entries to name the expected test level.
- `skills/flow-run/SKILL.md`
  - Load `flow-test` at the start of `## Validate`.
  - Add worktree hygiene around commit-related actions.
  - Clarify the existing review fallback wording so it does not imply copying a
    missing helper rubric.
- `skills/flow-review/SKILL.md`
  - Load `flow-test` for validation-heavy reviews and treat missing evidence as
    a gap or blocker based on impact.
- `skills/flow-ui-quality/SKILL.md`
  - Point browser-driven QA to `flow-test`, while keeping visual judgment in
    `flow-ui-quality`.

Optional docs-only clarification:

- `.agents/skills/flow-contribution-check/SKILL.md`
  - Add one sentence that the preflight validates staged/outgoing work but does
    not choose commit boundaries or write commit messages.

## Phase 4: Register managed skills

Required if `flow-test` and `flow-commit` become managed skills:

- `src/distribution/flow-skill-definitions.ts`
  - Import both new skill docs.
  - Add both entries to `FLOW_SKILL_DEFINITIONS`.
  - Add reference-file imports only if the new skills are split into
    `references/**`.
- `docs/maintainer-contract.md`
  - Change the managed set from six to eight skills.
  - Clarify that optional helper skills are coverage gaps when unavailable.
- `README.md`
  - Add both managed skill install paths.
  - Update the synced managed skill list.
  - Mention that `flow-commit` is user-triggered and outside the autonomous
    runtime loop.
- `tests/distribution-and-surface.test.ts`
  - Let existing `FLOW_MANAGED_SKILL_NAMES` derived tests expand.
  - Add explicit doctor/sync assertions for `flow-test` and `flow-commit` if the
    current smoke test would otherwise only assert `flow-review`.

Not required in the recommended first pass:

- `src/config-shared.ts`, unless direct `/flow-test` or `/flow-commit` commands
  are added.

Optional public command expansion:

- Add `flow-test` and `flow-commit` to `FLOW_CORE_COMMANDS`.
- Update `FLOW_COMMAND_NAMES` and expected skill-load mappings.
- Use the existing `flow_status` setup preflight for any command that loads a
  managed skill.
- Update README and maintainer-contract command tables.

## Phase 5: Validate

Static checks:

- Confirm both new skill directories exist and names match their frontmatter.
- Confirm descriptions are trigger-rich and within the expected length.
- Confirm no new runtime tool or schema was added.
- Confirm `flow-commit` does not appear in autonomous loop instructions except
  as an explicit guardrail.
- Confirm `.flow/**` remains local and ignored by default.

Repository checks:

```bash
bun run check
```

Distribution checks:

- Run the sync/doctor paths through the existing test suite.
- Confirm generated markers include the new managed skill files.
- Confirm foreign or edited managed folders are still preserved.
- Confirm uninstall removes pristine managed `flow-test` and `flow-commit`
  folders while preserving foreign Flow-like folders.

Behavioral smoke checks:

- Trigger `flow-test` on a small scoped change and confirm it returns
  `validationRun` evidence plus a test summary without calling state-changing
  Flow tools.
- Trigger `flow-commit` with a dirty tree containing an unrelated file and a
  suspicious local config file; confirm it excludes unrelated work, refuses
  suspicious data, and proposes a message unless commit creation was explicitly
  requested.
- Run `.agents/skills/flow-contribution-check/scripts/preflight.sh commit`
  before any actual commit.

## Suggested Flow feature split

If this plan is implemented through Flow, use this dependency order:

1. `add-flow-test-skill`
   - Targets: `skills/flow-test/SKILL.md`.
   - Validation: frontmatter check, content review, no state mutation claims.
2. `add-flow-commit-skill`
   - Targets: `skills/flow-commit/SKILL.md`.
   - Validation: frontmatter check, guardrail review, preflight delegation
     review.
3. `cross-load-new-skills`
   - Targets: existing `skills/flow*/SKILL.md` files listed above.
   - Validation: diff review for minimal wording, no duplicated rubrics.
4. `register-managed-skills`
   - Targets: distribution definitions, README, maintainer contract, and tests.
   - Validation: `bun test tests/distribution-and-surface.test.ts`.
5. `final-validation`
   - Targets: no new source scope unless failures require fixes.
   - Validation: `bun run check`, doctor/sync smoke evidence, final review.

## Resolved decisions

- Both `flow-test` and `flow-commit` are now managed skills.
- Direct `/flow-test` and `/flow-commit` commands remain deferred.
- `flow-test` keeps browser guidance generic instead of committing exact
  Playwright setup snippets.
- Contribution-check staged-boundary wording is handled by the current roadmap
  implementation.
