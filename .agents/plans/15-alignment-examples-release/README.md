# Offline qualification for 9.0.2 same-goal alignment examples

The operator explicitly authorized a provider-free qualification path for this
release on 2026-09-19, after being told the alternative was a funded live
campaign and that this path does not establish live model behavior. This path
covers only 9.0.2 and alignment-examples-v1.

## What this release does

Manager skills treat method or emphasis narrowing, extra evidence, and
"do the research and save the plan" as continuation. Inspect-then-implement,
mixed extra scope, and a replacement goal still stop. The Jev alignment corpus
adds those continue cases and retunes the same-goal score. Jev stays eval-only.
Offline feature qualification may pin bun 1.4.0 against the 8.3.0 live baseline.

No tool, command, setting, or Session v5 field changes.

## Frozen scope

`scripts/feature-release.ts` pins commit
206e3809c224173d67312e0d969870a4f032b8ee, which holds the 9.0.2 package
manifest, README pins and changelog. The frozen list is the 9.0.1 runtime
refactor files plus `skills/flow/SKILL.md` and
`.github/workflows/opencode-compatibility.yml`.

## Baseline and assurance

The baseline is 8.3.0. Manager-skill edits were regraded offline into this
plan's baselines directory, with no model calls.

Candidate assurance is reviewed frozen code, deterministic checks, replay,
package checks, and the provider-free OpenCode smoke. None of these measure
whether models actually continue more often.

## Recommendation for the next release

Fund a live campaign.
