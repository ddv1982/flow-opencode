# Flow Context Pack

## Summary

- session id: render-empty-plan
- goal: Empty plan fixture
- features: 0
- diagnostics: 2

## Feature Context

- none

## Context Diagnostics

- warn | missing_repo_profile | Planning context has no repo profile entries. | remediation: Record package manager, build/test commands, framework conventions, and local house rules before relying on the plan.
- warn | missing_research | Planning context has no inspected references. | remediation: Record the source files, tests, docs, configs, or prior decisions inspected during planning.
