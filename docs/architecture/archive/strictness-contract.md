> **Historical (pre-v3).** Describes the architecture retired by [skills-first-overhaul-2026-06-12](../../plans/skills-first-overhaul-2026-06-12.md); kept for history. See docs/maintainer-contract.md for the current contract.

# SDK/runtime bridge strictness contract

Scope: `src/adapters/opencode/tool-surface/schemas.ts`, `src/adapters/opencode/tool-surface/runtime-tools/shared.ts`, `src/adapters/opencode/tool-surface/runtime-tools/execution-tools.ts`, `src/runtime/schema.ts`, and the runtime-owned schema modules it composes. This records the current strict bridge between OpenCode tool payloads and runtime schemas after the schema decomposition work while preserving the stable adapter-facing import surface.

## Current state

- `src/runtime/schema.ts` is the stable public schema barrel. Narrower runtime-owned modules hold cohesive schema definitions: `schema-plan.ts` owns plan/planning/session status schemas, `schema-review-decisions.ts` owns reviewer/final-review decision schemas, `schema-worker-result.ts` owns worker result and execution-history schemas, and `schema-session.ts` owns the persisted session schema.
- OpenCode adapter schemas continue to import runtime payload schemas through `src/runtime/schema.ts` unless a reviewed strictness change requires a narrower import. The runtime schema export surface remains stable for existing adapter imports.
- The bridge no longer carries explicit `as any` / `as WorkerResult` arg-shape casts in the scoped files.
- `zod` is pinned to `4.1.8` in this repo to stay aligned with the installed `@opencode-ai/plugin` SDK's effective `zod` version; the Slice 1 refresh on 2026-05-10 confirmed both installed `@opencode-ai/plugin@1.3.10` and latest `@opencode-ai/plugin@1.14.46` declare `zod@4.1.8`.
- Treat that version alignment as part of the bridge contract. If you change either `zod` or `@opencode-ai/plugin`, rerun the bridge verification suite before accepting the change.

## What counts as **no relaxation of strictness**

A change is strictness-preserving only if **all** clauses hold:

1. **Required fields and unions do not widen at the bridge.**
   - Adapter-facing planning payloads reject unknown keys at these object boundaries: outer `flow_plan_apply`, `flow_plan_apply.plan` (`PlanArgsSchema.strict()`), optional `flow_plan_apply.planning` (`PlanningContextArgsSchema.strict()`), and outer `flow_plan_context_record`.
   - This planning strictness is scoped; it is not a global all-tools policy, and intentionally tolerant simple tool schemas remain covered by their own tests.
   - Worker completion continues to be parsed by `WorkerResultArgsSchema`, exported from `src/runtime/schema.ts` and owned internally by `src/runtime/schema-worker-result.ts`, before transition calls.

2. **Runtime parse/validation path is never bypassed.**
   - Runtime tools keep `withParsedArgs(...)` wrappers (`src/adapters/opencode/tool-surface/parsed-tool.ts:8-19`).
   - No direct raw-args path to `applyPlan`, `startRun`, `completeRun`, or `resetFeature`.

3. **No new boundary unsafes.**
   - Do not introduce new `any`, `as any`, `unknown as`, or equivalent bridge casts in scoped files.
   - If a schema alignment problem appears, solve it by dependency alignment first; only add an explicit bridge adapter as a last resort.

4. **Raw object behavior stays explicit and tested.**
   - Top-level worker payload is accepted; nested `result` payload is rejected.
   - Cross-field invalid worker combinations are rejected by runtime schema/transition checks.

5. **Recovery and completion gates stay runtime-owned.**
   - Validation/reviewer/final-review completion gates remain enforced in runtime transitions (`src/runtime/transitions/execution-completion.ts`).
   - Schema refactors may move definitions among runtime-owned `schema-*` modules, but `src/runtime/schema.ts` remains the stable export surface for adapter-facing payload shapes.
   - Bridge refactors must not move those rules into prompt/docs-only logic.

## Semantic parity anchors

Bridge changes must preserve these runtime-owned semantic IDs:
- [semantic-invariant] completion.gates.required_order
- [semantic-invariant] completion.policy.min_completed_features
- [semantic-invariant] decision_gate.planning_surface.binding
- [semantic-invariant] review.scope.payload_binding
- [semantic-invariant] recovery.next_action.binding
- [semantic-invariant] tools.canonical_surface.no_raw_wrappers

## Merge gate for bridge changes

Required checks:

- `bun run check:dependency-contract`
- `bun test tests/config/plugin-surface.test.ts tests/config/tool-schemas.test.ts`
- `bun test tests/runtime-tools.test.ts`
- `bun test tests/runtime/worker-result-contracts.test.ts tests/runtime/final-completion-gates.test.ts tests/runtime/final-review-contracts.test.ts tests/runtime/plan-and-tool-schema-contracts.test.ts`
- `bun test tests/runtime/semantic-invariants.test.ts`
- `bun test tests/recovery-hint-parity.test.ts`
- `bun test tests/docs-semantic-parity.test.ts`
- `bun test tests/schema-equivalence.test-d.ts`

Required quick audit:

- `rg -n "as any|as WorkerResult|unknown as" src/adapters/opencode/tool-surface/schemas.ts src/adapters/opencode/tool-surface/runtime-tools/shared.ts src/adapters/opencode/tool-surface/runtime-tools/planning-tools.ts src/adapters/opencode/tool-surface/runtime-tools/execution-tools.ts`
- `bun pm ls zod`
- Inspect the target `@opencode-ai/plugin` package typings for `tool(...)` raw arg-shape support and tool result support before changing package policy.

Pass condition: no new boundary cast points, and `zod` remains intentionally aligned with the plugin SDK unless a reviewed SDK-boundary change says otherwise.
