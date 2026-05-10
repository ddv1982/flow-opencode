# Contributor Map

Start with [`docs/maintainer-contract.md`](maintainer-contract.md). It is the non-historical ownership map for commands, tools, state paths, and release-critical invariants.

## Runtime schema

Risk: high

Read first:

- `docs/maintainer-contract.md`
- `src/runtime/schema.ts`
- `tests/runtime/worker-result-contracts.test.ts tests/runtime/final-completion-gates.test.ts tests/runtime/final-review-contracts.test.ts tests/runtime/plan-and-tool-schema-contracts.test.ts`
- `tests/schema-equivalence.test-d.ts`

Required checks:

- `bun run typecheck`
- `bun test tests/runtime/worker-result-contracts.test.ts tests/runtime/plan-and-tool-schema-contracts.test.ts tests/schema-equivalence.test-d.ts`
- `bun run check:dependency-contract` when tool payload shape may be affected

Do not:

- Change persisted state shape without migration/recovery consideration.
- Add cast bridges around schema mismatch without reviewing the `zod` / plugin SDK alignment.

## Runtime transitions and workflow policy

Risk: high

Read first:

- `src/runtime/transitions/`
- `src/runtime/domain/`
- `docs/architecture/invariant-matrix.md`
- `docs/architecture/strictness-contract.md`

Required checks:

- `bun run gate:completion-lane`
- `bun test tests/runtime.test.ts tests/runtime-replanning.test.ts tests/runtime-actionable-metadata.test.ts tests/runtime-recovery.test.ts tests/runtime/semantic-invariants.test.ts tests/transitions-consolidation.test.ts`

Do not:

- Let prompts define transition behavior that runtime does not enforce.
- Loosen completion/reviewer gates without updating contract tests and release notes.

## Tool schemas and OpenCode boundary

Risk: high

Read first:

- `src/adapters/opencode/tool-surface/schemas.ts`
- `src/adapters/opencode/tool-surface/runtime-tools/`
- `src/adapters/opencode/tool-surface/session-tools/`
- `src/adapters/opencode/tool-guidance.generated.ts`

Required checks:

- `bun test tests/config/plugin-surface.test.ts tests/config/tool-schemas.test.ts tests/runtime-tools.test.ts tests/runtime-tools-metadata.test.ts tests/docs-tool-parity.test.ts`
- `bun run typecheck`

Do not:

- Rename tools casually; tool names are prompt and operator contracts.
- Change direct `tool(...)` arg shapes without dependency-contract verification.

## Prompts, command templates, skills, and mode contracts

Risk: medium-high

Read first:

- `src/prompts/mode-contracts.ts`
- `src/prompts/commands.ts`
- `src/prompts/agents.ts`
- `src/prompts/skills.ts`
- `src/prompts/generated/skill-docs.ts`
- `src/adapters/opencode/skill-bundle.ts`
- `src/audit/prompts/`

Required checks:

- `bun run eval:prompt-capture:check`
- `bun run eval:review-capture:check` when `/flow-review` changes
- `bun test tests/config/prompt-contracts.test.ts tests/config/skill-bundle.test.ts tests/mode-contracts.test.ts tests/protocol-parity.test.ts tests/prompt-snapshot.test.ts tests/prompt-mode-behavior-eval.test.ts tests/prompt-behavior-eval.test.ts`

Do not:

- Add a prompt-only workflow rule unless runtime already owns it or the runtime change ships with it.
- Treat generated skills as runtime authorities; skills may reference existing tools and contracts but must not define new tools, state transitions, completion gates, persistence paths, review semantics, or `.flow/**` write behavior.
- Remove public command/agent names or fallback contracts when slimming prompts.
- Expand command/agent/skill surfaces during the surface freeze unless an explicit replacement/removal tradeoff is recorded.

## Session persistence, paths, and workspace root handling

Risk: high

Read first:

- `src/runtime/paths.ts`
- `src/runtime/session*.ts`
- `src/runtime/workspace-root.ts`
- `README.md` state-path section

Required checks:

- `bun test tests/runtime-session-persistence.test.ts tests/runtime-tool-persistence.test.ts tests/runtime-execution-history.test.ts tests/session-history.test.ts tests/runtime/render-snapshot.test.ts tests/workspace-root-guard.test.ts tests/path-traversal.test.ts`

Do not:

- Introduce a new `.flow/**` path without updating `docs/maintainer-contract.md` and path traversal tests.
- Treat rendered markdown docs as authoritative state.

## Config injection, install, and release package

Risk: medium-high

Read first:

- `src/config.ts`
- `src/audit/config.ts`
- `src/install-opencode.ts`
- `src/installer.ts`
- `src/adapters/opencode/skill-bundle.ts`
- `scripts/cross-area/pack-invariants.mjs`

Required checks:

- `bun run build`
- `bun run check:release-hygiene`
- `bun run check:pack-invariants`
- `bun test tests/config/plugin-surface.test.ts tests/config/tool-schemas.test.ts tests/config/skill-bundle.test.ts tests/install.test.ts tests/cross-area/install-lifecycle.test.ts tests/smoke/dist-load.test.ts`
Do not:

- Ship debug-only artifacts in `src` or `dist`.
- Add package files without updating pack/release invariants.
- Overwrite user-edited `.opencode/skills/**` files silently or mutate the global plugin before skill-conflict preflight passes.

## Performance-sensitive paths

Risk: medium

Read first:

- `bench/BASELINE.md`
- `bench/RESULTS.md`
- `src/runtime/session-persistence.ts`
- `src/runtime/render.ts`
- `src/runtime/json/strict-object.ts`

Required checks:

- `bun run bench:smoke`
- targeted tests for the changed path

Do not:

- Add repeated parse/normalize steps on hot save/render/schema paths without measurement.

## Test organization

Risk: medium

Read first:

- `tests/runtime.test.ts`
- `tests/runtime-*.test.ts`
- `tests/runtime/`
- `tests/config/`

Required checks:

- Run the focused suite you add or move coverage into.
- Run the previous broad suite plus the new focused suite when splitting tests.

Do not:

- Add unrelated behavior to broad catch-all files when a focused suite exists.
- Split tests by implementation module when the review concern is behavioral contract ownership.

## Documentation and historical evidence

Risk: medium

Read first:

- `docs/maintainer-contract.md`
- `docs/architecture/maintainer-risk-checklist.md`
- `docs/investigations/`
- `docs/releases/`

Required checks:

- `bun test tests/docs-tool-parity.test.ts tests/docs-semantic-parity.test.ts`
- Compare historical version references with `package.json` before presenting them as current facts.

Do not:

- Update prior investigation evidence as if it were current contract unless the evidence is re-run.
- Leave historical docs unlabeled when they can be mistaken for current contracts.
