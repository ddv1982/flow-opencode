---
name: flow-contribution-check
description: Validate Flow plugin contribution readiness before committing, pushing, release branching, or making any GitHub-visible repository change. Runs repo-local preflight for staged/outgoing work; does not choose commit boundaries, stage files, or write commit messages.
---

# Flow contribution check

Run the repository-local preflight before every commit and before pushing. Commit
mode validates the staged boundary; push mode adds the broader Flow plugin checks
for architecture seams, package/version hygiene, and path-sensitive focused
validation.

This preflight validates staged or outgoing work; it does not choose commit
boundaries, stage files, or write commit messages.

This is a repo-local contributor skill, not a managed Flow runtime skill.
Preflight output is commit/push readiness evidence only: it does not become
Flow `validationRun`, `featureReview`, or `finalReview` evidence, and it never
reads or mutates `.flow/**` session state.

## Before committing

1. Review `git status --short` and inspect the intended working-tree diff.
2. Stage only intended files.
3. Review `git diff --cached --stat` and `git diff --cached`.
4. Run:

```bash
.agents/skills/flow-contribution-check/scripts/preflight.sh commit
```

Rerun commit preflight after any staging change, including partial staging.
Commit mode validates the staged index only: staged whitespace, staged diff
summary, and optional redacted staged secret scanning. It intentionally does not
run whole-worktree `bun run check`; run that separately from a clean worktree, or
use push mode, when broad validation evidence is needed.

## Before pushing

1. Ensure the working tree is clean.
2. Run:

```bash
.agents/skills/flow-contribution-check/scripts/preflight.sh push
```

3. Review the outgoing range printed by the script.
4. Read `references/validation-matrix.md` and record any required evidence before pushing.

Push mode validates only the current branch against its configured upstream, or
`origin/main` for a non-`main` branch with no upstream. It does not validate
tags, mirrors, or arbitrary refspecs. Push mode requires a clean worktree before
running whole-worktree `bun run check` and selected focused checks, including the
distribution/surface test when `skills/**` changes are present.

## Escalate before risky operations

Ask the user immediately before force-push, branch deletion, tag deletion, credential rotation, npm publish, GitHub release mutation, or any other hard-to-reverse repository action.

## Evidence discipline

Keep secret values redacted in output and summaries. Generated release smoke artifacts and local Flow session state are evidence scaffolding; do not commit them unless a maintainer explicitly asks to archive that exact artifact.
