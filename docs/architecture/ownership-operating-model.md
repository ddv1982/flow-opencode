# Ownership and Operating Model

This document defines lightweight ownership and review expectations for Phase 5 foundations.

## Ownership boundaries

- Core workflow semantics: `src/core/`
- Runtime application + transitions: `src/runtime/`
- Persistence and storage contracts: `src/persistence/`
- OpenCode adapter/tool surface: `src/adapters/`
- Documentation and architecture guidance: `docs/`
- Tests and regression coverage: `tests/`

Default code owner for these areas is defined in `.github/CODEOWNERS`.

## Cross-domain review requirements

When a PR changes more than one domain (for example runtime + persistence, or core + adapters), require review from maintainers responsible for each touched domain before merge.

Minimum expectation:

- Confirm boundary invariants remain intact.
- Confirm tests cover affected contracts.
- Confirm docs are updated when behavior or operator expectations change.

## Weekly architecture triage cadence

Run a short weekly triage (about 20–30 minutes):

1. Review merged PRs that crossed domain boundaries.
2. Capture unresolved architectural risks or drift.
3. Create follow-up issues for deferred cleanup or contract hardening.
4. Reconfirm current ownership boundaries still match the codebase.
