# Flow contribution validation matrix

Use this after the scripted preflight when the touched boundary needs focused evidence.

| Changed boundary | Minimum focused evidence before push |
| --- | --- |
| Any commit boundary | Commit preflight: staged whitespace, staged-index review, optional staged secret scan |
| Any push or whole-worktree gate | Push preflight or clean-worktree `bun run check` |
| Session schema, domain transitions, application gates, persistence, or source identity | Narrow tests for the touched boundary; usually `bun test tests/domain-transitions.test.ts tests/runtime-gates.test.ts tests/workspace-persistence.test.ts tests/source-identity.test.ts` |
| `src/platform/opencode/**`, tool schemas, tool registration, command routing, or config projection | Push preflight runs `bun test tests/distribution-and-surface.test.ts tests/opencode-schema-contract.test.ts`; also run `bun run typecheck` when validating manually |
| Package files or OpenCode installation guidance | `bun run build`; `bun run package:smoke`; review the standard `opencode.json` plugin entry |
| `skills/**` | Push preflight runs the distribution and direct prompt-contract tests; review the relevant skill directly |
| Package scripts, workflow files, or release process | Focused script/workflow review; `bun run check` before merge/release |
| Release notes, README install snippet, or package version | Verify `package.json`, `CHANGELOG.md`, standard OpenCode configuration, and tag name agree |
| Public surface change: command, tool, agent, `.flow/**` path, package export, or schema | Update `docs/maintainer-contract.md`, README, skills, tests, and release notes together; treat as release-sensitive |

## Secret hygiene

- If `gitleaks` is installed, the preflight runs redacted scans for staged blobs and outgoing commits.
- If `gitleaks` is missing, the script warns instead of failing so Flow does not gain a new contributor dependency.
- Never print decoded tokens, API keys, npm tokens, GitHub tokens, private keys, app credentials, or local user secrets.
