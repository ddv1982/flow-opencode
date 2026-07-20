# ADR 0006: Bounded Intra-Feature Waves

Date: 2026-07-21

## Status

Accepted. Amends ADR 0005; it does not supersede the simplicity-first runtime.

## Context

ADR 0005 made Flow's lifecycle serial and assigned implementation ownership to
the root manager. That removed a large orchestration subsystem, but it also
removed Flow's supported worker role and guidance for asking host-native
subagents to investigate or contribute genuinely independent slices in
parallel.

The useful behavior did not require a Flow scheduler. OpenCode already supplies
subagent execution. Flow needs only a small eligibility, permission, handoff,
and integration contract around that host capability. The durable lifecycle
must remain one approved plan, one active feature run, one authoritative
validation chain, one independent review, and explicit closure.

## Decision

Flow restores optional bounded waves inside one active feature run.

- Serial remains the default. A manager may open a wave only when it can name
  two or three genuinely independent slices with exact, non-overlapping
  ownership.
- One initial cohort is allowed. At most one targeted follow-up cohort may close
  a named gap, retry a failed slice, use a newly available dependency, or verify
  a consequential claim. Workers cannot spawn workers.
- All instances use one reusable hidden `flow-worker`. Edit and Bash require host
  approval. External-directory access, skill loading, delegation, and every
  Flow tool are denied.
- A worker contributes only within its assigned boundary and returns its result
  and evidence to the manager. It cannot accept evidence, approve work, or own a
  lifecycle transition.
- The manager owns lifecycle state, slice selection, shared and integration
  files, combined diff inspection, evidence acceptance, integration, and the
  final result.
- After integration, the manager runs authoritative combined validation through
  the existing observation contract. Only then does the existing hidden
  `flow-reviewer` receive the run's one independent assignment.
- Wave coordination is ephemeral. Session v5 gains no wave fields, concurrent
  run identity, admission record, handoff ledger, telemetry, or recovery state.
  Flow writes no wave sidecar. After interruption, the manager uses existing
  status and worktree inspection, then reruns or finishes missing coverage.

The cohort limit and eligibility test are manager guidance, not runtime
admission. Runtime enforcement is deliberately limited to the worker permission
envelope and the existing single-run validation/review invariants.

This amends ADR 0005's root-only edit ownership: the manager now owns lifecycle,
integration, and acceptance while bounded workers may make disjoint
contributions. It does not amend ADR 0005's one-active-run state model or its
validation, review, reset, closure, installation, and compatibility decisions.

## Consequences

Flow regains visible host-native parallel contribution for tasks that divide
cleanly while retaining one durable source of truth and one convergence point.
Tasks without two independent slices remain serial. Shared contracts, generated
artifacts, and integration-sensitive files remain manager-owned.

The worker role and prompt contract add a small amount of configuration and test
surface. Worker output remains a claim until the manager inspects it and runs
combined validation. Restoring the capability is not evidence of a measured
speed, cost, or quality improvement; any such claim requires real canary data.

## Guardrail fit

This decision replaces the root-only implementation concept with
manager-owned integration plus bounded contributions. It does not add a durable
lifecycle concept, public tool, command, guide, or persisted document. One
reusable worker replaces the former specialized worker set, admission profiles,
rollout controls, telemetry, ledgers, and promotion harness.

Future wave changes must preserve the one-active-run and manager-owned
convergence boundary. A scheduler, durable worker identity, or another public
lifecycle phase requires a separate ADR and an equal or larger removal of
product machinery under ADR 0005's guardrail.

## Rejected alternatives

### Durable wave manifests and recovery ledgers

Persisting slices, worker identities, handoffs, and retries would create a
second execution state machine beside the feature run. Existing status and
worktree inspection are sufficient for restart recovery.

### Concurrent active features

Running multiple plan features durably would require lanes, dependency
scheduling, source ownership, multiple validation identities, merge policy, and
recovery coordination. That is a general orchestration framework rather than an
intra-feature execution convenience.

### Admission profiles, rollout telemetry, and worker promotion

The previous machinery did not spawn workers and did not establish a measured
performance improvement. Static eligibility and permissions provide the needed
safety boundary at much lower cost.

### Recursive or unrestricted delegation

Nested fan-out obscures coverage and ownership. Denying delegation keeps one
manager responsible for every slice and permits at most the explicitly bounded
follow-up cohort.
