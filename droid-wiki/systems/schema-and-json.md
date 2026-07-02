# Schema and JSON

Active contributors: ddv1982

## Purpose

The schema system defines Flow's persisted model and tool payload contracts. `src/runtime/schema.ts` uses Zod for the domain model, and `src/runtime/json/strict-object.ts` rejects malformed or duplicate-key JSON before schema validation.

## Directory layout

```text
src/runtime/
├── schema.ts
└── json/
    └── strict-object.ts
```

## Key abstractions

| Abstraction | File | Description |
| --- | --- | --- |
| `SessionSchema` | `src/runtime/schema.ts` | Persisted active or archived session model. |
| `PlanSchema` | `src/runtime/schema.ts` | Persisted approved or draft plan model. |
| `FeatureSchema` | `src/runtime/schema.ts` | Feature id, title, summary, status, targets, validation, dependencies. |
| `WorkerResultSchema` | `src/runtime/schema.ts` | Completion or blocker payload. |
| `parseStrictJsonObject` | `src/runtime/json/strict-object.ts` | JSON parser that reports duplicate keys and non-object roots. |

## How it works

`loadSession` in `src/runtime/workspace.ts` first calls `parseStrictJsonObject`. If parsing succeeds, `SessionSchema.safeParse` validates the version 2 session. If the file is malformed or does not match the current schema, `src/runtime/api.ts` can quarantine it and return recovery instructions.

## Integration points

Tool input schemas in `src/runtime/api.ts` reuse the domain schemas from `src/runtime/schema.ts`. `package.json` exact-pins `zod` because the schema objects are handed through OpenCode's `tool()` runner and should not drift from the tested host boundary.

## Key source files

| File | Purpose |
| --- | --- |
| `src/runtime/schema.ts` | Zod schemas and inferred TypeScript types. |
| `src/runtime/json/strict-object.ts` | Strict JSON parser. |
| `src/runtime/workspace.ts` | Applies strict parsing to sessions on disk. |
| `tests/workspace-persistence.test.ts` | Duplicate-key and malformed JSON tests. |

## Entry points for modification

Change `src/runtime/schema.ts` for model fields and runtime enums. Update `src/runtime/transitions.ts`, [Data models](../reference/data-models.md), and tests when schema changes affect behavior or persisted state.

Related pages: [Session, plan, and feature](../primitives/session-plan-feature.md), [Workspace persistence](workspace-persistence.md), and [Dependencies](../reference/dependencies.md).
