# F3 local verification

Local implementation passed `bun run check`: 1,144 passed, one opt-in live test
skipped, zero failures, 5,543 assertions across 71 files. See check.log. All 13
committed replay cassettes matched (replay.log). The owner scoped gate passed
291 tests and 1,311 assertions; a separate reviewer reran 27 tests/126 assertions
for the final three fixes.

Independent reviews found and corrected equal-artifact provenance rejection,
fatal retention errors hidden behind retryable failures, inaccurate preflight
dispatch records, unsafe executable version strings, incomplete usage accounting,
and ambient configuration leakage. Final scoped independent review is PASS.

Frozen f10c386 underpowered and powered legacy reports, plan hashes, allocation,
masked statistics and decisions are byte-identical under the new implementation
(legacy-comparison.json). Whole-task resampling preserves between-task variation
where the legacy within-task interval collapses (cluster-comparison.json).

Real baseline and compact tarballs both declare 8.2.1 and load from distinct digest
caches with distinct bundle hashes (real-cache.json). All local cache scratch was
removed. The historical/current artifact manifest passes dry-run; its initial
caseVersion 1 was correctly rejected, then corrected to the current version 2.
Two prospective compact smoke manifests also pass dry-run. Zero provider calls.

New studies expose smoke/descriptive and exploratory whole-task intervals without
claiming power. Fixed-task confirmation retains the existing bounded-pair rule.
Only OpenCode 1.18.6 default provider-path accounting is supported. Token categories
and requested versus observed profiles remain explicit. Money limits are observed
stop thresholds, not guaranteed invoice caps; effective service tier and provider
model behavior are unverified.

No production guide edits, holdout consumption, provider campaign, release, push,
or merge occurred. Human reviewer finding calibration and live qualification
remain pending. No-comments review found useful boundary comments only. Deslop
was unavailable; direct diff, lint, type and independent review were used.

F3 committed locally as `f821b31` after staged preflight passed. Optional gitleaks
was unavailable. No push, merge, or release was performed.
