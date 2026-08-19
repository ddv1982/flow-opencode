# Review-workflow UX

Back-link. This directory is the implementation plan. Do not start until the
user says to.

## Context

A user ran `/flow-auto` on the newest Flow (8.0.0) with a codebase-review
goal. The run felt too thorough. Blockers stopped it before the rest of the
survey finished. At the end there was no clear list of findings.

That is the architecture, not a missed prompt. Flow's aggregate is a change
lifecycle. A finding exists so the next attempt can prove a repair. Compact
status carries routing flags and no finding text. Auto-drive continues only
`ready` plus `flow_run_start`, and `completed` or `closed` plus
`flow_session_close`. The one runtime-owned list is `delivery.report`, and
`deliveryProjection` throws unless a closure is already recorded. `/flow-status`
is the only compiled prompt that dumps findings at a checkpoint. `/flow-auto`
does not load it.

Four independent critiques agreed on that map. ADR 0005 already deleted the
audit ledger. This plan does not bring it back. It derives a findings digest
from `session.runs` that already exist, shows that digest whenever Flow hands
control back, and stops the planner from turning an inspect goal into a fake
implementation DAG.

## Scope

Included.

- A derived findings digest over every attempt of every feature, not only the
  last passing review.
- That digest on compact status and on close delivery.
- A checkpoint and lease-stop utterance that pastes the digest.
- Auto-drive behavior so a first allowed reset or a blocked wait cannot go
  silent.
- Planner and reviewer prompt cuts so inspect-shaped goals do not invent
  fixes or run an unbounded change checklist.
- An eval that fails when `/flow-auto` on an inspect goal produces no
  user-visible findings list.

Excluded.

- Restoring `flow_audit_render`, `audit-ledger.ts`, or any persisted findings
  ledger.
- A persisted intent classifier.
- A new required-at-save plan field. `tests/documentation-contract.test.ts`
  pins today's optional plan fields until a major.
- Changing `adjacent-defect-refused`. Change reviews must still catch a
  planted out-of-scope defect.
- Making Flow a team orchestrator or a multi-repo auditor.

## Constraints

Session v5 stays the only active schema. New complexity must remove or replace
an existing concept, or be a derived projection of canonical run data (ADR
0005). Auto-drive stays process-local and fail-closed (ADR 0008). Prompt
bytes stay under `MAX_TOTAL_PROMPT_BYTES` in `tests/prompt-quality.test.ts`.
Maintained docs stay under the prose budget in
`tests/documentation-contract.test.ts`. Put this plan under `.agents/plans/`
so it does not spend that budget.

A new required plan field is a major. An optional compact field that is
derived at projection time is a widening of an existing view, the same kind
as `blockedFeature.scopeBlocker`.

## Alternatives

1. **Prompt-only.** Tell `/flow-auto` to read detail and narrate findings.
   `/flow-status` already does this. Models following `/flow-auto` still go
   mute. Rejected. Routing that a model must spot in prose is the pattern
   `scopeBlocker` replaced.

2. **Restore the audit ledger.** A second durable document next to Session v5.
   ADR 0005 named that subtraction. Rejected.

3. **Derived digest plus handback paste, then a later inspect kind.** Build
   the report from runs that already exist. Bind it to "Flow is handing
   control back", not only to close. Keep inspect-as-a-kind for a major if
   evals still show the planner inventing a fix DAG. Chosen. It matches
   `deliveryProjection` (derived, not persisted) and does not need a new
   ledger.

## Applicable skills

- `how` before each unfamiliar subsystem (`session-projection`, `auto-drive`,
  eval harness).
- Cursor `create-skill` for any SKILL.md edit.
- `unslop` and `/deslop` on every prose and diff.
- `flow-contribution-check` before commit and push.
- `show-me-your-work` if a phase amends an ADR.

## Phases

1. [Derived findings digest](phase-1-findings-digest.md)
2. [Compact digest field](phase-2-compact-digest.md)
3. [Delivery uses the same digest](phase-3-delivery-digest.md)
4. [Checkpoint paste](phase-4-checkpoint-utterance.md)
5. [Auto-drive handback](phase-5-autodrive-handback.md)
6. [Reviewer budget](phase-6-reviewer-budget.md)
7. [Inspect-shaped planning](phase-7-inspect-planning.md)
8. [Eval](phase-8-eval.md)
9. [Inspect kind, major, only if phases 1 to 8 leak](phase-9-inspect-kind.md)

[Verification commands](testing.md).

## Verification

Project-level.

```bash
bun run check
bun run replay
```

After phase 8 also run the new scenario's unit checks in
`tests/eval-scenario-checks.test.ts`. Paid matrix is not required to land a
phase. It is required before promoting an inspect kind.

## Implementation guidance

- Run the **how** skill over `session-projection`, `auto-drive`, and the eval
  harness before changing them.
- Run **interrogate** before phase 9. Phases 1 to 8 are not a contested design
  once this overview is accepted. Phase 9 is.
- `/deslop` each diff. **unslop** every skill, ADR, and plan edit.
- **show-me-your-work** for phase 5 (ADR 0008) and phase 9 (ADR 0005).
- Cursor **babysit** after the PR that lands each phase. This plan PR is
  documents only.

## Lead judgment

Four critics. Act on the shared structural claims. Do not restore deleted
ledgers.

**Act on.** Findings are retry state, not a report. Compact has no finding
text. Delivery exists only after close and then usually prints `terminal
findings: none` because a pass cannot carry blockers. Auto-drive parks or
dies at the moment a survey has something to say. The planner has no inspect
shape, so it invents a change DAG. The reviewer is measured for misses, not
for a readable list.

**Consider.** Making `flow_feature_reset` mechanical, a reviewer step cap, and
an inspect plan kind. Those wait on phases 1 to 8 and on evals.

**Noted.** Untyped `nextAction` strings in auto-drive. Cross-cutting findings
cannot reopen a passed feature. Positioning.md never says "do not use Flow
to audit a tree."

**Dismissed.** Prompt-only dumps. Rebuilding `audit-ledger.ts`. A persisted
intent classifier. Shipping "just don't use Flow for reviews" as the whole
product answer while `/flow-auto` still accepts that goal.
