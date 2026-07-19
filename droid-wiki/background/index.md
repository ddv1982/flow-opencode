# Background

The most important background for Flow is the June 2026 v4 simplification. ADR 0001 moved planning and review judgment into skills and kept runtime code focused on the session ledger and hard gates.

## Pages

| Page | Focus |
| --- | --- |
| [Skills-first ADR](skills-first-adr.md) | Why v4 originally removed earlier runtime concepts and kept seven tools, before ADR 0003 established the current nine-tool assignment surface. |

## Source context

`docs/maintainer-contract.md` and `docs/development.md` restate the same design in maintainer-facing language. `docs/architecture/allowed-cross-layer-dependencies.md` keeps the source dependency map small enough to review manually.

Related pages: [Lore](../lore.md), [Architecture](../overview/architecture.md), and [Patterns and conventions](../how-to-contribute/patterns-and-conventions.md).
