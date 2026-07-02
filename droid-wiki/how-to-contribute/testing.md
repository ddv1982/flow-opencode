# Testing

Testing focuses on hard gates, persistence safety, public surface stability, package shape, and real OpenCode integration. The canonical broad gate is `bun run check` from `package.json`.

## Test suites

| File | Purpose |
| --- | --- |
| `tests/runtime-gates.test.ts` | Plan validation, immutable approval, single active feature, completion evidence, final review, blockers, reset, and close rules. |
| `tests/workspace-persistence.test.ts` | Unsafe roots, duplicate and malformed JSON, generated instructions, archive and close behavior, lock recovery, quarantine, and schema errors. |
| `tests/distribution-and-surface.test.ts` | Plugin surface, managed skills, command prompts, permission contracts, CLI doctor/sync/uninstall, startup sync health, config collisions, and compaction opt-in. |
| `tests/package-smoke.test.ts` | Build, pack, tar extraction, CLI execution from the packed package, and consumer TypeScript imports. |
| `tests/live-opencode-smoke.test.ts` | Real OpenCode server registration over HTTP, gated by `FLOW_LIVE_SMOKE=1`. |

## Commands

| Command | Use when |
| --- | --- |
| `bun run test` | Run all local Bun tests. |
| `bun test tests/runtime-gates.test.ts` | Runtime state gate changed. |
| `bun test tests/workspace-persistence.test.ts` | `.flow/` persistence or recovery changed. |
| `bun test tests/distribution-and-surface.test.ts` | Plugin config, commands, agents, skill sync, or CLI changed. |
| `bun run package:smoke` | `package.json`, `exports`, `bin`, build scripts, declaration output, or packed package changed. |
| `FLOW_LIVE_SMOKE=1 bun test tests/live-opencode-smoke.test.ts` | OpenCode host behavior might differ from mocked adapter tests. |

## Evidence pattern

Flow's own skills require concrete validation records. `skills/flow-test/SKILL.md` says validation evidence should name the exact command, status, and observed result. That same habit applies to repository work: a good handoff says which command ran and what behavior it covered.

Related pages: [Review and validation](../features/review-and-validation.md), [Flow tools](../api/flow-tools.md), and [By the numbers](../by-the-numbers.md).
