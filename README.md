# Flow Plugin for OpenCode

`opencode-plugin-flow` adds a resumable planning, execution, validation, and review workflow to OpenCode. Use it when a task is important enough that you want a plan, recorded validation evidence, review gates, and a clear way to resume later.

Flow is skills-first: four hand-authored skills carry the workflow guidance, and a small plugin provides durable `.flow/**` session state plus a few hard, code-enforced invariants.

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

Flow creates a tracked session under `.flow/**`, drafts a plan, executes one feature at a time, records validation evidence, reviews, and either continues, recovers, or stops with a concrete blocker.

## Install

Add Flow to the `plugin` array in your `opencode.json` (global `~/.config/opencode/opencode.json` or per-project):

```json
{
  "plugin": ["opencode-plugin-flow@3"]
}
```

OpenCode installs the package from npm on startup. Pin the major version you install (currently `@3`) so restarts pick up fixes without crossing a breaking release.

On startup the plugin syncs its global skills into `~/.config/opencode/skills/`:

```text
flow/SKILL.md          # the driving loop: status → plan → run → review → repeat
flow-plan/SKILL.md     # decomposition heuristics, feature sizing, approval criteria
flow-run/SKILL.md      # one-feature discipline, validation evidence standards
flow-review/SKILL.md   # review depth criteria, finding taxonomy, report format
```

**Restart OpenCode once after the first install or after an update** so freshly synced skills are discovered.

Skill sync is ownership-aware: each Flow-owned skill folder carries a `.flow-skill-version` marker with a sha256 line per shipped file. Folders without the marker are never touched, and if you edit a Flow-owned file by hand — `SKILL.md` or a `references/` file — the previous content is backed up next to it (`SKILL.md.backup`, `references/<name>.md.backup`) before an update replaces it.

### Per-project skill overrides

Skills are plain markdown and deliberately overridable. To customize Flow's behavior for one project — for example a team-specific planning or review rubric — place a project-local skill at:

```text
.opencode/skills/flow-plan/SKILL.md
```

OpenCode's project skill takes precedence over the global one. This is a supported feature, not a hack: edit the global synced copy for personal defaults (it will be backed up on update), or commit a project override for team conventions.

### Upgrading from the pre-npm (curl) install

Releases before 2.1.0 installed a bundled plugin file at `~/.config/opencode/plugins/flow.js`. Once you add the npm plugin entry, that copy would load Flow twice — the plugin warns about this at startup. Remove it with the uninstall command below.

### Uninstall

```bash
bunx opencode-plugin-flow uninstall
```

This removes the Flow-owned global skill folders (those carrying the Flow marker) and a pre-npm `flow.js` copy if one exists, then reminds you to remove `"opencode-plugin-flow"` from the `plugin` array in `opencode.json`. Skills you created yourself are never deleted. Use `--dry-run` to preview.

## Skills, commands, and tools

### The four skills

| Skill | What it carries |
| --- | --- |
| `flow` | The driving loop: check status, plan, run, review, repeat; stop conditions, when to ask the user, recovery playbook. |
| `flow-plan` | How to decompose work into features, size them, profile the repo, and when a plan is safe to auto-approve. |
| `flow-run` | One-feature-at-a-time discipline and what counts as validation evidence. |
| `flow-review` | Review depth criteria, finding taxonomy, and report format. |

Deeper methodology (worked plan examples, validation and review rubrics) lives in `references/` files next to the `flow-plan`, `flow-run`, and `flow-review` skills and is loaded only when needed.

### Commands

Commands are thin pointers into the skills — the skill content is the real instruction surface. Command names are stable across the v2 → v3 upgrade.

| Command | Use it when... |
| --- | --- |
| `/flow-auto <goal>` | You want Flow to drive the whole loop — plan, run, validate, review — until completion or a real blocker. Run without a goal to resume. |
| `/flow-plan <goal>` | You want to create, inspect, or shape the plan before execution. |
| `/flow-run [feature-id]` | You want to execute exactly one approved feature. |
| `/flow-review <goal>` | You want a read-only review and findings report (runs in the fresh-context `flow-reviewer` subagent). |
| `/flow-status` | You want session state, readiness checks, and the suggested next step. |
| `/flow-doctor` | You want the workspace readiness checks with remediation steps (same `flow_status` view, doctor framing). |
| `/flow-history` | You want to list saved sessions. |
| `/flow-session activate <id>` / `close <completed\|deferred\|abandoned>` / `show <id>` | You want to switch, close, or inspect sessions. |
| `/flow-reset <feature-id>` | You want to reset a feature back to pending (convenience over `flow_feature_complete` with `reset: true`). |

### Tools

The plugin registers a small tool surface (7 tools) that owns all `.flow/**` mutations:

| Tool | Purpose |
| --- | --- |
| `flow_status` | Session state, doctor-style readiness, and a computed suggested next step. |
| `flow_plan_save` | Create or update the draft plan (planning context plus features). |
| `flow_plan_approve` | Approve the plan, optionally restricted to a feature subset. |
| `flow_run_start` | Start the next runnable feature. |
| `flow_feature_complete` | Record a validated feature result; also handles feature reset. |
| `flow_review_record` | Record a reviewer decision (`scope: feature` or `final`). |
| `flow_session` | Activate or close a session, list history, or show a stored session. |

These seven tools are the whole canonical surface. For one minor cycle, the retired v2 tool names (for example `flow_run_complete_feature` or `flow_session_close`) remain registered as hidden redirect stubs: calling one returns an error naming its replacement and the key arguments, so resumed v2 sessions and old transcripts degrade gracefully instead of failing on an unknown tool. The stubs are scheduled for removal in v3.1. Existing v2 sessions migrate seamlessly (the session schema is unchanged).

### Agents

Flow ships one dedicated subagent: `flow-reviewer`, a read-only reviewer used for fresh-context review passes. Its read-only boundary is enforced by OpenCode's native per-agent permissions, not by prompt text. Everything else runs in your normal agent, guided by the skills.

## What the plugin enforces vs. what skills guide

The plugin code enforces only hard invariants and persistence safety:

1. A feature cannot be completed without recorded validation evidence.
2. A session cannot close as `completed` with unfinished features.
3. An approved plan cannot be mutated without an explicit reset.
4. If the session's review policy is strict, a reviewer decision must be recorded before completion.

Plus: atomic, locked, path-safe writes under `.flow/**`; schema validation of all tool payloads; and the compaction hook that keeps Flow state intact when OpenCode compacts a long session.

Everything judgment-shaped — how to decompose a plan, how deep to review, what counts as good evidence, when to stop and ask — lives in the skills, where you can read and override it.

## What Flow writes

Flow stores workflow state in the project/worktree where OpenCode is running:

```text
.flow/active/<session-id>/session.json        # active session (source of truth)
.flow/active/<session-id>/docs/**             # readable derived views
.flow/stored/<session-id>/session.json        # parked resumable sessions
.flow/completed/<session-id>-<timestamp>/**   # closed session history
.flow/locks/
```

The JSON session files are the source of truth; markdown files are derived views. There is one active session per worktree — activating another parks the current one under `.flow/stored/**`.

Flow refuses to write session state at filesystem roots or directly in `$HOME`, and asks before writing `.flow/**` under unusual workspace roots. Existing v2 sessions resume under v3 (the session schema is unchanged).

## Troubleshooting

```text
/flow-doctor
```

shows the workspace readiness checks (skills in sync, no stale pre-npm copy, workspace writable) with remediation steps; `/flow-status` adds the active session state, the current blocker, and the suggested next step.

## OpenCode references

- Plugins: https://opencode.ai/docs/plugins
- Skills: https://opencode.ai/docs/skills
- Agents: https://opencode.ai/docs/agents

## Releases

Release notes live in [`CHANGELOG.md`](CHANGELOG.md) and under [`docs/releases/`](docs/releases/).

## Working on Flow itself

- Development guide: [`docs/development.md`](docs/development.md)
- Maintainer contract: [`docs/maintainer-contract.md`](docs/maintainer-contract.md)
- Codebase map: [`docs/contributor-map.md`](docs/contributor-map.md)

### Package API boundary

`opencode-plugin-flow` supports root-only imports:

```ts
import flowPlugin from "opencode-plugin-flow";
```

Deep imports such as `opencode-plugin-flow/dist/...` are intentionally not exported.

## License

MIT. See [`LICENSE`](LICENSE) for the full text.
