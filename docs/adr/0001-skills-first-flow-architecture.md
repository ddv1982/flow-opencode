# ADR 0001: Skills-First Minimal Runtime

Date: 2026-06-14

## Status

Accepted.

## Decision

Flow v4 is a breaking simplification. The plugin keeps only a minimal runtime ledger and hard completion gates. Planning quality, context gathering, validation judgment, review depth, cleanup guidance, UI quality, and recovery choices live in skills.

## Consequences

- v3 sessions and retired tools are not migrated.
- Runtime exposes seven tools.
- `.flow/session.json` replaces the v3 active/stored/completed directory layout.
- `flow_context`, context quality, readiness projections, project maps, feature doc drilldowns, lanes, and decision gates are removed.
- Review decisions are no longer recorded independently; completion payloads carry `featureReview` and final `finalReview`.
