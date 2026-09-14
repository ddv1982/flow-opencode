# Offline qualification for the reviewed 8.5.0 planning models

The operator explicitly authorized a provider-free qualification path for this
feature on 2026-09-15, after being told the alternatives were a funded live
campaign or holding the release. This path covers only 8.5.0 and
planning-models-v1. It does not establish live model behavior and is not a
reusable exemption for new features.

## Frozen scope

`scripts/feature-release.ts` pins the reviewed PR #80 commit
c0064dc68cb7f8424ed4d5673b3faad9580d1dac, which is the feature head after the
automated review's stored-preference finding was fixed. Every enumerated picker
and planning source, server configuration adapter, prompt surface, flow-plan and
flow-run guide, package manifest and build/type surface must match that commit's
Git blob and regular-file mode exactly. The commit must remain an ancestor of the
candidate. Any edit, removal, or mode change fails even if a new manifest claims
approval. The approved file list is code-owned, not supplied by the release
record.

Other differences from the fully measured 8.3.0 source must satisfy the existing
patch tooling/documentation allowance. Domain logic, persistence, validation,
review gates, other guides, lockfiles, and unknown paths remain excluded.
Dependencies, engines, package identity and package manager must match 8.3.0.
Formatter settings must match the reviewed feature commit.

## Baseline and assurance

The baseline is 8.3.0, the last release with a live multi-provider campaign and
canary. It is deliberately not 8.4.0. Offline releases never become baselines,
because chaining one onto another would let the newest measured evidence recede
while each record still claimed a qualified parent. `OFFLINE_FEATURE_BASELINE`
holds this invariant and the tests assert that no authorized feature names the
baseline version.

Two releases now sit between the candidate and the last measurement. Nothing in
this record narrows that gap. The 8.3.0 matrix and canary remain baseline
evidence only; they must independently regrade under current verifier authority
and match their tag and artifact.

Candidate assurance consists of reviewed frozen code, full deterministic checks,
all retained gated replays, package checks, and the provider-free OpenCode smoke.
PR #80 also exercised native `/flow-models` rendering and planner routing against
a local synthetic provider, and verified the planner's deny-by-default tool
permissions. These checks do not measure planning quality or coding outcomes.

The feature record binds exact candidate tarball/manifest hashes, names the
reviewed commit and feature, and records the operator's rationale. Generated
release notes state that no candidate live model eval or canary ran, and that no
release after 8.3.0 has been measured live.

## Registry

The authorized features are a fixed list in source, not configuration. Adding one
requires editing `OFFLINE_FEATURES`, review, and merge. A record whose version and
feature pair is absent from that list is refused before any evidence is read, so a
record cannot nominate its own scope, reuse another feature's commit, or advance
to a later version.
