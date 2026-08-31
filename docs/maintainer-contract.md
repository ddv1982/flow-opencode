# Maintainer Contract

This document defines the small set of invariants Flow must preserve.

## Product boundary

Flow is in preview. [Positioning](positioning.md) owns the audience and the cases
Flow is the wrong tool for, and [what Flow guarantees](guarantees.md) is the public
map of which claims are TS-enforced, host-attested, caller-declared, model-judgment,
or unenforced. A claim in neither a test nor a scheduled eval is unmeasured and is
labelled so there.

The public surface — tools, commands, guides, agents, and the Session v5 shape —
stays frozen while those guarantees are measured; additive optional fields are
allowed, and a removal or rename waits for a major announced one release ahead.
A new required-at-save plan declaration is a major. `evidence` entries own
`scope`, `platform`, and `assertions`; named commands bind `.flow/results.xml`.
Do not add another evidence field to close a measured cheat.
[Release qualification](release-qualification.md) owns the thresholds and cadence.

Flow is a serial durable workflow plugin, not a general orchestration framework.
It owns planning state, one active run, observed validation, one independent
review, reset, and closure. Implementation inside that run may use one bounded,
ephemeral host-native worker wave. Flow exposes ten tools, five commands,
four guides, and two hidden subagents. Active work uses only the root manager
and the reserved `flow-worker` and `flow-reviewer` roles; generic agents are not
part of the Flow execution model.

An active Flow session is authoritative for its goal until an explicit close
records completed, deferred, or abandoned disposition. The manager must not
silently continue that goal through an ordinary non-Flow workflow. Runtime
`nextAction` is durable default workflow direction, not a new permission grant.
Environment-sensitive transition guards remain authoritative when a mutation is
attempted.

Before every manager-owned lifecycle mutation, including direct `/flow-plan` or
`/flow-run` use, the manager compares the compact-projected goal with the current
request. Exact projected recovery of an already-accepted close runs first and
grants no authority for new work. The comparison is a semantic judgment made by
the manager, not a runtime intent classifier. A continuation or compatible
narrowing may proceed. A materially new or expanded request causes no mutation
and has not started; the manager offers to continue, defer, or abandon the
active work. A completed but unclosed session is closed as completed before a
new request begins. A same-goal approved plan-only request reports the immutable
plan and current progress, then stops without saving, approving, or starting a
run.

Within existing implementation authority, the manager continues after plan
approval and each passing feature outcome. Under `/flow-auto`, compact `ready`
and `completed` projections are mechanical loop states, not user handoffs: the
manager starts the next runnable feature or closes the session in the same
authorized auto drive. An internal host-triggered continuation may cross model
turns from idle only after a same-host accepted non-replayed `flow_plan_save`
establishes the created Flow session. For an active provisional baseline,
temporal progress in that same session lets a dispatched pending reviewer submit
its owned result without pretending reviewer submission is manager provenance.
An unchanged already-ready baseline or replacement session fails closed.
Planning awaiting `flow_plan_approve` and any
`await-user-direction`, whether blocked or ready, remain conversational
checkpoints. A clarification ending at the same recognized checkpoint revision
re-arms waiting without auto-routing; a reply resumes only after it advances the
same session to a mechanical state through an accepted non-replayed manager
mutation observed in that OpenCode host session. The mutation is credited only
when the tool assistant ID resolves through the cached `message.updated`
`parentID` to the authoritative user reply; a missing mapping or mismatch fails
closed. Another host cannot establish that reply authority, though a reviewer
child may contribute only the one state-constrained successor revision after an
authenticated `flow_review_start`; every other mechanical projection must equal
the credited mutation revision. Compaction transfers authority only
after the same host authenticates the trigger assistant → automatic compaction
marker → summary assistant → successor user lineage while the captured
authority remains unchanged. Missing, stale, or unrelated lineage fails closed.
This provenance remains process-local and adds no Session v5 field. Flow never
returns “ready for the next feature” while that proven lease can safely start
it.

`/flow-auto stop` and `/flow-auto cancel` revoke only the process-local lease in
that OpenCode session. They do not mutate or close the durable Flow session.

Initial auto/run prompts, compaction context, and synthetic continuations share
one concise manager kernel: root ownership of manager mutations and
reviewer-owned result submission, reserved Flow roles, the exact
`failedReviewCount === 1` retry gate, and current-source plus relevant base-diff
evidence. This
repetition adds no runtime role registry or durable policy state.

A feature whose latest relevant reviewed outcome remains failed is never
selected implicitly. `/flow-auto` may continue an untouched,
dependency-independent feature; when only retry-required candidates remain,
compact status is `ready` with `await-user-direction`. An automatic fresh full
retry is allowed only as the Session v5 convergence bound below permits. At a
blocked checkpoint, optional `nextFeatureId` on `flow_feature_reset` names the
exact authorized retry or independent feature, and reset plus run start occur in
one transaction. If that reset selects independent work, then all untouched work
finishes, the failed run is already superseded; ready `await-user-direction`
resumes an authorized retry through
`flow_run_start(featureId)`, not another reset. The session remains authoritative
while waiting. Flow otherwise pauses only for a material product or scope
choice, missing authority for an external Git or release action, a hard
operational failure, or the user's explicit choice of deferred or abandoned
closure. Only the user may select either non-completed disposition.

Flow does not own plugin installation, automatic activation, cache cleanup,
configuration repair, optional worker admission, audit schemas, benchmark
promotion, replay reporting, narrow correction protocols, durable wave state,
worker recovery, concurrent active features, or cross-version active-state
migration. It also owns no persisted request-intent classifier, retry counter,
or delivery document.

## Session v5

- Session v5 is the only active schema. Older documents never hydrate as active
  state and old archives never authorize work.
- Within Session v5, compatibility runs from older writer to newer reader. An
  older Flow build is not a supported reader after a newer build writes values
  beyond its historical bounds. In particular, a run may retain 64 exact
  planned gates plus one separate broad observation. Users must finish or close
  active work before downgrade; Flow adds no rollback capability layer.
- A plan is a bounded DAG and is immutable after approval. A newly saved plan
  declares `evidence` with exactly one `scope: "gate"` entry. The persisted
  field stays optional so an older document still hydrates. This build does not
  read `gate` or `externalEvidence`.
- Stable finding, issue, and requirement IDs supplied by the source request
  remain verbatim in saved feature summary or validation prose so each ID is
  traceable to an immutable outcome and its evidence.
- If implementation would require material scope outside an approved plan, stop
  editing. Finish the approved plan or explicitly close it before creating a
  different plan; never replan the active approved session in place.
- A feature run is the canonical attempt aggregate. It contains validation,
  review, result, and artifacts; status and progress are derived.
- Runs remain in strictly increasing durable start-revision order, so derived
  latest-attempt delivery cannot disagree with canonical progress.
- At most one run is active. Dependencies must be complete before a run starts.
- A failed review blocks the run. Reset supersedes the selected feature and its
  dependent runs; an optional exact `nextFeatureId` starts the chosen runnable
  feature in the same transaction, and its new run starts empty. A failed
  feature is excluded from implicit selection while its latest relevant reviewed
  outcome remains failed; untouched dependency-independent features remain
  eligible. Automatic convergence is bounded by recorded failed review results:
  only `failedReviewCount === 1` without a `scopeBlocker` finding may retry
  automatically; every scope blocker or count of two or greater projects
  `await-user-direction` before another user-authorized attempt. When all
  runnable candidates require an explicit retry, status is `ready` and also
  projects `await-user-direction`. Detail identifies the failed feature from
  durable runs; explicit `flow_run_start(featureId)` begins that retry without
  reset. Pre-review resets and rejected stale-source submissions do not
  increment the derived count.
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

`flow_status` may add process-local `/flow-auto` context to top-level workflow data:
`autoContinuation` reports whether this host has been observed to report assistant
message parentage, which continuation depends on. Two values are surfaced:
`supported`, and `unsupported` with a reason and recovery. Before any assistant
message exists the field is omitted rather than reported `unknown`, since the absence
of a signal is not a limitation. `/flow-auto` activation states an `unsupported` host
plainly instead of letting continuation fail silently after every feature. This
adds no Session v5 field and never blocks a transition.

`flow_status` may also add timing for the latest `/flow-auto` invocation in the
current plugin process to top-level workflow data, and only on `view: "detail"`.
Compact status omits it. `activeMs` is process-local wall time while the
coordinator classifies the lease as active, not CPU time or pure coding time.
`waitingForUserMs` counts only recognized projected `flow_plan_approve` and
`await-user-direction` checkpoints. Paused, inactive, errored, and unprojected
waits are excluded. Timing resets on plugin reload, never enters Session v5 or a
projection, and never authorizes or blocks a transition.

Every successful status read also derives `statusReport` from its typed
projection. The report owns human lifecycle and recovery text and is not stored.

## Validation and review

Split into its own document as this section outgrew the rest of the contract:
[validation and review](validation-and-review.md) owns the evidence, review,
finding-identity, and closure invariants normatively.

## Bounded worker waves

Serial means one durable active feature run and one authoritative combined
validation/review chain. The manager works serially by default, but may delegate
two or three exact, non-overlapping slices to one initial `flow-worker` cohort
when parallel work has clear benefit, and at most one targeted follow-up cohort.
Existing implementation authority covers a qualifying wave; workers need no
separate user approval.

Workers contribute only inside their assigned boundary. The manager owns shared
files, integration, evidence acceptance, the combined diff, authoritative
validation, and review dispatch. Ordinary worker edits are allowed so a cohort
can run without approval interruptions; Bash, `.flow` and `.git` metadata
paths, nested delegation, and Flow-state tools are denied. Exact per-assignment
paths remain a prompt contract because one static reusable agent cannot express
a dynamic file ACL; the manager audits assigned versus changed paths after
every cohort. Every assignment includes the manager's preflighted adversarial
acceptance and risk checklist. Generic agents may not substitute for a
`flow-worker` or the reserved reviewer. No wave state is persisted; after
interruption, ordinary status and worktree inspection remain authoritative.
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
- Exact active close replay confirms that the canonical active bytes still
  match, synchronizes the file and `.flow` durability boundary, and does not
  rewrite the Session. Exact archived replay re-synchronizes no-overwrite
  publication and active cleanup, including when cleanup is already absent. A
  delayed replay must not clear a different active session.
- An archive or active-state collision preserves both documents and returns
  `manualRecoveryRequired` with no `archiveRetry`; callers stop automatic retry
  rather than overwrite or delete either side. Closed status re-derives an
  archive collision from the existing history document, so interruption cannot
  restore automatic retry. This behavior adds no persisted recovery state.
- Every close path whose terminal state was durably accepted returns the same
  derived `workflowData.delivery`: initial success, archive-pending recovery,
  exact retry, and delayed replay from history. The projection declares a
  `handoff` with `formatVersion: 1` and
  `externalActionAuthority: "not-granted"`, then contains
  the goal, closure, completed/total progress, every planned feature's attempt
  count, latest outcome, terminal findings, Flow-reported artifact groups, and
  derived tiered assurance with explicit limitations.
- Delivery is recomputed from the canonical closed Session or archive. It is not
  written into Session v5 or archive JSON and is not a report artifact unless
  the user separately requests one.
- Source identity hashes sorted effective workspace path/type/content tuples;
  `.git` and `.flow` are excluded. It is a content fingerprint, not a Git audit
  chain.
- Source identity requires a readable Git worktree and rejects tracked
  submodules explicitly.
- A timed-out project lock fails closed. Automatic stale-lock stealing is not
  allowed because ownership cannot be reclaimed without a race.

## OpenCode surface

Compact `flow_status` includes the active goal so the manager can align the
current request before mutation. When blocked, it also includes
`blockedFeature.featureId`, the latest attempt number, and a
`failedReviewCount` derived only from recorded failed review results. Compact
always includes `findingsDigest` (derived; empty is `[]`). No intent,
hold, or retry budget is persisted. After the second
failure, blocked status has `nextAction: await-user-direction`; the same action
is projected with ready status when every runnable candidate requires an
explicit retry. For either form the manager reads detail once and reports
`findingsDigest`. While blocked, an authorized choice is passed
as optional `nextFeatureId` so reset and exact run start are atomic. Once ready,
there is no blocked run to reset: explicit `flow_run_start(featureId)` starts
the authorized retry. A reset-only compatibility request never makes the failed
feature eligible for default selection.

### Commands

| Command | Contract |
| --- | --- |
| `flow-auto` | Normal end-to-end driver for the authorized lifecycle. |
| `flow-plan` | Plan-only/advanced creation, revision, and approval; same-goal approved plans are reported without mutation. |
| `flow-run` | Advanced/recovery execution of one approved feature after request alignment. |
| `flow-review` | Internal/recovery dispatch for a runtime-created reviewer assignment. |
| `flow-status` | Advanced/recovery projection of compact durable state and the next action. |

`flow-review` stays in the public inventory because OpenCode dispatches the
reserved reviewer through it and recovery may need it. It is not an ordinary
user starting point.

### Tools

| Tool | Contract |
| --- | --- |
| `flow_guidance` | Load one package-owned guide. |
| `flow_status` | Read compact, execution, detail, or reviewer state; compact state includes the goal and derived blocked convergence summary. |
| `flow_plan_save` | Create or replace the active draft plan. |
| `flow_plan_approve` | Approve and lock the draft plan. |
| `flow_run_start` | Start one runnable approved feature. |
| `flow_validation_start` | Arm observation of the exact next Bash command. |
| `flow_review_start` | Create the run's independent review assignment. |
| `flow_feature_complete` | Reviewer-only new result submission; exact accepted requests remain read-only replays while the Session v5 workflow is active. |
| `flow_feature_reset` | Supersede a failed attempt and optionally atomically start the exact authorized retry or dependency-independent feature through `nextFeatureId`. |
| `flow_session_close` | Close and archive the session, returning the same concise derived delivery and tiered assurance on every durably accepted close path. |

The nine lifecycle tools accept a nested `request`, return state under
`workflowData`, and require the current revision plus a stable operation ID for
mutations. `flow_session_close` additionally returns derived delivery under
`workflowData`; `flow_guidance` instead accepts a guide ID and returns Markdown.

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
`{ reviewer: { model, steps } }`; the environment variables remain fallbacks.
`flow_status` reports this process-local visibility without persisting it to
Session v5.

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
soaks, harness promotion, replay, and cross-version active session gates must not
return without a new ADR that removes an equal or larger amount of product
machinery.

Model evals are the one exception, admitted by
[ADR 0010](adr/0010-declared-canonical-gate.md) against the prompt prose the
declared gate replaced. They run weekly and on demand in one workflow, never in a
gate a contributor waits on, and skip themselves without a configured matrix or
credentials. `bun run qualify` seals a complete campaign and exact canary. A
scenario without a threshold, or a required scenario the report omitted, fails.

Bounded-wave coverage should test the real agent permissions, manager guidance, and
host-visible configuration without adding a scheduler or tests-of-tests.

See [Model-driven wave evidence](development.md#model-driven-wave-evidence) for
the manual canary policy.
