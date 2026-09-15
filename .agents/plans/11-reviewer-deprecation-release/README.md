# Offline qualification for the 8.6.0 deprecation notice

The operator explicitly authorized a provider-free qualification path for this
release on 2026-09-15, after being shown that the alternatives were a funded live
campaign or holding the release. This path covers only 8.6.0 and
reviewer-command-deprecation-v1. It does not establish live model behavior and is
not a reusable exemption.

## Why this release exists

`docs/release-qualification.md` requires a surface that is going away to be
announced in one release and removed no earlier than the next major. The
`/flow-reviewer` deprecation landed on main in #82 but no published version
carried it, so 9.0.0 could not remove the command without stranding anyone
upgrading straight from 8.5.0. This release is that announcement.

It is the third consecutive offline release, which the operator accepted
knowingly. The exception was written for individually reviewed features, and a
deprecation notice is a weaker claim on it than 8.4.0 or 8.5.0 were. Four
releases now sit between the candidate and the last live measurement.

## Frozen scope

`scripts/feature-release.ts` pins commit 4c59cdd3d6a0065f3fc79fabc5e19df3f9004c80,
which holds the final package manifest, README pins and changelog. The frozen
file list is the same one 8.5.0 froze: only the reviewed commit advances, because
this release changes no picker source except one palette title.

Every enumerated picker and planning source, server configuration adapter, prompt
surface, flow-plan and flow-run guide, package manifest and build/type surface
must match that commit's Git blob and regular-file mode exactly. Other
differences from the fully measured 8.3.0 source must satisfy the existing patch
tooling/documentation allowance.

## Baseline and assurance

The baseline is 8.3.0, the last release with a live multi-provider campaign and
canary. It is deliberately not 8.4.0 or 8.5.0. `OFFLINE_FEATURE_BASELINE` holds
that invariant and the tests assert no authorized feature names it.

The retained 8.5.0 seal could not be reused: the grader closure covers
`package.json`, so the version bump alone invalidated it. The same original
8.3.0 campaign and canary were regraded offline into this plan's baselines
directory, with no model calls. That retains existing evidence and produces no
new measurement.

Candidate assurance is reviewed frozen code, full deterministic checks, all
retained gated replays, package checks, and the provider-free OpenCode smoke.
None of these measure planning quality or coding outcomes. Generated release
notes state that no candidate live model eval or canary ran, and that no release
after 8.3.0 has been measured live.

## What this unblocks

9.0.0 may now remove `/flow-reviewer`, the `flow.reviewer.select` command and the
`opencode-plugin-flow.reviewer-picker` module id. See
[10-reviewer-command-deprecation](../10-reviewer-command-deprecation/README.md)
for the exact deletions.
