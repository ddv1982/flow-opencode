# Tool Schema vs Runtime Schema Boundary Design Note

## Status
Deferred architectural cleanup.

## Problem
The codebase currently defines similar contract shapes in two places:

- `src/tools.ts` — OpenCode-facing tool argument schemas built with `tool.schema`
- `src/runtime/schema.ts` — internal runtime/domain schemas built with Zod

This looks like obvious duplication, but the two layers serve different purposes and do not currently share a safe implementation surface.

## Evidence in the current codebase

### Tool boundary (`src/tools.ts`)
The tool layer uses `const z = tool.schema` and builds raw arg shapes for OpenCode tools such as:
- `FlowPlanApplyArgsShape`
- `WorkerResultArgsShape`
- `FlowReviewRecordFeatureArgsShape`
- `FlowReviewRecordFinalArgsShape`

These shapes are consumed by `tool({ args: ... })` and are explicitly tested for SDK compatibility in `tests/config.test.ts`.

### Runtime boundary (`src/runtime/schema.ts`)
The runtime layer uses Zod directly and adds stricter internal rules, for example:
- `WorkerResultSchema` is a discriminated union with cross-field constraints
- `PlanSchema` and `SessionSchema` define normalized runtime state
- parsing here is the authoritative runtime/domain validation step

### Tests that encode the boundary
`tests/config.test.ts` already documents the intended separation:
- raw tool schemas must remain SDK-compatible
- raw tool schemas may accept some structurally valid payloads that runtime schemas reject
- runtime schemas are stricter than tool arg schemas for cross-field rules

That is a strong signal that the duplication is not accidental copy-paste alone; part of it is boundary design.

## Why direct unification is risky
A previous cleanup attempt confirmed the risk.

### 1. Different schema engines / expectations
`tool.schema` comes from `@opencode-ai/plugin`, while runtime validation uses Zod directly.
Even when their APIs look similar, they are not interchangeable enough to be treated as one source of truth without adapter work.

### 2. Different validation goals
The tool layer wants:
- SDK-compatible raw arg shapes
- permissive structural validation at the integration boundary

The runtime layer wants:
- normalized internal domain objects
- stricter semantic validation
- discriminated unions and cross-field refinements

### 3. Tests explicitly rely on the difference
The existing tests intentionally assert that some payloads pass raw tool-schema validation but fail runtime-schema validation. A full unification would either:
- weaken runtime validation, or
- tighten tool-boundary validation and risk breaking the SDK contract/ergonomics

## Recommended design decision
### Keep the boundaries separate for now
Treat the current duplication as **boundary duplication**, not just implementation duplication.

Source of truth should remain split by responsibility:
- `src/tools.ts` owns **integration-boundary raw shapes**
- `src/runtime/schema.ts` owns **internal domain/runtime schemas**

## Safe future improvement options
If you want to reduce duplication later, prefer one of these conservative designs.

### Option A — Shared primitive fragments only (recommended if revisited)
Create a small module that exports only primitive, boundary-safe facts such as:
- feature id regex/message
- enum value arrays from `src/runtime/contracts.ts`
- maybe field-name constants / tiny shape descriptors that are plain data only

Do **not** export full reusable schema objects across the boundary.

This reduces drift on low-level facts while preserving the tool/runtime separation.

### Option B — Runtime schema remains authoritative, tool layer uses explicit adapters
Create explicit conversion/adaptation helpers from raw tool payloads to runtime payloads.

Pattern:
1. tool arg schema accepts SDK-compatible input
2. adapter normalizes/reshapes raw args if needed
3. runtime schema parses the adapted payload

This avoids pretending the two schema surfaces are the same thing.

### Option C — Full unification (not recommended right now)
Only consider this if:
- the OpenCode tool schema surface becomes demonstrably interoperable with Zod
- you are willing to redesign tests and boundary behavior together
- you treat it as a feature/architecture change, not cleanup

## Concrete next steps if revisited
1. Extract only low-risk shared primitives:
   - feature id regex/message
   - shared enum arrays (already mostly centralized in `src/runtime/contracts.ts`)
2. Add one adapter helper for the highest-drift payload first:
   - likely `flow_run_complete_feature`
3. Preserve the existing test contract:
   - raw tool schema remains SDK-compatible
   - runtime schema remains stricter
4. Stop if a change starts forcing the two boundaries to behave identically.

## Recommendation
Do **not** pursue full schema unification as a cleanup pass.

If you want to continue in this area, treat it as a small architecture task with an explicit adapter strategy, not as simple deduplication.
