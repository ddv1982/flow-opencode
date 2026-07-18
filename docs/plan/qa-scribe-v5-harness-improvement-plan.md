# Long-running harness improvement plan

Status: in progress; four-phase remediation locally accepted on 2026-07-18,
while the original historical same-corpus Phase 2 gate remains unavailable

Case study: qa-scribe on `opencode-plugin-flow@5.0.0`

Plan baseline: flow-opencode HEAD `3118348` on 2026-07-18

## Outcome

Improve Flow's long-running coding harness in six strictly gated phases:

1. establish a sanitized, deterministic replay oracle;
2. correct review lifecycle and telemetry;
3. make state causal, compact, and snapshot-bound;
4. make dispatch, handoffs, and completion structurally typed;
5. reduce prompt and context cost without moving hard rules into prose;
6. retain only bounded orchestration that demonstrates measurable value.

No later phase begins until the prior phase's acceptance gate passes and its
checkpoint is recoverable. The current prompt-driven path remains the control
until the Phase 5 rollout gate promotes bounded economy mode.

## Non-negotiable invariants

- Fail closed on invalid or stale state.
- Keep approved plans immutable and allow only one active feature.
- Preserve independent review, broad final validation, bounded repair, and
  durable recovery.
- Keep all state-changing Flow calls with the root manager.
- Keep hidden worker permissions strict and prohibit recursive reviewer or
  verifier spawning.
- Never trade correctness gates for lower token cost or higher completion rate.
- Never assume cached tokens make oversized context harmless.
- Never store raw private transcripts, credentials, reasoning, secret-bearing
  database rows, or unrestricted tool output in fixtures or checkpoints.
- Never add provider-specific fields to core domain state.
- Never silently migrate, overwrite, or destroy an existing Flow session.
- Do not add a public tool or deterministic conductor without a demonstrated
  host/runtime gap.
- Do not commit, push, publish, alter branches, or archive sessions without
  explicit authorization.

## Verified starting point

The following values were rechecked against current HEAD and read-only
case-study aggregates. They are baselines, not timeless product claims.

| Signal | Verified baseline |
| --- | ---: |
| Package / state schema | `5.0.0` / strict Session v3 |
| Focused prompt/runtime/schema tests | 52 passed, 0 failed |
| Deterministic prompt evaluation | 18/18 scenarios; 52/52 criteria |
| Current `flow-auto` | 26,947 characters; 6,737 estimated tokens |
| Case sessions / children | 46 / 45 |
| Case tool parts | 3,314 |
| Case host input / cache-read tokens | 6,673,027 / 98,713,088 |
| Case host output tokens | unavailable (`provider_unavailable`) |
| Case compaction parts | 4 |
| Root Flow tool calls / result characters | 92 / 1,007,950 |
| Child `flow_status` calls / result characters | 28 / 455,038 |
| Reviewer task dispatches / reviewer child sessions | 30 / 26 |
| Observed reviewer executions | 7 |
| Prompt / result characters | 103,813 / 255,269 |
| Tool / message errors | 17 / 2 |
| Tool latency p50 / p95 / total | 9 ms / 185 ms / 11,661,273 ms |

The exact case counts in this table were independently rechecked with safe,
read-only case-study aggregates over session IDs, agent classes, part types,
token columns, tool names, and result lengths. No prompt, transcript, tool-input,
tool-output, credential, or message prose was selected, and no source database
belongs in this repository.

Current source also confirms:

- most successful ordinary mutation responses embed the full
  `summarizeSession` projection; successful `flow_session_close` is the
  archive-only exception;
- that projection repeats feature data under active, next, pending, and full
  feature views;
- review attempts are counted only through a structurally valid
  `flow_feature_complete` submission;
- successful completion clears the current per-feature failed-review counter;
- orchestration counts are manager-declared and pass IDs are deduplicated only
  within a bounded retained window;
- `validateFlowWorkerHandoff` is offline-only and does not intercept a hidden
  worker's returned text.

The following supplied observations still require Phase 0 semantic
reconciliation before they become replay labels: the final repair pass's 78.2%
reviewer input share, failed-to-passed logical-pass
causality, the exact 80-file/5,657-line review packet, and terminal verdict
ordering. Phase 0 must also reconcile the supplied 108,102-character
four-invocation observation and label the first active-final false block
explicitly.

## Phase ordering and dependency rule

| Phase | Depends on | Primary decision unlocked |
| --- | --- | --- |
| 0. Trace and replay | Current baseline only | A trustworthy oracle and metric collector |
| 1. Review lifecycle | Phase 0 replay | Truthful review and retry semantics |
| 2. Causal compact state | Phase 1 identifiers and verdict model | Revision, snapshot, evidence, and compact transport |
| 3. Typed contracts | Phase 1 attempts + Phase 2 guards/artifacts | Runtime-validated dispatch and completion |
| 4. Prompt economics | Phases 1-3 structural enforcement | Small router and phase addenda |
| 5. Bounded rollout | All prior phase metrics | Economy default, optional latency experiment |

Every phase produces:

- a before/after replay report for every metric it changes;
- a versioned, sanitized checkpoint with base revision, diff manifest,
  changed-file statistics, validation evidence, review result, and next-step
  packet;
- focused tests plus the shared regression gates;
- an explicit rollback path;
- updated architecture/prompt documentation for behavior that actually landed.

Checkpoint manifests may be committed only when sanitized and intentionally
reviewed. Raw traces, prompts, handoffs, stdout/stderr, and database extracts
stay outside the repository and outside `.flow/**`. Every committable fixture
or checkpoint summary uses a closed structural allowlist, rejects arbitrary
prose, absolute paths, commands, environment values, and output, and passes the
same secret/privacy scan as the Phase 0 fixture. Cache records and raw validation
commands are never committed; only allowlisted aggregate cache metrics may
enter a report.

## Phase 0 — Sanitized trace and deterministic replay

### Purpose

Build the oracle before changing orchestration behavior. This phase must not
change production tools, prompts, state transitions, or session schema.

### Work packages

1. Define a versioned sanitized event contract.
   - Add host-neutral trace and replay types under `src/application/replay/**`.
   - Include fixture-local session, operation, worker/pass, snapshot, and
     evidence identifiers; sequence; relative latency; event kind; revision;
     role/model class; token/cache fields; prompt/result character counts;
     validation/review/retry/compaction/schema-failure fields; and terminal
     reason, duplicate-finding fingerprints, and duplicate-finding counts.
   - Permit typed absence for historically unavailable fields.
   - Forbid raw prose, unrestricted paths, environment values, command
     arguments, credentials, findings, prompts, and tool outputs.

2. Keep case-study collection outside the product repository.
   - Treat qa-scribe and its OpenCode database as investigation-only inputs.
   - Do not add a SQLite reader, database dependency, source-data adapter, or
     case-specific runtime path to flow-opencode.
   - Record only the already verified aggregate baseline and generic replay
     scenarios in the repository fixture.
   - Normalize identifiers, record sanitized projection hashes, and fail if an
     unapproved string payload or secret-like key would enter the fixture.

3. Keep only the sanitized corpus in the repository.
   - Store the project-neutral fixture and reconciled metrics under
     `tests/fixtures/replay/long-running-v5/**`.
   - Cover the nine required scenarios: active final feature awaiting review;
     contradictory feature/final verdicts; failed-to-passed retry; unsubmitted
     review failure; malformed optional telemetry; empty/malformed handoff;
     stale validation; unchanged finding retry; and crash/replay around a
     mutation.
   - Use opaque finding fingerprints and generic scenario labels.

4. Build the deterministic replay engine.
   - Reuse pure transitions, deterministic clock/ID providers, temp workspaces,
     and fault-injected repository transactions.
   - Emit decisions, state digests, counters, and evidence references only.
   - Preserve the current prompt-driven path as variant A/control.

5. Add reconciliation, privacy, and report gates.
   - Add replay, fixture-schema, secret-scan, crash-recovery, and metric
     reconciliation tests.
   - Add `scripts/replay-report.ts` with JSON and concise human output.
   - Report host facts, Flow-ledger claims, and replay-derived facts separately;
     never coerce unavailable provider telemetry to zero.

### Phase 0 acceptance gate

- The repository aggregate baseline matches the independently verified
  investigation metrics exactly; later replay variants reconcile within 1%.
- The verified aggregate starts at 46 sessions, 45 children, 3,314 tool parts,
  6,673,027 input tokens, 98,713,088 cache-read tokens, and four compactions.
- All nine scenarios reproduce deterministic terminal decisions from trace plus
  durable state.
- The sanitized fixture passes an allowlist validator and secret scan.
- No production prompt, state transition, public tool, or Session version
  changes.
- The focused 52 tests, prompt quality, full local check, and supported live
  smoke remain green.

### Rollback

Delete only generated replay reports that fail validation. Source case data and
the prompt-driven runtime remain untouched; no source-data extractor is part of
the repository.

## Phase 1 — Correct review lifecycle and telemetry

### Purpose

Make review execution, verdicts, retries, and worker accounting truthful before
optimizing any transport or prompt.

### Work packages

1. Introduce review execution records.
   - Add append-only attempts with `attemptId`, `logicalPassId`,
     `featureId`, review kind, review-snapshot reference, verdict, findings,
     timestamps, and terminal disposition.
   - Phase 1's minimal `reviewSnapshotId` is an immutable review-packet/source
     digest used only to correlate verdicts. Phase 2 generalizes it into causal
     session revision, state snapshot, and evidence identities.
   - Maintain a logical-pass projection whose latest valid attempt can move
     from failed to passed without deleting prior attempts.
   - Count feature-review attempts, final-review attempts, verdicts, and retry
     consumption separately.

2. Make findings stable and actionable.
   - Use exactly these classes:
     `implementation_defect`, `regression_coverage_gap`,
     `evidence_gap`, and `advisory`.
   - Require blockers to identify the violated requirement/risk and concrete
     evidence.
   - Compute a stable fingerprint from normalized taxonomy, subject,
     requirement/risk, and evidence locator; exclude attempt/time so unchanged
     retry findings deduplicate.

3. Split review recording from completion success.
   - Parse and persist valid core review evidence before applying completion
     gates.
   - Parse optional orchestration telemetry separately; malformed telemetry
     produces a bounded warning and cannot erase a valid failed review.
   - Record every observed execution even when completion is rejected or the
     manager fails to submit a successful completion.

4. Reconcile declared and observed workers.
   - Keep current orchestration records as declared intent.
   - Add observed child/reviewer execution counters from a verified OpenCode
     lifecycle event path.
   - Run a focused host-capability spike against the installed plugin event
     surface before choosing the adapter. If the host cannot provide trustworthy
     child lifecycle identity, mark counts `unreconciled`; do not invent them
     and do not add a new public tool.

5. Correct final-feature sequencing and guidance.
   - Define the economy sequence as targeted validation, feature review,
     authorized bounded repair/retry, broad validation after the last
     functional edit, final review, then atomic completion.
   - Previous features must be completed. The active final feature may remain
     `in_progress` with implementation and targeted evidence ready; that
     expected pre-completion state is not a blocker.
   - Economy mode cannot dispatch final review before feature review passes.
   - Any future speculative latency mode must use one immutable snapshot and
     reconcile contradictory verdicts before completion.

### Phase 1 acceptance gate

- Active final work is never blocked solely because atomic completion has not
  happened yet.
- Economy mode never launches final review before a passing feature review.
- Two valid failed attempts exhaust the documented budget even when optional
  telemetry is malformed.
- A failed-to-passed retry leaves the logical pass truthfully passed while
  preserving both attempts.
- Replay reports all seven reviewer executions from observed trace
  evidence rather than a ledger count of zero. If the supported host cannot
  reconcile live child identity, the ledger says `unreconciled`, never zero.
- Same-snapshot contradictory verdicts cannot survive completion.
- All current validation/review/closure gates remain fail closed.

### Compatibility and rollback

Prefer additive strict defaults for new v3 fields during Phase 1, matching the
repository's existing sparse-v3 compatibility pattern. Do not bulk rewrite old
sessions or fabricate retrospective attempts. If the design requires a semantic
version boundary, stop and approve an explicit, backup-first migration before
implementation. Latency policy remains off; rollback disables new routing but
never deletes execution history.

## Phase 2 — Compact, revisioned, snapshot-bound state

### Purpose

Keep the full durable ledger while making every model-visible view causal,
bounded, role-scoped, and cheap.

### Work packages

1. Add causal guards and immutable identities.
   - Add a monotonic revision and current snapshot ID (or an equivalent
     canonical state digest).
   - Each committed mutation advances the revision exactly once and records
     operation ID, prior/current snapshot, changed entity/fields, blocker
     delta, evidence references, and timestamp.
   - Completion-sensitive mutations require expected revision and snapshot.

2. Bind validation and review evidence to source state.
   - Evidence includes command, cwd, start/end, exit code, redacted environment
     metadata, stdout/stderr digest or safe artifact reference, source/worktree
     digest, evidence ID, and snapshot ID.
   - Exact command/cwd evidence remains a restricted local artifact. Any
     committable summary contains only an allowlisted command class and digests,
     never raw command arguments or absolute paths.
   - Missing, stale, or digest-mismatched evidence fails closed.
   - Use hash-addressed review packets/diff manifests for safe cache reuse.

3. Split durable state from projections.
   - Keep the complete ledger on disk.
   - Add explicit compact, detail, and reviewer projections.
   - Compact status uses one canonical active-or-next feature reference,
     progress, blockers, revision/snapshot, evidence references, and next
     action; it never repeats the full feature under multiple keys.
   - Reviewer view contains only assigned scope, packet hash, evidence
     references, required depth, and expected revision/snapshot.

4. Return compact mutation receipts.
   - Return status, operation/revision/snapshot, changed entity and fields,
     blocker delta, evidence references, warnings, and next action.
   - Do not attach full session status to ordinary mutations.

5. Add delta polling.
   - Extend `flow_status` with compact/detail and `sinceRevision` semantics.
   - Equal revision returns unchanged metadata only.
   - Older revision returns a bounded ordered delta.
   - Future/invalid revision fails rather than returning guessed state.

6. Extend persistence safety to evidence artifacts.
   - Publish artifacts atomically and exclusively, verify content digests on
     read, and make crash/replay idempotent.
   - Do not silently migrate sessions. Prefer additive defaults where semantics
     remain honest; otherwise use an explicit lock/backup/validate/publish
     migration with digest-guarded rollback.
   - A version-boundary migration, if separately approved, is a standalone
     offline operation. The runtime gains no compatibility reader or automatic
     migration: unsupported active sessions remain byte-preserved through the
     existing quarantine/recovery path.
   - The offline migrator retains strict JSON and root/symlink checks, lock
     ownership, atomic/no-clobber publication, archive-collision behavior, and
     digest-guarded rollback.

### Phase 2 acceptance gate

- Six-feature compact status is at most 3,000 UTF-8 bytes.
- Ordinary mutation receipts are at most 2,000 UTF-8 bytes plus the changed
  entity.
- Reviewer pre-artifact context is at most 3,000 UTF-8 bytes.
- Same-corpus Flow tool-result characters fall by at least 70%; the verified
  1,007,950-character baseline therefore permits at most 302,385 characters.
- Current-run stateful output falls by at least 60%; unchanged polling returns
  only metadata/delta.
- Equivalent pre/post transition fixtures make the same runtime decisions.
- Stale revision, stale snapshot, missing evidence, and digest mismatch all
  fail closed.
- Crash, archive, quarantine, and rollback tests preserve readable state.

### Rollback

Keep legacy full/detail rendering available for diagnostics behind an explicit
view, not as ordinary model transport. Disable delta/compact selection if
necessary while retaining causal/evidence records. Never down-convert or
overwrite an unknown newer session.

## Phase 3 — Typed dispatch, handoffs, and completion contracts

### Purpose

Replace repeated prose schemas and all-or-nothing completion parsing with one
versioned structural contract.

### Work packages

1. Create a host-neutral contract source.
   - Define a small versioned contract specification under
     `src/application/contracts/**`, consistent with application ownership of
     use-case inputs/results.
   - Keep the specification validator-neutral. An application-side builder
     creates direct-Zod validators; a platform-side builder under
     `src/platform/opencode/**` imports the pure specification and creates
     OpenCode host-schema validators. Validator objects never cross the
     platform boundary.
   - A build/test script generates version-stamped role prompt blocks in the
     existing skill/guidance layer; `src/prompt-*.ts` continues to import only
     guidance, not application code. Drift tests compare generated content and
     hashes to the application contract source.
   - Generate contract fixtures from the same source.
   - Treat fixtures as parity oracles; no hand-maintained third schema.

2. Define typed assignments.
   - Required fields: contract version, assignment ID, role, logical/pass ID,
     row/output key, mode, expected coverage, dependencies, evidence inputs,
     output budget, write scope, expected revision, and expected snapshot.
   - Reject duplicate output keys, overlapping write scope, unknown contract
     versions, and stale guards locally.

3. Define discriminated role handoffs.
   - Echo assignment/role/pass/snapshot identity.
   - Carry typed status, coverage, compact synthesis, core evidence, artifact
     references, role-specific result, and machine-readable coverage gaps.
   - The hidden agent receives exactly one matching schema rendering.

4. Enforce runtime validation and budgets.
   - Validate before manager synthesis.
   - Empty, malformed, wrong-role, stale, or over-budget output becomes a typed
     local coverage gap.
   - Permit at most one formatting-only retry; the second failure is terminal
     partial/blocked coverage.
   - Default serialized UTF-8 budgets: 4,000 bytes ordinary; 8,000 bytes broad
     audit unless an immutable manifest explicitly raises it.
   - Externalize safe detail through hash-addressed artifact references; never
     truncate required evidence silently.

5. Split completion core from optional telemetry.
   - Core contains feature, expected revision/snapshot, outcome, validation,
     reviews, evidence, and artifact references.
   - Optional orchestration telemetry is parsed afterward and can warn but not
     erase valid core evidence.
   - Preserve the active-feature, validation, review-depth, final-review, and
     atomic-completion gates.

6. Prove the host interception seam.
   - Test OpenCode event/text-completion hooks and hidden-agent identity in live
     smoke before implementation depends on them.
   - Prefer a Flow-owned private adapter using existing hidden agents.
   - Add a narrowly permissioned hidden submission tool only if the supported
     host cannot expose complete, attributable worker output; document the
     demonstrated gap and keep it unavailable to public manager routes.
   - Any hidden submission fallback is transport-only and non-mutating: it may
     validate and return a typed envelope, but it cannot write Flow
     domain/session state, advance revisions, persist evidence or verdicts,
     consume retry budget, or complete work. The root manager remains the only
     actor that submits accepted evidence to a state-changing transition.

### Phase 3 acceptance gate

- Every accepted assignment, handoff, and completion core validates against one
  versioned contract source.
- Replay completion-schema failures are below 5%.
- Malformed optional telemetry yields a warning without losing core evidence.
- Empty/malformed handoffs fail locally and never become accepted coverage.
- One formatting retry is the hard maximum.
- Combined agent-plus-task context contains one handoff schema.
- Every completion matches the current revision and snapshot.
- Existing worker permissions remain unchanged or stricter.

### Rollback

Use a feature-flagged dual-read window for legacy plain-text handoffs, but make
new typed dispatches typed-only. Disable the new dispatcher to return to the
prompt-driven control; retain versioned artifacts and warnings for diagnosis.
Do not silently down-convert typed evidence.

## Phase 4 — Phase-specific prompts and context economics

### Purpose

Shrink prompt delivery only after lifecycle, state, and contracts are
structural and replay-measurable.

### Work packages

1. Define versioned prompt contracts.
   - Hash/version the invariant router, every phase addendum, hidden role
     contract, and guidance fragment.
   - Render stable invariant content before typed dynamic task/session data.
   - Generate and test a task envelope with Goal, Context, Constraints, and
     Done-when sections.

2. Split `flow-auto`.
   - Keep a compact invariant router that calls status and selects exactly one
     planning, running, reviewing, blocked, or archival addendum.
   - Router budget: at most 2,000 estimated tokens.
   - Each phase addendum: at most 1,500 estimated tokens.
   - Current live baseline is 6,737 tokens; the docs table's 6,779 value is
     stale and must be regenerated or corrected.

3. Add epoch-aware delivery.
   - Track delivered guidance/contract hashes by OpenCode session and observed
     compaction epoch.
   - Do not emit the same guidance ID twice in one uncompacted epoch.
   - Observe host compaction events without initiating/model-directing
     compaction or coupling plugin initialization to workspace state.
   - After compaction, rehydrate only the invariant router, current phase
     addendum, typed task envelope, and compact resume state.
   - On missing epoch metadata, conservatively rehydrate the current phase and
     record a warning; never skip a structural gate.

4. Add absolute and replay budgets.
   - Retain the current relative size-growth guard.
   - Add router/addendum/per-surface/per-session ceilings, duplicate-guidance
     characters, total emitted static tokens per epoch, unique-fragment
     diagnostics, and output budgets.
   - Report cache ratio only when the provider exposes both input and cache-read
     fields; otherwise report unsupported.

5. Expand deterministic and held-out evaluation.
   - Preserve the tuned 18/18 and 52/52 suite.
   - Add a held-out state-routing corpus and compaction/dedup fixtures.
   - Compare current and Phase 4 prompts sequentially on at least two configured
     model/provider combinations.

### Phase 4 acceptance gate

- Four-command replay uses at most 8,000 total emitted static prompt tokens in
  one uncompacted epoch.
- Duplicate guidance characters fall at least 75%.
- Router and phase addenda meet their hard ceilings.
- Current deterministic evaluation remains 18/18 and 52/52.
- Held-out routing is non-inferior within two percentage points on two
  configured model/provider combinations.
- Cache ratio is never reported for an unsupported provider.
- Compaction rehydration restores only current-phase contract and compact state.
- No correctness/safety rule that can be structural exists only in a prompt.

### Rollback

Keep the current compiled prompt set as the explicit control/fallback. A
contract mismatch rehydrates the conservative current-phase prompt and warns;
it never relaxes runtime permissions or completion gates.

## Phase 5 — Bounded orchestration, checkpoints, and rollout

### Purpose

Retain a multi-agent stage only when it demonstrates a measurable quality gain
on the labeled replay corpus. Efficiency gains are additional evidence, never a
substitute for that quality gate.

### Work packages

1. Add provider-neutral orchestration policy.
   - Economy is default: serial implementation, at most two concurrent
     read-only workers, one reviewer, one verifier, no recursive worker launch,
     and no candidate implementation without explicit authorization.
   - Latency is opt-in: at most four read-only workers and two candidate workers
     only for exact-disjoint scopes or isolated worktrees; independent review
     remains single-snapshot and reconciled.
   - Keep model and effort routing in installation config, not durable domain
     state. Preserve existing model environment variables as fallback.

2. Enforce manifest identity and scope.
   - Require unique pass/row IDs, output keys, scope hashes, parent depth,
     snapshot/packet hashes, policy version, and terminal stop reason.
   - Reject duplicate/overlapping scopes and recursive reviewer/verifier work.

3. Cache immutable review results.
   - Key by contract version, packet manifest, source/worktree snapshot, review
     depth, and role-policy version.
   - Store only redacted result, fingerprints, evidence digests, and terminal
     decision.
   - Never commit cache records. A committable cache report contains only
     allowlisted aggregate hit/miss and byte/count metrics and passes the Phase
     0 privacy scan.
   - Reuse exact keys only.
   - Reject a second retry when the normalized remaining finding-delta hash is
     unchanged.

4. Bound review packets and create virtual checkpoints.
   - Default maximum: 25 files or 1,500 changed lines.
   - Larger cohesive work requires a recorded exception and immutable virtual
     shards with file list, digest, requirement coverage, evidence references,
     and dependency graph.
   - Final review consumes shard verdict digests plus the aggregate manifest,
     not every raw diff again.

5. Publish recoverable phase/pass checkpoints.
   - Store sanitized immutable artifacts outside `.flow/**` and outside the
     worktree; commit only intentional redacted summaries.
   - Include base revision, diff/source manifest and statistics, policy/mode,
     packet/snapshot hashes, validation/review evidence, passed/failed gates,
     advisories, stop reason, and next-step reference.
   - Publish atomically/no-clobber and verify digest before resume.
   - A committable summary passes the Phase 0 closed allowlist and secret scan;
     it cannot contain raw commands, paths, prompts, findings, or output.

6. Run A/B variants on the same corpus.
   - A: current prompt-driven behavior.
   - B: lifecycle fixes only.
   - C: compact state plus typed contracts.
   - D: bounded economy orchestration with cache, packets, and checkpoints.
   - Hold fixture, labels, policy seed, provider configuration, and metric
     definitions constant.

7. Roll out in observe, canary, then default mode.
   - First record policy decisions without enforcement.
   - Enable economy enforcement for explicit canaries.
   - Promote economy only after replay, live smoke, and model-eval gates pass.
   - Keep latency experimental and disabled by default.

### Phase 5 acceptance gate

- Preserve 100% of confirmed substantive blockers in the labeled corpus.
- Reviewer calls and child sessions each fall at least 40%.
  - Case targets: at most 18 reviewer task dispatches and at most 27 child
    sessions on the same replay.
- Uncached input falls at least 50% without increased false completion.
  - Case target: at most 3,336,513 host input tokens where the provider reports
    the comparable field.
- Duplicate-finding ratio remains below 15%.
- No identical remaining finding delta is retried twice.
- Every terminal outcome includes stop reason, passed gates, failed gates,
  advisories, and evidence references.
- Checkpoint crash/recovery and exact-cache-key behavior are deterministic.
- No conductor is added unless residual live replay proves recurring mechanical
  failures that prompts, contracts, and existing transitions cannot solve.

### Rollback

Set policy back to the prompt-driven control/observe mode. Preserve append-only
checkpoints and cache records for diagnosis, but never reuse them against a
changed snapshot. Do not mutate session archives or user branches.

## Metric ownership

| Metric | Baseline owner | First phase allowed to change it | Final target |
| --- | --- | --- | --- |
| Terminal correctness / false blocks | Replay labels | Phase 1 | No false completion; active-final false block removed |
| Review attempts and logical pass truth | Host + Flow ledger | Phase 1 | Every execution recorded; retry terminal state truthful |
| Flow tool-result characters | Host trace | Phase 2 | At least 70% lower |
| Stateful model-visible output | Replay | Phase 2 | At least 60% lower |
| Completion schema failures | Replay | Phase 3 | Below 5% |
| Handoff acceptance and bytes | Typed dispatcher | Phase 3 | 100% valid; 4,000/8,000-byte defaults |
| Static prompt tokens / duplicate guidance | Prompt compiler + trace | Phase 4 | At most 8,000 over four commands; at least 75% duplicate reduction |
| Reviewer calls / children | Host trace | Phase 5 | At least 40% lower |
| Uncached input | Provider telemetry | Phase 5 | At least 50% lower where available |
| Duplicate findings | Fingerprints | Phase 5 | Below 15% |
| Latency | Host trace | Phase 5 | Report p50/p95; no fixed claim until measured |

## Validation matrix

Run after each phase:

```bash
bun run prompt:quality --json
bun test tests/prompt-quality.test.ts tests/runtime-gates.test.ts tests/opencode-schema-contract.test.ts
```

Run at each phase exit:

```bash
bun run check
```

Run where the environment supports them:

```bash
bun run smoke:live
bun run prompt:model-eval -- --model <provider/model-a> --reasoning <effort>
bun run prompt:model-eval -- --model <provider/model-b> --reasoning <effort>
```

Add and run the Phase 0/5 replay commands once implemented:

```bash
bun run replay:report -- --fixture long-running-v5 --variant A
bun run replay:report -- --fixture long-running-v5 --variant B
bun run replay:report -- --fixture long-running-v5 --variant C
bun run replay:report -- --fixture long-running-v5 --variant D
```

Model evaluations run sequentially because concurrent OpenCode processes may
contend on the local session database. Provider cost, credentials, cache fields,
and exact model availability remain environment-dependent.

## Decision gates that must not be guessed

1. **Session schema evolution.** Default to additive strict fields with honest
   absence for retrospective data. Approve an explicit backup-first version
   migration only if Phase 2 semantics cannot be represented safely.
2. **Review/handoff lifecycle hook.** Prove child identity and final-output
   interception in supported OpenCode live smoke before choosing event hooks,
   text completion, or a narrowly private submission path.
3. **Snapshot digest.** Choose and document the canonical boundary for Git and
   non-Git workspaces before caching evidence.
4. **Evidence retention/redaction.** Define artifact location, lifetime, byte
   cap, permissions, and redaction policy before persisting stdout/stderr.
5. **Compaction epoch.** Confirm how a restarted host identifies the current
   uncompacted epoch; conservative rehydration is the fallback.
6. **Latency mode.** Enable only after replay demonstrates material wall-clock
   gain with no verdict-reconciliation regression.
7. **Conductor.** Add only after live evidence satisfies the brief's residual
   mechanical-failure test.

## Project completion gate

The project is complete only when all six phase checkpoints pass, the same
sanitized corpus demonstrates preserved blockers and no false completion, the
before/after report explicitly covers correctness, false blocks, reviewer
calls, child sessions, tool errors, prompt bytes, tool-result bytes,
tokens/cache fields, latency, and recovery behavior, prompt and architecture
docs match implemented behavior, and the prompt-driven control remains
available for rollback.

## Implementation log

### Phase 0 wave manifest

Run shape: one read-only design wave, one disjoint implementation wave, and one
independent verification wave. Later phases remain blocked until every Phase 0
acceptance check is verified. Following user clarification, case-study database
collection remains outside this repository.

| Slice | Scope | Role / effort | Depends on | Verification tier |
| --- | --- | --- | --- | --- |
| P0-D1 | Event contract, allowlist, privacy and secret-scan design | explorer / low | none | single verifier |
| P0-D2 | Aggregate provenance and source-reconciliation design | explorer / low | none | single verifier |
| P0-D3 | Deterministic replay, scenarios, reporting and fault-injection design | explorer / low | none | single verifier |
| P0-I1 | `src/application/replay/**` contract, validation, replay core | worker / high | P0-D1, P0-D3 | tests + verifier |
| P0-I2 | sanitized fixture corpus, replay report CLI, package wiring and Phase 0 docs | worker / high | P0-D1..P0-D3 | tests + verifier |

Coverage gate: the three design slices partition Phase 0 into contract/privacy,
aggregate provenance/reconciliation, and deterministic replay/reporting. The two
implementation slices own disjoint path sets. Completion requires accounted
handoffs, deterministic tests, privacy validation, metric reconciliation, the
shared focused suite, and `bun run check`. No SQLite code or database artifact is
part of the deliverable.

### Phase 0 checkpoint — accepted 2026-07-18

- Added a provider-neutral `long-running-v5` fixture, closed replay contract,
  recursive privacy validator, deterministic variant-A engine, report command,
  and crash/recovery mismatch coverage.
- Independent privacy verification closed an arbitrary-slug identifier bypass by
  requiring field-specific numeric fixture-local identifiers.
- Independent scope verification confirmed every aggregate has an explicit
  baseline, the rollback list is complete, and no database artifact, reader,
  extractor, dependency, or runtime adapter is present.
- `bun run check` passed with 141 tests and one environment-dependent live smoke
  skipped. Variants B, C, and D remain structurally unsupported, as required.

### Phase 1 wave manifest

Run shape: one domain lifecycle slice, one application/transport slice after the
domain contract lands, one prompt-guidance slice with disjoint ownership, and an
independent verification wave. Phase 2 remains blocked until Phase 1 acceptance.

| Slice | Scope | Role / effort | Depends on | Verification tier |
| --- | --- | --- | --- | --- |
| P1-I1 | Review execution, finding taxonomy/fingerprint, retry truth, transition persistence | worker / high | Phase 0 | tests + verifier |
| P1-I2 | Core completion schema, optional orchestration isolation, host schema parity | worker / high | P1-I1 | tests + verifier |
| P1-I3 | Economy review ordering and completion guidance | worker / high | P1-I1 | prompt gates + verifier |

Coverage gate: P1-I1 owns `src/domain/**` and focused domain/runtime tests;
P1-I2 owns `src/application/**`, `src/platform/opencode/tools.ts`, and schema
contract tests; P1-I3 owns review/run guidance and prompt-quality fixtures. Every
review execution must survive rejected completion, optional telemetry must not
mask core review evidence, and contradictory terminal verdicts on one immutable
snapshot must fail closed.

### Phase 1 checkpoint — accepted 2026-07-18

- Added append-only feature/final review executions, stable finding
  fingerprints, logical-pass retry projection, exact-attempt idempotence, and
  strict observed-worker availability states.
- Completion summaries no longer override execution truth. Completed results
  require review evidence, failed summaries require matching failed attempts,
  final review requires a distinct execution after feature review, and only
  distinct failed attempts consume retry budget.
- Structurally valid active-feature attempts persist before later core-schema,
  validation, or optional-telemetry rejection. Malformed optional orchestration
  telemetry is dropped with one bounded warning.
- Economy guidance uses the exact targeted-validation through atomic-completion
  order, treats an active final feature awaiting review as legitimate
  `in_progress`, and keeps speculative review disabled.
- Replay provenance labels the seven executions as host-observed metadata,
  separate from the Flow ledger's zero declared workers and the nine replay
  scenario decisions.
- Three independent re-verifiers passed lifecycle, application/telemetry, and
  guidance/replay scopes. `bun run check` passed with 169 tests and one
  environment-dependent live smoke skipped.

### Phase 2 wave manifest

Run shape: establish the domain causal/evidence contract first, then implement
application projections/receipts and filesystem evidence artifacts against that
contract in disjoint slices, followed by compactness/replay integration and an
independent verification wave. Phase 3 remains blocked until Phase 2 acceptance.

| Slice | Scope | Role / effort | Depends on | Verification tier |
| --- | --- | --- | --- | --- |
| P2-I1 | Revision/snapshot/operation ledger, evidence identities, stale guards, pure projections | worker / high | Phase 1 | domain tests + verifier |
| P2-I2 | Compact/detail/reviewer status, mutation receipts, delta polling, host input parity | worker / high | P2-I1 | runtime/schema tests + verifier |
| P2-I3 | Atomic hash-addressed evidence artifact persistence and crash/replay safety | worker / high | P2-I1 | persistence tests + verifier |
| P2-I4 | Size budgets, same-decision replay comparison, docs and report metrics | worker / medium | P2-I2, P2-I3 | replay/size gates + verifier |

Coverage gate: every completion-sensitive mutation carries the expected
revision/snapshot; exact commands, cwd values, and output remain restricted
local artifacts; ordinary transport uses bounded allowlisted summaries and
digests. Compact views cannot repeat feature bodies, unchanged polling returns
metadata only, evidence reads verify content hashes, and no source database or
provider-specific adapter enters the runtime.

### Phase 2 implementation checkpoint — acceptance blocked

The four Phase 2 implementation slices are complete in flow-opencode. Session
v3 now has a canonical revision/snapshot root, append-only digest-linked
operation and evidence records, stale causal guards, exact replay identity, and
compact/detail/reviewer/delta projections. Ordinary mutations return bounded
receipts. Restricted validation output uses owner-only, immutable,
hash-addressed files under `.flow/evidence/**`; this is filesystem artifact
storage, not SQLite or another database. It has no index, extractor, qa-scribe
adapter, or provider integration.

The deterministic local report (`bun run transport:report`) records:

- six-feature compact status: 929 / 3,000 UTF-8 bytes;
- ordinary mutation response: 1,009 / 2,000 bytes, changed entity included;
- reviewer context: 1,528 / 3,000 bytes;
- unchanged polling: 339 bytes with only view/revision/snapshot metadata;
- local detail-reference output: 650,875 bytes versus 35,995 current bytes,
  a 94.46% reduction with all 14 transition signatures identical.

Independent domain/causal, application/transport, evidence-filesystem, and
measurement verifiers passed. `bun run check` passed with 209 tests and one
environment-dependent live smoke skipped. Static and artifact scans found no
SQLite dependency, database file, database reader, source adapter, or qa-scribe
runtime integration.

Phase 2 is not accepted yet. The separate historical same-corpus 70% gate is
machine-readably `unavailable`: the 1,007,950-character baseline is retained,
but the investigation attachment contains neither a sanitized
call-kind/result-shape histogram nor a complete replay corpus. Observed
characters, reduction, and pass therefore remain `null`; the report's overall
Phase 2 status is `blocked`. Per phase gating, Phase 3 has not begun. Resolving
this requires either a user-supplied sanitized aggregate/replay corpus (not a
database reader) or an explicit plan amendment replacing that historical gate.

### Remediation decision lock — 2026-07-18

Before remediation code work begins, the following design decisions are locked:

1. Completion input is one `validations[]` observation list plus
   `reviewExecutions[]`. Callers never supply `sourceDigest`, `snapshotId`,
   `evidenceId`, or `commandClass`.
2. Completion replay hashes the canonical public command and checks for an exact
   replay before recomputing derived source identity or evidence.
3. Source identity uses `source-v2`; in a sparse checkout, index-only
   materialization is real source state rather than an unreadable-path failure.
4. Replay resolves a failed logical pass only when a later attempt passes.
   Unchanged or changed findings remain failed, and unsubmitted failures block.
5. Execution UX exposes a complete active-feature execution view and enforces a
   plan-save byte-budget invariant. Required content is never silently
   truncated.

Remediation proceeds through four green phases with every verified finding
assigned exactly once:

| Remediation phase | Finding partition | Delivery boundary |
| --- | --- | --- |
| 1. Secure completion substrate | 1, 2, 7, 8, 9, 10, 12, 13 | Completion input, source identity, review/classifier parity, and compile/interface closure land together. |
| 2. Causal and replay correctness | 4, 5, 6, 11, 15 | Causal/archive/projection and replay/privacy are disjoint tracks after Phase 1. |
| 3. Execution UX and redaction | 3, 14 | Guidance and redaction consume the stabilized projection contract. |
| 4. Evidence closeout | none | Reports, documentation, checkpoint claims, and full release gates run last. |

This remediation lock does not reopen accepted checkpoints or change any
fixture corpus, metric definition, denominator, threshold, or baseline value.

### Remediation checkpoint — locally accepted 2026-07-18

All 15 remediation findings are implemented in their locked partition:

- Phase 1 rewrote `source-v2`, transaction-owned source identity, validation
  classification, reviewer policy derivation, and the observable-input
  completion boundary with exact replay-before-derivation behavior.
- Phase 2 added precise durable completion deltas, new-only evidence receipts,
  canonical archive replay lookup, exact post-archive close replay, and one
  pure strict review-pass reducer with corrected retry/unsubmitted semantics.
- Phase 3 added the complete active-feature execution projection, a 12 KiB
  plan-admission and runtime invariant, routing-only compact closure state,
  platform-independent lexical scope redaction, and one fresh/resumed manager
  path across runtime guidance and contract docs.

Phase 4 local evidence:

- `bun run check` passed typecheck, Biome, deterministic prompt quality,
  plugin/CLI/declaration builds, package smoke, and the full suite: 266 passed,
  zero failed, with one environment-gated live test skipped inside that command.
- The separately enabled pinned OpenCode 1.18.3 live smoke passed 2/2 checks
  against the packed plugin.
- Variant-A replay remained supported across all nine scenarios; every terminal
  decision and reason matched. Reducer coverage passed 38 focused tests.
- The corrected 54-response local transport comparison includes mandatory
  execution calls: 737,264 detail-reference bytes versus 44,572 current bytes,
  a 93.95% reduction with all 14 transition decisions identical.
- Six-feature maxima were 784/3,000 compact bytes, 1,069/2,000 receipt bytes,
  1,551/3,000 reviewer bytes, 1,571/12,288 execution bytes (10,717 bytes
  headroom), and 339 bytes for metadata-only unchanged polling.
- Prompt evaluation remained 18/18 scenarios and 52/52 criteria for both
  implemented variants. The bookended surface measured 16,322 estimated tokens
  versus 59,106 for the whole-skill baseline, without changing thresholds or
  baselines.
- Source-identity coverage passed all nine Git/non-Git layout tests on macOS.
  The blocking CI definition covers Ubuntu, macOS, and Windows, but the Linux
  and Windows jobs were not executed locally because this host has no
  container/VM runner and no GitHub-visible action was authorized.

The original historical same-corpus 70% result remains machine-readably
`unavailable`: observed characters, reduction, and pass stay `null` because the
sanitized histogram and complete replay corpus do not exist. This checkpoint
does not convert that unavailable gate into a pass. Optional provider-backed
prompt model evaluation was not run; deterministic prompt evaluation and the
pinned real-host smoke were run instead.

No dependency, session version, compatibility migration, database, archive
index, cache, pagination layer, or new corpus field was added. No corpus,
denominator, threshold, or baseline value was changed to obtain green output.
