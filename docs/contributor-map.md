# Contributor Map

Start with [`docs/maintainer-contract.md`](maintainer-contract.md) — it defines the hard invariants, the frozen persistence surfaces, and the skills-vs-code split. This map points each area of the codebase at its files, risks, and checks.

The layout in one line: `skills/` is the brain, `src/config-shared.ts` is host-neutral config projection, `src/runtime/` is the safe state backend, `src/adapters/opencode/` is a thin adapter, `src/distribution/` ships and syncs it.

The source-ownership guardrail lives in [`docs/architecture/allowed-cross-layer-dependencies.md`](architecture/allowed-cross-layer-dependencies.md) and is enforced by `bun run check:architecture-seams:enforce`. In short: runtime must not import adapters, distribution, or root entrypoint facades; distribution must not import runtime or adapters; shared config must not import implementation layers; root entrypoints are package/binary composition points, not implementation dependencies.

Before commit/push, the optional repo-local preflight lives at `.agents/skills/flow-contribution-check/scripts/preflight.sh`. Use `commit` mode after staging and `push` mode before pushing. For simplification claims or release notes, capture `bun run report:architecture-metrics`; it is report-only and not a merge gate.

## Skills (`skills/`)

Risk: medium — wrong guidance degrades output quality but cannot corrupt state.

- `skills/flow/SKILL.md` — the driving loop, stop conditions, recovery playbook
- `skills/flow-plan/SKILL.md` + `references/` — decomposition, sizing, approval criteria
- `skills/flow-run/SKILL.md` + `references/` — one-feature discipline, validation evidence standards
- `skills/flow-review/SKILL.md` + `references/` — review depth, finding taxonomy, report format

Required checks: tool-name-coverage test; careful diff review (skill quality is review-owned).

Do not:

- Instruct direct edits of `.flow/**` — every state change goes through a registered tool.
- Reference tools, paths, or behavior the runtime does not provide.
- Reintroduce generated or hash-locked skill content; these files are hand-authored.

## Runtime: schema, persistence, invariants (`src/runtime/`)

Risk: high — this is the half that must never lie or lose data.

- `src/runtime/schema.ts` — session and tool-payload schemas (persisted schema v1 is frozen)
- `src/runtime/transitions/` — state transitions, hard invariants, and completion payload gates
- `src/runtime/domain/` — workflow policy helpers; invariant catalog in `semantic-invariants.ts`
- `src/runtime/session*.ts`, `src/runtime/paths.ts`, `src/runtime/workspace-root.ts` — persistence, locking, activation, path-traversal and workspace-root guards
- `src/runtime/application/` — session mutation actions behind the tool surface
- rendering of derived markdown views beside each session

Required checks: invariant/transition/persistence tests under `tests/`, the v2-session resume fixture, `bun run typecheck`, and `bun run check:architecture-seams:enforce` for dependency-boundary-sensitive changes.

Do not:

- Change persisted state shape without migration/recovery consideration (v2 sessions must resume).
- Weaken a hard invariant, locking, or a path guard without updating the maintainer contract and its direct tests.
- Import from `src/adapters/**`, `src/distribution/**`, or root entrypoints such as `src/config.ts`; inject those concerns from the adapter instead.
- Grow the invariant set back into a gate matrix — judgment belongs in skill rubrics.

## Adapter: plugin entry and tool surface (`src/adapters/opencode/`)

Risk: medium-high — public names and payload shapes are contracts.

- `src/adapters/opencode/plugin.ts` — plugin entry: config hook (command/agent injection), tool registration, compaction hook
- `src/adapters/opencode/tools.ts`, `src/adapters/opencode/tool-surface/` — the 7 tools and their zod arg shapes (no v2 tool-name aliases; the new names are the whole surface)
- `src/adapters/opencode/sdk.ts` — the `@opencode-ai/plugin` boundary

Required checks: tool/schema tests, tool-name-coverage test, `bun run typecheck`, and `bun run check:architecture-seams:enforce` when touching imports or exported facades.

Do not:

- Rename tools casually — names are referenced by skills, users, and docs; change all together.
- Put workflow policy in a tool — tools validate and dispatch to runtime actions.
- Wrap SDK `tool(...)` args in anything other than raw zod shapes.
- Import from root entrypoint facades (`src/index.ts`, `src/config.ts`, `src/cli.ts`) instead of the owning module.
- Loosen the read-only enforcement on the `flow-reviewer` agent (native per-agent permissions, not prompt text).

## Distribution: skill/command sync, uninstall, packaging (`src/distribution/`, `src/cli.ts`)

Risk: medium-high — this code writes to the user's home directory.

- `src/distribution/skill-sync.ts` — idempotent startup sync of `skills/` into `~/.config/opencode/skills/`, commands into `~/.config/opencode/commands/`, and `flow-reviewer` into `~/.config/opencode/agents/`
- `src/distribution/skill-markers.ts` — `.flow-skill-version` and command/agent path ownership constants
- `src/distribution/uninstall.ts`, `src/cli.ts` — `bunx opencode-plugin-flow uninstall`

Required checks: `bun run build`, install smoke against the packed tarball (`bun run smoke:release`), install/uninstall tests, and `bun run check:architecture-seams:enforce` when touching imports or shared config.

Do not:

- Touch skill folders that lack the Flow marker — they belong to the user or another plugin.
- Replace a user-edited Flow-owned file (SKILL.md or a `references/` file) without writing a `.backup` beside it first.
- Let sync failures break plugin startup — sync is best-effort.
- Import from `src/runtime/**` or `src/adapters/**`; expose distribution facts through injected adapter/runtime ports instead.
- Write under `.flow/**` from any install/uninstall path.

## Tests (`tests/`)

Risk: medium.

Coverage is focused: hard invariants, transitions and recovery, persistence/locking/path safety, v2-session resume, tool shapes, install lifecycle. Add new coverage to the narrowest matching suite. Golden-transcript evals (model-driven, manual lane) own end-to-end skill effectiveness — do not try to test skill quality mechanically.

## Documentation and historical evidence

Risk: low-medium.

- Current contracts: `docs/maintainer-contract.md`, `docs/development.md`, this file, `README.md`
- Archives: `docs/releases/` and `CHANGELOG.md`

Release notes are historical records and may mention deleted plans or investigations; use ADRs, current docs, source, and tests for present-day contracts.

Do not:

- Update release history as if it were a current contract.
- Leave historical docs unlabeled when they could be mistaken for current contracts.
