# Cleanup opportunities

The current repo has no `TODO`, `FIXME`, `HACK`, or `@deprecated` markers in `src/`, `tests/`, `docs/`, or `skills/`. The main cleanup candidates are file size and hotspot review, not obvious dead-code comments.

## Complexity hotspots

| File | Lines | Why it is worth watching |
| --- | ---: | --- |
| `tests/distribution-and-surface.test.ts` | 688 | Covers guidance, plugin, command, permission, and legacy-cleanup contracts. |
| `src/domain/transitions.ts` | 1,212 | Central pure state machine and completion gate. |
| `src/distribution/legacy-cleanup.ts` | ~290 | Deliberately conservative one-time migration code; keep it outside plugin startup. |
| `tests/workspace-persistence.test.ts` | 910 | Broad persistence safety coverage. |
| `src/infrastructure/fs/workspace.ts` | 652 | Filesystem safety, locking, archive, and quarantine in one module. |

## Recent churn hotspots

Git history in the last 90 days shows high churn in historical runtime tests, `CHANGELOG.md`, `README.md`, and surface tests. Many of those files were replaced during the v4 simplification, so current cleanup should focus on present files rather than resurrecting old structures.

## Dependency freshness

Dependabot is enabled in `.github/dependabot.yml`, but `zod` and `@opencode-ai/plugin` are intentionally ignored for automatic npm updates. `docs/maintainer-contract.md` says both should be bumped manually with host-boundary testing.

## Suggested next checks

- Split `tests/distribution-and-surface.test.ts` only if a future change makes a stable contract cluster obvious.
- Keep legacy cleanup recoverable and nofollow-tested; do not generalize it into runtime sync.
- Split `src/domain/transitions.ts` only along domain concepts that preserve
  pure transition review and exhaustive gate coverage.

Related pages: [By the numbers](by-the-numbers.md), [Patterns and conventions](how-to-contribute/patterns-and-conventions.md), and [Dependencies](reference/dependencies.md).
