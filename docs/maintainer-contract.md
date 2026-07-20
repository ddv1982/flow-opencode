# Maintainer Contract

This document defines the small set of invariants Flow v6 must preserve.

## Product boundary

Flow is a serial durable workflow plugin, not a general orchestration framework.
It owns planning state, one active run, observed validation, one independent
review, reset, and closure. Implementation inside that run may use one bounded,
ephemeral host-native worker wave. Flow exposes ten tools, five commands, four
guides, and two hidden subagents.

Flow does not own plugin installation, automatic activation, cache cleanup,
configuration repair, optional worker admission, audit schemas, benchmark
promotion, replay reporting, narrow correction protocols, durable wave state,
worker recovery, concurrent active features, or cross-version active-state
migration.

## Session v5

- Session v5 is the only active schema. Older documents never hydrate as active
  state and old archives never authorize work.
- A plan is a bounded DAG and is immutable after approval.
- A feature run is the canonical attempt aggregate. It contains validation,
  review, result, and artifacts; status and progress are derived.
- At most one run is active. Dependencies must be complete before a run starts.
- A failed review blocks the run. Reset supersedes the selected feature and its
  dependent runs; the next attempt starts empty.
- Completed close is allowed only after every feature has a passing current run.
  Deferred and abandoned close explicitly supersede active work.

## Causality and idempotency

Every accepted mutation advances one nonnegative revision. Mutation requests
carry the expected revision and a stable operation ID. An exact previously
accepted request resolves to the same durable entity at its current projection
without another mutation. Reusing the ID for another kind or payload fails.
Rejected work does not consume the operation ID.

Revision and durable record order are authoritative. Session correctness must
not depend on UTC time, model-provided time, elapsed duration, or timestamp
repair.

## Validation and review

`flow_validation_start` prepares the active run, exact next Bash command, scope,
and current workspace-content digest. The OpenCode after-hook accepts only a
structured exit code, records output completeness and digests the output. The
observation is persisted directly on the run.

Only exit-zero, complete validation for the review's current source is
applicable. Final review additionally requires broad scope. A source change
during validation prevents recording; a source change after assignment prevents
completion.

Each run has at most one review assignment. The runtime derives `feature` or
`final`; callers do not choose it. The hidden reviewer receives compact approved
plan context, the full current feature and assignment, the run's declared
artifacts and validations, and completed feature IDs. It cannot mutate the
workspace or Flow state. A failed verdict requires an evidence-backed blocking
finding; a passed verdict cannot contain one.
Observed-but-unsubmitted work fails closed.

## Bounded worker waves

Serial means one durable active feature run and one authoritative combined
validation/review chain. The manager implements serially by default. It may use
a bounded wave only when it can define two or three genuinely independent
slices with exact, non-overlapping ownership.

- One initial cohort is permitted, followed by at most one targeted cohort for
  a named gap, retry, newly available dependency, or consequential verification.
- The reusable hidden `flow-worker` may edit or run Bash only with host approval.
  External-directory access, skill loading, delegation, and every Flow tool are
  denied. Nested waves are impossible by permission.
- A worker returns a bounded contribution and evidence; it cannot accept
  evidence, approve work, validate the aggregate, dispatch review, or mutate
  lifecycle state.
- The manager owns slice selection, shared and integration files, combined diff
  inspection, evidence acceptance, integration, authoritative validation, and
  review dispatch.
- The hidden `flow-reviewer` remains independent of implementation workers and
  receives only the runtime-created assignment after combined validation.

Wave state is intentionally ephemeral. Flow does not persist a wave manifest,
handoff ledger, telemetry record, admission decision, or recovery protocol in
Session or a sidecar. On restart, ordinary Flow status and worktree inspection
are authoritative; missing coverage is rerun or completed serially. Cohort
eligibility and count are guidance contracts, not runtime admission. Runtime
enforcement remains the worker permission envelope plus the existing one-run,
validation, and review invariants.

## Persistence

- Workspace resolution is canonical and project-scoped.
- `.flow` and managed files are not followed through symbolic links.
- One cross-process project lock protects transactions.
- Session writes validate the complete schema and use atomic replacement with
  durability sync where supported.
- Unreadable active state is quarantined instead of overwritten.
- Close first records the terminal state durably, then publishes a no-overwrite
  archive and clears active state; compact status projects the exact retry
  request needed to converge after interruption.
- Source identity hashes sorted effective workspace path/type/content tuples;
  `.git` and `.flow` are excluded. It is a content fingerprint, not a Git audit
  chain.
- Source identity requires a readable Git worktree and rejects tracked
  submodules explicitly.
- A timed-out project lock fails closed. Automatic stale-lock stealing is not
  allowed because ownership cannot be reclaimed without a race.

## OpenCode surface

Commands:

- `flow-auto`
- `flow-plan`
- `flow-run`
- `flow-review`
- `flow-status`

Tools:

- `flow_guidance`
- `flow_status`
- `flow_plan_save`
- `flow_plan_approve`
- `flow_run_start`
- `flow_validation_start`
- `flow_review_start`
- `flow_feature_complete`
- `flow_feature_reset`
- `flow_session_close`

The hidden agents are exactly `flow-worker` and `flow-reviewer`.
`flow-worker` requires approval for edit and Bash and denies external-directory
access, skill loading, delegation, and all Flow tools. `flow-reviewer` denies
edit, Bash, skill loading, delegation, and all Flow tools except reviewer
status. User configuration may select the reviewer's model and step budget with
`OPENCODE_FLOW_REVIEWER_MODEL` and `OPENCODE_FLOW_REVIEWER_STEPS`.

Duplicate plugin instances for the same canonical project fail closed through a
small process-global guard. Instances for different projects do not conflict.
The guard does not elect a winning version or modify configuration.

## Distribution and release

The public package is loaded through OpenCode's ordinary npm plugin
configuration and native plugin command. Flow ships no installer CLI and
performs no startup activation, cache cleanup, inventory, version election, or
automatic repair.

The deterministic local gate is `bun run check`. CI keeps a normal Linux check,
targeted platform persistence coverage, dependency and workflow checks, a real
OpenCode live smoke, package smoke, and release publication. Removed lifecycle
soaks, prompt evaluators, harness promotion, replay, and cross-version active
session gates must not return without a new ADR that removes an equal or larger
amount of product machinery. Bounded-wave coverage should test the real agent
permissions, manager guidance, and host-visible configuration without adding a
scheduler or tests-of-tests.
