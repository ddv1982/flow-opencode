# Flow Context Pack

## Summary

- session id: render-single-feature
- goal: Single feature fixture
- workflow profile: default
- features: 1
- diagnostics: 2
- context quality: 73/100 (adequate)
- readiness: blocked_by_context
- readiness blocking: 2
- readiness warnings: 2
- next action: Resolve or explicitly account for the context diagnostics before relying on the next workflow phase.

## Context Quality

- fail | repo_profile | weight: 2 | Repo profile records package, command, framework, or convention context.
- fail | research | weight: 2 | Planning research names inspected files, docs, tests, configs, or contracts.
- pass | feature_targets | weight: 2 | Every feature has planned file targets or review scope.
- pass | planned_verification | weight: 2 | Every feature has planned verification.
- pass | scope_traceability | weight: 3 | Changed artifacts stay within planned file targets or review scope.
- pass | validation_traceability | weight: 3 | Changed artifacts have recorded validation evidence aligned to the plan.
- pass | context_specificity | weight: 1 | Planned targets are specific enough for reviewable handoff.

## Workflow Readiness

- missing_repo_profile | Planning context has no repo profile entries. | remediation: Record package manager, build/test commands, framework conventions, and local house rules before relying on the plan.
- missing_research | Planning context has no inspected references. | remediation: Record the source files, tests, docs, configs, or prior decisions inspected during planning.

## Requirements

- Keep benchmark fixtures deterministic.

## Architecture Decisions

- Use canonical runtime transitions to shape sessions.

## Traceability Summary

- planned targets: 1
- changed artifacts: 0
- validation commands: 0
- reviewed features: 0
- unplanned changed artifacts: none

## Feature Context

### feature-1
- title: Feature feature-1
- status: pending
- file targets: src/feature-1.ts
- review scope: src/feature-1.ts
- verification: bun test feature-1
- changed artifacts: none
- validation commands: none
- reviewer decision: none
- feature review: none
- final review: none
- gaps: none

## Context Diagnostics

- warn | missing_repo_profile | Planning context has no repo profile entries. | remediation: Record package manager, build/test commands, framework conventions, and local house rules before relying on the plan.
- warn | missing_research | Planning context has no inspected references. | remediation: Record the source files, tests, docs, configs, or prior decisions inspected during planning.
