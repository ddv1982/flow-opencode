# Parallel orchestration

Active contributors: ddv1982

## Purpose

Parallel orchestration lets a Flow manager fan out evidence, validation, audit, review, candidate implementation, and verification work while keeping state changes serial. The worker definitions live in `src/config-shared.ts`; `skills/flow/references/parallel-orchestration.md` routes managers to conditionally loaded decision, manifest, execution, and synthesis references.

## Directory layout

```text
src/config-shared.ts
skills/flow/references/
├── parallel-orchestration.md
├── parallel-decision.md
├── parallel-manifest.md
├── parallel-execution.md
├── parallel-synthesis.md
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
| Pass decision | `skills/flow/references/parallel-decision.md` | Fan-out and candidate eligibility judgment. |
| Pass manifest | `skills/flow/references/parallel-manifest.md` | Pre-fan-out coverage and dependency gate. |
| Worker execution | `skills/flow/references/parallel-execution.md` | Named roles, permissions, and launch prompts. |
| Manager synthesis | `skills/flow/references/parallel-synthesis.md` | Handoff accounting, verification, and stopping rules. |
| Handoff contract | `skills/flow/references/handoff-format.md` | Required worker report shape. |

## How it works

The plugin injects hidden agents into OpenCode config through `applyFlowConfig` in `src/config-shared.ts`. Worker permissions deny Flow state-changing tools and, for most workers, deny edits and native skill loading. Candidate workers can ask for edit and shell permissions, but only when a manager assigns isolated worktrees or exact non-overlapping paths.

The manager records implementation pass decisions explicitly: serial,
candidate exact-path, candidate worktree, tournament, or skipped. Bounded pass
records may be included in
`flow_feature_complete.request.result.orchestrationPasses`; the
runtime persists bounded counts and recent pass summaries in the session
ledger, while mutation receipts never substitute for status and full worker
handoffs stay outside `.flow/**`. Candidate accounting records `candidateEligibility`,
`candidateDecision`, and structured `decisionFactors` so `flow_status` can
distinguish serial-required work from eligible candidate work that was skipped.
The full validation rules — valid decision pairings and what counts as
candidate or verifier execution evidence — are canonical in
`skills/flow/references/parallel-decision.md` and
`skills/flow/references/parallel-synthesis.md`.

Managers read the decision reference first. Serial work stops there; manifest
and execution guidance load only after fan-out is selected, and synthesis
guidance loads only after handoffs return. This preserves the full contract
while reducing context on ordinary paths.

## Integration points

`skills/flow/SKILL.md`, `skills/flow-plan/SKILL.md`, `skills/flow-run/SKILL.md`, and `skills/flow-review/SKILL.md` all refer to the parallel orchestration references for broad discovery, validation, review, and implementation attempts. The manager remains responsible for claim verification and every `flow_*` state call.

## Key source files

| File | Purpose |
| --- | --- |
| `src/config-shared.ts` | Defines hidden Flow workers and permission maps. |
| `skills/flow/references/parallel-orchestration.md` | Short routing index for progressive disclosure. |
| `skills/flow/references/parallel-decision.md` | Pass selection and implementation decision pairings. |
| `skills/flow/references/parallel-manifest.md` | Slice, coverage, dependency, and write-scope accounting. |
| `skills/flow/references/parallel-execution.md` | Worker roles, permissions, prompts, and model routing. |
| `skills/flow/references/parallel-synthesis.md` | Handoff acceptance, verification, synthesis, and stopping. |
| `skills/flow/references/handoff-format.md` | Worker return contract. |
| `tests/distribution-and-surface.test.ts` | Permission and prompt contract tests. |

## Entry points for modification

Change worker ids and runtime permissions in `src/config-shared.ts`. Change manager fan-out judgment in `parallel-decision.md`, worker role prose in `parallel-execution.md`, and acceptance rules in `parallel-synthesis.md`. Update `tests/distribution-and-surface.test.ts` when permissions or expected worker names change.

Related pages: [Embedded guidance](embedded-guidance.md), [OpenCode adapter](../systems/opencode-adapter.md), and [Security](../security.md).
