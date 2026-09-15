# Offline qualification for the 9.0.0 reviewer command removal

The operator explicitly authorized a provider-free qualification path for this
release on 2026-09-15, after being told the alternative was a funded live
campaign, and after being told that a fourth consecutive offline release is the
weakest claim yet on an exception written for individually reviewed features.
This path covers only 9.0.0 and reviewer-command-removal-v1.

## What this release does

Removes `/flow-reviewer`, which 8.6.0 announced as deprecated, satisfying the
cadence rule that a surface is announced in one release and removed no earlier
than the next major. It also renames the optional TUI module id from
`opencode-plugin-flow.reviewer-picker` to `opencode-plugin-flow.model-picker`,
which is public module identity and therefore held for the major.

The candidate deletes one palette command and changes one identifier string. No
domain logic, persistence, validation, review gate or agent permission changes.
Saved reviewer and planning preferences are read from the same agent options, so
upgrading requires no reselection.

## Frozen scope

`scripts/feature-release.ts` pins commit f2d92b80f9caab422646235e3d3eb7e7e319c361,
which holds the final package manifest, README pins and changelog. The frozen
file list is the same one 8.5.0 and 8.6.0 froze: only the reviewed commit
advances. Every enumerated picker and planning source, server configuration
adapter, prompt surface, flow-plan and flow-run guide, package manifest and
build/type surface must match that commit's Git blob and regular-file mode
exactly.

Nothing in the offline path constrains the major or minor, unlike the patch
path. That is what makes this release mechanically possible; it is not evidence
that it is well measured.

## Baseline and assurance

The baseline is 8.3.0, the last release with a live multi-provider campaign and
canary. Offline releases never become baselines. The retained 8.6.0 seal could
not be reused because the grader closure covers `package.json`, so the version
bump alone invalidated it; the same original 8.3.0 campaign and canary were
regraded offline, with no model calls.

The seal was regraded a second time after a teardown fix in `evals/harness.ts`,
which the grader closure also covers. Neither regrade executed a model, and the
candidate artifact was unaffected: the packed file list does not include the
evaluation harness, so the tarball hash held across both.

**Five releases now sit between this candidate and the last live measurement.**
Nothing in this record narrows that gap, and each offline release widens it.
Candidate assurance is reviewed frozen code, full deterministic checks, all
retained gated replays, package checks, and the provider-free OpenCode smoke.
None of these measure planning quality or coding outcomes.

## Recommendation for the next release

Fund a live campaign. A qualified release becomes a new baseline, which would
reset `OFFLINE_FEATURE_BASELINE`, restore the patch path that has been
unavailable since 8.4.0, and end a disclosure that has grown from one release
behind to five.
