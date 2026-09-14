# Baseline-qualified patch releases

This policy adds a limited path alongside full qualification. The operator
explicitly authorized it on 2026-09-14. It does not change historical grades.

## Eligibility

A stable version must advance within a fully qualified baseline's major/minor.
Every candidate is compared directly with that baseline's measured source, never
just the previous patch. The baseline tag must resolve to the recorded commit,
contain the measured source commit, and be an ancestor of the candidate.

Runtime source, lockfiles, dependencies, package exports, package scripts,
engines, build configuration, and all guides other than flow-run must remain
unchanged. Package metadata may change only its version. Only enumerated release
scripts/workflows, offline evals, tests, plan records, documentation, and .gitignore
may otherwise differ. Unknown paths fail. Only adding the sealed patch-baseline directory to formatter exclusions is
allowed in biome.json; all other settings must match. The build and packaging helpers are
outside the allowlist. A new category requires an explicit reviewed policy change.

The only shipped guide exception is a reviewed flow-run clarification. Its exact
content digest and rationale must be recorded. The reviewer must confirm that it
clarifies an existing obligation without changing permissions, workflow gates,
validation, review requirements, or closure guarantees. Code cannot infer that
semantic judgment from a path or a patch version. A content change invalidates
that approval. This is a maintainer review control, not a sandbox against someone
who can rewrite the policy and its approvals together.

## Evidence

A record at evals/qualification/patches/VERSION.json uses schemaVersion 1 and kind
baseline-qualified-patch. It contains the candidate's exact tarball and unpacked
manifest hashes, its version, the baseline artifact identity, tag commit, canary
path and regraded bundle hash, approvedBy, rationale, and any guidance approval.
The PatchReleaseSchema in scripts/patch-release.ts is the executable format.

The baseline must independently pass the full verifier at release time. Existing
seven-day campaign and 72-hour canary limits remain unchanged. A patch record
cannot stand in for a fully qualified baseline, extend freshness, or invent runs.
An expired baseline blocks; it never starts a paid campaign automatically.

The candidate has no new model eval or live model canary. Required assurance is
clean source, strict diff eligibility, matching package bytes, review of the
clarification, deterministic checks, replay, package smoke, provider-free pinned
OpenCode smoke, and green CI. These checks do not establish model behavior on the
new candidate. This reduced assurance must be visible in release notes.

Offline verifier changes may require resealing the original retained baseline
campaign under current verifier authority. Keep original provider evidence and
seals unchanged; place the new seal alongside them in a separate bundle directory.
Only that new directory is passed to patch verification, avoiding ambiguous seals.

## Publication

The release workflow chooses --patch only when the version's explicit record
exists; otherwise it uses --canary and the original full route. A malformed patch
record fails; it never silently falls back. Both flags together are rejected.

release.ts init and resume independently recheck the same evidence choice. The
persistent release record binds the patch file's digest through bundleSha256 and
stores its path in the optional patch field. Existing full records stay valid.
Candidate notes identify the policy, prior version, prior package/bundle/canary,
and state that prior passes are not candidate measurements. Recovery still checks
exact payloads, Git refs, remote assets, and npm integrity before mutations.

No --skip-evals flag, environment bypass, altered old report, or fake candidate
canary is used. Updating this policy does not itself publish or authorize spend.

## Current candidate

8.3.1 contains the reviewed baseline capture/inventory clarification from PR #75.
The independent reviewer already required that inventory. Core source, dependencies,
build settings, and review authority are unchanged. PRs #73/#74 improve release
recovery and spending guards; #76 adds offline reporting. The intended release
notes must describe the spending guard as a top-level dispatch limit, not a token
or billing ceiling. The 8.3.0 matrix's 76/76 result belongs to 8.3.0 only.

The regression suite checks version boundaries, protected paths, dependency
changes, guide hash substitution, dirty source, changed runtime, moved baseline
tags, stale evidence, and mismatched seals. Existing publication recovery tests
continue to exercise unchanged transport convergence. No paid runs are authorized.
