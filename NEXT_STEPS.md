# Next Steps

## Deferred architecture / cleanup backlog

### 1. Tool schema vs runtime schema boundary
- **Status:** deferred by design
- **Priority:** high
- **Why:** similar payload shapes still exist in `src/tools.ts` and `src/runtime/schema.ts`
- **Risk:** high — crosses the OpenCode `tool.schema` vs runtime Zod boundary
- **Recommended approach:** treat as a design task, not a cleanup pass
- **Concrete next action:** choose a source-of-truth strategy, likely adapters or shared primitive fragments only
- **Reference:** `analysis/tool-runtime-schema-boundary-design.md`

### 2. Schema drift on high-churn payloads
- **Status:** partially mitigated, not solved
- **Priority:** medium-high
- **Why:** worker/reviewer/plan payloads still have parallel definitions
- **Risk:** medium
- **Concrete next action:** prototype a single adapter path for `flow_run_complete_feature`

### 3. Render layer simplification
- **Status:** improved, not fully simplified
- **Priority:** medium
- **Why:** `src/runtime/render.ts` still relies on large markdown assembly functions
- **Risk:** medium
- **Concrete next action:** only if needed, split `renderIndexDoc()` into smaller section builders under existing test coverage

### 4. Session lifecycle separation
- **Status:** boundary clarified, not redesigned
- **Priority:** medium-low
- **Why:** `saveSession()` still synchronously triggers doc generation
- **Risk:** medium
- **Concrete next action:** revisit only if performance or lifecycle complexity grows

### 5. Prompt-layer semantic duplication
- **Status:** reduced, not eliminated
- **Priority:** low-medium
- **Why:** planner/worker/auto prompts still overlap in some instructions
- **Risk:** medium if wording changes break prompt behavior
- **Concrete next action:** continue only when prompt maintenance becomes painful; preserve tested wording

### 6. Convert deferred items into tracked issues
- **Status:** not done
- **Priority:** medium
- **Concrete next action:** create issues or milestone entries for items 1-5

## Definition of done for future follow-up
- design approved before any risky schema-boundary refactor
- behavior preserved under:
  - `bun test tests/config.test.ts`
  - `bun test tests/runtime.test.ts`
  - `bun run check`
- avoid mixing architecture changes with small cleanup passes
