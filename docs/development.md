# Development Guide

This file is for contributors working on the plugin itself. If you are trying to use Flow inside OpenCode, start with the top-level `README.md`.

Read [`docs/maintainer-contract.md`](maintainer-contract.md) first — it defines what is frozen (persistence safety, schema v1, the hard invariants, the compaction hook) and what is skill-owned. Use [`docs/contributor-map.md`](contributor-map.md) to find the right files and checks for a given change.

This repo's workflow is Bun-first.

## Local workflow

```bash
bun install
bun run check
```

`bun run check` is the canonical readiness gate and is intentionally small: typecheck, lint, build, tests, install smoke, and bundle sanity. There are no generation, capture, parity, or drift steps — nothing in this repo is generated from anything else.

Useful scripts:

- `bun run build`
- `bun run typecheck`
- `bun run test` (focused suites live under `tests/`)
- `bun run smoke:release` — builds, packs the npm tarball, and runs the install smoke against it (pack → extract → plugin startup → skill sync → uninstall CLI)
- `bun run uninstall:opencode` — same logic as `bunx opencode-plugin-flow uninstall`

There is no local install script: OpenCode installs the plugin from npm via the `plugin` array in `opencode.json`. To develop against an unpublished build, point a test project's `opencode.json` at a packed tarball (`bun pm pack`) or use the smoke runner.

## Architecture in one view

```text
user / slash command / skill-guided agent
  -> OpenCode adapter tool surface (7 tools)
  -> runtime application action
  -> transition policy + hard invariants
  -> `.flow/**/session.json` snapshot persistence
  -> derived markdown rendering
```

- `skills/` — the four hand-authored skills plus `references/`. This is the instruction surface; commands and agents only point at it.
- `src/runtime/` — schemas, transitions, the hard invariants, persistence, locking, path/workspace-root safety, rendering.
- `src/adapters/opencode/` — thin adapter: plugin entry, config-hook injection of commands/agents, the tool surface, the compaction hook. Tools validate payloads and dispatch to runtime actions; they own no workflow policy.
- `src/distribution/` — startup skill sync (marker files, backups) and the uninstall CLI.

Live persistence is snapshot-primary: `.flow/**/session.json` is the source of truth, rendered markdown is derived. The session schema stays at v1 so v2-created sessions resume under v3.

## Editing skills

Skills are plain markdown checked into `skills/<name>/SKILL.md` (frontmatter: `name` + `description`), with deeper material in `skills/<name>/references/`. There is no build step, no generation, no hash locking — edit the file, that's it.

How they reach users:

1. The files ship inside the npm package.
2. On plugin startup, `src/distribution/skill-sync.ts` idempotently copies them to `~/.config/opencode/skills/<name>/`, writing a `.flow-skill-version` marker per folder (plugin version plus a sha256 line per shipped file).
3. Folders without the marker are never touched. If a user edited a Flow-owned file (`SKILL.md` or a `references/` file), the old content is backed up next to it (`SKILL.md.backup`, `references/<name>.md.backup`) before being replaced.
4. Skills synced during init may only be discovered on the next OpenCode start — keep the "restart once after install/update" line in user docs.

Per-project overrides (`.opencode/skills/<name>/SKILL.md`) are a documented user feature; the plugin never writes there.

Guidelines for skill content:

- Keep `SKILL.md` tight (~1–2KB); move methodology and worked examples into `references/` (progressive disclosure).
- Skills may reference registered tool names but must not invent tools, state transitions, persistence paths, or `.flow/**` write behavior — every state change goes through a tool.
- The tool-name-coverage test fails if a registered tool name appears in no skill. There are no other mechanical skill checks; quality is owned by code review and the golden-transcript evals (manual lane, needs a model key).

## Tool schema note

OpenCode plugin tools take `args` as a raw zod shape, not a wrapped schema object:

```ts
const FlowRunStartArgsShape = {
  featureId: z.string().optional(),
};
```

Validation is two-layered: raw shapes at the SDK boundary, stricter semantic schemas in `src/runtime/schema.ts`. Keep `zod` aligned with `@opencode-ai/plugin`.

## Testing

The suite is small (~40 files) and focused on what code actually owns:

- the four hard invariants (each rejection path unit-tested directly)
- transitions and recovery metadata
- session persistence, locking, activation, closure, and path/workspace-root safety
- a v2-session resume fixture
- tool arg shapes and registration
- install lifecycle: pack, startup skill sync, uninstall

```bash
bun test
```

Benchmarks under `bench/` stay runnable but are out of `check` and not a merge gate.

### Golden-transcript evals

The driving loop itself is checked by five golden-transcript evals under `evals/golden/`: each one runs `opencode run` headless against a tiny fixture workspace that loads the plugin from this checkout (built `dist/index.js` dropped into the workspace's `.opencode/plugins/`), then asserts observable outcomes from the persisted `.flow/**` state — parsed with the runtime's own `SessionSchema`, never from transcript text.

```bash
bun run build
bun run evals:golden                        # needs the opencode CLI and a model key
bun run evals/golden/runner.ts --list
bun run evals/golden/runner.ts --dry-run    # harness check, no model key needed
```

This is a manual/scheduled lane — it tests effectiveness, not synchronization, and is never part of `bun run check` or default CI. The CI-safe piece is `tests/evals-golden-harness.test.ts`, which shape-checks scenarios and fixtures without invoking opencode. Requirements and caveats live in `evals/golden/README.md`.
