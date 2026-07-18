# Review lifecycle

Flow records review executions independently from feature completion. A review
attempt remains durable when completion fails validation, review, snapshot, or
schema gates; successful retries add a new attempt instead of rewriting prior
evidence.

## Execution identity and retry truth

Each `reviewExecutions` entry identifies an `attemptId`, `logicalPassId`,
`featureId`, review kind, immutable `reviewSnapshotId`, verdict, typed findings,
start/end timestamps, and terminal disposition. The two terminal dispositions
are `submitted` and `observed_unsubmitted`.

`observed_unsubmitted` represents a failed attempt the host observed even
though normal submission did not complete. It cannot carry a passing verdict.

Attempt IDs are idempotent. Repeating the same attempt has no effect; reusing an
attempt ID with different evidence fails closed. A logical pass projects to its
latest recorded attempt, so a failed-to-passed retry is currently passed while
both attempts remain in the append-only ledger. Distinct logical passes that end
with contradictory verdicts on one immutable snapshot prevent completion.

Findings use exactly four taxonomies:

- `implementation_defect`
- `regression_coverage_gap`
- `evidence_gap`
- `advisory`

Flow computes each finding fingerprint from normalized taxonomy, subject,
requirement or risk, and evidence locator. Attempt identity, time, summary prose,
and presentation severity do not affect the fingerprint.

## Completion and optional telemetry

Core review evidence is a correctness input. Orchestration passes are optional
telemetry and are parsed separately. Invalid optional telemetry is ignored with
a bounded warning; it cannot erase a valid review execution or turn a failed
review into a passing completion. Unknown core completion fields remain invalid.

A completed (`status: "ok"`) result must include at least one execution. Flow
records structurally valid, active-feature executions before validating the rest
of the completion envelope, so they survive a later core-schema or ordinary
completion rejection. Review summaries do not override this ledger: a failed
summary needs a matching failed execution, and a passing summary requires the
latest truth for every applicable logical pass to be passing. Final completion
also requires a distinct passing final execution.

Preliminary review recording is itself a causal operation. Its request identity
binds the execution list, expected revision, and expected snapshot. An exact
retry returns the original receipt; reusing the operation id for another causal
assignment fails instead of presenting a stale observation as accepted.

Two distinct failed review attempts consume the bounded retry budget. Replaying
one already-recorded attempt is idempotent and does not consume the budget again.

## Final-feature economy order

The default final-feature sequence is:

1. targeted validation;
2. feature review;
3. at most one already-authorized repair and feature-review retry;
4. broad validation after the last functional edit;
5. final review;
6. one atomic `flow_feature_complete` call.

An active final feature may legitimately remain `in_progress` between these
steps. Economy mode does not dispatch final review before feature review passes.
The runtime enforces this chronology from execution timestamps: final review
cannot start before the latest feature review completes. Speculative latency
routing remains disabled.

## Observed worker capability

The supported OpenCode plugin API exposes generic session and message events,
including parent session and agent metadata, but it does not provide a durable
Flow operation, feature, logical-pass, and review-snapshot correlation boundary.
Those events are therefore insufficient for a trustworthy persistent child
execution adapter.

Flow keeps manager-declared orchestration counts as declared intent. The
separate observed-review-worker ledger defaults to `unreconciled` with a `null`
count; it never presents missing observation as zero. Its state is a strict
union: unavailable observation is always unreconciled with a null count, while
host-observed data is reconciled with a numeric count. A future adapter requires
a verified durable correlation path and does not require a new public tool.

## Compatibility and rollback

These fields are additive Session v3 defaults. Existing sparse v3 sessions load
with an empty review-execution ledger and an unreconciled observed-worker count;
Flow does not fabricate retrospective attempts. Rolling back routing does not
delete recorded review history.
