# Flow Context Pack

## Summary

- session id: bench-session-10
- goal: Benchmark 10-feature session
- workflow profile: default
- features: 10
- diagnostics: 2
- context quality: 73/100 (adequate)
- readiness: execution_ready
- readiness blocking: 0
- readiness warnings: 2
- next action: Continue the approved plan one feature at a time and keep validation and review evidence aligned with scope.

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

- planned targets: 10
- changed artifacts: 3
- validation commands: 1
- reviewed features: 3
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
- status: in_progress
- file targets: src/feature-4.ts
- review scope: src/feature-4.ts
- verification: bun test feature-4
- changed artifacts: none
- validation commands: none
- reviewer decision: none
- feature review: none
- final review: none
- gaps: none

### feature-5
- title: Feature feature-5
- status: pending
- file targets: src/feature-5.ts
- review scope: src/feature-5.ts
- verification: bun test feature-5
- changed artifacts: none
- validation commands: none
- reviewer decision: none
- feature review: none
- final review: none
- gaps: none

### feature-6
- title: Feature feature-6
- status: pending
- file targets: src/feature-6.ts
- review scope: src/feature-6.ts
- verification: bun test feature-6
- changed artifacts: none
- validation commands: none
- reviewer decision: none
- feature review: none
- final review: none
- gaps: none

### feature-7
- title: Feature feature-7
- status: pending
- file targets: src/feature-7.ts
- review scope: src/feature-7.ts
- verification: bun test feature-7
- changed artifacts: none
- validation commands: none
- reviewer decision: none
- feature review: none
- final review: none
- gaps: none

### feature-8
- title: Feature feature-8
- status: pending
- file targets: src/feature-8.ts
- review scope: src/feature-8.ts
- verification: bun test feature-8
- changed artifacts: none
- validation commands: none
- reviewer decision: none
- feature review: none
- final review: none
- gaps: none

### feature-9
- title: Feature feature-9
- status: pending
- file targets: src/feature-9.ts
- review scope: src/feature-9.ts
- verification: bun test feature-9
- changed artifacts: none
- validation commands: none
- reviewer decision: none
- feature review: none
- final review: none
- gaps: none

### feature-10
- title: Feature feature-10
- status: pending
- file targets: src/feature-10.ts
- review scope: src/feature-10.ts
- verification: bun test feature-10
- changed artifacts: none
- validation commands: none
- reviewer decision: none
- feature review: none
- final review: none
- gaps: none

## Changed Artifacts

- src/feature-3.ts
- src/feature-1.ts
- src/feature-2.ts

## Validation Commands

- bun test

## Context Diagnostics

- warn | missing_repo_profile | Planning context has no repo profile entries. | remediation: Record package manager, build/test commands, framework conventions, and local house rules before relying on the plan.
- warn | missing_research | Planning context has no inspected references. | remediation: Record the source files, tests, docs, configs, or prior decisions inspected during planning.
