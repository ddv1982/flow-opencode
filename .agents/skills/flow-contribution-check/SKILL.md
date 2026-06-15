---
name: flow-contribution-check
description: Validate Flow plugin contributions before committing or pushing. Use when preparing a commit, push, release branch, or any GitHub-visible repository change.
---

# Flow contribution check

Run the repository-local preflight before every commit and before pushing. It is scaled to Flow's small plugin surface: staged diff hygiene, optional redacted secret scanning, architecture seams, package/version hygiene, and path-sensitive focused checks.

## Before committing

1. Review `git status --short` and inspect the intended working-tree diff.
2. Stage only intended files.
3. Review `git diff --cached --stat` and `git diff --cached`.
4. Run:

```bash
.agents/skills/flow-contribution-check/scripts/preflight.sh commit
```

Rerun commit preflight after any staging change, including partial staging. Commit mode validates the staged index, not just the working tree.

## Before pushing

1. Ensure the working tree is clean.
2. Run:

```bash
.agents/skills/flow-contribution-check/scripts/preflight.sh push
```

3. Review the outgoing range printed by the script.
4. Read `references/validation-matrix.md` and record any required evidence before pushing.

Push mode validates only the current branch against its configured upstream, or `origin/main` for a non-`main` branch with no upstream. It does not validate tags, mirrors, or arbitrary refspecs.
Push mode also runs focused checks for selected changed paths, including the distribution/surface test when `skills/**` changes are present.

## Escalate before risky operations

Ask the user immediately before force-push, branch deletion, tag deletion, credential rotation, npm publish, GitHub release mutation, or any other hard-to-reverse repository action.

## Evidence discipline

Keep secret values redacted in output and summaries. Generated release smoke artifacts and local Flow session state are evidence scaffolding; do not commit them unless a maintainer explicitly asks to archive that exact artifact.
