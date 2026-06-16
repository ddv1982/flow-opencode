---
name: flow-commit
description: Prepare safe Git commits and commit messages. Use only when the user asks to inspect, stage, validate, write a commit message, or create a commit; preserves unrelated work and never pushes, amends, rebases, or publishes without explicit authorization.
---

# Flow Commit

Use this skill only when the user asks to prepare or create a commit, write a
commit message, stage intended work, or validate staged changes before
committing. It is not part of the autonomous Flow loop and must not be loaded
automatically by `flow`, `flow-run`, or `flow_feature_complete`.

When a Flow session exists, a commit never substitutes for Flow completion. The
manager still records validation and review evidence through
`flow_feature_complete` before claiming a Flow feature is done. Default to commit
preparation only after `flow_feature_complete` has recorded the relevant
completion evidence. If the user explicitly asks for a WIP commit, preserve
failing or incomplete validation context in the message.

## Boundaries

- Preserve unrelated user work.
- Stage explicit paths or hunks only. Do not default to `git add .` or
  `git add -A`.
- Do not commit `.flow/**` state unless the maintainer explicitly asks to
  archive those exact files.
- Do not push, amend, rebase, squash, reset, force-push, tag, release, publish,
  or mutate remote state unless the user explicitly authorizes that exact
  operation.
- Stop before committing secrets, local config, credentials, private keys,
  generated release artifacts, or suspicious environment files.
- Stop when validation fails unless the user explicitly wants an unfinished WIP
  commit and the commit message says so.

## Inspect

Start with the worktree and intent:

1. Run `git status --short`.
2. Inspect unstaged and staged changes separately with `git diff` and
   `git diff --cached`.
3. Inspect untracked files before deciding whether they belong.
4. Group changes by intent, feature, and risk. Prefer one coherent commit over
   one large mixed commit.
5. Identify exclusions: unrelated files, local notes, `.flow/**`, generated
   artifacts, logs, caches, credentials, and temporary outputs.

If the commit boundary is unclear, propose the boundary and ask before staging.

## Stage

Stage only the intended boundary:

- Use explicit file paths for whole-file staging.
- Use patch staging for mixed-intent files.
- Re-run `git status --short` and `git diff --cached --stat` after staging.
- Review the full staged diff before validation and commit.

Never undo or rewrite user changes to make staging easier. If a file contains
mixed user and agent work, either stage selected hunks or ask for direction.

## Screen and Validate

Before commit creation, check the staged diff for:

- Secrets, tokens, private keys, credentials, cookies, and unredacted personal
  data.
- `.env`, local config, machine-specific paths, and editor files.
- `.flow/**` state.
- Generated artifacts that are not normally versioned.
- Package or version metadata drift unrelated to the requested change.

When this repository-local contribution preflight exists, defer to it for staged
and outgoing validation instead of duplicating its checks:

```bash
.agents/skills/flow-contribution-check/scripts/preflight.sh commit
```

Run it after staging and rerun it after any staging change. The preflight
validates staged or outgoing work; it does not choose commit boundaries or write
commit messages. If the script is absent, use the repository's documented commit
preflight from package scripts, AGENTS/docs, or CI guidance.

Use the repository's documented broad validation gate when a full local check is
appropriate, such as package scripts, AGENTS/docs, or CI guidance. Use narrower
tests only when the user has asked for a lighter pass or when the change is
intentionally not ready for the broad gate.

## Message

Propose a commit message that reflects the staged diff:

- Subject: imperative, specific, and scoped.
- Body when useful: context, changed areas, validation run, and remaining risk.
- Do not mention unstaged or excluded work as if it were included.
- Include WIP or failing-validation context only when the user explicitly chose
  that path.

## Create Commit

Create the commit only after the user explicitly asks for commit creation or has
already authorized it in the current request.

Before running `git commit`, report:

- Staged paths.
- Excluded dirty or untracked paths.
- Validation command and result.
- Proposed message.
- Any risks or gaps.

After a successful commit, report the commit hash and leave push or release
actions for a separate explicit request.
