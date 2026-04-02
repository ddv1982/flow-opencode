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

## Pass 3 Scope
- `src/runtime/schema.ts`
- `src/tools.ts`
- new shared shape-helper module if needed
- `tests/config.test.ts` and `tests/runtime.test.ts` as behavior lock

## Pass 3 Smell focus
1. Duplicate field/object schema definitions between runtime schemas and tool arg shapes.
2. Extract shared shape builders for common contracts only.
3. Preserve existing runtime validation strictness and current tool payload compatibility.

## Pass 3 Non-goals
- Do not redesign transition logic.
- Do not change prompt text.
- Do not force top-level tool args to use runtime Zod schemas directly if that risks SDK compatibility.

## Pass 4 Scope
- `src/runtime/transitions.ts`
- `tests/runtime.test.ts` as behavior lock

## Pass 4 Smell focus
1. Replace the long `buildCompletionRecovery()` branch ladder with data-backed helper builders.
2. Keep every error code, resolution hint, and runtime recovery field unchanged.
3. Preserve final-feature vs normal-feature distinctions exactly.

## Pass 5 Scope
- `src/runtime/transitions.ts`
- `tests/runtime.test.ts` as behavior lock

## Pass 5 Smell focus
1. Extract the duplicated feature-subset validation used by `approvePlan()` and `selectPlanFeatures()`.
2. Keep approval vs selection behavior differences intact.
3. Preserve exact user-facing failure messages where they currently differ.

## Pass 6 Scope
- `src/prompts/agents.ts`
- `src/prompts/commands.ts`
- `tests/config.test.ts` as behavior lock

## Pass 6 Smell focus
1. Extract repeated Flow guardrail text into shared prompt fragments/constants.
2. Preserve the effective prompt/template strings exactly where tests or downstream behavior rely on wording.
3. Avoid changing contracts or runtime logic.

## Pass 7 Scope
- `src/runtime/render.ts`
- `tests/runtime.test.ts` as behavior lock

## Pass 7 Smell focus
1. Reduce nested inline conditionals in the render helpers without changing emitted markdown.
2. Prefer simpler section assembly over larger template-string expressions.
3. Keep file output, headings, and formatting stable under the existing render tests.
