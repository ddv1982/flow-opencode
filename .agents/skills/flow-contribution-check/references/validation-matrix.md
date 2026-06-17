# Flow contribution validation matrix

Use this after the scripted preflight when the touched boundary needs focused evidence.

| Changed boundary | Minimum focused evidence before push |
| --- | --- |
| Any commit boundary | Commit preflight: staged whitespace, staged-index review, optional staged secret scan |
| Any push or whole-worktree gate | Push preflight or clean-worktree `bun run check` |
| `src/runtime/**`, session schema, transitions, persistence, or hard invariants | Narrow runtime tests for the touched module; usually `bun test tests/runtime-gates.test.ts tests/workspace-persistence.test.ts` |
| `src/adapters/opencode/**`, tool schemas, tool registration, or config projection | Push preflight runs `bun test tests/distribution-and-surface.test.ts`; also run `bun run typecheck` when validating manually |
| `src/distribution/**`, `src/cli.ts`, package files, install/update/uninstall behavior | `bun run build`; `bun test tests/distribution-and-surface.test.ts` |
| `skills/**` | Push preflight runs `bun test tests/distribution-and-surface.test.ts`; review the relevant skill and references directly |
| Package scripts, workflow files, or release process | Focused script/workflow review; `bun run check` before merge/release |
| Release notes, README install snippet, or package version | Verify `package.json`, `bun.lock`, `CHANGELOG.md`, README snippets, and tag name all agree |
| Public surface change: command, tool, agent, `.flow/**` path, package export, or schema | Update `docs/maintainer-contract.md`, README, skills, tests, and release notes together; treat as release-sensitive |

## Secret hygiene

- If `gitleaks` is installed, the preflight runs redacted scans for staged blobs and outgoing commits.
- If `gitleaks` is missing, the script warns instead of failing so Flow does not gain a new contributor dependency.
- Never print decoded tokens, API keys, npm tokens, GitHub tokens, private keys, app credentials, or local user secrets.
