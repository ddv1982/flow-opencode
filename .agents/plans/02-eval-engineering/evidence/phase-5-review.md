# Phase 5 review and throughput checkpoint

Phase 5 replaces release authority with explicit v2 report, catalog, and measured
artifact inputs. Every verdict writes a deterministic report-ID decision record.
Release scans committed records, validates the full digest set, rebuilds and
rechecks the exact artifact, and remains intentionally blocked by
`canary-not-enabled` until Phase 9.

Interrogate fixed workflow flag/catalog/artifact mismatches, report-ID record
handoff, full artifact comparison, per-attempt host configuration, catalog hashing,
checksum ordering, and the missing required-case promotion. The final four-model
recheck found no blocker.

Throughput checkpoint:

- The live v2 catalog promotes exactly seven current release cases and leaves
  uncalibrated cases report-only.
- A new scenario needs its scenario definition, release-policy entry when promoted,
  and one policy/test update. It does not require a qualifier branch.
- The historical summary path remains as 39 symbol references across the legacy
  helper tests and 743-line transitional qualifier module. It has no CLI or release
  authority and can be deleted after migration evidence no longer needs comparison.
- The vertical slice passes the full gate. Later phases may proceed.
