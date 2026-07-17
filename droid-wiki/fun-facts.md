# Fun facts

This page collects small bits of repository archaeology that help explain where Flow came from.

## Oldest surviving code

The predecessors of several current files were introduced with the first plugin
commit on 2026-03-31 (`c59240e`) under `src/adapters/opencode/**` and
`src/runtime/**`. Their behavior survived the v4 simplification and moved into
the v5 platform, application, domain, and infrastructure layers.

## The longest current file

The largest files now sit in the domain and persistence test surfaces. The old distribution test shrank substantially when v5 replaced startup skill synchronization with one embedded guidance catalog and a read-only tool.

## No TODO trail

A scan for `TODO`, `FIXME`, `HACK`, and `@deprecated` across `src/`, `tests/`, `docs/`, and `skills/` found no matches. Maintenance work is tracked through docs and plan files instead, especially `docs/plan/codebase-review-2026-07-improvement-plan.md`.

## Dependency caution

`zod` is exact-pinned in `package.json`, and `@opencode-ai/plugin` is pinned in dev dependencies while exposed as a peer range. The reason is documented in `docs/maintainer-contract.md`: Zod schema objects cross the plugin and host boundary, while OpenCode compatibility needs a tested peer range.

Related pages: [By the numbers](by-the-numbers.md), [Dependencies](reference/dependencies.md), and [Testing](how-to-contribute/testing.md).
