# Schema and JSON

Active contributors: ddv1982

## Purpose

The schema system defines Flow's persisted model and tool payload contracts. `src/application/schema.ts` uses Zod for the domain model, and `src/infrastructure/fs/strict-json-object.ts` rejects malformed or duplicate-key JSON before schema validation.

## Directory layout

```text
src/application/schema.ts
src/infrastructure/fs/strict-json-object.ts
```

## Key abstractions

| Abstraction | File | Description |
| --- | --- | --- |
| `SessionSchema` | `src/application/schema.ts` | Persisted active or archived session model. |
| `PlanSchema` | `src/application/schema.ts` | Persisted approved or draft plan model. |
| `FeatureSchema` | `src/application/schema.ts` | Feature id, title, summary, status, targets, validation, dependencies. |
| `WorkerResultSchema` | `src/application/schema.ts` | Completion or blocker payload. |
| `parseStrictJsonObject` | `src/infrastructure/fs/strict-json-object.ts` | JSON parser that reports duplicate keys and non-object roots. |

## How it works

`loadSession` first calls `parseStrictJsonObject`. If parsing succeeds,
`SessionSchema.safeParse` validates a version 3 session. Older versions are not
migrated: the application reports them as unsupported and asks the repository
to preserve them in quarantine.

## Integration points

Application input schemas reuse the core schemas in `src/application/schema.ts`
and use Flow's exact-pinned direct `zod` dependency. OpenCode host schemas are a
separate private graph in `src/platform/opencode/tools.ts`, built with the
validator exported by the host SDK. Shared contract fixtures prevent wire
format drift without passing schema objects across the boundary.

## Key source files

| File | Purpose |
| --- | --- |
| `src/application/schema.ts` | Zod schemas and inferred TypeScript types. |
| `src/infrastructure/fs/strict-json-object.ts` | Strict JSON parser. |
| `src/infrastructure/fs/workspace.ts` | Applies strict parsing to sessions on disk. |
| `tests/workspace-persistence.test.ts` | Duplicate-key and malformed JSON tests. |

## Entry points for modification

Change `src/application/schema.ts` for model fields and runtime enums. Update `src/domain/transitions.ts`, [Data models](../reference/data-models.md), and tests when schema changes affect behavior or persisted state.

Related pages: [Session, plan, and feature](../primitives/session-plan-feature.md), [Workspace persistence](workspace-persistence.md), and [Dependencies](../reference/dependencies.md).
