# SDK/runtime bridge strictness contract

Scope: `src/tools/schemas.ts`, `src/tools/runtime-tools/shared.ts`, `src/tools/runtime-tools/planning-tools.ts`, `src/tools/runtime-tools/execution-tools.ts`.

## What counts as **no relaxation of strictness**

A change is strictness-preserving only if **all** clauses hold:

1. **Required fields and unions do not widen at the bridge.**
   - `flow_plan_apply` remains `{ plan: PlanArgsSchema.strict(), planning?: PlanningContextArgsSchema.strict() }` (`src/tools/schemas.ts:63-66`).
   - Worker completion continues to be parsed by `WorkerResultArgsSchema` (`src/runtime/schema.ts:293-311`) before transition calls.

2. **Runtime parse/validation path is never bypassed.**
   - Runtime tools keep `withParsedArgs(...)` wrappers (`src/tools/parsed-tool.ts:8-19`).
   - No direct raw-args path to `applyPlan`, `startRun`, `completeRun`, or `resetFeature`.

3. **No new boundary unsafes.**
   - Do not introduce new `any`, `as any`, `unknown as`, or equivalent bridge casts in scoped files.
   - Existing scoped casts are technical debt and may only be reduced or replaced with stricter adapters.

4. **Raw compatibility behavior stays explicit and tested.**
   - Top-level worker payload is accepted; deprecated nested `result` payload is rejected.
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

- `bun test tests/config.test.ts`
- `bun test tests/runtime-tools.test.ts`
- `bun test tests/runtime-completion-contracts.test.ts`
- `bun test tests/runtime/semantic-invariants.test.ts`
- `bun test tests/recovery-hint-parity.test.ts`
- `bun test tests/docs-semantic-parity.test.ts`
- `bun test tests/schema-equivalence.test-d.ts`

Required quick audit:

- `rg -n "as any|as WorkerResult|unknown as" src/tools/schemas.ts src/tools/runtime-tools/shared.ts src/tools/runtime-tools/planning-tools.ts src/tools/runtime-tools/execution-tools.ts`

Pass condition: no new boundary cast points unless paired with new/updated seam tests and an explicit seam-owner sign-off.
