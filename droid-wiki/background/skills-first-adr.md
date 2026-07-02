# Skills-first ADR

ADR 0001 in `docs/adr/0001-skills-first-flow-architecture.md` is the central design decision for Flow v4. It was accepted on 2026-06-14 and explains why the runtime is deliberately small.

## Decision

Flow v4 keeps only a minimal runtime ledger and hard completion gates. Planning quality, context gathering, validation judgment, review depth, cleanup guidance, UI quality, and recovery choices live in skills.

## Consequences

The ADR records that v3 sessions and retired tools are not migrated. It removes `flow_context`, context quality, readiness projections, project maps, feature doc drilldowns, lanes, and decision gates. Review decisions are no longer recorded independently; completion payloads carry `featureReview` and `finalReview`.

## Code that implements the decision

| File | Role |
| --- | --- |
| `src/runtime/schema.ts` | Minimal session, plan, feature, validation, and review model. |
| `src/runtime/transitions.ts` | Hard gates only. |
| `src/runtime/api.ts` | Seven tool handlers. |
| `skills/flow/SKILL.md` | End-to-end workflow judgment. |
| `skills/flow-plan/SKILL.md` | Planning judgment. |
| `skills/flow-run/SKILL.md` | Execution and validation discipline. |
| `skills/flow-review/SKILL.md` | Review judgment. |

## Maintenance rule

If a rule needs interpretation, it belongs in `skills/**`. If a rule must never be bypassed for session safety, it belongs in `src/runtime/transitions.ts` or `src/runtime/workspace.ts`.

Related pages: [Runtime state machine](../systems/runtime-state-machine.md), [Managed skills](../features/managed-skills.md), and [Lore](../lore.md).
