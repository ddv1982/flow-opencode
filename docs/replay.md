# Sanitized replay

Phase 0 adds a deterministic, read-only replay oracle for a sanitized
long-running investigation corpus. It does not change production prompts,
tools, state transitions, session storage, or runtime behavior. Variant A is
the current prompt-driven control. Variants B, C, and D are reserved and report
`unsupported`; Phase 0 does not invent outcomes for them.

## Derived terminal truth

The oracle derives each scenario's terminal decision, reason, durable revision,
and durable state digest from event causality alone. It never reads the
fixture's asserted terminal decision, reason, revision, or digest while deriving
truth. The `terminal_decision` event is treated as an expectation: when the
derived decision, reason, revision, or digest disagrees with it, the scenario
result records a `terminal_*_mismatch`, and the reported decision remains the
derived truth rather than the asserted label.

Durable revision and state digest are derived from the latest state-bearing
event (`session_state`, `mutation_commit`, or `mutation_recovery`). When a
scenario carries no such event, the derived revision and digest are `null` and
the oracle does not claim a revision or digest match rather than fabricating
one. A schema-valid but causally impossible layout — a missing, duplicated, or
non-final terminal event — resolves to a `failed` / `schema_invalid` decision
instead of selecting the last observed label.

Each `session_state` event must carry the enclosing scenario's `sessionId`.
The schema rejects a cross-session event, and the replay reducer independently
fails closed if it receives one through the typed API boundary. Durable state
observations are monotonic: revisions cannot regress, and an equal revision must
retain the same digest and previously observed session/feature statuses. A
conflicting observation is reported but cannot replace the last accepted durable
state.

## Mutation causality

Mutation histories are tracked independently by `mutationId`, with every event
bound to the `operationId` recorded by its start event. The accepted state
transitions are deliberately small:

| Current state | Event | Next state | Durable evidence accepted |
| --- | --- | --- | --- |
| absent | `mutation_start` | started | no |
| started | `mutation_commit` | committed | yes |
| started | `mutation_crash` | crashed | no |
| crashed | `mutation_recovery` | recovered | yes |

Any other transition, a changed operation identity, or a terminal mutation
event without a start is causally invalid. Invalid commits and recoveries do
not contribute a revision or digest. A mutation left started or crashed is
reported as incomplete; incompleteness takes precedence over an independently
recovered mutation when terminal truth is derived.

The start event binds the mutation's base revision and the durable base digest
visible at that point. A commit, reapplied recovery, or reused commit advances
exactly once to `baseRevision + 1`. A rolled-back recovery retains the base
revision and base digest. No terminal event may overwrite an intervening
durable state; `commit_reused` may only reconcile an already-observed advanced
state when both its revision and digest agree. Operation IDs and advancing
revisions each have one mutation owner, so interleaved histories cannot commit
two mutations into the same causal slot.

Recovery status is also constrained by the recorded crash phase:

| Crash phase | Accepted recovery statuses |
| --- | --- |
| `before_write` | `rolled_back`, `reapplied` |
| `after_write_before_commit` | `rolled_back`, `reapplied`, `commit_reused` |
| `after_commit` | `commit_reused` |

## Review and retry causality

Review attempts form one scenario-wide `attemptId` index and are projected by
`logicalPassId`. Repeating an attempt with identical semantic evidence is
idempotent and counts once; reusing its identity with different evidence fails
closed. A logical pass has one review kind and its effective truth is its latest
unique attempt. A latest unsubmitted failure remains failed and blocks
completion. An unsubmitted passing attempt is causally invalid.

A `retry_finding_delta` is valid only when its distinct previous and current
attempt IDs both exist, belong to the delta's logical pass and the same review
kind, are submitted, occur before the delta, and are adjacent unique attempts
within that pass. The previous attempt must have failed. The delta's previous,
current, and duplicate finding counts must match the referenced fingerprint
sets, where the duplicate count is their overlap.

Delta meanings are closed:

- `resolved` is a failed-to-passed transition whose current attempt has no
  findings;
- `unchanged` keeps a failed current attempt with an equivalent finding set;
- `changed` keeps a failed current attempt with a different, nonempty finding
  set.

Invalid attempt identity or retry causality resolves to `failed` /
`schema_invalid`. A resolved pass cannot mask another pass whose latest truth
is failed. Contradictory verdicts block only when the latest truths of distinct
logical passes disagree on the same immutable snapshot; historical disagreement
inside one retried pass is not a contradiction.

## Safe inputs and outputs

Only the sanitized JSON fixture belongs in the repository. Never commit raw transcripts,
prompt or finding prose, tool input or output, commands, absolute paths, source
identifiers, credentials, reasoning, environment values, or database rows.
Fixture identifiers are local opaque IDs and source identity is represented by
SHA-256 fingerprints. The report boundary rejects invalid JSON, non-object
roots, and duplicate keys before object-level validation. The closed fixture
schema and privacy validator then reject unknown fields, unrestricted strings,
secret-like keys, and path- or command-shaped values before replay.

Phase 0 accepts only the repository-owned, provider-neutral sanitized fixture. It does
not include or invoke an extractor, host database reader, or provider-specific
source adapter. Generated reports are written to standard output and never
replace the fixture.

## Reports and fact provenance

Run the repository control replay in concise human-readable form or as JSON:

```sh
bun run replay:report -- --fixture long-running-v5 --variant A
bun run replay:report -- --fixture long-running-v5 --variant A --json
```

The fixture name is resolved beneath `tests/fixtures/replay`; absolute paths,
path separators, and traversal are rejected. A report is emitted only after
strict JSON parsing, privacy validation, and schema validation succeed.

Every fixture-local identifier also has a field-specific, numeric canonical
form (`session_N`, `operation_N`, `attempt_N`, and so on). Arbitrary slugs are
not accepted as identifiers, preventing one-word prompt, command, credential,
or transcript content from bypassing the privacy allowlist.

Reports keep four origins separate:

- **Host facts** are independently verified structural aggregates from the
  case-study source, including seven observed reviewer executions.
- **Flow-ledger claims** are values declared by the durable Flow ledger. They
  are claims, not observed worker execution; a declared worker count of zero
  remains zero.
- **Supplied observations** came with the case study but have not yet been
  semantically reconciled. The four-invocation total of 108,102 characters and
  78.2% reviewer input share remain supplied and unreconciled.
- **Replay-derived facts** are deterministic decisions and counters produced
  from the sanitized fixture. The reviewer execution count is repeated there
  only as a reconciliation value; the report labels its observation source as
  host metadata, never as a count inferred from the nine scenario events.

The report also loads the closed `qa_scribe_5_1_high` lifecycle baseline. It
prints all eight remediation counters: reviewer-assignment attempts, invalid
reviewer payloads, completion submissions, accepted blockers, schema
rejections, evidence-only reruns, feature resets, and abandoned sessions.
Unavailable source facts remain `unavailable` with `not_recorded` provenance;
they are never converted to zero. The `high` inference-effort label is retained
as run provenance and is not presented as the cause of protocol outcomes.

`tests/support/lifecycle-proof-registry.ts` is the seven-invariant executable
proof registry. `tests/review-lifecycle-coverage-map.test.ts` verifies that each
required proof class invokes real assertions rather than naming a source anchor.
The focused invariant suites cover relational state, trusted chronology,
context-loss continuation, archive retry, actual host contracts, atomicity, and
the Session v4-only boundary.

The deterministic host proof classes exercise the actual registered handlers:
`registered_host_final_path` covers final recovery and
`registered_host_calls` covers the host contract corpus. They are not a packed-
host claim. Executable packed-plugin proof belongs to the separate pinned
OpenCode live-smoke release gate.

S4-HOST-01 does not treat advertised schema as enforcement. The supported host
can still enter a handler for an invalid advertised request, so the registered
handler must parse that same host schema before the application execution
wrapper. The contract proof includes invalid handler calls and requires a host
tool error with no Flow state read or mutation.

Unavailable historical data is displayed as `unavailable`, never converted to
zero. Reconciliation compares replay-derived host-backed aggregates to the
verified host facts, reports absolute and percentage deltas, and uses a 1%
tolerance. Each metric is classified `matched`, `mismatched`, or `unavailable`,
and the aggregate is `matched` only when every expected host-backed metric was
derived within tolerance. An expected metric that replay did not derive is
`unavailable` and drags the aggregate to `unavailable` (never `true`); a derived
metric outside tolerance makes the aggregate `mismatched`. The live prompt
baseline is 26,947 characters and an estimated 6,737 tokens; it is not conflated
with the supplied four-invocation observation.

## Rollback

If privacy validation, schema validation, or reconciliation fails, delete only
the generated report. Do not replace the repository control fixture. Removing
the Phase 0 fixture, `src/application/replay/**`, report script, replay tests,
package command, this document, and the Phase 0 implementation entries in the
project plan fully rolls back the replay harness because no production behavior
is changed.
