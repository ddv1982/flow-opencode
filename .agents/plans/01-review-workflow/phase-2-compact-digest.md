# Phase 2. Compact digest field

Back-link. [Overview](overview.md).

## Goal

Compact status, the view `/flow-auto` and auto-drive actually read, carries
the digest. A checkpoint no longer requires a detail dump to know what was
found.

## Changes

- `src/application/session-projection.ts`. Add `findingsDigest` to
  `CompactProjection`. Populate it from `findingsDigest(session)`.
- `tests/runtime-gates.test.ts`. Assert the field on a first failed review
  and on a scope-blocker checkpoint.
- Public compact shape. Update `docs/maintainer-contract.md` and any compact
  inventory test if the contract lists compact keys. Do not add a second
  status view.

Empty digest is `[]`, never omitted as a missing key, so callers can branch
on length.

## Data structures

`CompactProjection.findingsDigest` uses the phase 1 type. No Session v5
field. Derived at project time, same family as `blockedFeature` and
`nextAction`.

## Verification

**Static.** `bun test tests/runtime-gates.test.ts tests/findings-digest.test.ts`.
`bun run typecheck`. Documentation contract if the maintainer contract
changed.

**Runtime.** No OpenCode session required. The compact fixture is the
surface. After a failed `flow_feature_complete` in the in-memory harness,
`flow_status { view: "compact" }` returns the blocking summary in
`findingsDigest`.
