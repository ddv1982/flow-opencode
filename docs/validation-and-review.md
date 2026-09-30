# Validation and Review

These are the validation, review, and closure invariants in
[the maintainer contract](maintainer-contract.md).

Before edits, inventory exact and behavioral evidence, required environments,
and authorized commands. Give workers and reviewers the relevant adversarial
checklist for failure ordering, adjacent transitions, repeated/interrupted
operations, overlapping invariants, and platform/mode risks. Concurrency work
uses a bounded matrix of state/interleaving, event, outcome, cleanup/invariant,
and evidence. Keep race-heavy lifecycle invariants separate from independent
UI, persistence, and accessibility outcomes.

Discover the gate from repository instructions, docs, CI, then manifests and task
fit. Record the source and rationale in `decisions` when ambiguous.

The host retains one immutable feature baseline across retries. Review packets
map IDs to current evidence and relevant risk matrices, preserving prior findings.
When resuming attempt 2 or later without prior findings in conversation, the
manager reads detail once and recovers their IDs from superseded runs before
preflight.

Known missing required behavior or environment proof forbids review, even after
an unrelated broad pass. The reviewer blocks if that gap reaches review.
Beyond declared entries, no skipped-evidence field or parallel blocker ledger
exists. Missing evidence checkpoints for direction through reset or explicit closure.

`flow_validation_start` prepares the active run, exact next Bash command, scope,
current workspace-content digest, and the host platform, which infrastructure reads
rather than the caller claiming it. The OpenCode after-hook accepts only a structured
exit code, records output completeness and digests the output. The observation is
persisted directly on the run.

Validation commands are durable and must not contain inline secrets. Raw output
is neither persisted nor projected; the command, exit code, completeness,
output digest, and source binding are the evidence. `broad` means an observation of
the plan's gate command. `savePlan` requires exactly one `gate`, or one
`gate-observe` for an all-inspect plan, and refuses a gate that selects its own
tests. `recordValidation` refuses a broad claim on another command. Nothing
decides whether the declared command is a test; [ADR 0010](adr/0010-declared-canonical-gate.md)
records why that stays a caller declaration made at planning time.

For truncated Bash output, Flow hashes the host `outputPath` only if its
bounded regular `tool-output` file matches the visible tail. Missing or
mismatched files stay incomplete; the exact command and exit code still bind.

`savePlan` requires `evidence`: one gate plus optional extra observations. Every
entry names its command, `platform`, and `assertions`. A `gate` or `extra` needs
an eligible exact-command pass on its declared platform with every named case
`passed`. Only an all-inspect plan may use `gate-observe`, without named
assertions. Its latest exact-command broad observation must have a known exit
code, complete output, current source, and the declared platform. A nonzero
exit remains failed in review and delivery; it satisfies observation, not
validation. Named commands write changed JUnit to `.flow/results.xml`; legacy
plans may supply `resultsPath` ([ADR 0012](adr/0012-named-results-over-exit-codes.md)).
Final review and `completed` closure refuse any unsatisfied entry. Feature
reviews do not require every entry, so a goal can split by what this host can
prove.
Optional feature `checks` freeze exact commands, `pass` or `observe` intent,
platform and passing assertions at approval. Every check must be satisfied before
review. Complete nonzero `observe` results remain visible without claiming a pass
or granting repair scope. Legacy `validation` strings keep their meaning.

A failed, incomplete, or source-drifted result requires a newer accepted result
of that exact command for current source across attempts. Acceptance requires
exit zero for `pass`; `observe` needs a known exit and complete output. Returning
to an old digest never revives evidence. This veto binds exact active-feature
`validation` strings, typed checks, the canonical gate and any broad observation;
Flow does not parse legacy prose into commands. Another command cannot discharge
it. Legacy Session v5 reviews remain valid. Typed assignments must reference every
check as of their creation; completed closure also rechecks immutable plan evidence.
[ADR 0009](adr/0009-scope-keyed-validation-veto.md) records why the label binds.

An armed capture waits at most 15 minutes for its exact Bash command to begin.
An unrelated Bash command cancels it. Once the exact command begins, the
after-hook remains eligible even if the command finishes after that original
waiting deadline. Session, run, source, exit-code, and output-completeness gates
still apply.

Final review additionally requires broad scope. If the workspace digest
recomputed at persistence differs
from the digest recorded when validation was armed, the observation is recorded
as source-drifted and permanently ineligible. This endpoint comparison does not
detect a transient edit that returns to the armed bytes before persistence.
Review completion likewise fails when its recomputed current digest differs
from the assignment digest.

Each run has at most one review assignment. The runtime derives `feature` or
`final`; callers do not choose it. The hidden reviewer receives approved plan
context — including `plan.evidence`, so the commands it
is asked about are in hand rather than inferred — its full assignment, declared
artifacts, assignment-linked validation with each observation's recorded host, and
completed feature IDs. It is workspace-read-only; its allowed Flow tools are
`flow_status` and `flow_feature_complete`, while guidance limits status to its assignment and evidence pages. The platform accepts a new completion only
from the reserved reviewer identity. While that Session v5 workflow remains
active, every caller with tool access may receive the read-only result of an
exact previously accepted completion request without validation cancellation or
a session write. A failed verdict requires an evidence-backed blocking finding;
a passed verdict cannot contain one.

Reviewer guidance explicitly covers before/during/after state transitions,
failure and cleanup ordering, repeated/retried/interrupted/concurrent
operations, invariants shared with overlapping features, changed artifacts, and
the manager-supplied base-diff inventory including deletions, renames, file
types, and executable modes. The reviewer treats that inventory as evidence,
not a verdict, and does not fail merely because its isolated role has no shell.
When the packet omits a relevant fact, conflicts with inspectable artifacts, or
cannot prove a material claim, the reviewer fails with a precise
missing-evidence finding naming the manager-owned reproduction, environment,
and expected observable result. It does not pass conditionally.

A finding carries an optional `scopeBlocker` boolean, valid only on a blocking
finding, set when satisfying it would require material work outside the approved
plan. The projection surfaces it as `blockedFeature.scopeBlocker` and `nextAction`
accounts for it, so routing is enforced rather than inferred from prose.

Every finding carries a stable identity in its own `findingId` field, as
`<feature-id>.R<assignment-createdRevision>-<NN>`. The reviewer sets it to a
prior ID for recurrence and omits it for a new issue, which the runtime numbers;
that composition prevents reuse after a qualifying pass drops history. The
reviewer projection supplies the still-live set as `priorFindings` with
`nextFindingIdPrefix`, each carrying its latest severity, summary, and evidence,
so carry-forward never depends on packet prose, and `flow_feature_complete`
rejects a failed result that drops a live prior ID. A passing review clears every
ID it does not repeat. The reviewer checks each claim
against current source and evidence and completes the supplied risk checklist
through its bounded matrix when applicable so independently detectable issues can
arrive in one cohort. An ordinary-review summary preserves only plan/source IDs
mapped to the active feature or explicitly supplied in its packet; a final-review
summary preserves every approved requirement or feature ID. Both report each
still-live prior finding's severity and disposition. Only a passing verdict with
current evidence may state terminal `fixed`. On a failed verdict, if repair F1 is
proven but blocker F2 fails the review, F1 remains `repair proven; terminal fixed
pending pass` with a concise evidence reference. An unproven fixed claim is marked unverified; `recurring` requires
current recurrence and `residual` a confirmed nonblocker. The summary becomes
the latest `outcomeSummary`; terminal findings retain unresolved blockers. Only
IDs fixed by a passing review leave the live carry-forward set.

A fresh close constructs its request from the compact-projected session id and
revision, a fresh operation id, the selected closure kind, and an optional
summary. An `archiveRetry` instead replays only its compact-projected request
byte-for-byte. Both run first without a prerequisite detail read. The accepted
response returns terminal data through the existing concise
`workflowData.delivery`; its latest `outcomeSummary` and terminal findings
supply only the plan-bounded, terminal-only conversational disposition map. If
delivery is absent, the manager reports the exact recovery and claims no map. A
close revision conflict requires a compact refresh. Retry only after confirming
the same session and goal while
status still permits the selected closure kind; it never closes a replacement.
`fixed` requires later passing independent review and current-source evidence;
`residual` means a confirmed nonblocking issue remains; `deferred` requires
explicit user authority for non-completed closure; and `abandoned` remains the
actual closure kind. This adds no historical-finding manifest or second ledger.

`artifactsChanged` is a caller declaration associated with the review
assignment. Flow validates bounded normalized workspace-relative paths, but it
does not prove that each path exists or changed and does not infer an exhaustive
Git delta. The rendered delivery `report` therefore labels them Flow-reported and
separates latest-attempt paths from superseded-only paths.

Result submission is the reviewer's sole lifecycle mutation. `flow_status` may
fail-closed quarantine unreadable active state; that is recovery maintenance,
not a lifecycle transition.

New runs pin an immutable Git tree plus effective dirty bytes and modes; unborn
repositories use an empty tree. Accepted existing work requires `existingWork`
with a full local commit ID and exact `ownedPaths`, granting no new scope.
Retries retain the original feature baseline. Legacy implementation runs need an explicit
existing-work declaration on a fresh/reset run or a preparation blocker. Legacy
inspection retains current-source assurance without captured baseline provenance.

Preparation verifies complete current-source evidence before assignment creation.
Missing, tampered, stale, unsafe, oversized, or changed unrelated dirty evidence
blocks without spending a review attempt. Packets allow 256 changed entries and
4 MiB total; baseline bounds are separate. Binary semantics remain review judgment.
Parent/leaf checks reject symlinks. Portable revalidation cannot promise zero
external reads during a malicious concurrent parent-directory swap.

`reviewerPager` gives context/diff page counts. Query `reviewer-evidence` status
with assignment ID, `part` and zero-based `page`, concatenating `projection.text`
in order. Each chunk is at most 8 KiB. `complete` describes the whole packet,
not one page. Context pages recover initial host truncation; no shell or private
output path is needed. Submission rechecks source and evidence.

New readers hydrate legacy v5 without inventing provenance. Older plugins may
quarantine new optional fields, retaining raw bytes.
Close active sessions before version changes; no-write downgrade is not promised.

The manager dispatches and reads compact status; it never submits the verdict. A pending assignment may be redispatched
after interruption or an unconfirmed reviewer return. A source-binding failure
instead requires reset, fresh validation, and a new review.
Manager status rechecks workspace content only while a review is pending and
projects `flow_feature_reset` when that assignment's source binding is stale.
If fingerprinting is unavailable, status fails closed with repair guidance and
does not recommend redispatch.
Observed-but-unsubmitted work fails closed. [ADR
0007](adr/0007-reviewer-owned-submission.md) records the rationale.

Every captured validation advances revision. The `[flow-validation]` marker
returns `passed` and `recordedRevision`. The revision is a concurrency token,
never permission. Reuse it for the next arm or review only while runtime gates
permit that action. Required failures block review; an accepted inspection
`gate-observe` follows the domain route. Missing or malformed markers require
compact refresh before mutation.

`source-drift`, `exit-code-unavailable`, and `output-completeness-unknown`
observations remain durable and never pass. Missing exit status records
`exitCode: null`; missing structured completeness also fails closed. Declared
named cases must pass in a fresh report; a skipped case cannot prove acceptance.
