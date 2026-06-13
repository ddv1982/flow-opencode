# Flow Context Pack

## Summary

- session id: bench-session-20
- goal: Benchmark 20-feature session
- features: 20
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

### feature-2
- title: Feature feature-2
- status: pending
- file targets: src/feature-2.ts
- review scope: src/feature-2.ts
- verification: bun test feature-2

### feature-3
- title: Feature feature-3
- status: pending
- file targets: src/feature-3.ts
- review scope: src/feature-3.ts
- verification: bun test feature-3

### feature-4
- title: Feature feature-4
- status: pending
- file targets: src/feature-4.ts
- review scope: src/feature-4.ts
- verification: bun test feature-4

### feature-5
- title: Feature feature-5
- status: pending
- file targets: src/feature-5.ts
- review scope: src/feature-5.ts
- verification: bun test feature-5

### feature-6
- title: Feature feature-6
- status: pending
- file targets: src/feature-6.ts
- review scope: src/feature-6.ts
- verification: bun test feature-6

### feature-7
- title: Feature feature-7
- status: pending
- file targets: src/feature-7.ts
- review scope: src/feature-7.ts
- verification: bun test feature-7

### feature-8
- title: Feature feature-8
- status: pending
- file targets: src/feature-8.ts
- review scope: src/feature-8.ts
- verification: bun test feature-8

### feature-9
- title: Feature feature-9
- status: pending
- file targets: src/feature-9.ts
- review scope: src/feature-9.ts
- verification: bun test feature-9

### feature-10
- title: Feature feature-10
- status: pending
- file targets: src/feature-10.ts
- review scope: src/feature-10.ts
- verification: bun test feature-10

### feature-11
- title: Feature feature-11
- status: pending
- file targets: src/feature-11.ts
- review scope: src/feature-11.ts
- verification: bun test feature-11

### feature-12
- title: Feature feature-12
- status: pending
- file targets: src/feature-12.ts
- review scope: src/feature-12.ts
- verification: bun test feature-12

### feature-13
- title: Feature feature-13
- status: pending
- file targets: src/feature-13.ts
- review scope: src/feature-13.ts
- verification: bun test feature-13

### feature-14
- title: Feature feature-14
- status: pending
- file targets: src/feature-14.ts
- review scope: src/feature-14.ts
- verification: bun test feature-14

### feature-15
- title: Feature feature-15
- status: pending
- file targets: src/feature-15.ts
- review scope: src/feature-15.ts
- verification: bun test feature-15

### feature-16
- title: Feature feature-16
- status: pending
- file targets: src/feature-16.ts
- review scope: src/feature-16.ts
- verification: bun test feature-16

### feature-17
- title: Feature feature-17
- status: pending
- file targets: src/feature-17.ts
- review scope: src/feature-17.ts
- verification: bun test feature-17

### feature-18
- title: Feature feature-18
- status: pending
- file targets: src/feature-18.ts
- review scope: src/feature-18.ts
- verification: bun test feature-18

### feature-19
- title: Feature feature-19
- status: pending
- file targets: src/feature-19.ts
- review scope: src/feature-19.ts
- verification: bun test feature-19

### feature-20
- title: Feature feature-20
- status: pending
- file targets: src/feature-20.ts
- review scope: src/feature-20.ts
- verification: bun test feature-20

## Context Diagnostics

- warn | missing_repo_profile | Planning context has no repo profile entries. | remediation: Record package manager, build/test commands, framework conventions, and local house rules before relying on the plan.
- warn | missing_research | Planning context has no inspected references. | remediation: Record the source files, tests, docs, configs, or prior decisions inspected during planning.
