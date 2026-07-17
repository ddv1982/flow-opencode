# Patterns and conventions

Flow keeps code paths explicit. Runtime code enforces only hard safety rules, while package-owned guidance carries planning, validation, review, cleanup, UI, and commit judgment.

## Keep judgment out of runtime

`docs/maintainer-contract.md` says `skills/**` owns planning and review judgment, while `src/**` owns durable state and hard gates. Do not move prompt heuristics into `src/domain/transitions.ts`. If a rule needs interpretation, put it in a skill under `skills/`.

## State changes use the application service

State-changing calls pass through `createFlowService` in the application layer.
It parses inputs with direct Zod schemas, coordinates the `SessionRepository`
port, applies a pure domain transition, and saves or archives the result. The
filesystem repository implementation owns locking and strict persistence.

## JSON is strict

`src/infrastructure/fs/strict-json-object.ts` rejects malformed JSON and duplicate keys before `src/application/schema.ts` validates the session shape. That prevents ambiguous persisted state from being treated as authoritative.

## Error responses include recovery

Transition failures return messages and, when useful, recovery guidance. `responseFromFailure` in `src/application/flow-service.ts` carries those into JSON tool responses. Completion failures also update `lastError` so `flow_status` can report the blocker.

## Session state has one representation

`.flow/session.json` is the sole active-state representation. The config hook
does not read or project it; command guidance calls `flow_status` before acting.

## Tests mirror boundaries

Pure transitions live in `tests/domain-transitions.test.ts`, application/runtime
gates in `tests/runtime-gates.test.ts`, persistence in
`tests/workspace-persistence.test.ts`, host/core wire parity in
`tests/opencode-schema-contract.test.ts`, and platform/distribution surface in
`tests/distribution-and-surface.test.ts`.

Related pages: [Runtime state machine](../systems/runtime-state-machine.md), [Schema and JSON](../systems/schema-and-json.md), and [Testing](testing.md).
