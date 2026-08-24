# Verification record

Run from `/Users/vriesd/projects/flow-opencode-eval-engineering` on branch
`codex/eval-engineering`.

## Repository gate

```bash
bun install --frozen-lockfile
bun run check
```

Observed twice after the final plan revisions:

```text
399 pass
1 skip
0 fail
1919 expect() calls
```

The skipped test is the credentialed live OpenCode 1.18.6 smoke. Biome reports two
pre-existing `noTemplateCurlyInString` warnings in
`tests/documentation-contract.test.ts`. The command exits zero.

## Plan links

The local Markdown-link check walks every plan file, resolves relative targets,
and exits nonzero on a missing file.

```text
all local markdown links resolve
```

## Prose and diff checks

The Deslop scan found none of the banned long dash or listed AI vocabulary in the
plan or audit log. `git diff --cached --check` passed.

## Contribution preflight

```bash
.agents/skills/flow-contribution-check/scripts/preflight.sh commit
```

Observed result:

```text
Commit preflight passed.
```

The optional secret scan was skipped because `gitleaks` is not installed. Staged
whitespace and the staged diff summary passed.
