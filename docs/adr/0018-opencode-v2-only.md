# ADR 0018. Target OpenCode v2 only

## Decision

Flow 10.0.0 removes OpenCode 1 support and targets 2.1.4 or later tested 2.x.
Later 2.x releases must pass compatibility checks. The peer range excludes 3.
Finish or close active Flow sessions before upgrading.

The maintainer requested immediate removal, waiving the earlier-announcement
cadence. There is no bridge release or dual runtime. Session v5 is unchanged.

## Host boundary

Native definitions register roles, commands, and tools. Application schemas
supply JSON Schema. Results retain Flow envelopes and guidance.
Frozen inputs bind each primary to its native session, agent, model, assistant,
call, and workspace. Flow selects HTTP for providers, models, and variants.
Prompt hooks and event arrival order grant no authority.
Queued prompts preserve the running request.

Unregistered native user and synthetic turns may use ordinary tools. They gain
no Flow-tool access, validation, recovery intent, or automatic lease. A consumed
registered prompt or Flow command establishes Flow provenance. Retired request
owners retain no transcript snapshots.

EOF and consumer cancellation close only the captured HTTP request. Protected
calls retain exact input identity and the native abort signal. Only a proved
owner can revoke. Terminal read failures before proof grant nothing.

The input ledger owns reservations, readiness, lifetime, and history. Request
attribution owns primary and tool bindings. Readiness precedes authority checks.
Checked native controls preserve accepted epochs through automatic compaction,
including before the first primary. Checkpoints grant no approval. Matched source
failure revokes only that source. Stale callbacks cannot revoke a fresh source.
Summary text and restart never supply authority.

Ordinary history may summarize without an origin. Summary-only execution and
unknown-history automatic compaction remain refused. Accepted ordinary
continuations retain their checked origin. Known automatic history cannot become
unowned summary history.

The model picker loads with the server. Server storage owns global preferences.
Project options override them. Role updates check revision, catalog, project,
and activity, then refresh transforms. Selection clears the role's reasoning
variant. Reset restores its base. Native selection owns the coding model.

## Qualification

10.0.0/10.0.1 pin `openai/gpt-6.1-sol` across 17 cases with 72 primary and 17
reserve cells. Other v2 releases retain two routes and 144/34 cells. Reviewers
use the manager model with recovery off. Candidate, canary, and publication
bind the exact archive and unpacked manifest.

Historical 9.x pins, digests, transcripts, and bundles remain verifiable offline.
Publication approval gates remain.

See [qualification](../release-qualification.md) and
[automatic continuation](../automatic-continuation.md).
