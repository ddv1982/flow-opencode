# Fun facts

This page collects small bits of repository archaeology that help explain where Flow came from.

## Oldest surviving code

Several current files were introduced with the first plugin commit on 2026-03-31 (`c59240e`), including `src/index.ts`, `src/adapters/opencode/plugin.ts`, `src/adapters/opencode/config.ts`, `src/runtime/schema.ts`, and `src/runtime/transitions.ts`. Those files survived the v4 simplification, although their responsibilities narrowed after ADR 0001 in `docs/adr/0001-skills-first-flow-architecture.md`.

## The longest current file

The longest current file is `tests/distribution-and-surface.test.ts`. That size reflects how much of Flow's public contract lives at the OpenCode boundary: managed skills, command prompts, hidden worker permissions, CLI doctor/sync/uninstall behavior, config collision handling, and setup health.

## No TODO trail

A scan for `TODO`, `FIXME`, `HACK`, and `@deprecated` across `src/`, `tests/`, `docs/`, and `skills/` found no matches. Maintenance work is tracked through docs and plan files instead, especially `docs/plan/codebase-review-2026-07-improvement-plan.md`.

## Dependency caution

`zod` is exact-pinned in `package.json`, and `@opencode-ai/plugin` is pinned in dev dependencies while exposed as a peer range. The reason is documented in `docs/maintainer-contract.md`: Zod schema objects cross the plugin and host boundary, while OpenCode compatibility needs a tested peer range.

Related pages: [By the numbers](by-the-numbers.md), [Dependencies](reference/dependencies.md), and [Testing](how-to-contribute/testing.md).
