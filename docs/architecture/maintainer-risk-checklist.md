# Flow Maintainer Risk Checklist

Use this checklist before merging changes in Flow's higher-risk areas.

## Prompt / tool / runtime parity

If you change any of these:

- `src/prompts/*`
- `src/tools/*`
- `src/runtime/transitions/*`
- `src/runtime/schema.ts`

then verify:

- prompts still reference canonical tool names only
- public tool registration still matches the intended canonical tool surface
- recovery metadata still emits canonical runtime tool names only
- payload shape changes stay aligned across prompt contracts, tool args, and runtime schemas

Recommended checks:

- `bun test tests/protocol-parity.test.ts tests/config.test.ts`

## Session persistence / migration / history

If you change any of these:

- `src/runtime/session*.ts`
- `src/runtime/paths.ts`
- `src/runtime/schema.ts`
- install / uninstall flows

then verify:

- archive history still sorts and loads correctly
- session summaries and rendered docs still match expectations

Recommended checks:

- `bun test tests/runtime.test.ts tests/session-history.test.ts`
- `bun test tests/runtime-render-snapshot.test.ts tests/runtime-summary.test.ts`

## Session tool placement rules

When adding session-facing behavior:

- tool registration and runtime calls -> `history-tools.ts` / `planning-tools.ts` / `lifecycle-tools.ts`
- JSON response shaping -> `responses.ts`
- next-command / navigation policy -> `next-command-policy.ts`
- tiny cross-cutting helpers -> `shared.ts`

If the change does not fit cleanly, prefer a new bounded module over growing the existing ones indiscriminately.

Recommended checks:

- `bun test tests/transitions-consolidation.test.ts`

## Performance-sensitive paths

Be conservative in:

- session load/save
- render/sync
- transition reducers
- schema parsing hot paths

Prefer:

- deletion over indirection
- one parse/reshape step over repeated normalization
- explicit branching over speculative helper layers on hot paths

Recommended checks:

- `bun run bench:smoke`

## Full release gate

Before merging any cross-surface or persistence-affecting change:

- `bun run check`
