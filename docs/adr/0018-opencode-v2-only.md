# ADR 0018. Target OpenCode v2 only

## Decision

Flow 10.0.0 targets OpenCode v2 with 2.1.4 as the tested minimum. OpenCode 1
support is removed in this release. Later 2.x releases require a compatibility
check before they enter the supported set. The peer range excludes OpenCode 3.
Finish or explicitly close active Flow sessions before the upgrade.

The maintainer requested the immediate cutover. This deliberately waives the
earlier-announcement cadence for this host removal. No bridge release or dual
runtime entrypoint is introduced. Session v5 remains unchanged.

## Host boundary

Native v2 definitions register roles, commands, and tools. Application schemas
produce JSON Schema. Structured tool results retain Flow envelopes and guidance.

Each primary request freezes consumed inputs and assistant bindings within a
live epoch. The prompt hook grants no authority. A tool must match the native session, assistant, agent, call,
workspace, and consumed-input snapshot. Asynchronous event arrival order does
not establish authority. Flow selects HTTP in provider, model, and variant
settings so each request stays observable.

Automatic compaction can precede the first primary request. It preserves the
epoch of an accepted input only through the exact checked native control.
Its user-role checkpoint grants no approval. The input ledger owns reservations,
readiness, lifetime, and history; request attribution owns primary and tool
bindings. Readiness waits precede authority checks. Interrupted ordinary history
may summarize without an execution origin. Known automatic history cannot take
that fallback. Live ordinary continuations retain their checked origin.
Matched source failures revoke that source; stale unmatched callbacks cannot
revoke a fresh one. Authority never comes from summary text or survives restart.

The model picker loads automatically with the server package. Server-owned
global preferences are separate from native configuration. Project plugin
options override global choices. Updates check revision, catalog, project, and
activity before changing one role. Role transforms refresh across loaded
instances. Explicit selection clears the role's reasoning variant. Reset
restores the configured base. The coding model stays under native selection.

## Qualification

Qualification retains all 17 cases on two provider routes.
Manager and reviewer use the same approved model within each cell. Recovery is
off. Candidate, canary, and publication retain the exact archive and unpacked
manifest identities.

Historical 9.x pins, digests, transcripts, and qualification bundles remain
verifiable without an active OpenCode 1 implementation. Publication retains
existing approval gates.

See [release qualification](../release-qualification.md) for the executable gates
and [automatic continuation](../automatic-continuation.md) for operator behavior.
