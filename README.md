# Flow Plugin for OpenCode

`opencode-plugin-flow` adds a resumable planning, execution, validation, and review workflow to OpenCode. Use it when a task is important enough that you want a plan, recorded validation evidence, review gates, and a clear way to resume later.

## Quick start

Install Flow, open OpenCode in the project you want to work on, then run:

```text
/flow-auto <your goal>
```

Common examples:

```text
/flow-auto Add CSV export to the reports page
/flow-plan Refactor the authentication middleware
/flow-review Review this repository for release risks
/flow-status
```

For most implementation work, start with `/flow-auto`. Flow will create a tracked session under `.flow/**`, draft a plan, execute one feature at a time, validate, review, and either continue, recover, or stop with a concrete blocker.

## When Flow is useful

Flow is a good fit when you want:

- a visible plan before code changes happen
- one feature at a time instead of a broad untracked edit
- validation commands and review decisions recorded with the work
- resumable state on disk
- a read-only repository review before or after implementation

Skip Flow for disposable prompts, brainstorming, or experiments you do not want written to `.flow/**`.

## Install

### From the latest GitHub release

```bash
curl -fsSL https://github.com/ddv1982/flow-opencode/releases/latest/download/install.sh | bash
```

### From this repository

```bash
bun install
bun run install:opencode
```

Both install paths install global OpenCode assets:

```text
~/.config/opencode/plugins/flow.js
~/.config/opencode/skills/flow-plan/SKILL.md
~/.config/opencode/skills/flow-run/SKILL.md
~/.config/opencode/skills/flow-review/SKILL.md
```

The plugin provides the slash commands, agents, tools, and hooks. The skills provide on-demand guidance for Flow planning, running, and review work; they do not replace the plugin or create separate workflow state.

Source install uses Bun to build this plugin. The project you use Flow on does not need to use Bun.

### Uninstall

From the latest release:

```bash
curl -fsSL https://github.com/ddv1982/flow-opencode/releases/latest/download/uninstall.sh | bash
```

From this repository:

```bash
bun run uninstall:opencode
```

Uninstall removes the canonical global `flow.js` plugin and generated Flow skill files only when they are still Flow-owned. If you edited a generated skill by hand, Flow refuses to delete it silently.

## Main commands

| Command | Use it when... |
| --- | --- |
| `/flow-auto <goal>` | You want Flow to plan, run, validate, review, and continue automatically. |
| `/flow-auto` or `/flow-auto resume` | You want to resume the active Flow session. |
| `/flow-plan <goal>` | You want to inspect or shape the plan before execution. |
| `/flow-plan approve [feature-id...]` | You want to approve the current plan or selected features. |
| `/flow-run [feature-id]` | You want to execute exactly one approved feature. |
| `/flow-review <goal>` | You want a read-only repository review and findings report. |
| `/flow-status [detail]` | You want to see the active session, blocker, and next command. |
| `/flow-doctor [detail]` | You want install/workspace/session readiness diagnostics. |
| `/flow-history` | You want to list saved or completed sessions. |
| `/flow-history show <session-id>` | You want details for a previous session. |
| `/flow-session activate <session-id>` | You want to switch the active session. |
| `/flow-session close <completed\|deferred\|abandoned>` | You want to close the active session. |
| `/flow-reset feature <feature-id>` | You want to reset a feature and dependent work. |

## Recommended workflows

### Let Flow drive implementation

```text
/flow-auto Add a settings import/export feature
```

Flow will:

1. inspect the repository and local guidance
2. create or refresh a plan
3. run one feature at a time
4. record validation evidence
5. ask a review lane to approve or request fixes
6. continue until the session completes or a real blocker appears

For small tasks, Flow may auto-approve a safe single-feature plan. For larger work, it adds more planning, validation, and review gates.

### Plan first, then run manually

```text
/flow-plan Add a settings import/export feature
/flow-plan approve
/flow-run
/flow-status
```

Use this path when you want to inspect the plan before any implementation work starts. Repeat `/flow-run` until Flow reports the session complete.

### Review without changing code

```text
/flow-review Review this repository for correctness and release risks
```

`/flow-review` is read-only. It returns a human-readable report with a conclusion, top findings, recommended next actions, and coverage notes.

Review depth labels:

- `default` — broad review across the major repository surfaces
- `detailed` — deeper review with direct evidence across the major surfaces
- `exhaustive` — strongest review claim, used only when coverage supports it

Examples:

```text
/flow-review detailed Review this codebase for regressions and test gaps
/flow-review exhaustive Review this repository before release and identify major risks
```

The command starts from changed or relevant files, then follows connected callers, callees, tests, prompts, tooling, release surfaces, and validation evidence when needed. It only claims the depth supported by inspected evidence.

To fix findings under Flow's tracked gates, start a Flow implementation session with `/flow-auto` or `/flow-plan` and complete the fixes through `/flow-run`, validation, and review.

## What Flow writes

Flow stores workflow state in the project/worktree where OpenCode is running:

```text
.flow/active/<session-id>/session.json
.flow/active/<session-id>/docs/index.md
.flow/active/<session-id>/docs/features/<feature-id>.md
.flow/stored/<session-id>/session.json
.flow/completed/<session-id>-<timestamp>/session.json
.flow/locks/
.flow/standards-profile.json
```

The JSON session files are the source of truth. Markdown files are readable generated views of that state.

There is one active Flow session per worktree. Activating another session parks the current one under `.flow/stored/**` and moves the requested one into `.flow/active/**`.

Flow refuses to write session state at filesystem roots or directly in `$HOME`. If a hidden directory outside the normal project root would become the mutable workspace root, Flow asks before writing `.flow/**` there.

## Agents and reasoning budgets

Flow installs dedicated OpenCode agents for planning, execution, auto coordination, review, control commands, and standalone audit. In v2.0.29 and later, Flow emits OpenCode `reasoningEffort` hints for those agents:

- high: planning, planning research, worker review, and standalone audit
- medium: `/flow-auto` coordination
- low: focused worker execution and control/status commands

Flow does not set a default model or provider. Your OpenCode configuration still owns model choice. `reasoningEffort` is passed through as OpenCode agent metadata. To inspect the budgets Flow configured, run `/flow-doctor detail` and look at the `config` check's `agentReasoningEffort` details.

## Troubleshooting

Run:

```text
/flow-doctor
```

Use `/flow-doctor detail` for a fuller structured view.

`/flow-doctor` checks:

- whether `~/.config/opencode/plugins/flow.js` is installed
- whether Flow commands and agents are injected
- whether the workspace root is writable and safe
- active session artifact health
- the current blocker and recommended next step

If you are unsure where you are in a session, run:

```text
/flow-status detail
```

## OpenCode references

Flow follows the current OpenCode plugin, skill, and agent surfaces:

- OpenCode plugins: https://dev.opencode.ai/docs/plugins/
- OpenCode skills: https://dev.opencode.ai/docs/skills/
- OpenCode agents and pass-through agent options: https://dev.opencode.ai/docs/agents/

## Releases

Release notes live in [`CHANGELOG.md`](CHANGELOG.md). Per-release notes also live under [`docs/releases/`](docs/releases/).

## Working on Flow itself

- Development guide: [`docs/development.md`](docs/development.md)
- Current maintainer contract: [`docs/maintainer-contract.md`](docs/maintainer-contract.md)
- Risk-to-file map: [`docs/contributor-map.md`](docs/contributor-map.md)

Prompt behavior is tested as a product surface. The maintainer workflow includes providerless prompt captures and behavior evaluations, so many prompt and command changes can be checked without a model API key.

### Package API boundary

`opencode-plugin-flow` supports root-only imports:

```ts
import flowPlugin from "opencode-plugin-flow";
```

Deep imports such as `opencode-plugin-flow/dist/...` or `opencode-plugin-flow/src/...` are intentionally not exported and are outside the public API.

## License

MIT. See [`LICENSE`](LICENSE) for the full text.
