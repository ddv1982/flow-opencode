# Primitives

Active contributors: ddv1982

Flow's core primitives are the session ledger, plan and feature model, and validation and review evidence model. They are defined in `src/runtime/schema.ts` and enforced by `src/runtime/transitions.ts`.

## Primitive map

| Primitive page | What it covers |
| --- | --- |
| [Session, plan, and feature](session-plan-feature.md) | The durable session and feature state model. |
| [Validation and review](validation-and-review.md) | Completion evidence, feature reviews, and final reviews. |

## Why these are primitives

`Session`, `Plan`, `Feature`, `ValidationRun`, `Review`, and `FinalReview` appear across runtime API handlers, transitions, workspace persistence, tests, and skills. They are the common vocabulary between OpenCode commands, hidden workers, and the persisted `.flow/session.json` file.

Related pages: [Schema and JSON](../systems/schema-and-json.md), [Flow loop](../features/flow-loop.md), and [Data models](../reference/data-models.md).
