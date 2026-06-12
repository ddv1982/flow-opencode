# Maintainer Contract

## What this project is

Flow is a workflow plugin for OpenCode with two clearly separated halves:

1. **Skills are the brain.** Four hand-authored skills (`skills/flow`, `skills/flow-plan`, `skills/flow-run`, `skills/flow-review`, plus their `references/` files) are the single guidance surface. They own all orchestration judgment: what to do next, how to plan, how deep to review, how to recover, when to stop and ask the user.
2. **The plugin is a dumb-but-safe state backend.** It owns durable, atomic, schema-validated persistence of `.flow/**` session state, a small set of hard invariants, the compaction hook, and a small tool surface (7 tools) through which all state mutations flow.

Authoring effort goes into skill content. Code defends only what a skill can never guarantee.

## Retired doctrine: three-tier resilience

Earlier versions of this contract required three synchronized guidance layers (runtime mode contracts → generated fallback prompts → generated hash-locked skills), with capture scripts and parity tests keeping them aligned. **That doctrine is retired as of v3.** OpenCode's native skills and per-agent permissions made the fallback tiers redundant; the generation, capture, parity, and hash-locking apparatus is deleted, not dormant. Do not reintroduce a second projection of skill guidance (generated prompts, mirrored mode contracts, fallback prompt templates). If a command or agent needs instruction text, it points at a skill.

## Source of truth

- Runtime transitions and domain policy own the hard invariants; skills describe everything else.
- `.flow/**/session.json` snapshots (schema v1) are the authoritative live state; rendered markdown under `docs/` is derived.
- Skills route every state change through registered tools; nothing may instruct direct edits of `.flow/**`.
- Tool payloads are zod-validated at the SDK boundary.

```text
user / slash command / skill-guided agent
  -> OpenCode adapter tool surface (7 tools)
  -> runtime application action
  -> transition policy + hard invariants
  -> `.flow/**/session.json` snapshot persistence
  -> derived markdown rendering
```

## Hard invariants (code-enforced)

These are the only behavioral gates the plugin enforces. They are release-critical and must stay covered by direct unit tests:

1. A feature cannot be completed without recorded validation evidence.
2. A session cannot close as `completed` with unfinished features.
3. An approved plan cannot be mutated without an explicit reset.
4. If the session's review policy is strict, a reviewer decision must be recorded before completion.

Judgment-heavy quality expectations (scope proportionality, review depth, evidence quality) live in skill rubrics, not validators. Do not grow the invariant set back into a gate matrix; a new hard invariant needs to be binary, cheap, and something a skill cannot guarantee.

## Frozen surfaces

These stay untouched regardless of other refactors:

- Atomic writes, file locking, path-traversal guards, and workspace-root safety (`src/runtime/paths.ts`, `src/runtime/workspace-root.ts`, `src/runtime/session*.ts`).
- Snapshot-primary persistence: `.flow/**/session.json` at schema v1. v2-created sessions must activate and resume under v3.
- Zod validation of tool payloads at the SDK boundary, with `zod` kept aligned to `@opencode-ai/plugin`.
- The compaction hook (`experimental.session.compacting`) — Flow state surviving compaction is the differentiator.

## Ownership map

- Plugin registration and config injection: `src/index.ts`, `src/adapters/opencode/plugin.ts`, `src/adapters/opencode/config.ts`
- Tool surface and schemas: `src/adapters/opencode/tools.ts`, `src/adapters/opencode/tool-surface/`
- Runtime schemas and persisted state: `src/runtime/schema.ts`
- Transitions and hard invariants: `src/runtime/transitions/`, `src/runtime/domain/` (catalog in `src/runtime/domain/semantic-invariants.ts`)
- Persistence and workspace-root rules: `src/runtime/session*.ts`, `src/runtime/paths.ts`, `src/runtime/workspace-root.ts`
- Skills: `skills/<name>/SKILL.md` plus `references/` (checked into the repo, shipped as package files)
- Skill sync and uninstall: `src/distribution/skill-sync.ts`, `src/distribution/skill-markers.ts`, `src/distribution/uninstall.ts`, `src/cli.ts`

## Tools

The public tool surface is exactly 7 tools; all `.flow/**` mutations go through them. The adapter registers only these names — there are no v2 tool-name aliases. v2 sessions still load (schema v1 is unchanged, and old tool names inside persisted failed-attempt records are harmless); anything referencing old v2 tool names just uses the new ones.

| Tool | Purpose |
| --- | --- |
| `flow_status` | State, readiness diagnostics, and a computed suggested next step (the only "what next" authority in code). |
| `flow_plan_save` | Create/update the draft plan (context + features). |
| `flow_plan_approve` | Approve the plan, optionally a feature subset. |
| `flow_run_start` | Start the next runnable feature. |
| `flow_feature_complete` | Record a validated feature result; reset via param. |
| `flow_review_record` | Record a reviewer decision (`scope: feature\|final`). |
| `flow_session` | Activate / close / history / show. |

Tool names are public contracts for skills and users. Every registered tool name must appear in at least one skill (enforced by the tool-name-coverage test); renames require updating skills and docs together.

## Commands and agents

- Commands are thin pointers (~1–2 lines) that load a skill; names are stable. They are both injected via the config hook and synced as Flow-owned markdown command files under `~/.config/opencode/commands/` so OpenCode's normal slash-command discovery sees them. There is nothing in a command worth growing — if a command needs real instruction text, move it into the skill.
- `flow-reviewer` is the one dedicated subagent: read-only, enforced by native per-agent permissions (tool-name glob denies), never by prompt text alone.

## Sync Ownership Rules

- Skills install to `~/.config/opencode/skills/<name>/` at plugin startup; sync is idempotent and best-effort (it must never fail plugin init).
- Commands install to `~/.config/opencode/commands/<name>.md`, and `flow-reviewer` installs to `~/.config/opencode/agents/flow-reviewer.md`, with Flow-owned sidecar marker files.
- Each Flow-owned folder carries a `.flow-skill-version` marker recording the plugin version and a sha256 line per shipped file. Folders without the marker belong to the user or another plugin and are never touched.
- A user-edited Flow-owned file is backed up next to itself (`SKILL.md.backup`, `references/<name>.md.backup`, or `<command>.md.backup`) before being replaced — never refused, never silently lost.
- Project-local overrides under `.opencode/skills/<name>/` are a documented feature, not drift. The plugin never writes into project skill directories.
- Files written during init may only be discovered on the next OpenCode start; install/update docs must keep saying "restart once," and `flow_status` readiness should flag a missing or stale synced surface.
- Uninstall removes only marker-carrying Flow-owned folders/files and the pre-npm `flow.js` copy; it never writes under `.flow/**`.

## State paths

- `.flow/active/<session-id>/session.json` — active mutable session state
- `.flow/active/<session-id>/docs/**` — derived renders
- `.flow/stored/<session-id>/**` — inactive resumable sessions
- `.flow/completed/<session-id>-<timestamp>/**` — closed history
- `.flow/locks/` — lock files

State shape changes require schema, persistence, recovery, and migration consideration. Do not add new `.flow/**` paths without updating path-traversal tests and this document.

## Historical references

`CHANGELOG.md`, `docs/releases/**`, `docs/investigations/**`, and superseded plans under `docs/plans/**` are archive records. They may reference deleted files and retired doctrine (mode contracts, generated skills, gate matrices); do not mass-edit them to chase current terminology. Current behavior is defined by this contract, current source, and current tests.

`docs/architecture/archive/**` holds pre-v3 architecture contracts (projection/parity-era ADRs, gate matrices, and complexity baselines) retired by the skills-first overhaul; treat them as the same kind of archive record.

## If you touch X, run Y

Prefer the narrowest useful check first; run `bun run check` before release or cross-surface merges. The check pipeline is intentionally small: typecheck, lint, build, tests, install smoke, bundle sanity.

| Area touched | Required checks |
| --- | --- |
| Hard invariants, transitions, or schema | invariant/transition unit tests under `tests/`, plus the v2-session resume fixture test |
| Tool registration or payload schemas | tool/schema tests, tool-name-coverage test, `bun run typecheck` |
| Persistence, paths, or workspace root | persistence/locking/path-traversal tests |
| Skills (`skills/**`) | tool-name-coverage test; read the diff — skill quality is review-owned, not test-owned |
| Install, sync, uninstall, packaging | `bun run build`, install smoke against the packed tarball, uninstall CLI test |
