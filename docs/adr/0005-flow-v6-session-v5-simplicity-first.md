# ADR 0005: Flow v6 and Session v5 Simplicity-First Runtime

Date: 2026-07-20

## Status

Accepted. Supersedes ADR 0003 and ADR 0004.

## Context

Flow's Session v4 lifecycle preserved strong safety properties, but accumulated
parallel ledgers, detached validation receipts, two-pass final review,
correction modes, replay reports, orchestration profiles, admission telemetry,
audit schemas, activation repair, prompt evaluators, and cross-version gates.
The interaction looked simpler while the maintained product grew substantially.

Flow's purpose is narrower: make a plan, run one feature, validate real source,
obtain one independent review, and close durable state.

## Decision

Flow v6 is a breaking subtraction release with Session v5 as its sole active
schema.

- One feature-run aggregate owns attempt state, validation, review, result, and
  artifacts. Status and progress are derived.
- Execution is serial. One run is active and each run receives one review.
- The final feature derives one final review requiring broad validation; it does
  not receive a feature review first.
- Validation is captured from the exact next Bash command and stored directly
  in the session. A crash before persistence means rerunning the command.
- Revision and operation ID provide causal order and exact idempotency. Wall
  clocks have no correctness role.
- A workspace-content fingerprint binds validation, assignment, and completion.
- Fingerprinting requires one readable Git worktree and rejects submodules
  rather than pretending nested repositories are covered.
- Failed review retry is always a fresh full run.
- Close is one convergent operation keyed by session and operation identity.
- The public surface is ten tools, five commands, and one hidden read-only
  reviewer.
- OpenCode's native plugin command and normal npm configuration replace
  Flow-owned installation, activation inventory, cache cleanup, and automatic
  configuration repair.
- Older active sessions must be finished or closed before upgrading. Existing
  archives are inert; there is no active-state compatibility reader.

## Intentional tradeoffs

Flow v6 gives up optional orchestration experiments, machine-canonical audit
ledgers, narrow correction optimization, targeted-then-broad final review,
detached receipt crash recovery, automatic activation repair, replay reports,
and active cross-version migration.

The result may rerun more validation after a crash or failed review. Invalid
configuration and duplicate sources still require manual repair. Those costs
are accepted in exchange for a smaller state model, fewer failure modes, clearer
reviewer scope, less prompt ceremony, and a product that can be understood from
one short contract.

## Guardrail

Future complexity must remove or replace an existing concept. Moving a rule to
another layer, adding a compatibility stack, or creating tests-of-tests does not
count as simplification.
