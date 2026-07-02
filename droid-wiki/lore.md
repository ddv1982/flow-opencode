# Lore

Flow began on 2026-03-31 as an OpenCode plugin for stateful planning and execution. By 2026-07-01 it had reached Flow 4.2.0, with a much smaller runtime, managed skills, and stronger live smoke coverage.

## Eras

### First plugin shape, Mar 2026

- 2026-03-31: `c59240e` introduced the Flow plugin for OpenCode.
- 2026-03-31: `9f73add` added reviewer-gated execution, a design thread that still exists as `featureReview` and `finalReview` in `src/runtime/schema.ts`.
- 2026-04-01: `fdcaf7f` added GitHub Actions validation, now visible in `.github/workflows/ci.yml`.

### Early runtime hardening, Apr 2026

- 2026-04-03: commits such as `e97b4dc` and `14ffc9b` tightened persistence and schema boundaries.
- 2026-04-05: tag `v0.1.0` marked the first visible release series.
- 2026-04-18: tag `v1.0.0` started the first stable major line.

### Rapid v1 and v2 release cycle, Apr to May 2026

- 2026-04-19 to 2026-05-02: the v1 line moved from `v1.0.1` to `v1.0.59`.
- 2026-05-03: tag `v2.0.0` started the v2 line.
- 2026-05-03 to 2026-06-01: the v2 line advanced through `v2.0.56`, with frequent runtime and docs changes.

### v3 to v4 simplification, Jun 2026

- 2026-06-12: tag `v3.0.0` started the v3 line.
- 2026-06-14: ADR `docs/adr/0001-skills-first-flow-architecture.md` accepted the skills-first minimal runtime.
- 2026-06-14: tag `v4.0.0` marked the breaking simplification: seven runtime tools, `.flow/session.json`, and no v3 compatibility aliases.

### v4 hardening and release polish, Jun to Jul 2026

- 2026-06-17: `2bd42b9` and nearby commits refined command title seeds and package surface tests.
- 2026-07-01: `ae265bd` hardened safety and recovery behavior across `src/runtime/api.ts`, `src/runtime/workspace.ts`, and `src/distribution/sync.ts`.
- 2026-07-01: `a173b69` added host-boundary and packaging confidence, including the live OpenCode smoke in `tests/live-opencode-smoke.test.ts`.
- 2026-07-01: `7aefd0a` released Flow 4.2.0 with recovery gates and live smoke lore.

## Longest-standing features

| Feature | First seen | Still active in |
| --- | --- | --- |
| OpenCode plugin entrypoint | 2026-03-31 | `src/index.ts`, `src/adapters/opencode/plugin.ts` |
| Runtime tools | 2026-03-31, simplified 2026-06-14 | `src/adapters/opencode/tools.ts`, `src/runtime/api.ts` |
| Reviewer-gated completion | 2026-03-31 | `src/runtime/transitions.ts`, `skills/flow-review/SKILL.md` |
| GitHub Actions validation | 2026-04-01 | `.github/workflows/ci.yml` |

## Deprecated and removed ideas

ADR 0001 records the main deprecations on 2026-06-14. Flow v4 removed v3 session migration, `flow_context`, separate review-record tools, context quality, readiness projections, project maps, feature doc drilldowns, lanes, and decision gates. The replacement is the small state model in `src/runtime/schema.ts` and the seven tool handlers in `src/runtime/api.ts`.

## Major rewrites

The largest rewrite was the 2026-06 v4 simplification. Historical churn shows deleted test files such as `tests/runtime-tools.test.ts`, `tests/runtime.test.ts`, and `tests/runtime/final-review-contracts.test.ts`, while current behavior is concentrated in `tests/runtime-gates.test.ts`, `tests/workspace-persistence.test.ts`, and `tests/distribution-and-surface.test.ts`.

## Growth trajectory

The repo has 383 commits through 2026-07-02. Activity peaked in 2026-04 with 199 commits, stayed high in 2026-05 with 98 commits, and shifted in 2026-06 to v4 architecture, skill management, package smoke checks, and release hardening.

Related pages: [Skills-first ADR](background/skills-first-adr.md), [Runtime state machine](systems/runtime-state-machine.md), and [Deployment](deployment.md).
