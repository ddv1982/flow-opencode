# Changelog

One short line per release. For the full rationale behind each entry, see the
commit history and review evidence.

## [Unreleased]

## [4.1.0] - 2026-06-15

- Add Flow-native orchestration handoffs, verification gates, and a hidden verifier worker while keeping the public runtime surface unchanged.

## [4.0.1] - 2026-06-15

Teach Flow to fan out through named evidence, validation, audit, review, and candidate workers while keeping runtime state changes manager-owned.

## [4.0.0] - 2026-06-14

Breaking overhaul: Flow is now a skills-first plugin with a minimal v4 runtime ledger, seven tools, one active `.flow/session.json`, archived history, embedded review evidence on completion, and no context-pack or separate review-decision framework.
