# Flow Context Pack

## Summary

- session id: bench-session-5
- goal: Benchmark 5-feature session
- workflow profile: default
- features: 5
- diagnostics: 2
- context quality: 73/100 (adequate)
- readiness: release_ready
- readiness blocking: 0
- readiness warnings: 2
- next action: Use final review, validation evidence, and release hygiene checks to decide whether to cut a release.

## Context Quality

- fail | repo_profile | weight: 2 | Repo profile records package, command, framework, or convention context.
- fail | research | weight: 2 | Planning research names inspected files, docs, tests, configs, or contracts.
- pass | feature_targets | weight: 2 | Every feature has planned file targets or review scope.
- pass | planned_verification | weight: 2 | Every feature has planned verification.
- pass | scope_traceability | weight: 3 | Changed artifacts stay within planned file targets or review scope.
- pass | validation_traceability | weight: 3 | Changed artifacts have recorded validation evidence aligned to the plan.
- pass | context_specificity | weight: 1 | Planned targets are specific enough for reviewable handoff.

## Requirements

- Keep benchmark fixtures deterministic.

## Architecture Decisions

- Use canonical runtime transitions to shape sessions.

## Notes

- Ship the implementation.

## Traceability Summary

- planned targets: 5
- changed artifacts: 5
- validation commands: 1
- reviewed features: 5
- unplanned changed artifacts: none

## Feature Context

### feature-1
- title: Feature feature-1
- status: completed
- file targets: src/feature-1.ts
- review scope: src/feature-1.ts
- verification: bun test feature-1
- changed artifacts: src/feature-1.ts
- validation commands: bun test
- reviewer decision: approved
- feature review: passed
- final review: none
- gaps: none

### feature-2
- title: Feature feature-2
- status: completed
- file targets: src/feature-2.ts
- review scope: src/feature-2.ts
- verification: bun test feature-2
- changed artifacts: src/feature-2.ts
- validation commands: bun test
- reviewer decision: approved
- feature review: passed
- final review: none
- gaps: none

### feature-3
- title: Feature feature-3
- status: completed
- file targets: src/feature-3.ts
- review scope: src/feature-3.ts
- verification: bun test feature-3
- changed artifacts: src/feature-3.ts
- validation commands: bun test
- reviewer decision: approved
- feature review: passed
- final review: none
- gaps: none

### feature-4
- title: Feature feature-4
- status: completed
- file targets: src/feature-4.ts
- review scope: src/feature-4.ts
- verification: bun test feature-4
- changed artifacts: src/feature-4.ts
- validation commands: bun test
- reviewer decision: approved
- feature review: passed
- final review: none
- gaps: none

### feature-5
- title: Feature feature-5
- status: completed
- file targets: src/feature-5.ts
- review scope: src/feature-5.ts
- verification: bun test feature-5
- changed artifacts: src/feature-5.ts
- validation commands: bun test
- reviewer decision: approved
- feature review: passed
- final review: passed
- gaps: none

## Changed Artifacts

- src/feature-5.ts
- src/feature-1.ts
- src/feature-2.ts
- src/feature-3.ts
- src/feature-4.ts

## Validation Commands

- bun test

## Context Diagnostics

- warn | missing_repo_profile | Planning context has no repo profile entries. | remediation: Record package manager, build/test commands, framework conventions, and local house rules before relying on the plan.
- warn | missing_research | Planning context has no inspected references. | remediation: Record the source files, tests, docs, configs, or prior decisions inspected during planning.
