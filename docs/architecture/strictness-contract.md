# SDK/runtime bridge strictness contract

Scope: `src/adapters/opencode/tool-surface/schemas.ts`, `src/adapters/opencode/tool-surface/runtime-tools/shared.ts`, `src/adapters/opencode/tool-surface/runtime-tools/planning-tools.ts`, `src/adapters/opencode/tool-surface/runtime-tools/execution-tools.ts`.

## Current state

- The bridge no longer carries explicit `as any` / `as WorkerResult` arg-shape casts in the scoped files.
- `zod` is pinned to `4.1.8` in this repo to stay aligned with `@opencode-ai/plugin@1.3.10`, which also bundles `zod@4.1.8`.
- Treat that version alignment as part of the bridge contract. If you change either `zod` or `@opencode-ai/plugin`, rerun the bridge verification suite before accepting the change.

## What counts as **no relaxation of strictness**

A change is strictness-preserving only if **all** clauses hold:

1. **Required fields and unions do not widen at the bridge.**
   - `flow_plan_apply` remains `{ plan: PlanArgsSchema.strict(), planning?: PlanningContextArgsSchema.strict() }` (`src/adapters/opencode/tool-surface/schemas.ts:63-66`).
   - Worker completion continues to be parsed by `WorkerResultArgsSchema` (`src/runtime/schema.ts:293-311`) before transition calls.

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

Pass condition: no new boundary cast points, and `zod` remains intentionally aligned with the plugin SDK unless a reviewed SDK-boundary change says otherwise.
