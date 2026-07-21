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

Flow restores optional host-native waves inside one active feature run:

- Serial remains the default. A manager may delegate only genuinely independent,
  non-overlapping slices to one reusable hidden `flow-worker`, with one initial
  cohort and at most one targeted follow-up. Workers cannot delegate.
- Workers contribute within their assignment; the manager retains integration,
  evidence acceptance, authoritative combined validation, and review dispatch.
- Runtime enforcement stops at the worker permission envelope and the existing
  one-run validation/review boundary. Eligibility and cohort size remain
  guidance, not a scheduler.
- The worker may edit ordinary project files without an approval round trip,
  but Bash, `.flow` and `.git` metadata paths, nested delegation, and Flow tools
  are denied. Exact slice paths remain manager-audited guidance because the
  reusable static agent cannot carry a different host ACL for every assignment.
- Session v5 and the public lifecycle gain no wave state, phase, telemetry,
  recovery protocol, or sidecar.

This amends ADR 0005's root-only edit ownership without changing its serial
durable lifecycle. The package's `flow-run` guide holds the executable slice,
handoff, and convergence rules; the
[maintainer contract](../maintainer-contract.md) records the supported surface
and invariants.

## Consequences

Flow regains parallel contribution for cleanly divisible tasks while retaining
one source of durable truth and one convergence point. Worker output remains a
claim until the manager inspects the aggregate and validates it. The capability
does not itself establish a speed, cost, or quality improvement; those claims
require real canary evidence.

## Guardrail fit

This decision adds no durable lifecycle concept, public tool, command, guide, or
persisted document. One reusable worker replaces the former specialized worker
set, admission profiles, rollout controls, telemetry, ledgers, and promotion
harness.

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
