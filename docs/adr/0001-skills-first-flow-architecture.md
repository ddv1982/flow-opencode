# ADR 0001: Skills-First Minimal Runtime

Date: 2026-06-14

## Status

Accepted. The runtime tool-count, session-version, and review-recording
consequences are superseded by ADR 0003; the skills-first minimal-runtime
decision remains current.

## Decision

Flow v4 is a breaking simplification. The plugin keeps only a minimal runtime ledger and hard completion gates. Planning quality, context gathering, validation judgment, review depth, cleanup guidance, UI quality, and recovery choices live in skills.

## Consequences

- Unsupported session formats and retired tools are not migrated.
- The runtime originally exposed seven tools; ADR 0003 defines the current
  assignment-based surface.
- `.flow/session.json` replaces the former multi-file
  active/stored/completed directory layout.
- `flow_context`, context quality, readiness projections, project maps, feature doc drilldowns, lanes, and decision gates are removed.
- The original completion-carried review design is superseded by ADR 0003's
  durable review assignments and atomic recorded review executions.
