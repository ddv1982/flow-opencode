# Patterns and conventions

Flow keeps code paths explicit. Runtime code enforces only hard safety rules, while skills carry planning, validation, review, cleanup, UI, and commit judgment.

## Keep judgment out of runtime

`docs/maintainer-contract.md` says `skills/**` owns planning and review judgment, while `src/**` owns durable state and hard gates. Do not move prompt heuristics into `src/runtime/transitions.ts` or generated instruction projections. If a rule needs interpretation, put it in a skill under `skills/`.

## State changes use the runtime API

State-changing calls should pass through `src/runtime/api.ts`. That layer parses inputs with Zod, acquires the workspace lock through `withSessionLock` in `src/runtime/workspace.ts`, loads the active session, applies a pure transition from `src/runtime/transitions.ts`, and saves or archives the result.

## JSON is strict

`src/runtime/json/strict-object.ts` rejects malformed JSON and duplicate keys before `src/runtime/schema.ts` validates the session shape. That prevents ambiguous persisted state from being treated as authoritative.

## Error responses include recovery

Transition failures return messages and, when useful, recovery guidance. `responseFromFailure` in `src/runtime/api.ts` carries those into JSON tool responses. Completion failures also update `lastError` so `flow_status` can report the blocker.

## Generated files are projections

`.flow/opencode-instructions.md` is rebuildable from `.flow/session.json`. `src/runtime/workspace.ts` writes it on save, refresh, and archive. It should never become an independent state source.

## Tests mirror boundaries

Runtime gates live in `tests/runtime-gates.test.ts`, persistence in `tests/workspace-persistence.test.ts`, and adapter/distribution surface in `tests/distribution-and-surface.test.ts`. Add coverage where the boundary lives rather than making one broad test file carry every concern.

Related pages: [Runtime state machine](../systems/runtime-state-machine.md), [Schema and JSON](../systems/schema-and-json.md), and [Testing](testing.md).
