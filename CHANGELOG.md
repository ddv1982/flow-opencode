# Changelog

One short line per release. For the full rationale behind each entry, see the
commit history and review evidence.

## [4.1.8] - 2026-06-17

Make Flow command preflight overrule stale OpenCode command lore, with review instructions bundled where skill discovery can lag.

## [4.1.7] - 2026-06-17

Teach Flow's managed skill lore to test, commit, and trigger more precisely while keeping release state and `.flow/**` artifacts guarded by explicit maintainer intent.

## [4.1.6] - 2026-06-16

Make Flow's pinned installer path force-aware, so OpenCode replaces older global plugin entries instead of leaving stale versions behind.

## [4.1.5] - 2026-06-16

Make Flow installation follow OpenCode's native plugin installer, with pre-start skill sync and older-version fallback.

## [4.1.4] - 2026-06-16

Make Flow skill loading restart-aware across every command, add manual sync repair, and treat missing optional helpers as explicit coverage gaps.

## [4.1.3] - 2026-06-16

Sharpen Flow's skill/runtime contract with aligned final-review language, broader gate coverage, CLI smoke tests, and skill-aware preflight routing.

## [4.1.2] - 2026-06-15

Make Flow's skill registry lag visible with restart-aware setup warnings, a doctor command, and a bundled review fallback for stale OpenCode startups.

## [4.1.1] - 2026-06-15

Keep Flow's local session ledger out of Git by default with a generated `.flow/.gitignore`, while preserving opt-in versioning for teams that intentionally archive session evidence.

## [4.1.0] - 2026-06-15

Add Flow-native orchestration handoffs, verification gates, and a hidden verifier worker, inspired by Ray Fernando's parallel agent workflow skill work and RepoPrompt CE's context-engineering approach, while keeping the public runtime surface unchanged.

## [4.0.1] - 2026-06-15

Teach Flow to fan out through named evidence, validation, audit, review, and candidate workers while keeping runtime state changes manager-owned.

## [4.0.0] - 2026-06-14

Breaking overhaul: Flow is now a skills-first plugin with a minimal v4 runtime ledger, seven tools, one active `.flow/session.json`, archived history, embedded review evidence on completion, and no context-pack or separate review-decision framework.
