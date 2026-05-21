# Flow Session

## Summary

- session id: render-single-feature
- goal: Single feature fixture
- status: planning
- closure: open
- approval: pending
- next command: /flow-plan
- next step: none
- reviewer decision: none
- created: 2026-01-01T00:00:00.000Z

## Task Progress

- ready | flow-planner | planning | projection: runtime_projection | Planning | next: Review or approve the draft plan. | evidence: features: 1
- pending | flow-worker | execution | projection: runtime_projection | feature-1 — Feature feature-1 | next: Waiting for execution selection. | evidence: file targets: 1, verification: 1

## Plan

- summary: Plan with 1 feature.
- overview: Benchmark fixture plan.
- progress: 0/1 completed
- active feature: none
- completion target: 1/1 features
- stop rule: ship_when_clean
- priority mode: balanced
- final review policy: detailed
- defer allowed: no
- pending allowed at completion: no
- active feature triggers session completion: no

## Requirements

- Keep benchmark fixtures deterministic.

## Architecture Decisions

- Use canonical runtime transitions to shape sessions.

## Features

- feature-1 | pending | Feature feature-1
