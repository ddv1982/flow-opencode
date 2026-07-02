# Cleanup opportunities

The current repo has no `TODO`, `FIXME`, `HACK`, or `@deprecated` markers in `src/`, `tests/`, `docs/`, or `skills/`. The main cleanup candidates are file size and hotspot review, not obvious dead-code comments.

## Complexity hotspots

| File | Lines | Why it is worth watching |
| --- | ---: | --- |
| `tests/distribution-and-surface.test.ts` | 1,778 | Covers many public surface contracts in one large file. |
| `src/distribution/sync.ts` | 638 | Combines sync, marker parsing, doctor reporting, setup health, and uninstall behavior. |
| `src/runtime/transitions.ts` | 628 | Central state machine and completion gate. |
| `tests/workspace-persistence.test.ts` | 585 | Broad persistence safety coverage. |
| `src/runtime/workspace.ts` | 439 | Filesystem safety, locking, archive, quarantine, and instruction projection in one module. |

## Recent churn hotspots

Git history in the last 90 days shows high churn in historical runtime tests, `CHANGELOG.md`, `README.md`, and surface tests. Many of those files were replaced during the v4 simplification, so current cleanup should focus on present files rather than resurrecting old structures.

## Dependency freshness

Dependabot is enabled in `.github/dependabot.yml`, but `zod` and `@opencode-ai/plugin` are intentionally ignored for automatic npm updates. `docs/maintainer-contract.md` says both should be bumped manually with host-boundary testing.

## Suggested next checks

- Split `tests/distribution-and-surface.test.ts` only if a future change makes a stable contract cluster obvious.
- Keep `src/distribution/sync.ts` behavior-tested before extracting helper modules.
- Avoid splitting `src/runtime/transitions.ts` unless the state machine remains easy to review end-to-end.

Related pages: [By the numbers](by-the-numbers.md), [Patterns and conventions](how-to-contribute/patterns-and-conventions.md), and [Dependencies](reference/dependencies.md).
