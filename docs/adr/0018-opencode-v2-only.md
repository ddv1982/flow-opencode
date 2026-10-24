# ADR 0018. Target OpenCode v2 only

## Decision

Flow 10.0.0 removes OpenCode 1 support and targets 2.1.4 or later tested 2.x.
Later 2.x releases must pass compatibility checks. The peer range excludes 3.
Finish or close active Flow sessions before upgrading.

The maintainer requested immediate removal, waiving the earlier-announcement
cadence. There is no bridge release or dual runtime. Session v5 is unchanged.

## Host boundary

Native v2 definitions register roles, commands, and tools. Application schemas
produce JSON Schema. Structured tool results retain Flow envelopes and guidance.

Each primary request freezes consumed inputs and assistant bindings within a
live epoch. The prompt hook grants no authority. A tool must match the native session, assistant, agent, call,
workspace, and consumed-input snapshot. Asynchronous event arrival order does
not establish authority. Flow selects HTTP in provider, model, and variant
settings so each request stays observable.

HTTP consumer cancellation ends the captured request, as EOF does. It proves
neither success nor user interruption. Tool guards retain exact input identity
and the native abort signal. Read and status failures retain owned revocation.

Automatic compaction can precede the first primary request. It preserves the
epoch of an accepted input only through the exact checked native control.
Its user-role checkpoint grants no approval. The input ledger owns reservations,
readiness, lifetime, and history; request attribution owns primary and tool
bindings. Readiness waits precede authority checks. Interrupted ordinary history
may summarize without an execution origin. Known automatic history cannot take
that fallback. Live ordinary continuations retain their checked origin.
Matched source failures revoke that source; stale unmatched callbacks cannot
revoke a fresh one. Authority never comes from summary text or survives restart.

The model picker loads with the server package. Server-owned global preferences
are separate from native configuration; project plugin options override them.
Role updates check revision, catalog, project, and activity. Transforms refresh
loaded instances. Explicit selection clears the role's reasoning variant; reset
restores its base. The coding model stays under native selection.

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
