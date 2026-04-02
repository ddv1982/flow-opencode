# Repository AI Slop Audit

## Duplicated patterns

### Runtime contracts duplicated in tool argument schemas
- Evidence: `src/tools.ts:8-147`; `src/runtime/schema.ts:10-203`
- Why it smells: The plan, worker result, reviewer decision, feature, and completion-policy shapes are defined twice in parallel schema systems. The field names, enums, and defaults largely mirror each other, which creates a two-source-of-truth problem and makes every contract change harder than it should be.
- Simplify: Derive tool argument schemas from the runtime schemas, or move the shared field definitions into one module that both layers compose.
- Confidence: high

### Feature subset validation copied between approval and selection flows
- Evidence: `src/runtime/transitions.ts:426-463`; `src/runtime/transitions.ts:466-503`
- Why it smells: `approvePlan` and `selectPlanFeatures` both re-check unknown ids, filter selected features, walk the filtered set, and reject omitted dependencies with nearly identical control flow. The differences are mostly status updates and error phrasing.
- Simplify: Extract one helper that validates and returns a dependency-consistent feature subset, then let each transition handle only its state changes.
- Confidence: high

### Tool handlers repeat the same load -> transition -> save -> summarize wrapper
- Evidence: `src/tools.ts:268-305`; `src/tools.ts:308-329`; `src/tools.ts:332-353`; `src/tools.ts:356-407`; `src/tools.ts:410-478`
- Why it smells: Most tool handlers differ only by which transition function they call and which success summary they emit. The surrounding `loadSession`, `if (!session)`, `if (!result.ok)`, `saveSession`, and `toJson` steps are copy-pasted across the file.
- Simplify: Introduce a small helper for session-backed commands so each tool only supplies its transition function and response mapper.
- Confidence: high

## Dead abstractions

### Static config builders add indirection around fixed data
- Evidence: `src/config.ts:15-88`; `src/config.ts:90-105`
- Why it smells: `buildAgents`, `buildCommands`, and `createConfigHook` wrap static object literals in extra functions even though the maps never vary and `_ctx` is unused. The abstraction layers do not appear to buy polymorphism, caching, or reuse.
- Simplify: Export constant agent and command maps, merge them directly in `applyFlowConfig`, and drop the unused hook indirection unless runtime context is actually needed later.
- Confidence: high

## Over-engineered helpers

### Completion recovery is encoded as a long branch ladder of object literals
- Evidence: `src/runtime/transitions.ts:206-329`; `src/runtime/transitions.ts:614-667`
- Why it smells: A small decision table is spelled out as a seven-case `if` cascade with repeated `nextCommand`, `retryable`, `autoResolvable`, and reset payload fields. The shape is regular, but the implementation is verbose and branch-heavy.
- Simplify: Replace the ladder with a keyed recovery table or a couple of focused builders for feature-vs-final and validation-vs-review failures.
- Confidence: high

### Markdown rendering is split into many micro-helpers that still feed giant template strings
- Evidence: `src/runtime/render.ts:6-189`; `src/runtime/render.ts:192-299`
- Why it smells: Helpers like `bulletList`, `maybeSection`, `maybeQuotedSection`, `renderOutcomeLines`, and `renderReviewBlock` suggest modularity, but the main renderers still assemble very large string templates full of inline conditionals. The result is both over-factored and hard to scan.
- Simplify: Keep only the helpers that remove real duplication, then rewrite `renderIndexDoc` and `renderFeatureDoc` as smaller explicit section builders.
- Confidence: high

### Session persistence regenerates docs on every save
- Evidence: `src/runtime/session.ts:26-39`; `src/runtime/render.ts:288-302`
- Why it smells: Every state write also performs markdown rendering and filesystem fan-out. For a small runtime this couples persistence, presentation, and disk churn more tightly than necessary, and it broadens the blast radius of every mutation path.
- Simplify: Separate state persistence from doc rendering, or trigger doc generation only from explicit status/report flows.
- Confidence: medium

## Likely AI-generated code smells

### Prompt and command text restate the same workflow rules in multiple long strings
- Evidence: `src/prompts/agents.ts:3-139`; `src/prompts/commands.ts:1-60`; `src/prompts/contracts.ts:1-81`
- Why it smells: The same invariants are repeated across planner, worker, auto, reviewer, and command templates: use runtime tools, do not write `.flow` files directly, validate before completion, and record reviewer decisions. This kind of verbose restatement is common when prompts are expanded by generation instead of being composed from shared fragments.
- Simplify: Pull shared guardrails into reusable prompt fragments and keep each prompt focused on its delta from the common contract.
- Confidence: high

### Detailed schemas are followed by `any`-typed handlers and manual casts
- Evidence: `src/tools.ts:158-493`, especially `src/tools.ts:172-173`, `src/tools.ts:232-233`, `src/tools.ts:272-284`, `src/tools.ts:311-312`, `src/tools.ts:335-336`, `src/tools.ts:359-360`, `src/tools.ts:385-386`, `src/tools.ts:459-460`
- Why it smells: The file spends more than 100 lines describing strict argument shapes, then most `execute` handlers immediately accept `args: any` and cast by hand. That mismatch between elaborate validation and loose downstream typing is a frequent generated-code pattern.
- Simplify: Infer handler input types from the schema declarations or define typed aliases once and remove the repeated `any` casts.
- Confidence: high

## Highest-value simplifications

1. Unify the runtime contract layer so `src/tools.ts` and `src/runtime/schema.ts` stop drifting independently.
2. Replace the repetitive session-backed tool handlers with a small wrapper and typed transition adapters.
3. Collapse `buildCompletionRecovery` into data plus a tiny composer instead of repeating nearly identical recovery objects.
4. Trim the prompt surface by extracting shared Flow rules into common fragments instead of restating them in every agent and command template.
5. Decouple `saveSession` from markdown doc generation so state transitions remain cheap and easier to test.
