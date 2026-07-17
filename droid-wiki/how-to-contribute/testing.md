# Testing

Testing focuses on hard gates, persistence safety, public surface stability, package shape, and real OpenCode integration. The canonical broad gate is `bun run check` from `package.json`.

## Test suites

| File | Purpose |
| --- | --- |
| `tests/runtime-gates.test.ts` | Plan validation, immutable approval, single active feature, completion evidence, final review, blockers, reset, and close rules. |
| `tests/workspace-persistence.test.ts` | Unsafe roots, duplicate and malformed JSON, archive and close behavior, fail-closed lock contention, quarantine, and schema errors. |
| `tests/distribution-and-surface.test.ts` | Embedded guidance, no-write startup, hostile-link safety, command prompts, permissions, legacy cleanup, and config collisions. |
| `tests/prompt-quality.test.ts` | Prompt source ownership, role applicability, handoff schemas, growth thresholds, 18 static scenarios, and model-response grading. |
| `tests/package-smoke.test.ts` | Build, pack, tar extraction, CLI execution from the packed package, and consumer TypeScript imports. |
| `tests/live-opencode-smoke.test.ts` | Real OpenCode server registration over HTTP, gated by `FLOW_LIVE_SMOKE=1`. |

## Commands

| Command | Use when |
| --- | --- |
| `bun run test` | Run all local Bun tests. |
| `bun test tests/runtime-gates.test.ts` | Runtime state gate changed. |
| `bun test tests/workspace-persistence.test.ts` | `.flow/` persistence or recovery changed. |
| `bun test tests/distribution-and-surface.test.ts` | Plugin config, commands, agents, guidance, or CLI changed. |
| `bun run prompt:quality` | Prompt sources, contracts, roles, or compiled surface size changed. |
| `bun run prompt:model-eval -- --model <provider/model> --timeout-ms 300000` | Opt-in comparison of baseline and implemented prompt decisions is warranted. |
| `bun run package:smoke` | `package.json`, `exports`, `bin`, build scripts, declaration output, or packed package changed. |
| `FLOW_LIVE_SMOKE=1 bun test tests/live-opencode-smoke.test.ts` | OpenCode host behavior might differ from mocked adapter tests; defaults to the pinned host version. |
| `FLOW_OPENCODE_SMOKE_VERSION=latest bun run smoke:live` | Exercise the packed plugin against the current npm `latest` OpenCode host, as the scheduled compatibility monitor does. |

## Evidence pattern

Flow's own skills require concrete validation records. `skills/flow-test/SKILL.md` says validation evidence should name the exact command, status, and observed result. That same habit applies to repository work: a good handoff says which command ran and what behavior it covered.

Related pages: [Review and validation](../features/review-and-validation.md), [Flow tools](../api/flow-tools.md), and [By the numbers](../by-the-numbers.md).
