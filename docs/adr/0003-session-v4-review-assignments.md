# ADR 0003: Session v4 Recoverable Review Lifecycle

Date: 2026-07-19

## Status

Accepted. The local lifecycle-hardening gates passed on 2026-07-19; bounded
real-project validation and supported external-environment release evidence
remain in the predecessor plan's Phase 5.

## Context

The earlier lifecycle made review attempts durable but still required managers
and hidden reviewers to retain causal data that Flow could not recover after
context loss. Plan-feature identity, execution epoch, source identity, mutable
session snapshot, validation capture, and review assignment were also easy to
conflate. Review-only mutations could stale unchanged-source validation, reset
could leave old review truth applicable, actor-reported timestamps could escape
runtime chronology, and interrupted archive publication still depended on a
caller-retained close request.

The OpenCode host registration API exposes a structural object-schema subset.
Conditional requirements expressed only by a separate refined application
schema are therefore not necessarily the contract the model receives. Session
v4 needs one nested request contract that is durable, host-expressible, and
recoverable at every lifecycle boundary. Its raw-shape API also constructs the
outer tool-argument object itself; OpenCode 1.18.3 omits
`additionalProperties` for that SDK-owned wrapper even when Flow's complete
application envelope is strict.

## Decision

Session v4 is the sole supported session contract. Every run start creates
runtime-owned feature-run identity. Reset ends applicability of the old run
without deleting its audit history; retry truth and failed-attempt counters are
run-scoped. Flow has no version-specific compatibility, migration, quarantine,
or recovery branch for another session format.

The root manager creates a durable assignment after validation through the
strict nested `flow_review_start.request` contract. Flow derives source, run,
packet, evidence, attempt, logical-pass, start-time, and required-depth
identity. Hidden reviewers recover only through
`flow_status { request: { view: "reviewer", assignmentId } }` and return
assignment id, verdict, typed findings, reported time, and terminal
disposition.

Validation evidence keeps capture revision/snapshot as audit metadata while
applicability uses source digest plus feature run. A source change or reset
invalidates an assignment; a review-only revision does not. On a new review
start, Flow atomically invalidates a pending same-run, same-kind assignment for
older source and creates a replacement, recording `source_changed` separately
from `feature_reset`. Validation observations also carry a runtime-derived
command digest so distinct silent commands cannot collapse.

A final assignment requires the exact passing feature-assignment result before
dispatch. Flow persists that bound prerequisite result as one aggregate: the
feature-assignment id, a cloned canonical result, and its digest. Binding does
not terminalize the feature assignment or append a recorded review execution.
Once a final assignment establishes the binding for one run and source, every
same-source final-review retry must reuse that exact first aggregate. Detail
status exposes it at
`workflowData.projection.finalReviewRetry.prerequisite`; compact and reviewer
status omit it. A manager recovering context copies only `.result` unchanged
into the next final `flow_review_start.request.featureReview`; the value is
bounded by the persisted 64 KiB assignment-result limit. A mismatched retry
records nothing and does not consume its operation id, so the corrected request
may reuse it. A changed source restarts targeted feature review before a new
final sequence. Final completion submits only the distinct final-assignment
result; Flow consumes the durable binding and records both executions only in
the accepted atomic feature outcome.

`flow_feature_complete.request` is a strict nested discriminated `completed` or
`blocked` result. Schema errors, stale guards, changed source, invalid
chronology, or inconsistent assignments cause no mutation and do not consume
the operation id. A genuine failed review is an accepted mutation with status
`ok`; it records evidence and consumes the bounded run-scoped retry budget.

Every accepted transition captures one runtime acceptance time. Reported times
must satisfy this inclusive order:

```text
feature-run start
  <= validation start
  <= validation completion
  <= review-assignment start
  <= reported assignment-result time
  <= runtime acceptance time
```

Final review additionally requires the bound feature-assignment result time to be
no later than broad-validation start, followed by broad-validation completion
and final-assignment start. One transition uses the same runtime acceptance
time for run termination, assignment invalidation, and closure recording.

Final feature completion marks workflow progress completed without
manufacturing a closure. `flow_session_close.request` is the sole closure and
archive transition. Its `start` branch records a closure and durable retry
handle. If archive publication is interrupted, compact status exposes that
complete handle and the `retry` branch accepts only it; the caller does not
resubmit summary, guards, or another close operation.

A close-start operation id must be unused by the active session and by every
mutation in every canonical Session v4 archive in the workspace. Quarantine
files are not retry sources. Corrupt, unsupported, filename-mismatched, or
ambiguous canonical history fails closed without changing active bytes. Any
archived mutation match is a collision regardless of mutation kind because
archive retry lookup is keyed by operation id; an unaccepted close start must
use a new id.

Archive publication accepts only a Session v4 document with a non-null explicit
closure. A closureless document can remain active state, but it is never valid
canonical history; publication rejects it and canonical lookup fails closed if
one is present.

`flow_plan_save` may update only the active draft for the same goal. It never
archives or replaces an unclosed session for a different goal, regardless of
approval state. The caller must explicitly close unfinished work as `deferred`
or `abandoned`, let archive publication converge, and then save the new goal.
Completed progress instead requires an explicit `completed` close.

A closure is quiescent. Completed, deferred, and abandoned closure leave no
active execution or pending review assignment. Deferred or abandoned closure
preserves plan and workflow progress as forensic state while terminalizing the
active run and invalidating its pending assignments with the closure reason.

All conditionally shaped lifecycle tools use strict nested request objects that
OpenCode 1.18.3 can express. The registered tool schema and the application
schema accept and reject the same host-expressible request semantics. The
model-visible schema requires the nested `request` and emits its strict
discriminated branches and numeric bounds. Schema advertisement alone is not
enforcement: the platform parses Flow's complete strict envelope again at
handler entry before the application execution wrapper, so an invalid host
call—including one with an unknown outer field—becomes a tool error without
reaching mutation logic. No flat compatibility adapter is retained.

## Consequences

- The runtime surface contains nine tools.
- Manager and reviewer prompts become smaller in causal identity while gaining
  an explicit assignment step.
- Assignment and nested completion schemas ship together as one minor cutover;
  neither has a supported dual-schema compatibility period.
- Append-only review and evidence history remains available for diagnostics and
  deterministic replay, but only active-run records affect completion.
- A closed session may remain visible only as an archive-recovery session until
  publication converges; its retry handle is sufficient to continue.
- Actor-reported time is evidence, not trusted runtime time.
- Bound prerequisite results consume bounded durable space so continuation does
  not depend on chat-local memory.

## Gates

- reset/restart excludes historical blockers without deleting them;
- unchanged source survives assignment/review mutations;
- changed source rejects completion without partial mutation;
- changed source invalidates stale pending work and creates one replacement;
- final assignment durably binds the exact passing feature result;
- same-source final-review retries recover and reuse the first durable binding
  from detail status while compact and reviewer projections omit it;
- final completion submits only its final-assignment result and atomically
  records both review executions;
- validation and review chronology is bounded by one runtime acceptance time;
- malformed completion leaves its operation id reusable;
- final completion leaves closure null and explicit close owns `session_close`;
- completed, deferred, and abandoned closure are quiescent;
- failed archive publication resumes from compact status and its retry handle;
- close-start operation ids are unique across active and canonical archived
  mutation history, with malformed canonical history failing closed;
- closureless Session v4 documents cannot be published or accepted as
  canonical history;
- a different-goal plan save cannot replace an unclosed session;
- application, registered-handler, emitted host-expressible, and documented
  request contracts agree, with unknown outer fields rejected before Flow;
- handler-entry validation rejects invalid host calls before application
  mutation logic;
- hidden reviewers cannot mutate state or author causal identity;
- reviewer, execution, compact, receipt, and delta byte budgets pass; and
- only valid Session v4 can become active state, and only its explicitly closed
  form can become canonical history.
