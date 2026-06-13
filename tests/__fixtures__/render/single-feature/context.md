# Flow Context Pack

## Summary

- session id: render-single-feature
- goal: Single feature fixture
- features: 1
- diagnostics: 2

## Requirements

- Keep benchmark fixtures deterministic.

## Architecture Decisions

- Use canonical runtime transitions to shape sessions.

## Feature Context

### feature-1
- title: Feature feature-1
- status: pending
- file targets: src/feature-1.ts
- review scope: src/feature-1.ts
- verification: bun test feature-1

## Context Diagnostics

- warn | missing_repo_profile | Planning context has no repo profile entries. | remediation: Record package manager, build/test commands, framework conventions, and local house rules before relying on the plan.
- warn | missing_research | Planning context has no inspected references. | remediation: Record the source files, tests, docs, configs, or prior decisions inspected during planning.
