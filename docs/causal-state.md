# Causal state and restricted evidence

Flow keeps its runtime file-backed. It does not use SQLite or another database,
and it does not read qa-scribe state. The qa-scribe review supplied investigation
facts only.

## Durable causal identity

Session v4 contains a required `causal` object:

- `revision` advances exactly once for every committed operation;
- `genesisSnapshotId` anchors the initial canonical session snapshot;
- `snapshotId` identifies the current durable state;
- `mutations` is an append-only, digest-linked operation ledger;
- `evidence` contains typed metadata and hash references, never raw output.

Each mutation records its operation id and kind, canonical request digest,
prior/current revision and snapshot, previous mutation digest, changed entity
and fields, blocker delta, evidence references, and timestamp. Before changing
state, transitions validate the complete chain. Review assignment, completion,
reset, and close bind request identity to the caller's expected revision and
snapshot.

An exact operation replay returns the existing result without another revision.
Reusing an operation id for another kind, payload, or later causal assignment
fails. A stale revision or snapshot also fails without recording caller
evidence. Only a valid Session v4 document can become active state or canonical
history. Any other version is generic unsupported input, not a compatibility or
recovery format.

Each `flow_run_start` creates runtime-owned feature-run identity. Review
assignment records carry that run, source digest, validation references,
immutable packet digest, attempt/logical-pass identity, start time, and required
depth. Invalidated assignments record whether source changed, the run reset, or
session closure made the assignment quiescent. Final assignments bind one
prerequisite aggregate containing the feature-assignment id, canonical passing
result, and result digest. Capture revision and snapshot remain audit metadata;
current applicability is based on source identity plus the active execution's run.

Each accepted mutation captures one runtime acceptance time. Actor-reported
validation and review times must be ordered from feature-run start through
validation, assignment start, and assignment result, and may not postdate that
runtime acceptance time. Broad final validation must begin no earlier than the
bound feature-assignment result's reported time.

The hashes detect inconsistent durable state and make replay comparisons
deterministic. They are not a secret signature against an actor who can rewrite
the whole workspace.

## Projections and polling

`flow_status` requires a strict nested request. `view: "compact"` selects a
routing-only projection with one active-or-next feature identity, progress,
blockers, causal guards, closure kind, archive retry handle, and next action.
`view: "execution"` is the
full working projection for the active execution: its targets, validation,
review policy, applicable requirements and decisions, and causal guards. Bounded
diagnostic state requires `view: "detail"`. Reviewer recovery accepts only
`{ request: { view: "reviewer", assignmentId } }` and returns bounded assigned
scope, packet summary, risk lenses, validation count, required depth, and
assignment status. It never asks the reviewer to reconstruct causal identity.

Detail status alone also exposes a bounded
`finalReviewRetry.prerequisite` aggregate after the first final assignment for
one active run and source. A manager recovering a same-source retry copies its
`.result` unchanged into the next final review start's `request.featureReview`.
The bounded detail object includes final-assignment, run, source,
prerequisite-assignment, and result-digest identity; the raw result remains
within the persisted 64 KiB limit. Compact and reviewer views omit the
aggregate. A mismatch records no mutation and does not consume the operation
id; a source edit requires a new targeted feature-review sequence instead of
old-source reuse.

`sinceRevision` provides ordered, byte-bounded deltas. Polling the current
revision returns unchanged metadata only. Negative, fractional, or future
revisions fail instead of guessing. Ordinary state changes return a bounded
mutation receipt and never attach the full session. A manager therefore loads
compact for routing, execution after a fresh start or resume, and compact again
immediately after a feature outcome. A refreshed `status: "completed"` with
null closure starts a new guarded completed close; a stored closure routes only
to `{ request: { mode: "retry", operationId: closure.retryOperationId } }`.
Receipts are acknowledgements, not continuation state.
Rejected mutation receipts state `operationAccepted: false` and
`operationIdConsumed: false`, retain the current causal/run identity when state
was readable, and report null identity when payload validation preceded a safe
session read. Accepted blockers are ordinary accepted mutations and consume
their operation id.

A passing final feature outcome advances workflow progress to `completed` with
no closure. A subsequent guarded `flow_session_close` start owns the closure and
`session_close` mutation. If archive publication stops after that mutation,
compact status exposes the accepted retry handle; retry resumes publication and
cleanup without caller-retained summary, guards, or request reconstruction.
Every closure is quiescent: no active execution or pending assignment remains.
Close-start operation ids are workspace-history unique: any match in a
canonical Session v4 archive mutation is a collision, regardless of mutation
kind. Quarantine files are excluded from lookup, and corrupt or ambiguous
canonical history fails closed before the active session changes.
Canonical history must also carry a non-null explicit closure: publication
rejects closureless Session v4 state, and lookup treats a closureless archive as
invalid rather than as retry authority.

Plan admission serializes every feature's final and non-final execution shape
with worst-case causal guard widths and rejects any projection above 12 KiB.
Runtime repeats the check for invalid or hand-edited state. Execution scope is
never truncated, paginated, or redirected to a detail fallback.

Before scope references enter execution, reviewer, or detail projections, Flow
normalizes them with NFKC and trimming. It deterministically digests POSIX
roots, leading backslashes, drive qualifiers, UNC/device paths, URI schemes,
home roots, and exact `..` path segments. Safe relative references such as
`src\feature.ts` and `foo..bar` remain readable. This lexical rule is
platform-independent and runs before bounded-view shortening.

Hard UTF-8 budgets are tested for six-feature compact status (3,000 bytes),
complete execution context (12,288 bytes), reviewer context (3,000 bytes),
ordinary receipts (2,000 bytes), and delta pages (3,000 bytes).

## Restricted evidence artifacts

Optional exact validation output is published beneath:

```text
.flow/evidence/v1/sha256/<first-two-hex>/<remaining-hex>
```

The application ledger stores only `{ kind, digest, byteLength }`. Publication
copies caller bytes, enforces an 8 MiB ceiling, uses owner-only directories and
files, fsyncs before exclusive no-clobber publication, and verifies an existing
target byte-for-byte on replay. Reads refuse symlinks and non-regular files and
verify permissions, length, and SHA-256 before returning bytes inside the
application boundary.

Artifact failures become one curated tool error. Raw bytes, absolute paths, and
filesystem diagnostics never enter ordinary model-visible responses. Evidence
blobs are not automatically deleted when active state is unreadable; no
automatic cleanup or index exists. `.flow/.gitignore` finishes with Flow's canonical ignore block,
while preserving maintainer-owned entries, so restricted evidence is not
accidentally staged.

## Threat model and rollback

Flow defends against static symlinks/non-regular components, unsafe roots, and
uncoordinated Flow writers through its existing workspace checks and session
lock. A hostile same-UID process continuously swapping already validated parent
directories is outside the current cooperative filesystem threat model; a
future stronger boundary would require dirfd/openat-style platform support.

Compact and delta selection can be disabled while keeping the causal ledger and
explicit detail view. Do not strip causal fields from a live session or rewrite
unknown state. Evidence rollback removes only the publication/use path after no
session references remain; never delete referenced blobs as part of an ordinary
runtime rollback.
