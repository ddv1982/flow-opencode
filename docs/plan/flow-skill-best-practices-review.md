# Flow skill best-practices review plan

Status: implemented / superseded
Created: 2026-06-17

Implementation note: this historical review drove the current trigger matrix,
helper-skill wording, and commit/preflight boundary cleanup. Remaining optional
UI metadata ideas are deferred under the current improvement roadmap.

## Purpose

Review the current Flow managed-skill changes against current Codex skill
guidance and define a no-code implementation plan for any worthwhile
improvements.

This plan intentionally does not modify skill, source, test, or runtime files.

## Sources checked

Current external sources:

- OpenAI Codex Agent Skills docs:
  `https://developers.openai.com/codex/skills`
- OpenAI Codex Best Practices docs:
  `https://developers.openai.com/codex/learn/best-practices`
- OpenAI Codex reusable skills use case:
  `https://developers.openai.com/codex/use-cases/reusable-codex-skills`
- Open Agent Skills specification:
  `https://agentskills.io/specification`

Tools used:

- Fresh Codex manual fetch through `openai-docs`.
- Ref MCP search/read for OpenAI Codex skill docs.
- Exa MCP search/fetch for OpenAI Codex skill docs and the linked open skill
  specification.
- Four read-only subagent review slices: external-doc verification,
  frontmatter/trigger review, body/progressive-disclosure review, and Flow
  boundary/safety review.

Local verification:

- `git status --short` confirmed the review worked on the existing uncommitted
  implementation plus existing `docs/plan/` artifacts.
- A read-only Node frontmatter check confirmed all nine reviewed skills have
  present `name` and `description`, folder-matching lowercase hyphenated names,
  and descriptions under the formal length limit.
- `skill-creator/scripts/quick_validate.py` could not run in this environment
  because available Python runtimes do not include `yaml`; treat that as a local
  tooling gap, not a skill-format failure.

## Current assessment

The implementation is structurally sound:

- `flow-test` and `flow-commit` are valid managed helper skills.
- Existing frontmatter uses only `name` and `description`.
- Helper skill bodies are short enough to keep in `SKILL.md` for now:
  `flow-test` is 124 lines and `flow-commit` is 109 lines.
- `flow-test` stays evidence-only and does not mutate Flow state.
- `flow-commit` is user-triggered and does not add an autonomous commit path.
- No `/flow-test` or `/flow-commit` public command surface was found.
- Fallback-rubric copying appears avoided.

The review found improvement opportunities, not blockers.

## Best-practice implications

The current docs and skill-creator guidance imply these design rules:

- Skill descriptions are the primary implicit trigger surface; put the most
  important use case and trigger words early.
- Descriptions should carry scope and boundaries because long skill lists may
  shorten descriptions.
- Each skill should stay focused on one job with clear inputs and outputs.
- Progressive disclosure matters: do not load helper skills or references when
  the immediate task does not need them.
- Scripts, references, assets, and optional `agents/openai.yaml` should be added
  only when they improve reliability, discovery, invocation policy, or context
  efficiency.

## Recommended direction

Do a small follow-up improvement pass before considering the skill layer done.

Keep:

- `flow-test` as an instruction-only validation-evidence helper.
- `flow-commit` as an instruction-only commit-preparation helper.
- `flow-plan`, `flow-run`, and `flow-review` metadata mostly unchanged.
- No public `/flow-test` or `/flow-commit` commands.

Improve:

- Metadata trigger resilience for `flow-test`, `flow`, `flow-deslop`, and
  `flow-ui-quality`.
- Overlap between `flow-commit` and repo-local `flow-contribution-check`.
- `flow-test` cross-loading policy so it does not defeat progressive
  disclosure.
- `flow-commit` portability and sequencing.
- `.flow/**` archive wording consistency.

Defer:

- Splitting `flow-test` or `flow-commit` into reference files unless future
  edits make them materially longer or duplicate detailed rubrics.
- Adding `agents/openai.yaml` until prompt-trigger tests show a real need for
  explicit invocation policy or UI metadata.

## Phase 1: Prompt-trigger matrix

Before editing descriptions, create a small trigger matrix and review expected
skill selection.

Candidate prompts:

- `run tests for this change`
- `validate this feature`
- `make a test plan`
- `triage this failing check`
- `commit these changes`
- `write a commit message`
- `run preflight before commit`
- `prepare this branch for push`
- `run Flow end to end`
- `plan this Flow task`
- `run the next Flow feature`
- `review this Flow feature`
- `clean up this messy code`
- `review this UI`
- `validate the browser flow`

Expected output:

- A table mapping each prompt to the intended primary skill and acceptable
  helper skills.
- A short list of ambiguous prompts.
- A decision on whether ambiguity is acceptable or should be fixed in metadata.

Acceptance criteria:

- `flow-test` wins validation/test/failure-triage prompts.
- `flow-commit` wins staging/message/commit orchestration prompts.
- `flow-contribution-check` wins contribution-readiness preflight prompts.
- `flow` wins end-to-end Flow loop prompts, not narrow plan/run/review prompts.
- `flow-ui-quality` wins visual/design quality prompts, while `flow-test` is
  only pulled for validation strategy or evidence.

## Phase 2: Frontmatter description tuning

Edit only descriptions that the trigger matrix shows need improvement.

Likely edits:

- `flow-test`: front-load plain user phrases such as test, validate, test plan,
  failure triage, browser QA, and validation evidence before Flow-internal
  `validationRun` wording.
- `flow`: sharpen as the end-to-end or multi-stage Flow loop so it is less
  likely to compete with narrow `flow-plan`, `flow-run`, or `flow-review`.
- `flow-deslop`: start with cleanup/refactor/code-smell removal rather than
  low-signal `Flow guidance for`.
- `flow-ui-quality`: start with review/improve frontend UI quality rather than
  low-signal `Flow guidance for`.
- `.agents/skills/flow-contribution-check`: distinguish contribution-readiness
  validation from `flow-commit` staging/message/commit orchestration.
- `flow-commit`: keep current safety boundary; optionally add `commit message`
  if the trigger matrix shows weak message-only matching.

Acceptance criteria:

- All descriptions remain under the formal limits.
- The first clause carries the most important trigger.
- Boundaries remain explicit for commit and contribution-check behavior.
- The managed skill list is still easy to scan.

## Phase 3: Cross-load and progressive-disclosure cleanup

Resolve the current tension between conditional and unconditional `flow-test`
loading.

Decision to make:

- Option A: `flow-test` is loaded for every `flow-run` validation pass.
- Option B: `flow-test` is loaded only when validation is complex,
  regression-sensitive, browser/UI-related, failure-prone, or unclear.

Recommended default: Option B, unless prompt-trigger tests or real usage show
agents miss validation quality without unconditional loading.

Likely edits:

- Make `flow`, `flow-run`, `flow-plan`, `flow-review`, and
  `flow-ui-quality` use the same loading policy.
- Keep `flow-ui-quality` responsible for visual/design judgment.
- Use `flow-test` for route QA, browser validation strategy, failure
  classification, exploratory QA, and `validationRun` evidence.
- Preserve `skills/flow-run/references/validation-rubric.md` as the core
  completion rubric unless a later refactor moves it under `flow-test`.

Acceptance criteria:

- UI work no longer implies loading both `flow-ui-quality` and `flow-test`
  unless validation evidence is needed.
- Validation evidence remains strong enough for Flow completion.
- The docs still make missing helper skills a coverage gap, not a fallback
  invitation.

## Phase 4: Commit portability and sequencing

Clarify whether `flow-commit` is a general managed helper for any repository or
a Flow-plugin maintainer helper. Because it is synced as a managed skill, treat
it as general by default.

Likely edits:

- Replace repo-specific broad-gate wording with generic guidance:
  use the repository's documented broad gate from package scripts, AGENTS/docs,
  or CI conventions.
- Mention `bun run check` only as the gate for this repository, preferably in
  repo-local contribution guidance rather than the globally synced helper.
- Keep `.agents/skills/flow-contribution-check/scripts/preflight.sh commit` as
  a conditional repo-local preflight when present.
- Tighten `flow-run` wording so commit preparation defaults to after
  `flow_feature_complete` has been recorded, unless the user explicitly asks for
  a WIP commit path.

Acceptance criteria:

- `flow-commit` remains safe and useful outside this repo.
- It does not stage, commit, push, amend, rebase, publish, or mutate releases
  without explicit authorization.
- It does not replace Flow completion, validation, or review evidence.
- It still defers to repo-local contribution preflight when present.

## Phase 5: `.flow/**` archive wording alignment

Align public docs and helper skill wording around Flow runtime state.

Likely edits:

- Keep `.flow/**` local and ignored by default.
- Say archive/versioning is opt-in and should require explicit maintainer intent
  for exact artifacts.
- Avoid casual `git add -f` language without a warning about exact artifact
  selection.

Acceptance criteria:

- README, maintainer contract, `flow-commit`, and
  `flow-contribution-check` carry the same safety model.
- No wording encourages accidental `.flow/**` staging.

## Phase 6: Optional UI metadata decision

Decide whether managed Flow skills should ship `agents/openai.yaml`.

Default: defer.

Reasons to add later:

- Need clearer Codex app display names or short descriptions.
- Need to set `allow_implicit_invocation: false` for a helper.
- Need to declare tool dependencies for a skill.

Reasons to defer now:

- Current skills are instruction-only.
- Trigger behavior should first be improved through descriptions.
- Adding metadata would require distribution registration and tests for extra
  managed skill files.

## Validation plan for a future implementation

Static checks:

- Run the fallback frontmatter check or make `quick_validate.py` runnable in the
  local environment.
- Confirm names still match folders and descriptions are non-empty.
- Confirm no new runtime tools, session fields, or public commands are added.
- Confirm no `flow-test` or `flow-commit` entry appears in `src/config-shared.ts`.

Focused tests:

```bash
bun test tests/distribution-and-surface.test.ts
```

Full gate:

```bash
bun run check
```

Manual review:

- Re-run the prompt-trigger matrix.
- Review diffs for helper-skill overloading.
- Re-check `.flow/**` and commit safety wording.

## Priority order

1. Trigger matrix and metadata tuning.
2. Resolve `flow-test` loading policy.
3. Make `flow-commit` portable and tighten sequencing.
4. Align `.flow/**` archival language.
5. Consider optional `agents/openai.yaml` only if real trigger/UI gaps remain.

## Resolved decisions

- `flow-test` targets general validation, test-plan, failure-triage, browser QA,
  and Flow validation-evidence prompts.
- `flow-test` is loaded for complex, regression-sensitive, browser QA,
  failure-prone, unclear, or evidence-summary work, not every trivial validation
  pass by default.
- `flow-commit` remains a general managed helper with repo-local preflight
  delegation when present.
- Commit preparation defaults to after `flow_feature_complete`; only explicit WIP
  commit requests should happen earlier.
- README keeps concise `.flow/**` guidance while maintainer docs carry the fuller
  safety contract.
