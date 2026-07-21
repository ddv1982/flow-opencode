# ADR 0007: Reviewer-Owned Result Submission

Date: 2026-07-21

## Status

Accepted. Amends ADR 0005 by replacing manager-proxy review submission.

## Context

Session v5 already gives each run one independent review assignment, but the
manager previously copied the reviewer's returned verdict into
`flow_feature_complete`. The runtime could validate the result and source
binding, but not distinguish a copied reviewer verdict from a manager-authored
one. That weakened the meaning of independent review.

## Decision

The reserved `flow-reviewer` reads its pending assignment through reviewer
status, inspects the workspace, and calls the existing
`flow_feature_complete` tool directly. The OpenCode boundary verifies
`ToolContext.agent === "flow-reviewer"` before accepting a new completion.
Permission configuration also denies every other reviewer lifecycle mutation.

The reviewer remains workspace-read-only. Its sole lifecycle mutation is exact
result submission; it cannot plan, start, validate, reset, close, delegate, or
run commands. `flow_status` may fail-closed quarantine unreadable active state;
that is recovery maintenance, not a lifecycle transition. The manager creates
and dispatches the assignment, then reads compact status. It redispatches a
pending assignment after reviewer interruption or an unconfirmed return instead
of copying or inventing a verdict. A source-binding rejection requires reset,
fresh validation, and a new review; that assignment is not redispatched. Manager
status rechecks source content for a pending review so this recovery survives a
lost submission error without adding persisted state.

While its Session v5 workflow remains active, an exact previously accepted
completion remains replayable without another mutation, regardless of caller
identity. This read-only compatibility path neither cancels validation nor
writes session state, cannot submit a new result, and preserves operation-ID
idempotency across same-major upgrades.

This replaces proxy submission. It adds no public tool, persisted provenance,
review pass, lifecycle state, receipt, or recovery protocol. Existing revision,
operation-ID, source-binding, and result-semantic checks remain authoritative.

## Consequences

A newly recorded result is tied to the host-reported reserved reviewer identity,
which is a stronger practical boundary than prompt compliance alone. It is not
a cryptographic attestation beyond OpenCode's `ToolContext`. Reviewer
interruption can leave an assignment pending and require redispatch; there is
intentionally no manager fallback.

## Rejected alternatives

A new reviewer receipt, signature, provenance ledger, or completion tool would
duplicate the existing assignment and transition. Allowing manager fallback
would preserve the integrity gap this decision removes.
