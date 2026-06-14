# Flow Context Pack

## Summary

- session id: render-empty-plan
- goal: Empty plan fixture
- workflow profile: default
- features: 0
- diagnostics: 2
- context quality: 47/100 (weak)
- readiness: blocked_by_context
- readiness blocking: 2
- readiness warnings: 2
- next action: Resolve or explicitly account for the context diagnostics before relying on the next workflow phase.

## Context Quality

- fail | repo_profile | weight: 2 | Repo profile records package, command, framework, or convention context.
- fail | research | weight: 2 | Planning research names inspected files, docs, tests, configs, or contracts.
- fail | feature_targets | weight: 2 | Every feature has planned file targets or review scope.
- fail | planned_verification | weight: 2 | Every feature has planned verification.
- pass | scope_traceability | weight: 3 | Changed artifacts stay within planned file targets or review scope.
- pass | validation_traceability | weight: 3 | Changed artifacts have recorded validation evidence aligned to the plan.
- pass | context_specificity | weight: 1 | Planned targets are specific enough for reviewable handoff.

## Workflow Readiness

- missing_repo_profile | Planning context has no repo profile entries. | remediation: Record package manager, build/test commands, framework conventions, and local house rules before relying on the plan.
- missing_research | Planning context has no inspected references. | remediation: Record the source files, tests, docs, configs, or prior decisions inspected during planning.

## Traceability Summary

- planned targets: 0
- changed artifacts: 0
- validation commands: 0
- reviewed features: 0
- unplanned changed artifacts: none

## Feature Context

- none

## Context Diagnostics

- warn | missing_repo_profile | Planning context has no repo profile entries. | remediation: Record package manager, build/test commands, framework conventions, and local house rules before relying on the plan.
- warn | missing_research | Planning context has no inspected references. | remediation: Record the source files, tests, docs, configs, or prior decisions inspected during planning.
