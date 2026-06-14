# Flow contribution validation matrix

Use this after the scripted preflight when the touched boundary needs focused evidence.

| Changed boundary | Minimum focused evidence before push |
| --- | --- |
| Any contribution | `git diff --check`, staged-index review, `bun run check` |
| `src/runtime/**`, session schema, transitions, persistence, or hard invariants | Narrow runtime tests for the touched module; usually `bun test tests/runtime-gates.test.ts tests/workspace-persistence.test.ts` |
| `src/adapters/opencode/**`, tool schemas, tool registration, or config projection | `bun test tests/distribution-and-surface.test.ts`; `bun run typecheck` |
| `src/distribution/**`, `src/cli.ts`, package files, install/update/uninstall behavior | `bun run build`; `bun test tests/distribution-and-surface.test.ts` |
| `skills/**` | Review the relevant skill and references directly; make sure tool names still match `tests/distribution-and-surface.test.ts` |
| Package scripts, workflow files, or release process | Focused script/workflow review; `bun run check` before merge/release |
| Release notes, README install snippet, or package version | Verify `package.json`, `bun.lock`, `CHANGELOG.md`, README snippets, and tag name all agree |
| Public surface change: command, tool, agent, `.flow/**` path, package export, or schema | Update `docs/maintainer-contract.md`, README, skills, tests, and release notes together; treat as release-sensitive |

## Secret hygiene

- If `gitleaks` is installed, the preflight runs redacted scans for staged blobs and outgoing commits.
- If `gitleaks` is missing, the script warns instead of failing so Flow does not gain a new contributor dependency.
- Never print decoded tokens, API keys, npm tokens, GitHub tokens, private keys, app credentials, or local user secrets.
