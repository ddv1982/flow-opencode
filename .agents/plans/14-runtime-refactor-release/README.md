# Offline qualification for the 9.0.1 runtime refactor

The operator explicitly authorized a provider-free qualification path for this
release on 2026-09-18, after being shown that the alternatives were a funded
live campaign or holding the release, and after being told that this entry
freezes most of the runtime rather than one reviewed feature. This path covers
only 9.0.1 and runtime-refactor-v1.

## What this release does

Phases 0 to 4 of [13-runtime-refactor](../13-runtime-refactor/README.md), merged
as #88 to #92. The application, persistence and auto-drive layers are split by
responsibility, with one source of truth for session validation and review
readiness. No tool, command, setting or session field changes, and `.flow`
session files written by 9.0.0 load unchanged.

Two behavior changes are deliberate and were planned:

- The plugin validates its workspace when it loads instead of on the first tool
  call, logging the reason before it refuses. Starting OpenCode with the
  filesystem root or a home directory as the project now fails at load.
- An identical repeat of `flow_feature_complete` returns the same bytes as
  before, taking the session lock once rather than reading before it.

## Frozen scope

`scripts/feature-release.ts` pins commit 8d275b7b02708e1a2a9cde65c03029a0f074f373,
which holds the final package manifest, README pins and changelog.

Unlike every earlier entry, this one cannot reuse a prior file list. The refactor
touched most of `src/`, so the frozen list names all twenty-nine runtime files
that differ from the 8.3.0 baseline, plus the two guides, the manifest and the
build and packaging surface. Every one must match that commit's Git blob and
regular-file mode exactly, and other differences from 8.3.0 must satisfy the
existing patch tooling and documentation allowance.

**This is the weakest claim yet on the exception.** It was written for a single
individually reviewed feature with a small frozen surface; 8.4.0 and 8.5.0 froze
thirteen files. "Reviewed code" here means five whole-branch reviews and thirteen
task reviews recorded in #88 to #92, not a diff a reader can hold in their head.

## The freshness change this release required

A canary expires seventy-two hours after it is recorded, and that window was
checked against the wall clock everywhere, including where an offline release
cites a baseline it explicitly does not claim to have measured. The 8.3.0 canary
expired on 2026-09-16, so on 2026-09-18 no offline release could be sealed or
verified against it, and the already published 8.4.0, 8.5.0, 8.6.0 and 9.0.0
records could no longer be re-verified either. Retained evidence had been made to
rot.

Freshness is now stated by the caller. The release being published still needs a
canary inside its window; a baseline that a patch or feature record only cites is
read as it stood when it was recorded. Nothing else is relaxed: a future date, a
failed checklist, a mismatched artifact, a broken digest or unreadable evidence
still refuse.

This deliberately removes the only mechanism that forced a live measurement every
three days. What remains is the reviewed `OFFLINE_FEATURES` entry each offline
release needs, which is a source change that must be reviewed and merged, and the
disclosure every record carries. The honest summary is that the exception is now
bounded by review alone.

## Baseline and assurance

The baseline is 8.3.0, the last release with a live multi-provider campaign and
canary. Offline releases never become baselines. The retained 9.0.0 seal could not
be reused: the grader closure covers `scripts/eval-canary.ts` and
`scripts/qualify-release.ts`, which the freshness change edits. The same original
8.3.0 campaign and canary were regraded offline into this plan's baselines
directory, with no model calls.

**Six releases now sit between this candidate and the last live measurement**, and
the mechanism that used to make that gap uncomfortable has been removed. Candidate
assurance is reviewed frozen code, 1251 deterministic tests, all retained gated
replays, package checks, and the provider-free OpenCode smoke. None of these
measure planning quality or coding outcomes.

## Recommendation for the next release

Fund a live campaign. It would reset `OFFLINE_FEATURE_BASELINE`, restore the patch
path that has been unavailable since 8.4.0, and end a disclosure that has now
grown from one release behind to six. This recommendation stood in the 9.0.0 plan
and was not taken; it is stronger here, because the timer that used to enforce it
is gone.
