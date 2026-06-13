# Flow contribution validation matrix

Use this after the scripted preflight when the touched boundary needs focused evidence.

| Changed boundary | Minimum focused evidence before push |
| --- | --- |
| Any contribution | `git diff --check`, staged-index review, `bun run check:architecture-seams:enforce` |
| `src/runtime/**`, session schema, transitions, persistence, or hard invariants | Narrow runtime tests for the touched module; `bun run check:completion-lane` for completion-lane changes |
| `src/adapters/opencode/**`, tool schemas, tool registration, or config projection | Tool/schema tests, tool-name coverage tests, `bun run typecheck` |
| `src/distribution/**`, `src/cli.ts`, package files, install/update/uninstall behavior | `bun run build`, install/uninstall focused tests, `bun run smoke:release` before release |
| `skills/**` | Review against `docs/skill-review-checklist.md`; tool-name coverage; run the relevant golden eval manually when behavior changed and model access is available |
| `scripts/cross-area/**`, package scripts, or release process | Focused script run; `bun run check` before merge/release |
| `docs/release-process.md`, release notes, README install snippet, or package version | `bun run check:release-hygiene`; `bun run smoke:opencode` verifies README exact pin drift |
| Public surface change: command, tool, agent, `.flow/**` path, package export, or schema | Update `docs/maintainer-contract.md`, README, skills, tests, and release notes together; treat as release-sensitive |

## Secret hygiene

- If `gitleaks` is installed, the preflight runs redacted scans for staged blobs and outgoing commits.
- If `gitleaks` is missing, the script warns instead of failing so Flow does not gain a new contributor dependency.
- Never print decoded tokens, API keys, npm tokens, GitHub tokens, private keys, app credentials, or local user secrets.
