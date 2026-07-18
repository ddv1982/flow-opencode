# Causal state and restricted evidence

Flow keeps its runtime file-backed. It does not use SQLite or another database,
and it does not read qa-scribe state. The qa-scribe review supplied investigation
facts only.

## Durable causal identity

Session v3 contains an additive `causal` object:

- `revision` advances exactly once for every committed operation;
- `genesisSnapshotId` anchors the initial canonical session snapshot;
- `snapshotId` identifies the current durable state;
- `mutations` is an append-only, digest-linked operation ledger;
- `evidence` contains typed metadata and hash references, never raw output.

Each mutation records its operation id and kind, canonical request digest,
prior/current revision and snapshot, previous mutation digest, changed entity
and fields, blocker delta, evidence references, and timestamp. Before changing
state, transitions validate the complete chain. Completion, reset, close, and
preliminary review recording bind the request identity to the caller's expected
revision and snapshot.

An exact operation replay returns the existing result without another revision.
Reusing an operation id for another kind, payload, or later causal assignment
fails. A stale revision or snapshot also fails without recording caller
evidence. Sparse Session v3 files created before this additive contract hydrate
to a canonical revision-zero root; unknown versions still follow the existing
byte-preserving quarantine path.

The hashes detect inconsistent durable state and make replay comparisons
deterministic. They are not a secret signature against an actor who can rewrite
the whole workspace.

## Projections and polling

`flow_status` defaults to a routing-only compact projection with one
active-or-next feature identity, progress, blockers, causal guards, closure
kind, and next action. `view: "execution"` is the
full working projection for the active feature: its targets, validation,
review policy, applicable requirements and decisions, and causal guards. Bounded
diagnostic state requires `view: "detail"`. Reviewer requests get only assigned
scope, packet/evidence hashes, required depth, and expected causal identity.

`sinceRevision` provides ordered, byte-bounded deltas. Polling the current
revision returns unchanged metadata only. Negative, fractional, or future
revisions fail instead of guessing. Ordinary state changes return a bounded
mutation receipt and never attach the full session. A manager therefore loads
compact for routing, execution after a fresh start or resume, and compact again
immediately after completion. Only refreshed `projection.closure.kind` decides
whether to close; receipts are acknowledgements, not continuation state.

Plan admission serializes every feature's final and non-final execution shape
with worst-case causal guard widths and rejects any projection above 12 KiB.
Runtime repeats the check for legacy or hand-edited state. Execution scope is
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
filesystem diagnostics never enter ordinary model-visible responses. Archive
and unreadable-session quarantine retain evidence blobs; no automatic cleanup
or index exists. `.flow/.gitignore` finishes with Flow's canonical ignore block,
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
