# Parallel orchestration

Active contributors: ddv1982

## Purpose

Parallel orchestration lets a Flow manager fan out evidence, validation, audit, review, candidate implementation, and verification work while keeping state changes serial. The worker definitions live in `src/config-shared.ts`, and the manager guidance lives in `skills/flow/references/parallel-orchestration.md`.

## Directory layout

```text
src/config-shared.ts
skills/flow/references/
├── parallel-orchestration.md
├── parallel-pass-example.md
└── handoff-format.md
```

## Key abstractions

| Abstraction | File | Description |
| --- | --- | --- |
| `FLOW_CORE_AGENTS` | `src/config-shared.ts` | Hidden worker definitions and permission policies. |
| `flow-evidence-worker` | `src/config-shared.ts` | Read-only facts and coverage worker. |
| `flow-validation-worker` | `src/config-shared.ts` | Validation command or check-selection worker. |
| `flow-reviewer` | `src/config-shared.ts` | Read-only review worker for `/flow-review`. |
| Handoff contract | `skills/flow/references/handoff-format.md` | Required worker report shape. |

## How it works

The plugin injects hidden agents into OpenCode config through `applyFlowConfig` in `src/config-shared.ts`. Worker permissions deny Flow state-changing tools and, for most workers, deny edits and native skill loading. Candidate workers can ask for edit and shell permissions, but only when a manager assigns isolated worktrees or exact non-overlapping paths.

The manager records implementation pass decisions explicitly: serial,
candidate exact-path, candidate worktree, tournament, or skipped. Compact pass
records may be included in `flow_feature_complete.orchestrationPasses`; the
runtime aggregates counts and recent pass summaries under
`session.budget.orchestration`, while full worker handoffs stay outside
`.flow/**`.

## Integration points

`skills/flow/SKILL.md`, `skills/flow-plan/SKILL.md`, `skills/flow-run/SKILL.md`, and `skills/flow-review/SKILL.md` all refer to the parallel orchestration references for broad discovery, validation, review, and implementation attempts. The manager remains responsible for claim verification and every `flow_*` state call.

## Key source files

| File | Purpose |
| --- | --- |
| `src/config-shared.ts` | Defines hidden Flow workers and permission maps. |
| `skills/flow/references/parallel-orchestration.md` | The whole pass playbook: when to fan out, pass manifest, handoff acceptance, and claim verification tiers. |
| `skills/flow/references/handoff-format.md` | Worker return contract. |
| `tests/distribution-and-surface.test.ts` | Permission and prompt contract tests. |

## Entry points for modification

Change worker ids, permissions, or prompts in `src/config-shared.ts`. Change manager fan-out judgment in `skills/flow/references/parallel-orchestration.md` and update `tests/distribution-and-surface.test.ts` when permissions or expected worker names change.

Related pages: [Managed skills](managed-skills.md), [OpenCode adapter](../systems/opencode-adapter.md), and [Security](../security.md).
