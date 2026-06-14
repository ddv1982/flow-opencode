# Safe refactor workflow

Refactoring is a behavior-preserving sequence of small changes. This workflow keeps cleanup from becoming an unreviewable rewrite.

## Before editing

- Define the invariant: what behavior, API, schema, command, state path, or visual output must remain unchanged.
- Locate callers and tests before changing the target. If there is no test coverage, add or run the narrowest check that proves current behavior.
- Identify the smallest reversible move: remove dead code, rename, extract, inline, move, consolidate, or split phase.
- Choose a validation command that can fail for the behavior you might break.

## During editing

- Make one structural move at a time, then re-run the relevant check when risk is non-trivial.
- Prefer deleting or inlining a useless layer before introducing a new one.
- Keep names domain-specific. Generic names like `manager`, `processor`, `utils`, and `helper` are suspect unless the repo already owns that vocabulary.
- Avoid mixed commits inside a feature: no unrelated formatting, package churn, comment rewrites, or style sweeps.
- If the refactor uncovers a behavior bug, stop and replan unless the approved feature already includes fixing that bug.

## Validation evidence

Good cleanup evidence includes:

- focused tests for behavior touched by the refactor.
- typecheck/lint/build output for mechanical structure changes.
- before/after references for deleted exports, commands, generated files, and docs when static search is not enough.
- broad validation when shared abstractions, public APIs, persistence, or cross-feature integration changed.

Weak evidence includes:

- "No tests needed" for behavior-adjacent refactors.
- tests that were edited to match the new shape but do not prove the old behavior.
- scanner metrics without human inspection.
- green tests after changing unrelated surfaces not covered by those tests.

## Review checklist

- Every changed artifact maps to the approved cleanup scope.
- The new structure has fewer reasons to change, not just fewer lines.
- Public contracts and compatibility shims remain intact or were explicitly planned.
- Deleted code is actually unreachable or obsolete.
- Validation can catch a realistic mistake in the refactor.
