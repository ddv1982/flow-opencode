# ADR 0001: Skills-First Minimal Runtime

Date: 2026-06-14

## Status

Accepted. Lifecycle details are superseded by
[ADR 0005](0005-flow-v6-session-v5-simplicity-first.md); the minimal-runtime
direction remains current.

## Decision

Flow keeps only durable workflow state and safety gates in TypeScript. Planning,
implementation, validation judgment, review judgment, and recovery guidance
remain concise package-owned Markdown.

The runtime must not grow into project mapping, readiness scoring, execution
lanes, general worker orchestration, or a second instruction/state system.

## Consequences

- `.flow/session.json` is the sole active workflow document.
- Guidance may evolve without adding persisted protocol fields.
- Safety-critical ordering, validation applicability, independent review, and
  closure remain runtime-enforced.
- A new subsystem must replace existing machinery or justify why guidance and
  the current state machine cannot express the need.
