---
name: core-worker
description: General-purpose implementation worker for TypeScript/Bun features in the flow mission. Supports implementation, test-only/coverage, validation-only, and release/integration tracks.
---

# Core Worker

Startup and cleanup are handled by `worker-base`. This skill defines the required worker procedure for one feature.

## Required Orientation (must be visible in transcript)

Read these once per session before feature work:

- `mission.md`
- `AGENTS.md`
- `.factory/library/architecture.md`
- `.factory/library/environment.md`
- `.factory/library/user-testing.md`

Then read your feature entry in `features.json` (`description`, `preconditions`, `expectedBehavior`, `verificationSteps`, `fulfills`) and each referenced assertion in `validation-contract.md`.

If a precondition is missing, return to orchestrator immediately.

## Workstream Classification (choose exactly one)

Classify the feature before editing and state the classification in your handoff summary.

1. **Implementation** — behavior/code changes that require new or updated tests plus implementation edits.
2. **Test-only / coverage / tooling** — tests or tooling config are the deliverable; no behavior-changing implementation edits.
3. **Validation-only** — evidence collection / contract verification with no implementation changes.
4. **Release / integration** — packaging, install/uninstall, release docs/scripts, or cross-environment integration proof.

## Procedure

### 1) Investigate

- Inspect only files needed for this feature.
- For refactors, enumerate call sites first.
- Confirm mission boundaries (no writes outside permitted test/worktree paths).

### 2) Execute by workstream

#### A. Implementation

- Write failing tests first for observable behaviors.
- Confirm red for the right reason.
- Implement minimal code to pass.
- Re-run targeted tests; then required verification matrix.

#### B. Test-only / coverage / tooling

- Author/adjust tests or config directly.
- No red/green requirement when tests/config are the deliverable, but evidence must show assertions in `fulfills` are exercised.
- Run required verification matrix for this workstream.

#### C. Validation-only

- Do not modify source/behavior code.
- Run only the validation commands required by assigned assertions.
- Record command evidence with outcomes and blockers.

#### D. Release / integration

- Make only release/integration scoped edits.
- Prefer deterministic smoke checks with temp HOME/worktree overrides.
- Record install/package/integration evidence explicitly.

### 3) Verification evidence rules (all workstreams)

Every handoff must include `verification.commandsRun[]` entries with:

- `command`
- `exitCode`
- one-sentence `observation`

Exit code alone is insufficient.

#### Baseline command policy

- Prefer `bun run check` as the default aggregate proof when available.
- Expand to sub-checks when needed for scoped evidence, failure triage, or assertion-specific requirements.

Required verification matrix by workstream:

- **Implementation** — targeted red/green evidence for changed behavior, then `bun run check` unless the feature contract explicitly narrows or replaces part of the matrix.
- **Test-only / coverage / tooling** — the specific test/config proof required by `fulfills`, plus `bun run check` when the changed files participate in the normal repo validation surface.
- **Validation-only** — only the assertion-required commands and inspections; do not fabricate implementation-oriented checks.
- **Release / integration** — `bun run build`, the relevant install/package/smoke proof, and `bun run check` unless the assertion defines a narrower release-only evidence set.

Allowed expanded sub-checks:

- `bun run typecheck`
- `bun test` (or targeted `bun test <file>`)
- `bun run lint`
- `bun run deadcode`
- `bun run build`
- `bun run bench` (only when required by the assertion/feature)
- `bun run format_check` (preferred formatter-only check)

#### Safety-gated / portability commands

If a direct command is blocked by worker safety policy or platform variance:

1. Use the canonical safe alias from `.factory/services.yaml` first.
2. If you must bypass the alias mechanism, use the equivalent approved formatter fallback directly:
   `node_modules/.bin/biome check <repo-root> --formatter-enabled=true --linter-enabled=false --enforce-assist=false --files-ignore-unknown=true --vcs-use-ignore-file=true`
3. Record the blocker and fallback in evidence; do not claim skipped commands as passed.

### 4) Assertion coverage check

Re-read each `fulfills` assertion and confirm evidence satisfies it literally. If not, list the gap in `whatWasLeftUndone`.

### 5) Commit and handoff hygiene

- Keep implementation + tests together when code changed.
- No orphaned watch/bench processes.
- Never claim `followedProcedure: true` unless transcript evidence matches this procedure.

## Return to orchestrator when

- Preconditions are unmet.
- Requirements conflict across mission docs.
- Needed command cannot be executed and no approved fallback exists.
- A blocker is outside feature scope (dependency/policy/external system).
