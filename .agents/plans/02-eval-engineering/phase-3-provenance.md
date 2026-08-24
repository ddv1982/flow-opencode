# Phase 3. Exact provenance and actors

[Back to overview](overview.md)

## Goal

Compute source, package, evaluator, host, actor, instruction, and transcript
evidence outside the report and bind each attempt to those observed facts.

## Changes

- `evals/provenance.ts`. Add canonical hashing, source and tarball manifests,
  evaluator inputs, host config, normalized gateway/model identity, and redacted
  transcript artifacts.
- `evals/harness.ts`. Capture actor metadata and observed guidance loads through
  the Phase 0 field map.
- `tests/eval-reporting.test.ts`. Cover hash swaps, dirty trees, unobserved actor
  fallback, gateway ids, lazy guidance bytes, transcript retention, and redaction.

## Data structures

`ExpectedProvenance` is computed independently. `ObservedActor` is either a
normalized identity from the host or an explicit `unobserved` value.

## Verification

Static. Focused reporting tests and `bun run check`.

Runtime. Run one paid `happy-path` attempt, read the actual parent and child model
fields, and prove a tarball swap invalidates the externally computed binding.

Stop gate. Cross-family reviewer evidence stays unavailable on hosts that cannot
expose actual child-session identity. Other evidence work may continue.
