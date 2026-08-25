# Phase 9. Canary and release alignment

[Back to overview](overview.md)

## Goal

Bind tag-only publication to the measured tarball and a current maintainer-run
OpenCode canary without blocking earlier evidence infrastructure work.

## Changes

- `scripts/eval-canary.ts`. Add `prepare` and `record`, a versioned checklist,
  exact-artifact fixture, passed, failed, and incomplete records, expiry, redacted
  transcript/session artifacts, canonical hashes, and the durable path
  `evals/canary/<version>.json`.
- `.github/workflows/release.yml`. Verify on `main` and again in the tag job. Publish
  only tags after rebuilding the tarball and matching its digest to the verified
  decision and `evals/canary/<version>.json` from the tagged commit. The reviewed
  record, tag commit, and operator field form the attestation chain.
- `tests/release-metadata.test.ts`. Delete the major-only exemption and reject
  missing, stale, mismatched, failed, incomplete, or non-verified evidence for any
  release whose packed bytes changed.

## Data structures

`CanaryRecord = status + artifact + checklist version/hash + recorded/expiry times
+ release tag + operator + host + actors + checks + redacted artifact digests`.

## Verification

Static. Release metadata, workflow contract, and full project checks.

Runtime. Prepare and record the exact-artifact canary in OpenCode. Tag dry-run must
rebuild the same tarball hash and preserve deterministic checks in the publish job.

Stop gate. This final phase remains `INCONCLUSIVE` until the maintainer completes
the canary. It does not block Phases 0 through 8.

## Outcome

Infrastructure implemented and verified. Exact-artifact preparation, strict
passed/failed/incomplete records, sanitized evidence, expiry, canary-bound decision
hashes, main dry-run verification, and tag-only strict publication are live. The
prepared fixture loads Flow on OpenCode 1.18.6. The phase remains `INCONCLUSIVE`
because the maintainer-run canary and resulting canary-bound decision are pending;
no release was requested. See `evidence/phase-9-architecture.md`,
`evidence/phase-9-review.md`, and `evidence/phase-9-preparation.json`.
