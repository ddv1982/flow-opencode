# AI Slop Cleanup Plan

## Scope
- `src/config.ts`
- `tests/config.test.ts` verification only unless a narrow regression gap appears

## Smell focus
1. Dead / needless abstraction: `buildAgents()` and `buildCommands()` wrap fixed object literals.
2. Keep behavior unchanged: same injected agents, commands, prompts, and read-only tool flags.
3. Avoid broad refactors from the audit in this pass.

## Ordered pass
1. Run targeted config tests as a behavior lock.
2. Replace static builder functions with exported constant maps or equivalent direct literals.
3. Keep `applyFlowConfig` and `createConfigHook` behavior unchanged.
4. Rerun targeted tests, then full `bun run check`.

## Non-goals
- No changes to `src/tools.ts`, runtime transitions, or prompt text in this pass.
- No new dependencies.
- No schema consolidation yet.

## Pass 2 Scope
- `src/tools.ts`
- `tests/runtime.test.ts` verification lock only unless a narrow gap appears

## Pass 2 Smell focus
1. Duplicate wrapper flow: load session -> missing-session response -> transition -> error response -> save -> summary.
2. Keep tool payloads and response shapes unchanged.
3. Reduce repetition without moving business logic out of transition functions.
