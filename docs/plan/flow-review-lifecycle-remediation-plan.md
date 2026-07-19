# Flow Review Lifecycle Remediation Plan

Status: Phases 0–4A implemented and verified locally for the 5.2.0 cutover;
Phase 5 is locally unblocked by the completed Session v4 lifecycle hardening
plan and now awaits bounded qa-scribe validation plus the remaining supported
external-environment evidence

V4-only clarification: the successor hardening plan supersedes every
version-specific preservation, fixture, archive, test, or recovery statement
below. The target is one clean Session v4 contract. Generic malformed-v4
corruption safety remains, but no other format is recognized as Flow runtime or
canonical history evidence.

Predecessor: `docs/plan/qa-scribe-v5-harness-improvement-plan.md`

Source: sanitized structural aggregates and repository evidence from the latest
qa-scribe `opencode-plugin-flow@5.1.0` run on 2026-07-19. Raw transcripts,
prompts, tool payloads, commands, source data, and credentials remain outside
this repository.

## Implementation Checkpoint

The local implementation now includes Session v4 feature runs, source-bound
validation with command identity, durable `flow_review_start` assignments,
assignment-id-only reviewer recovery, nested atomic completion, accepted
blockers, run-scoped reset/retry truth, the nine-tool host surface, updated
manager/reviewer guidance, ADR 0003, and deterministic lifecycle/transport
coverage. Source edits now invalidate stale pending assignments while creating
their replacement, final assignment dispatch binds the exact passing feature
result, and the final feature outcome stays visibly completed until explicit
close owns the closure and archive mutation. The earlier flat worker-result
transition, standalone review/evidence mutation adapters, per-feature retry
fallback, and superseded reviewer handshake are removed. The last deprecated persisted outcome
variants (`needs_input` and `replan_required`) are removed from Session v4.

This checkpoint records the completed migration and hardening work, not current
release readiness. The successor hardening plan now proves first-binding
final-review retry recovery, trusted chronology, workspace-history-unique close
handles, quiescent closure, explicit different-goal draft closure, and
registered handler-entry enforcement. Its local completion unblocks this
plan's external Phase 5 without claiming that evidence.

Phase 0 now has a closed eight-counter lifecycle baseline and a machine-checked
14-row failure-to-test map. Phase 4 now has a direct `/flow-auto` plan-only scenario,
and completion validates causal guards, assignment identity, chronology,
verdict shape, and source-independent result semantics before measuring source.

The post-fix `bun run check` gate passed typecheck, Biome, 19/19 prompt
scenarios and 54/54 criteria, plugin/CLI/declaration builds, and 407 passing
tests with one environment-gated live test skipped inside that command (3,330
assertions).
The separately enabled pinned OpenCode 1.18.3 packed live-host smoke passed 2/2
with 373 assertions locally. Its
deterministic local-provider path now makes the real host execute
`flow_review_start`, assignment-id-only reviewer `flow_status`, and nested
`flow_feature_complete`, and verifies the persisted assignment becomes
submitted. A bounded qa-scribe tranche is intentionally not claimed by this
checkpoint; it requires an external real-project run and is the remaining
Phase 5 evidence, not compatibility code to keep in the runtime.

| Phase | Local status | Evidence |
| --- | --- | --- |
| 0. Regression oracle | Complete | Eight lifecycle counters plus 14-row machine-checked coverage map |
| 1. Feature execution epochs | Complete | Session v4 run/reset lifecycle tests |
| 2. Source-bound evidence | Complete | Changed/unchanged source and command-multiplicity tests |
| 3. Reviewer assignment handshake | Complete | Assignment capture, recovery, permissions, telemetry tests, and packed-host lifecycle smoke |
| 4. Atomic completion and guidance | Complete | Nested-result, prerequisite binding, explicit-close, pre-I/O rejection, replay, and `/flow-auto` plan-only tests |
| 4A. V4 hard-cutover cleanup | Complete | V4-native history refs, unsupported-archive isolation, reasoned invalidation, corrected active docs, and 407-pass/full live-smoke verification |
| 5. Real-project validation and release | Ready for bounded external evidence | Run the bounded qa-scribe tranche and remaining supported-environment evidence; do not add compatibility runtime |

## Outcome

Make one Flow feature cycle mechanically predictable:

1. start one feature execution;
2. record source-bound validation once;
3. create one runtime-owned reviewer assignment;
4. dispatch that exact assignment to one reviewer;
5. record one passing or blocking review result; and
6. complete, block, or reset without stale evidence from an earlier execution.

The remediation must preserve independent review, source verification,
append-only audit history, causal guards, retry limits, compact projections,
restricted evidence storage, and the rule that only the root manager mutates
Flow state. It removes model-authored causal identity and prevents review-only
state changes from invalidating unchanged-source validation.

## Verified Latest-Run Baseline

The latest run used `gpt-5.6-sol` at `high` reasoning. The earlier comparison
run used `max`; cost and latency comparisons are therefore directional rather
than controlled model-quality claims.

| Signal | Latest run |
| --- | ---: |
| Wall time | 82.9 minutes |
| Root plus child sessions | 20 |
| Input / reasoning tokens | 2,774,551 / 103,654 |
| Planned / completed features | 10 / 2 |
| Root Flow calls / response characters | 60 / 157,756 |
| `flow_feature_complete` calls / accepted completions | 17 / 2 |
| Completion rejections caused by schema, identity, or evidence lifecycle | 11 |
| Completion rejections caused by genuine failed review | 4 |
| Child reviewer `flow_status` calls / invalid payloads | 74 / 47 |
| Reviewer child sessions | 13 |
| Host-level tool errors / compactions | 1 / 1 |

The run also proved that the review gate is valuable. Its terminal blocker was
a real stale-navigation defect: success publication was guarded, but a
superseded request could still publish an error or clear a newer request's busy
state. This plan does not weaken the review verdict, retry budget, or stop
condition that caught it.

## Problem Statement

Five causal boundaries are conflated today:

- a feature in the immutable plan;
- one execution of that feature before or after reset;
- the repository source identity validated by commands;
- the mutable Flow session snapshot; and
- one reviewer assignment and its eventual verdict.

That conflation produced four observable failure classes:

1. Hidden reviewers had to guess packet hashes, evidence references, revision,
   snapshot, attempt identity, logical-pass identity, and start time. The
   manager's packets did not provide the complete assignment required by the
   runtime.
2. `flow_feature_reset` cleared the retry counter but left prior logical review
   passes applicable. Repaired work was permanently gated by stale attempts
   until the session was abandoned and recreated.
3. Validation and review evidence were checked against the latest mutable Flow
   snapshot even when source was unchanged. Recording review state therefore
   made already-passing validation stale.
4. One flat, status-dependent completion payload left required fields optional
   in the host schema. Payload repair, preliminary review persistence, and
   operation-id reuse produced repeated rejected calls with ambiguous mutation
   consequences.

## Decision Lock

These decisions are fixed before implementation:

1. **Feature executions are explicit.** A plan feature may have multiple
   execution epochs after reset. Exactly one execution may be active, and only
   evidence and review truth from that execution can complete it.
2. **History remains append-only.** Reset never deletes review attempts,
   evidence, or mutation records. It makes them historical by ending the old
   feature execution and starting a new one.
3. **Source identity and Flow snapshot have different jobs.** Source identity
   proves what was tested and reviewed. Revision/snapshot guards serialize Flow
   mutations. A review-ledger mutation cannot by itself stale unchanged-source
   validation.
4. **The runtime owns reviewer identity.** The manager never invents
   `attemptId`, `logicalPassId`, review snapshot identity, or review start time.
5. **A reviewer assignment is durable.** One manager-only assignment operation
   records the validation references, source identity, immutable packet digest,
   feature execution, attempt identity, and start time before dispatch.
6. **Reviewer output is small.** The hidden reviewer returns assignment id,
   verdict, typed findings, completion time, and terminal disposition. It does
   not reconstruct causal fields or mutate Flow.
7. **Accepted blockers are successful mutations.** Recording a genuine failed
   review returns an accepted blocked result, not a generic tool error. Tool
   errors are reserved for invalid, stale, unsafe, or uncommitted operations.
8. **Completion is atomic and discriminated.** Completed and blocked outcomes
   use one nested discriminated contract. Invalid input causes no partial
   mutation and does not consume its operation id.
9. **Session v4 is a clean cutover.** No other session format is migrated,
   hydrated, preserved as canonical history, or given a version-specific
   recovery path. The runtime carries only native feature runs and review
   assignments.
10. **One new manager tool is justified.** Add a manager-only
    `flow_review_start` runtime tool because the latest run demonstrates the
    durable host-correlation gap anticipated by the v5 harness plan. It is not a
    user-facing slash command and is denied to hidden workers.
11. **Source changes replace stale pending review work.** A new assignment start
    atomically records `source_changed` invalidation and creates the replacement;
    reset records the distinct `feature_reset` reason.
12. **Final dispatch has a durable prerequisite.** Final assignment start
    retains the exact passing feature result as a bound prerequisite. The final
    feature outcome submits only the distinct final result; Flow records both
    atomically.
13. **Feature outcome and closure are separate transitions.** A passing final
    feature outcome marks progress completed with null closure. Only
    `flow_session_close` records quiescent closure, and archive recovery uses its
    durable retry handle.

## Non-Goals

- Do not lower review depth, remove independent review, increase the two-attempt
  review budget, or auto-approve a failed review.
- Do not let a hidden reviewer write Flow state, run shell commands, load
  skills, or launch workers.
- Do not add SQLite, a transcript reader, a qa-scribe runtime adapter, a raw
  command/output ledger, or another active-state representation.
- Do not store full reviewer packets, validation output, absolute paths,
  prompts, or findings outside the existing bounded typed records and
  restricted evidence rules.
- Do not make every Flow status projection carry completion or review schemas.
- Do not infer that `high` is universally better than `max`; keep model routing
  configurable and evaluate it separately from protocol correctness.
- Do not silently migrate a live ambiguous execution or rewrite a historical
  mutation chain.

## Phase Order

| Phase | Depends on | Boundary established |
| --- | --- | --- |
| 0. Regression oracle | Current 5.1 behavior | Deterministic failing cases and metrics |
| 1. Feature execution epochs | Phase 0 | Reset-safe applicability of evidence and review truth |
| 2. Source-bound evidence | Phase 1 | Validation validity independent of review-only revisions |
| 3. Reviewer assignment handshake | Phases 1–2 | Runtime-owned, dispatch-ready review identity |
| 4. Atomic completion and guidance | Phase 3 | One accepted result call per review outcome |
| 4A. V4 hard-cutover cleanup | Phase 4 | One persisted lifecycle with no deprecated duplicate runtime state |
| 5. Real-project validation and release | Phases 0–4A | Measured proof without weakened gates |

No later phase begins until the prior phase's acceptance gate passes. Each
phase produces a recoverable checkpoint and updates the replay/control evidence
for every behavior it changes.

## Phase 0 — Regression Oracle and Invariant Baseline

### Purpose

Turn the latest run's structural failures into sanitized deterministic tests
before changing production transitions or prompts.

### Work

1. Add a provider-neutral fixture or focused deterministic scenarios covering:
   - reviewer assignment with missing causal fields;
   - a failed review followed by reset and a passing new execution;
   - unchanged source across validation, reviewer assignment, and verdict
     recording;
   - changed source after validation or review;
   - two silent validation commands with the same command class, exit code, and
     output digest;
   - malformed completion followed by a corrected retry using the same
     operation id;
   - accepted blocked review versus rejected transport input; and
   - a reviewer that never submits after assignment.
2. Record only allowlisted structural aggregates from the latest run. Keep
   reasoning setting as provenance so model comparisons cannot be presented as
   protocol causality.
3. Extend replay/report output with counters for reviewer-assignment attempts,
   invalid reviewer payloads, completion submissions, accepted blockers,
   schema rejections, evidence-only reruns, feature resets, and abandoned
   sessions.
4. Add a coverage map proving that every failure in this plan is represented
   by at least one initially failing production-contract test.

### Likely Targets

- `tests/fixtures/replay/**`
- `tests/replay-*.test.ts`
- `tests/review-lifecycle.test.ts`
- `tests/application-causal-transport.test.ts`
- `scripts/replay-report.ts`
- `docs/replay.md`

### Acceptance Gate

- New scenarios reproduce current 5.1 failure decisions without raw source
  data or unsafe strings.
- Existing nine replay scenarios remain unchanged and deterministic.
- Fixture privacy, schema, secret scan, and reconciliation pass.
- `bun run replay:report -- --fixture <new-fixture> --variant A` reports the
  baseline counters without claiming unavailable model telemetry.
- No production transition, prompt, or tool schema changes in this phase.

### Rollback

Remove only the new sanitized fixture, report fields, and focused tests. Never
copy source database or transcript content into the repository.

## Phase 1 — Feature Execution Epochs and Reset Truth

### Purpose

Make reset a clean execution boundary without deleting historical review or
evidence records.

### Work

1. Introduce a runtime-owned `featureRunId` for every `flow_run_start`.
   - It identifies one execution of one approved plan feature.
   - It is returned in execution, reviewer, mutation receipt, delta, and detail
     projections only where required.
   - It is stored on review assignments, review executions, and completion
     evidence.
2. Scope retry counters and effective logical-pass truth to `featureRunId`, not
   only `featureId`.
3. Change reset semantics:
   - close the affected active execution;
   - set the feature and dependents back to pending as today;
   - preserve all prior attempts and evidence as historical;
   - exclude prior execution truth from future completion; and
   - allocate the next run id only when that feature starts again.
4. Define the Session v4 cutover:
   - new sessions always contain native run and assignment ledgers;
   - any other version is generic unsupported input;
   - no reader fabricates run identity or carries a second active-state
     representation; and
   - no version-specific fixture can become writable runtime or canonical
     history state.
5. Update pure projections and replay reducers so contradictory verdicts block
   only within the same active feature run and immutable review packet.

### Likely Targets

- `src/domain/session.ts`
- `src/domain/transitions.ts`
- `src/application/schema.ts`
- `src/application/flow-service.ts`
- `src/infrastructure/fs/session-repository.ts`
- `tests/domain-transitions.test.ts`
- `tests/review-lifecycle.test.ts`
- `tests/causal-state.test.ts`
- `tests/workspace-persistence.test.ts`

### Acceptance Gate

- A blocked feature can be reset, restarted, repaired, reviewed, and completed
  without archiving or recreating the session.
- Old failed logical passes remain visible in detail/history but cannot gate the
  new feature run.
- A reset clears only active applicability and run-scoped retry budget; it does
  not delete ledger records.
- Dependent feature resets receive new execution identity only when restarted.
- Exact reset replay remains idempotent and conflicting operation reuse fails.
- Generic non-v4 input fails closed without silent mutation or a compatibility
  branch.

### Rollback

Do not remove run identity from a persisted active session. Roll back the
release as a whole or require the feature to be reset/archived with the version
that created the run identity.

## Phase 2 — Source-Bound Evidence and Observation Multiplicity

### Purpose

Keep evidence valid for unchanged source while preserving causal auditability
and exact command multiplicity.

### Work

1. Separate capture metadata from applicability:
   - keep `capturedAtRevision` and `capturedAtSnapshotId` for audit;
   - use `sourceDigest` plus `featureRunId` to decide whether validation remains
     applicable; and
   - require current source identity to match again at completion.
2. Add a runtime-derived `commandDigest` or equivalent safe observation
   identity. Exact commands remain outside model-visible evidence records, but
   two different commands in the same class cannot collapse merely because
   both produced empty output at the same coarse timestamp.
3. Preserve observation multiplicity explicitly. Completion must match each
   declared validation observation, not only class/status counts or unique
   evidence ids.
4. Make review packet evidence bind to:
   - feature run;
   - source digest;
   - validation evidence references;
   - immutable packet digest; and
   - review kind.
5. Define staleness precisely:
   - review-ledger and receipt-only revisions do not stale evidence;
   - source changes do stale validation and review assignments;
   - feature reset ends applicability even when source is unchanged; and
   - final broad validation must postdate the last functional source change.
6. Keep restricted artifact integrity and no-clobber publication unchanged.

### Likely Targets

- `src/domain/session.ts`
- `src/domain/transitions.ts`
- `src/domain/validation-command.ts`
- `src/application/flow-service.ts`
- `src/application/ports/source-identity.ts`
- `src/infrastructure/fs/source-identity.ts`
- `tests/causal-state.test.ts`
- `tests/source-identity.test.ts`
- `tests/evidence-artifact-persistence.test.ts`
- `tests/runtime-gates.test.ts`

### Acceptance Gate

- Recording a reviewer assignment or review verdict does not force validation
  reruns when source and feature run are unchanged.
- Any functional source edit invalidates the prior validation and review packet.
- Two silent commands with identical output digest and command class produce
  two distinguishable applicable observations.
- Review-only state changes retain the same source applicability while causal
  revisions still advance and replay exactly.
- Reset invalidates prior-run applicability without deleting evidence.
- Restricted evidence permission, symlink, size, integrity, and concurrency
  tests remain green.

### Rollback

Evidence records created with run-scoped applicability remain readable audit
history. Do not reinterpret them as legacy snapshot-bound evidence; roll back
only before such records are published or retain the new reader while disabling
new capture.

## Phase 3 — Runtime-Owned Reviewer Assignment Handshake

### Purpose

Give the hidden reviewer one exact assignment instead of asking it to invent or
rediscover causal identity.

### Work

1. Add manager-only `flow_review_start`.
   - Inputs: operation id, causal guards, feature id, review kind, bounded packet
     content, validation observations/references, and optional safe risk lenses.
   - Runtime derivations: current source identity, feature run, packet digest,
     attempt id, logical-pass id, review start time, required depth, and
     applicable evidence references.
   - Persist only the bounded assignment metadata and digests needed for audit
     and recovery; do not persist the full prompt packet.
2. Return a canonical dispatch envelope the manager can paste verbatim into the
   reviewer task. It contains every identity field the reviewer may echo and no
   state-changing capability.
	3. Simplify reviewer recovery status to
	   `flow_status { request: { view: "reviewer", assignmentId } }`.
   - No packet hash, evidence list, revision, snapshot, or feature id is guessed
     by the reviewer.
   - A stale or completed assignment returns one curated result.
4. Change hidden reviewer output to:
   - assignment id;
   - verdict;
   - typed findings;
   - completion time; and
   - terminal disposition.
   Runtime derives immutable attempt, pass, feature, run, source, packet,
   and start fields from the assignment.
5. Record pending/unsubmitted assignment truth explicitly. A missing reviewer
   response is recoverable and cannot silently disappear or count as passed.
6. Deny `flow_review_start` to every hidden worker and keep the root manager as
   the sole caller of state-changing Flow tools.

### Likely Targets

- `src/domain/session.ts`
- `src/domain/transitions.ts`
- `src/application/flow-service.ts`
- `src/application/schema.ts`
- `src/platform/opencode/tools.ts`
- `src/platform/opencode/config.ts`
- `skills/flow-run/SKILL.md`
- `skills/flow-review/SKILL.md`
- `skills/flow-review/references/hidden-reviewer-contract.md`
- `tests/opencode-schema-contract.test.ts`
- `tests/review-telemetry-integration.test.ts`
- `tests/prompt-quality.test.ts`

### Acceptance Gate

- The canonical feature-review path needs exactly one successful assignment
  call before each reviewer dispatch.
- Hidden reviewers make zero invalid `flow_status` calls in prompt evaluation
  and the packed-host smoke's assignment-id-only recovery call.
- The manager and reviewer never author attempt id, logical-pass id, review
  snapshot id, source digest, evidence id, or start time.
- Retrying one logical pass creates a new attempt under the same runtime-owned
  pass id; reset creates a new run and therefore a new pass.
- An exact assignment replay is idempotent; conflicting operation reuse fails
  before dispatch.
- Reviewer projection remains within its 3,000-byte budget.

### Rollback

`flow_review_start` is introduced together with the new completion contract in
one minor release. Do not leave assignments writable without a compatible
result-recording path. Rolling back before release removes the tool, assignment
state, guidance, and tests as one unit.

## Phase 4 — Atomic Completion Contract and Manager Guidance

### Purpose

Make one accepted call record either completed work or a genuine review blocker,
with no partial mutation hidden behind a generic error.

### Work

1. Replace the flat status-dependent host envelope with one strict nested
   discriminated request:
   - targeted `completed`: summary, changed artifacts, validation scope, and one
     passing feature-assignment result;
   - broad `completed`: summary, changed artifacts, validation scope, and one
     passing final-assignment result, with its feature result supplied by the
     durable bound prerequisite;
   - `blocked`: summary, failed assignment result, and optional resolution hint.
2. Use assignment ids instead of resubmitting attempt, packet, snapshot, and
   start identities in completion.
3. Make completion atomic:
   - invalid schema, stale guard, missing assignment, or changed source records
     no mutation and does not consume the operation id;
   - an accepted failed review records its execution, consumes genuine retry
     budget, blocks when appropriate, and returns operation status `ok` with the
     blocked session projection/receipt;
   - an accepted passing result records review truth and completes the feature
     in one transaction.
4. Make every mutation response state its consequence explicitly:
   `operationAccepted`, `operationIdConsumed`, revision, snapshot, feature run,
   changed fields, and next action.
5. Update manager guidance to the exact ordinary sequence:
   `validate -> flow_review_start -> dispatch envelope -> one completion result
   -> compact status`.
	6. Preserve final-feature economy order:
	   targeted validation, feature assignment/review, one authorized repair/retry,
	   broad validation after the last source edit, final assignment bound to the
	   exact passing feature result, final review, and one atomic broad outcome
	   carrying only the final-assignment result.
7. Clarify planning UX: an explicit request to stop after planning pauses after
   the saved approval summary even when invoked through `/flow-auto`; autonomous
   implementation begins only when the user's request authorizes it.
8. Add examples for successful completion, accepted blocker, stale source,
   unsubmitted reviewer, reset/restart, and exact replay.
9. On changed source, invalidate a stale pending same-run assignment with an
   explicit reason while creating its replacement in one accepted transition.
10. Leave closure null at the final feature outcome. Make `flow_session_close`
	    start the only closure mutation and recover archive publication only through
	    the durable retry handle.

### Likely Targets

- `src/application/schema.ts`
- `src/application/flow-service.ts`
- `src/domain/transitions.ts`
- `src/platform/opencode/tools.ts`
- `src/prompt-surfaces.ts`
- `src/prompt-quality.ts`
- `skills/flow/SKILL.md`
- `skills/flow-run/SKILL.md`
- `skills/flow/references/recovery-playbook.md`
- `docs/maintainer-contract.md`
- `docs/review-lifecycle.md`
- `docs/causal-state.md`
- `tests/runtime-gates.test.ts`
- `tests/opencode-schema-contract.test.ts`
- `tests/prompt-quality.test.ts`

### Acceptance Gate

- A passing non-final feature uses one accepted completion call.
- A genuine failed review uses one accepted blocked-result call and still
  prevents later features from starting.
- Malformed input cannot append review executions, evidence, mutations, or
  retry counters.
- The response always tells the manager whether the operation id was consumed.
- Prompt evaluation contains no path that asks a reviewer to invent causal
  identity or a manager to repair a partially accepted completion payload.
- Explicit plan-only scenarios stop before implementation; ordinary autonomous
  scenarios still progress without an unnecessary user prompt.
- Final review cannot dispatch without the passing feature result, and the broad
  outcome submits only the final-assignment result.
- The final feature outcome has no close mutation; explicit close owns it and
  only its durable retry handle can resume failed archive publication.
- Ordinary receipts remain below 2,000 bytes and execution below 12,288 bytes.

### Rollback

Treat the assignment and nested completion contracts as one 5.2 cutover. Do not
maintain a prompt-visible dual completion schema. Before release, revert the
tool, runtime, guidance, and fixtures together; after release, retain readers
for persisted assignment/run metadata even if assignment creation is disabled.

## Phase 4A — V4 Hard-Cutover Cleanup

### Purpose

Finish the clean cutover by removing deprecated duplicated persisted summaries
and ensuring noncanonical state cannot become actionable Session v4 state.

### Work

1. Replace duplicated history fields (`validationRun`, `featureReviewDepth`,
   `featureReview`, and `finalReview`) with native `featureRunId`, validation
   evidence refs, and review assignment ids. Derive diagnostic summaries from
   the canonical evidence, assignment, and review-execution ledgers.
2. Delete the orphaned persisted review/validation summary types and schemas.
3. Keep strict JSON parsing for every canonical archive. Canonical history
   accepts only Session v4; generic non-v4, malformed, unversioned, corrupt,
   current-v4-invalid, filename-mismatched, or ambiguous input fails closed.
4. Mark pending assignments `invalidated` when reset closes their feature run.
   Reviewer recovery and exact assignment replay must report that accepted
   historical identity as consumed but no longer actionable.
   Source-changed replacement records `source_changed`; reset records
   `feature_reset`.
5. Correct the active wiki, tool count, replay baseline label, and lifecycle
   documentation. Use only a generic non-v4 sentinel where strict version
   rejection needs proof.

### Acceptance Gate

- No reader, migrator, adapter, public schema, tool alias, or writable
  representation exists for another session format.
- A freshly serialized Session v4 has no deprecated flat history fields.
- Canonical history accepts Session v4 only; generic non-v4, malformed,
  unversioned, and invalid-v4 archives fail closed.
- Reset assignments are retained for audit but cannot be projected or replayed
  as active reviewer work.
- Active documentation describes nine tools and the assignment-based contract.
- Focused regression tests, `bun run check` (407 pass, one gated skip, 3,330
  assertions), the packed live-host smoke (2 pass, 373 assertions), and
  `git diff --check` pass.

### Rollback

Revert this cleanup only together with the unreleased Session v4 cutover. Do
not restore another reader or dual persisted history representation.

## Phase 5 — Real-Project Validation, Model Routing, and Release Gate

### Purpose

Prove the new lifecycle under realistic long-running work and release only when
protocol correctness improves without weakening defect detection.

### Work

1. Run a bounded qa-scribe validation tranche of at most three approved
   features. Keep the larger maintainability roadmap in documentation rather
   than one ten-feature runtime session.
2. Run the primary case with `high` root reasoning. Use configurable reviewer
   routing for a second narrowly scoped detailed/concurrency review when
   practical; do not change provider-neutral core state or hard-code a model.
3. Collect only sanitized aggregates. Separate protocol metrics from model,
   task-risk, and feature-progress observations.
4. Compare against both 5.1 runs without claiming a controlled benchmark.
5. Run full deterministic replay, transport budgets, prompt evaluation, package
   smoke, pinned live OpenCode smoke, and the supported OS/Node matrix.
6. Update troubleshooting, changelog, README/runtime surface, maintainer
   contract, and the original v5 harness plan's checkpoint with the accepted
   follow-up evidence.

### Release Gates

All are required:

- the Session v4 lifecycle hardening plan is locally complete with no unresolved
  P1/P2 findings;
- zero invalid reviewer assignment/status payloads;
- zero completion schema rejections on the canonical path;
- one completion-result call per review outcome;
- zero validation reruns caused solely by review-ledger revisions;
- reset/restart completes without abandoning or recreating the session;
- two different silent validation commands retain two observations;
- a real blocking reviewer finding still blocks and consumes retry budget;
- stale source still prevents completion;
- no hidden worker gains mutation, shell, skill, or subagent permission;
- compact, execution, reviewer, receipt, and delta byte budgets pass;
- the existing replay decisions remain identical except for scenarios whose
  terminal behavior this plan explicitly changes;
- `bun run check` passes;
- packed plugin live smoke passes against the pinned supported OpenCode host;
- no raw real-project session data enters the repository; and
- release notes describe the user-visible workflow rather than only internal
  causal machinery.

### Rollout and Rollback

- Ship as a minor release because it adds a runtime tool and changes the
  model-facing completion contract.
- Keep `opencode-plugin-flow@5.1.1` as the rollback version until the
  real-project validation and live-host gates pass.
- Do not auto-migrate another session format; start a native Session v4
  workflow from valid input.
- If real-project validation exposes a protocol defect, stop rollout and
  preserve the failed session as investigation evidence; do not relax review
  or stale-source gates to obtain completion.

## Failure-to-Phase and Test Coverage

| Observed failure or improvement | Owning phase | Regression anchor |
| --- | --- | --- |
| 47/74 invalid child reviewer status calls | Phase 3 | `opencode-schema-contract.test.ts`: rejects the legacy reviewer identity handshake |
| Missing packet-provided attempt/pass/start/evidence identity | Phase 3 | `review-assignment-lifecycle.test.ts`: captures validation once, recovers by assignment id, and completes atomically |
| Reset preserved stale applicable logical passes | Phase 1 | `review-assignment-lifecycle.test.ts`: reset starts a fresh run whose review truth excludes the prior blocker |
| Session abandonment/recreation required after reset | Phase 1 | Same reset/restart/completion regression above |
| Review-only revisions invalidated unchanged-source validation | Phase 2 | `application-causal-transport.test.ts`: measures source and artifacts at assignment, then source at fresh completion only |
| Silent same-class validations collided | Phase 2 | `review-assignment-lifecycle.test.ts`: retains two silent same-class validations as distinct observations |
| 11 schema/identity/evidence completion rejections | Phases 2–4 | `review-lifecycle-coverage-map.test.ts`: malformed, stale, missing-assignment, and accepted-blocker anchors |
| Ambiguous partial mutation and operation-id consumption | Phase 4 | `review-assignment-lifecycle.test.ts`: invalid completion consumes nothing and corrected reuse succeeds |
| Changed source left stale pending review identity blocking replacement | Phases 2–4 | `review-assignment-lifecycle.test.ts`: source changes invalidate stale assignments and allow replacement without reset |
| Final review could dispatch before a passing feature result existed | Phase 4 | `review-assignment-lifecycle.test.ts`: final review binds one passing feature result before dispatch |
| Final completion manufactured closure outside a close operation | Phase 4 | `workspace-persistence.test.ts`: archives and clears completed sessions |
| Archive recovery could adopt closure through a different close request | Phase 4 | `workspace-persistence.test.ts`: never overwrites an existing archive on session-id collision |
| Explicit plan-first request continued into execution | Phase 4 | `prompt-quality.ts`: `flow-auto-plan-only` |
| High versus max reasoning confounded protocol conclusions | Phase 5 | Lifecycle baseline preserves `high` inference effort as provenance |
| Genuine stale-navigation defect was caught and blocked | Preserved invariant; Phases 0 and 5 verify it | `runtime-gates.test.ts`: failed review retry budget blocks after one autonomous retry |

Every row has one primary owner. This table remains provenance for the original
remediation only. The successor hardening plan replaces source-name anchors with
the executable invariant and proof-class registry verified by
`tests/review-lifecycle-coverage-map.test.ts`; that registry is the current
release authority.

## Definition of Done

The remediation is complete only when:

1. feature run, source identity, Flow snapshot, reviewer assignment, and verdict
   are distinct typed concepts;
2. reset starts a fresh executable review/evidence epoch without deleting
   history;
3. the runtime, not the model, owns all causal review identity;
4. validation survives review-only state changes but never source changes;
5. one accepted completion result records pass or blocker atomically;
6. application, registered, emitted, executed, prompt, and documented schemas
   expose the same strict nested request contract;
7. canonical real-project validation reaches meaningful implementation work without protocol
   recovery loops; and
8. independent review still stops the run on a real defect.
