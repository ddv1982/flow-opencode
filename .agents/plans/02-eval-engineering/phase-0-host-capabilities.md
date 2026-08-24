# Phase 0. OpenCode metadata reconnaissance

[Back to overview](overview.md)

## Goal

Prove which pinned-host fields expose actual manager and reviewer model identity,
child-session lineage, and delivered messages before those facts enter the schema.

## Changes

- `scripts/probe-opencode-eval-metadata.ts`. Start the pinned isolated host, run one
  parent and reviewer turn, and emit a redacted field map with endpoint names.
- `tests/live-opencode-smoke.test.ts`. Pin the observed field contract without
  requiring provider credentials in the normal smoke.
- `grounding.md`. Record the supported field path or the precise limitation.

## Data structures

`HostEvidenceCapabilities = observed model identity fields + lineage fields +
unsupported claims`.

## Verification

Static. Focused live-smoke configuration tests and `bun run typecheck`.

Runtime. Run the probe against OpenCode 1.18.6 with a reviewer child session.

Stop gate. If actual reviewer identity is unavailable, continue with an explicit
`unobserved` actor variant and forbid cross-family claims. Never copy the requested
environment value into an observed field.
