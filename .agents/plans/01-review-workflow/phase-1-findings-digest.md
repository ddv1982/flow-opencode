# Phase 1. Derived findings digest

Back-link. [Overview](overview.md).

## Goal

One pure function turns a `Session` into the findings list a human can read.
It walks every run of every planned feature. It does not persist. It does not
require a closure.

## Changes

- Add `src/application/findings-digest.ts`. Export `findingsDigest(session)`.
- Add `tests/findings-digest.test.ts`. Cover a failed then passing retry, a
  deferred close of a blocked run, an untouched feature, and a pass that omits
  prior ids.

Do not wire the function into compact or delivery yet.

## Data structures

`FindingsDigest` is a readonly array of rows.

Each row. `featureId`, `findingId`, `severity`, `summary`, `evidence` if
present, `attempt`, `verdict` of the review that last stated it, `live`
boolean.

`live` is true when `livePriorFindings` still holds that id for the feature.
Historical blockers that a later pass dropped stay in the digest with
`live: false`. That is the survey record the last-review strip throws away.

## Verification

**Static.** `bun test tests/findings-digest.test.ts`. `bun run typecheck`.

**Runtime.** No host surface yet. The unit tests are the check. Fixture a
session with two attempts, first failed with F1 blocking, second passed with
no findings. Digest must still list F1 with `live: false`.
