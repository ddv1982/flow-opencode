# Deslop smell rubric

Use this rubric to turn vague cleanup instincts into reviewable findings.

## Actionable smell classes

- **duplication** — repeated logic or conditionals that must change together. Confirm whether small repetition is clearer than abstraction.
- **bloat** — long function, large class/module, or oversized component whose responsibilities are mixed enough to hide behavior.
- **speculative generality** — unused extension points, factories, options, interfaces, or configuration added for imagined futures.
- **dead code** — unreachable branches, unused exports, stale flags, abandoned helpers, obsolete tests, or comments describing code that no longer exists.
- **primitive obsession** — stringly typed modes, loosely shaped objects, or magic literals that obscure a domain constraint already present elsewhere.
- **shotgun surgery** — one conceptual change requires scattered edits across unrelated modules.
- **feature envy / misplaced responsibility** — code repeatedly reaches into another module's internals instead of using the owning boundary.
- **message chains / excessive delegation** — call chains or wrappers that add no policy and make behavior harder to locate.
- **agent slop** — verbose scaffolding, duplicate defensive branches, generic helper layers, temporary flags, commented-out code, debug output, or invented patterns that do not match the repo.
- **test-oracle slop** — tests that assert implementation trivia, snapshots of noisy markup, or mocks that make broken behavior pass.

## Non-smells until proven

- Repetition that makes two workflows intentionally independent.
- Framework-required shape, generated code, migration history, compatibility shims, or public API affordances.
- Verbose guards protecting data loss, security, lifecycle ordering, or error observability.
- Logging/metrics that operators or tests rely on.
- Local style differences already accepted by the repo and not hurting changeability.

## Finding shape

Each blocking cleanup finding should carry:

```text
class; severity; location; evidence read; refutation checked; why it matters; safe fix shape; validation command
```

Rate as blocking only when the smell materially raises defect risk, blocks planned work, hides behavior, or makes the success claim unverifiable. Style-only cleanup is advisory.
