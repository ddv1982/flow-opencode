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

Validation commands are durable and must not contain inline secrets. Raw output
is neither persisted nor projected; the command, exit code, completeness,
output digest, and source binding are the evidence. `broad` means the
repository's canonical applicable gate or a justified equivalent, not merely a
caller label.

An armed capture waits at most 15 minutes for its exact Bash command to begin.
An unrelated Bash command cancels it. Once the exact command begins, the
after-hook remains eligible even if the command finishes after that original
waiting deadline. Session, run, source, exit-code, and output-completeness gates
still apply.

Only exit-zero, complete validation for the review's current source is
applicable. Final review additionally requires broad scope. A source change
during validation prevents recording; a source change after assignment prevents
completion.

Each run has at most one review assignment. The runtime derives `feature` or
`final`; callers do not choose it. The hidden reviewer receives approved plan
context, its full assignment, declared artifacts, assignment-linked validation,
and completed feature IDs. It is workspace-read-only; its allowed Flow tools are
`flow_status` and `flow_feature_complete`, while its guidance restricts status
use to the assigned reviewer view. The platform accepts a new completion only
from the reserved reviewer identity; a caller with tool access may receive the
read-only result of an exact previously accepted completion request. A failed
verdict requires an evidence-backed blocking finding; a passed verdict cannot
contain one.

Result submission is the reviewer's sole lifecycle mutation. `flow_status` may
fail-closed quarantine unreadable active state; that is recovery maintenance,
not a lifecycle transition.

The manager creates and dispatches the assignment, then reads compact status;
it never copies or submits the verdict. A pending assignment may be redispatched
after interruption or an unconfirmed reviewer return. A source-binding failure
instead requires reset, fresh validation, and a new review.
Manager status rechecks workspace content only while a review is pending and
projects `flow_feature_reset` when that assignment's source binding is stale.
If fingerprinting is unavailable, status fails closed with repair guidance and
does not recommend redispatch.
Observed-but-unsubmitted work fails closed. [ADR
0007](adr/0007-reviewer-owned-submission.md) records the rationale.

## Bounded worker waves

Serial means one durable active feature run and one authoritative combined
validation/review chain. The manager works serially by default, but may delegate
two or three exact, non-overlapping slices to one initial `flow-worker` cohort
and at most one targeted follow-up cohort.

Workers contribute only inside their assigned boundary. The manager owns shared
files, integration, evidence acceptance, the combined diff, authoritative
validation, and review dispatch. Ordinary worker edits are allowed so a cohort
can run without approval interruptions; Bash, `.flow` and `.git` metadata
paths, nested delegation, and Flow-state tools are denied. Exact per-assignment
paths remain a prompt contract because one static reusable agent cannot express
a dynamic file ACL; the manager audits assigned versus changed paths after
every cohort. No wave state is persisted; after interruption, ordinary status
and worktree inspection remain authoritative.
[ADR 0006](adr/0006-bounded-intra-feature-waves.md) records the rationale and
rejected heavier designs; the package's `flow-run` guidance is the executable
manager contract.

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

### Commands

| Command | Contract |
| --- | --- |
| `flow-auto` | Drive only the authorized lifecycle. |
| `flow-plan` | Create, revise, or approve a plan. |
| `flow-run` | Run or resume one approved feature. |
| `flow-review` | Internal/recovery dispatch for a runtime-created reviewer assignment. |
| `flow-status` | Project compact durable state and the next action. |

`flow-review` stays in the public inventory because OpenCode dispatches the
reserved reviewer through it and recovery may need it. It is not an ordinary
user starting point.

### Tools

| Tool | Contract |
| --- | --- |
| `flow_guidance` | Load one package-owned guide. |
| `flow_status` | Read compact, execution, detail, or reviewer state. |
| `flow_plan_save` | Create or replace the active draft plan. |
| `flow_plan_approve` | Approve and lock the draft plan. |
| `flow_run_start` | Start one runnable approved feature. |
| `flow_validation_start` | Arm observation of the exact next Bash command. |
| `flow_review_start` | Create the run's independent review assignment. |
| `flow_feature_complete` | Reviewer-only new result submission; exact accepted requests remain read-only replays. |
| `flow_feature_reset` | Supersede a failed attempt for a fresh full retry. |
| `flow_session_close` | Close and archive the session. |

The nine lifecycle tools accept a nested `request`, return state under
`workflowData`, and require the current revision plus a stable operation ID for
mutations. `flow_guidance` instead accepts a guide ID and returns Markdown.

### Guides

| Guide | Contract |
| --- | --- |
| `flow` | Manager orientation and authority boundary. |
| `flow-plan` | Planning and conversational approval. |
| `flow-run` | Serial execution and optional bounded waves. |
| `flow-review` | Independent review of one runtime assignment. |

### Hidden agents

| Agent | Boundary |
| --- | --- |
| `flow-worker` | Bounded implementation contribution; ordinary edits are allowed, while Bash, `.flow` and `.git` metadata paths, external-directory access, skills, delegation, and Flow tools are denied. |
| `flow-reviewer` | Independent workspace-read-only inspection; only `flow_status` and its exact `flow_feature_complete` lifecycle submission are allowed among Flow tools. |

User configuration may select the reviewer's model and step budget with
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

See [Model-driven wave evidence](development.md#model-driven-wave-evidence) for
the manual canary policy.
