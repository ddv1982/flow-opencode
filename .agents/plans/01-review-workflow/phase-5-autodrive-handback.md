# Phase 5. Auto-drive handback

Back-link. [Overview](overview.md).

## Goal

A blocked or resetting `/flow-auto` does not go silent. The lease either
prompts one handback turn that pastes the digest, or it warns before it
dies.

## Changes

- `src/platform/opencode/auto-drive.ts`. When `onIdle` would deactivate on
  a non-mechanical projection that is blocked, `flow_feature_reset`, or
  `dispatch-flow-reviewer`, prompt once. The prompt says to call compact
  `flow_status`, print `findingsDigest`, then follow `nextAction` or stop
  at `await-user-direction`. After that prompt, park or stop as now. Do
  not auto-reset. Do not auto-approve.
- `tests/auto-drive.test.ts`. First failed review at idle produces that
  prompt. A second idle at the same revision does not loop. Scope-blocker
  checkpoint still waits, but the first park is preceded by the handback
  prompt if the manager has not already spoken on that revision.
- `docs/adr/0008-bounded-auto-continuation.md`. Record the extra prompt as
  a conversational handback, not a new mechanical route. Keep start and
  close as the only mechanical continuations.

Do not add a status view. Compact already has the digest after phase 2.

## Data structures

Lease may hold `handbackPromptedRevision: number | null` so the one
handback cannot loop. Process-local, like the rest of the lease. Not
Session v5.

## Verification

**Static.** `bun test tests/auto-drive.test.ts`. Typecheck.

**Runtime.** The auto-drive harness in that test file is the surface. Idle
at `blocked` plus `flow_feature_reset` used to deactivate with no prompt.
It must prompt once, then not prompt again at the same revision.
