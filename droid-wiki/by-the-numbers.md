# By the numbers

Data collected on 2026-07-17 from the v5 worktree.

## Size

The repository is small but test-heavy. Counts below include the current v5
source and test trees and exclude generated output.

| Category | Count |
| --- | ---: |
| TypeScript source files in `src/` | 32 |
| Test files in `tests/` | 10 |

## Directory size

| Directory | Files | Lines |
| --- | ---: | ---: |
| `src/` | 32 | 7,387 |
| `tests/` | 10 | 4,589 |
| `docs/` | 13 | — |
| `skills/` | 27 | — |
| `.github/` | 4 | 284 |

## Activity

Recent history is concentrated in the v4 rewrite and release hardening work.

| Month | Commits |
| --- | ---: |
| 2026-03 | 9 |
| 2026-04 | 199 |
| 2026-05 | 98 |
| 2026-06 | 68 |
| 2026-07 | 9 |

Top churn hotspots in the last 90 days include removed historical test files as well as current docs and tests:

| Path | Lines changed |
| --- | ---: |
| `tests/runtime-tools.test.ts` | 12,518 |
| `tests/runtime.test.ts` | 7,638 |
| `tests/runtime/final-review-contracts.test.ts` | 6,534 |
| `docs/decisions/decision-log.md` | 6,468 |
| `CHANGELOG.md` | 6,292 |
| `tests/completion-gates.test.ts` | 5,650 |
| `tests/runtime-completion-contracts.test.ts` | 4,752 |
| `tests/config.test.ts` | 4,737 |
| `tests/runtime-summary.test.ts` | 4,328 |
| `README.md` | 3,652 |

## Bot-attributed commits

Git history has 383 commits. 69 commits, or about 18.0%, contain bot co-authorship or bot account markers such as `factory-droid[bot]`, `dependabot[bot]`, `github-actions[bot]`, or `copilot[bot]`. This is a lower bound on AI-assisted work because inline tools do not always leave a Git marker.

## Complexity

| Metric | Value |
| --- | --- |
| Largest source file | `src/domain/transitions.ts`, 1,212 lines |
| Prompt compiler size | `src/prompt-surfaces.ts`, 1,018 lines |
| Workspace persistence size | `src/infrastructure/fs/workspace.ts`, 812 lines |
| Embedded guidance catalog | `src/guidance/catalog.ts`, 308 lines |
| Legacy cleanup utility | `src/distribution/legacy-cleanup.ts`, 296 lines |

The import graph is intentionally shallow. `docs/architecture/allowed-cross-layer-dependencies.md` defines the expected source ownership map, `tests/architecture-boundaries.test.ts` enforces inward dependencies, and `tests/distribution-and-surface.test.ts` checks the public surface through behavior.

Related pages: [Architecture](overview/architecture.md), [Cleanup opportunities](cleanup-opportunities.md), and [Testing](how-to-contribute/testing.md).
