# Session v4 Lifecycle Hardening Plan

Status: Locally complete — Phases 0–5 implemented and verified on 2026-07-19;
the predecessor's bounded real-project and supported-environment release
evidence remains pending

Predecessor: `docs/plan/flow-review-lifecycle-remediation-plan.md`

Release interlock: satisfied locally. The predecessor's Phase 5 real-project
validation is unblocked, but its bounded qa-scribe tranche and supported
external OS/Node evidence are not claimed here. This plan hardens a clean
Session v4-only runtime. It removes Session v3-specific readers, migrators, adapters,
quarantine/recovery handling, archives, fixtures, tests, and active guidance
rather than retaining them as historical runtime evidence. Generic protection
for malformed current-v4 state remains a corruption-safety concern, not a
version-compatibility path.

## Why this is a separate plan

The migration plan solved the original lifecycle failures, but the latest
review found five cross-boundary gaps:

1. a final assignment cannot recover its exact bound feature-assignment result
   from durable state after manager context loss;
2. actor-reported validation and review timestamps can be future-dated or out
   of lifecycle order;
3. an interrupted close cannot be reconstructed from Flow state without the
   caller retaining the original optional summary and guards;
4. the schemas actually registered with OpenCode are looser than the
   application schemas and the shadow schemas used by tests; and
5. deferred or abandoned close can clear the active feature while leaving an
   active feature run and pending review work behind.

These are not five isolated transition bugs. They reveal three missing proof
classes:

- relational invariants across the persisted Session v4 graph;
- context-loss and crash recovery from durable state alone; and
- differential proof against the contract OpenCode actually exposes.

This plan addresses those classes so later review is an invariant sign-off,
not another free-form search for the same kinds of gaps.

## Recommended decision lock

Phase 0 records these decisions in ADR 0003 before production edits:

1. **Durable state is sufficient for continuation.** If Flow accepts a
   lifecycle checkpoint, a fresh manager with only Flow status and persisted
   state can perform every legal next action.
2. **The final prerequisite is one atomic aggregate.** Replace parallel nullable
   prerequisite fields with a bound prerequisite containing the feature
   assignment id, the canonical passing result, and its digest. Binding does not
   terminalize that feature assignment or append review execution/evidence.
3. **Final completion consumes the durable binding.** The caller submits the
   final-assignment result only; Flow obtains the feature-assignment result from
   the final assignment and records both executions atomically. Every later
   final attempt for the same run and source must reuse that exact first binding;
   detail status exposes the bounded aggregate for context-loss recovery, while
   compact and reviewer status never expose the raw result.
4. **Runtime time bounds reported time.** Each accepted transition captures one
   runtime-owned acceptance time. Actor-reported timestamps must fit the
   inclusive lifecycle order and may not be later than acceptance.
5. **Closure is quiescent.** Deferred or abandoned close preserves workflow and
   plan status as forensic progress, but clears both active identities,
   terminalizes an active run with the closure reason, and invalidates every
   pending assignment for that run.
6. **Archive retry uses durable accepted identity.** Once closure is recorded,
   Flow exposes the full accepted close operation id and accepts a retry form
   keyed only by that id. Retry resumes publication/cleanup without another
   mutation or caller-supplied summary. A new close operation cannot adopt the
   closure. Because the retry key contains no session id, a new close operation
   id must also be unique across canonical workspace history before acceptance.
7. **The registered contract is the host contract.** Keep nine tools, but put
   conditionally shaped requests inside strict discriminated request objects
   that OpenCode 1.18.3 can represent. Explicitly parse those registered
   requests before invoking Flow because schema advertisement alone does not
   guarantee host-side validation. OpenCode's raw-shape registration API owns
   the outer tool-argument object and 1.18.3 omits its
   `additionalProperties` keyword; require and advertise the nested `request`,
   keep every Flow-owned branch strict, and parse the complete strict envelope
   at handler entry so unknown outer fields also fail before Flow execution.
   Do not keep a flat compatibility adapter.
8. **Session v4 is the entire supported session lifecycle.** Flow
   does not treat Session v3 as a special format and does not recognize, preserve,
   quarantine, replay, migrate, clean up, or explain it. A non-v4 version is generic
   unsupported input and can never become Flow state or Flow history. Tests use
   a generic non-v4 sentinel where strict version rejection needs proof.
9. **Every prose invariant has executable proof.** A test-name string is not
   evidence. Each invariant must be exercised at every proof boundary assigned
   to it below.
10. **Only explicit closure publishes history.** Replacing an unclosed draft or
    changing goals never archives implicitly. The caller must close the current
    session as deferred or abandoned before a different goal can be saved.

The final-prerequisite choice deliberately preserves ADR 0003's atomic review
recording rule. Recording the feature result as a terminal execution during
final-assignment start would require a different ADR decision and is outside
this plan.

## Canonical chronology

All comparisons are inclusive so an injected or coarse clock may produce equal
adjacent timestamps:

```text
feature-run start
  <= validation start
  <= validation completion
  <= review-assignment start
  <= reported review completion
  <= accepting mutation time
```

Final review additionally requires:

```text
bound feature-review completion
  <= broad-validation start
  <= broad-validation completion
  <= final-assignment start
```

Run termination, assignment invalidation, closure recording, and their accepting
mutation use the same runtime acceptance time when they occur in one transition.

## Invariant proof matrix

| Invariant | Required proof classes |
| --- | --- |
| `S4-STATE-01` Active feature, active run, run status, plan feature status, closure, and pending assignments are coherent | Schema corruption cases; transition table; deterministic state-machine sequence; persistence reload |
| `S4-TIME-01` Run, validation, assignment, review result, and acceptance chronology is trusted and ordered | Boundary examples; timestamp perturbation table; atomic rejection; persistence parse |
| `S4-FINAL-REC-01` A persisted final assignment completes without caller-only prerequisite data | Domain transition; context-loss restart; registered-host final path; pinned live-host release smoke |
| `S4-CLOSE-REC-01` Interrupted close converges from durable Flow state alone | Failure-injection matrix; status contract; fresh-service retry; no-clobber archive proof |
| `S4-HOST-01` Application, registered-handler, emitted host-expressible, executed, and documented contracts agree; the SDK-owned outer-wrapper limitation is explicit | Shared corpus; actual-registration differential test; emitted JSON Schema assertion; registered-host calls; pinned live-host release smoke |
| `S4-ATOMIC-01` Rejection preserves bytes and operation identity; acceptance advances once | Transition sequence; repository reload; failpoint/replay tests |
| `S4-V4-ONLY-01` Session v4 is the sole recognized session format, with no Session v3-specific path or evidence | Exact-schema and generic non-v4 rejection; package smoke; static absence audit |

Replace the current source-anchor-only coverage map with an executable registry.
The registry must fail when a required proof class has no running case; the
presence of a test name or source string does not satisfy a row.

## Phase order

| Phase | Depends on | Result |
| --- | --- | --- |
| 0. Contract lock and red oracle | Current uncommitted v4 state | One agreed domain contract and five reproducible failures |
| 1. Relational and temporal invariant foundation | Phase 0 | Invalid Session v4 graphs and chronology fail at the boundary |
| 2. Durable continuation and crash convergence | Phase 1 | Final review and archive recovery need no chat-local payload |
| 3. Production host-contract convergence | Phases 1–2 | The model-visible schema exposes the strict Flow-owned request contract and handler execution enforces the complete envelope |
| 4. Adversarial lifecycle verification and CI | Phases 1–3 | Systemic sequence, failpoint, reload, registered-host proof, and pinned live-host release proof |
| 5. Documentation and review closure | Phases 0–4 | One consistent contract and bounded sign-off |

No production phase closes with an unresolved P1/P2 finding. A finding reopens
the owning invariant row: add or strengthen its executable counterexample,
correct the implementation, and rerun every proof class for that row before
continuing.

## Phase 0 — Contract Lock and Red Oracle

### Work

1. Create a terminology-only `CONTEXT.md` distinguishing Flow v5, Session v4,
   active execution, review assignment, assignment result, bound prerequisite
   result, recorded review execution, reported time, runtime acceptance time,
   closure, archive publication, archive-recovery session, and retry handle.
2. Change unshipped ADR 0003 back to `Proposed`, amend it with the decision lock
   above, and return it to `Accepted` only in Phase 5.
3. Mark ADR 0001 superseded where its seven-tool/no-recorded-review description
   conflicts with the current architecture. Preserve ADR 0002's requirement for
   host/application wire parity.
4. Add one deterministic counterexample for each latest finding before changing
   its production path:
   - final start, loss of the local feature result, fresh-service completion;
   - future validation/review time and broad validation before feature review;
   - closure save, archive failure, loss of the close request, status-only retry;
   - invalid requests parsed through `createTools()[name].args`; and
   - running deferred/abandoned close with an active run and pending assignment.
5. Prototype the nested request unions with the actual OpenCode 1.18.3 tool API
   and inspect its emitted JSON Schema. Do not choose a design based only on a
   local Zod helper.
6. Remove Session v3-specific preservation promises, fixtures, archive cases,
   tests, recovery instructions, and terminology from the active v4 contract.
   Where strict version rejection needs a test, use a generic non-v4 sentinel
   and assert only that it cannot load; do not create a version-specific recovery
   path.
7. Introduce the seven-row executable invariant registry and assign its proof
   classes, owners, and focused commands.

### Gate

- Each counterexample is observed failing for the intended production reason.
- The recommended request shape emits the required discriminator branches and
  required fields through the real host.
- No term such as "enforced chronology", "durable prerequisite", "clears active
  state", or "recover exact close" remains undefined.
- The static absence audit finds no Session v3-specific runtime, persistence,
  distribution, fixture, test, prompt, or active-document path.
- Generic malformed-v4 corruption recovery is clearly separated from version
  compatibility and contains no Session v3 branch.

Phase 0 is a deliberately red diagnostic checkpoint and is not mergeable by
itself. Each counterexample becomes green in its owning production phase.

## Phase 1 — Relational and Temporal Invariant Foundation

### Work

1. Add one pure `validateSessionInvariants` domain boundary and invoke it from
   `SessionSchema`, persisted-session loading, and transition-output tests.
2. Enforce graph integrity:
   - active feature and run are both present or both absent;
   - the active run is unique, active, and belongs to the active in-progress
     plan feature;
   - active runs have no end time and terminal runs have one;
   - assignment run/feature/source/evidence/prerequisite references resolve and
     agree;
   - terminal assignment state agrees with completion/invalidation time;
   - history references canonical runs, assignments, and evidence; and
   - closure implies no active run or pending assignment.
3. Introduce a controlled monotonic test clock and remove future-dated happy
   path fixtures.
4. Capture one runtime acceptance time per mutation and enforce `S4-TIME-01`,
   including the feature-review-to-broad-validation boundary.
5. Make deferred/abandoned close quiescent:
   - extend terminal run and invalidation reasons for closure;
   - end the active run and pending assignments at closure time;
   - clear both active pointers; and
   - preserve plan/session progress only as documented forensic state.
6. Validate every successful transition by serialize/parse round trip and every
   rejected transition by exact pre/post state equality.

### Gate

- Equality at each chronology boundary succeeds.
- Pre-run, reversed, future, and pre-feature-review broad validation reject
  without mutation or operation-id consumption.
- Hand-edited active-pointer, run-time, assignment-reference, and closure states
  fail schema parsing with curated invariant errors.
- Completed, deferred, and abandoned closure matrices leave no actionable run
  or assignment.
- `S4-STATE-01`, `S4-TIME-01`, and the relevant `S4-ATOMIC-01` cases are green.

## Phase 2 — Durable Continuation and Crash Convergence

### Work

1. Replace `prerequisiteAssignmentId` plus `prerequisiteResultDigest` with one
   `BoundReviewPrerequisite` aggregate containing assignment id, cloned
   canonical result, and digest.
2. Validate the aggregate structurally and semantically:
   - final assignment if and only if the aggregate exists;
   - stored result assignment id equals the referenced assignment;
   - canonical digest matches the stored result;
   - the referenced assignment is a same-run, same-feature, same-source feature
     assignment; and
   - the result is submitted, passing, and has no blocking finding.
3. Make final completion read the stored feature result. Remove redundant
   feature-result resubmission from the final-completion wire branch; do not
   keep both paths.
4. Require every final retry for a run/source to use the first durable
   prerequisite result byte-for-byte. Reject a divergent reconstruction without
   mutation or operation-id consumption, and expose the bounded aggregate only
   in detail status so a fresh manager can reconstruct the strict retry request.
5. Set and test a total serialized review-result budget in addition to existing
   per-field bounds. Keep raw bound results out of compact and reviewer
   projections.
6. Add a close request union with explicit `start` and `retry` branches. Persist
   the accepted retry operation id with closure, project the complete id in
   archive-recovery status, and let retry resume only publication/cleanup.
7. Add session invariants proving that closure and retry identity correspond to
   the accepted `session_close` mutation. Before accepting a new close, reject
   an operation id already present in canonical workspace history. A wrong or
   reused id fails without adopting the closure.
8. Remove implicit draft archival from different-goal `flow_plan_save`. Require
   explicit deferred or abandoned closure so publication always has a closure,
   retry identity, and one crash-recovery protocol.
9. Add restart/failure-injection cases at:
   - before state save;
   - after state save and before response;
   - after closure save and before archive publication;
   - after publication and before active-state deletion; and
   - after active-state deletion and before response.
10. At every cut point, construct a fresh service/repository instance and recover
   without retaining the original result, close summary, guards, or request
   object.

### Gate

- Final completion after context loss needs only persisted Flow state plus the
  final-assignment result; both review executions record atomically once.
- Tampered bound payload, id, or digest fails session loading and cannot mutate.
- A failed final review can use the still-valid bound feature result for the
  authorized final retry, but a divergent reconstruction rejects atomically;
  source change/reset cannot reuse it.
- Archive recovery works from compact status and the retry handle alone,
  including a 128-character operation id and an originally omitted summary.
- Close retry identity remains unambiguous after multiple sequential sessions,
  and a different goal cannot bypass explicit closure.
- Every crash cut point converges without duplicate revision, clobbered archive,
  lost active state, or caller-memory dependence.
- `S4-FINAL-REC-01`, `S4-CLOSE-REC-01`, and `S4-ATOMIC-01` are green.

## Phase 3 — Production Host-Contract Convergence

### Work

1. Preserve the nine tool names, but replace conditionally loose flat inputs
   with host-expressible strict nested requests:
   - status request: compact, detail, execution, or reviewer; reviewer requires
     assignment id;
   - review-start request: feature/targeted without a prerequisite, or
     final/broad with the passing feature result;
   - final-completion request: final-assignment result only, with the feature
     prerequisite supplied by durable state; and
   - close request: new guarded close or retry by accepted operation id.
2. Require explicit compact status rather than relying on a root-level optional
   discriminator. Retain no flat compatibility schema or adapter.
3. Remove `FlowHostInputSchemas` and `acceptsFlowHostInput`, which currently test
   schemas other than those registered by `createTools`.
4. Keep application and host Zod instances separate, but drive both with one
   shared JSON corpus containing:
   - canonical valid requests;
   - every required-field deletion;
   - missing/wrong discriminators;
   - branch-incompatible and unknown inner fields;
   - negative, fractional, and unsafe integers;
   - timestamp boundaries; and
   - legacy flat requests.
   Add a dedicated unknown-outer-field case because the outer object is created
   by the OpenCode SDK rather than supplied as a Flow-owned Zod object.
5. Parse the shared corpus through:
   - application schemas;
   - `tool.schema.object(createTools()[name].args)`;
   - actual registered callbacks against isolated workspaces.
   Separately inspect the schema emitted by a packed OpenCode host for required
   envelopes, strict Flow-owned inner branches, discriminator and outcome
   literals, required fields, and safe numeric bounds. Execute representative
   invalid-then-corrected calls through that packed host.
   Explicitly parse the actual registered request again at handler entry before
   calling the Flow service; OpenCode schema advertisement is not treated as an
   execution-time validation guarantee. The emitted-schema proof owns required
   envelopes, discriminated strict inner branches, literals, and numeric bounds.
   The registered and packed execution proofs own strict rejection of unknown
   outer fields because OpenCode 1.18.3 does not emit that outer keyword.
6. Fix constraint-emission drift such as `.nonnegative().safe()` advertising a
   negative minimum; order constraints so emitted and runtime bounds agree.
7. Update active prompts, skills, and examples in the same phase. Add a static
   rejection gate for old flat status/review-start/final-completion/close
   examples.

### Gate

- Application schemas, registered schemas, and registered handlers make the
  same decision for every lifecycle-critical corpus case. Every JSON
  Schema-expressible constraint is present in the packed emitted schema. The
  dedicated unknown-outer case is rejected by both registered and packed
  handler execution before Flow and preserves exact state bytes.
- Model-visible JSON Schema requires reviewer assignment id, final prerequisite,
  correct review-kind/scope pairing, review-start validation `exitCode: 0`,
  passing/submitted advisory-only prerequisite and completed results, failed
  blocked results, nonnegative safe integers, and strict inner branch fields.
- Packed-host negative calls are rejected before Flow execution and leave no
  state mutation; the following corrected call succeeds.
- `S4-HOST-01` and its `S4-ATOMIC-01` cases are green.

## Phase 4 — Adversarial Lifecycle Verification and CI

### Work

1. Replace source-string anchors in the existing coverage map with executable
   invariant cases and proof-class completeness checks.
2. Add deterministic state-machine sequences across plan, approve, start,
   validate, assign, complete, block, retry, reset, source change, close, and
   exact replay. Print the seed and minimized action trace on failure.
3. Generate one-field persisted-state corruptions and table-driven timestamp
   perturbations around every equality boundary.
4. Reload and validate persisted state after every accepted operation; assert
   exact bytes and reusable operation identity after every rejected operation.
5. Expand the pinned packed-host live smoke to cover:
   - emitted parameter schemas, not only tool names;
   - invalid reviewer/review-start requests;
   - the complete final-review path;
   - simulated manager context loss;
   - explicit close and archive retry; and
   - persisted invariant validation after each host call.
6. Add focused commands such as `test:lifecycle:invariants`,
   `test:lifecycle:recovery`, `test:contracts`, and an aggregate
   `verify:lifecycle`. Keep every underlying lifecycle test in the full test leg
   of `bun run check`; do not invoke the same aggregate a second time there.
7. Run a larger deterministic seed set in a scheduled lifecycle soak while
   keeping the pull-request suite bounded.
8. Require the pinned live-host smoke in the release workflow before package
   publication. Keep latest-OpenCode compatibility as a separate scheduled
   signal.
9. Add a repository-wide absence gate preventing Session v3-specific code,
   fixtures, recovery text, and tests from returning. Historical release notes
   may describe past releases, but they are never imported by or tested as the
   active runtime contract.

### Gate

- Every invariant row has all required executable proof classes.
- A deliberately removed proof causes the registry to fail.
- Bounded model sequences and the scheduled soak report reproducible seeds.
- `bun run check`, package smoke, pinned packed-host smoke, and
  `git diff --check` pass.
- `S4-ATOMIC-01` and `S4-V4-ONLY-01` remain green across the full matrix.

## Phase 5 — Documentation and Review Closure

### Work

1. Reconcile ADR 0003, ADR status links, `CONTEXT.md`, review lifecycle, causal
   state, maintainer contract, README, changelog, troubleshooting, prompt
   surfaces, core skills, recovery playbook, validation rubric, and hidden
   reviewer contract.
2. Delete the documented flat-schema exception and every false claim that a
   caller can reconstruct information Flow does not expose.
3. Update the predecessor plan's implementation checkpoint, coverage table,
   definition of done, and Phase 5 interlock. Do not duplicate its bounded
   qa-scribe or OS/Node evidence plan here.
4. Perform two focused independent reviews:
   - domain, persistence, recovery, chronology, and closure; and
   - registered/emitted host schema, application contract, prompts, and live
     host behavior.
5. Resolve every actionable finding through its invariant row, then perform one
   final integrator review of the complete uncommitted diff.
6. Return ADR 0003 to `Accepted` and mark this plan locally complete only after
   all Phase 0–4 gates and focused reviews pass.

### Gate

- No active document or prompt contradicts an executable invariant.
- Both focused reviews and the final integrator review have no unresolved P1/P2
  findings.
- Full deterministic, package, packed-host, byte-budget, privacy, and diff gates
  pass.
- The predecessor's external Phase 5 is unblocked but not falsely claimed.

### Local completion evidence

- `bun run check`: typecheck, Biome over 92 files, 19/19 prompt scenarios and
  54/54 criteria, plugin/CLI/declaration builds, and 407 passing tests with one
  explicitly gated live test skipped (3,330 assertions across 26 files).
- `bun run verify:lifecycle`: 10 invariant/sequence tests (229 assertions), 18
  durable-recovery proofs, and 133 host-contract tests (596 assertions).
- `bun run package:smoke`: one passing package/declaration/consumer proof with
  eight assertions.
- `bun run smoke:live`: two passing tests and 373 assertions against the real
  packed plugin in pinned OpenCode 1.18.3.
- Workspace persistence: 54 passing tests and 328 assertions, including pinned
  topology, helper liveness, exact-byte retry cleanup, and closure-only history.
- Two focused reviews, a fresh adversarial diff audit, and the final integrator
  review closed with no unresolved P1/P2 findings. Workflow lint and
  `git diff --check` passed.

## Finding ownership

| Latest finding | Owning production phase | Prevention proof |
| --- | --- | --- |
| Bound feature result is lost after context loss | Phase 2 | `S4-FINAL-REC-01` restart plus registered-host final path and pinned live-host release smoke |
| Future/out-of-order timestamps are accepted | Phase 1 | `S4-TIME-01` perturbation and atomic-rejection matrix |
| Exact close retry cannot be reconstructed | Phase 2 | `S4-CLOSE-REC-01` failpoint and status-only retry matrix |
| Registered schemas are looser than tested schemas | Phase 3 | `S4-HOST-01` shared corpus, emitted host-expressible structure, and strict handler-entry execution proof |
| Deferred/abandoned close leaves mixed active state | Phase 1 | `S4-STATE-01` closure transition and corruption matrix |
| Final retry binds a divergent reconstruction | Phase 2 | `S4-FINAL-REC-01` exact-binding retry and context-loss detail recovery |
| Close retry id collides across archived sessions | Phase 2 | `S4-CLOSE-REC-01` workspace-history uniqueness and post-delete retry |
| Different-goal plan save archives an unclosed draft | Phase 2 | `S4-CLOSE-REC-01` explicit-close-only replacement and crash-window regression |
| Schema-valid session id can wedge archive publication on deep or case-folding filesystems | Phase 2 | `S4-CLOSE-REC-01` 128-character admission boundary, fixed lowercase digest filename, and pinned-relative publication |
| Advertised schema does not stop invalid host execution | Phase 3 | `S4-HOST-01` packed-host invalid-then-corrected execution proof |
| Close retry publishes against stale or hidden canonical history | Phase 2 | `S4-CLOSE-REC-01` pre-save scan, pre-publication rescan, and exact archived-operation lookup |
| Archive publication or cleanup races path replacement, stalls its helper, or hashes normalized rather than observed bytes | Phase 2 | `S4-CLOSE-REC-01` pinned directory identities, bounded helper protocol, exact spelling/topology checks, and differently formatted equivalent-byte recovery |
| Relationally valid-looking ledgers contain phantom references, divergent counters, or noncausal revisions | Phase 1 | `S4-STATE-01`, `S4-TIME-01`, and `S4-ATOMIC-01` corruption, reload, and repository-sequence proofs |
| Canonical history is published without explicit closure | Phase 2 | `S4-CLOSE-REC-01` closure-only publication and lookup rejection proofs |
| A local mock is mislabeled as packed-host evidence | Phase 4 | External `pinned_packed_live_host` registry classes for `S4-FINAL-REC-01` and `S4-HOST-01`, with missing-class/token failures and runtime-bound live observations |
| Active recovery prose retains flat or multiline lifecycle requests | Phase 3 | Repository-wide four-tool flat-guidance scan with one-line/multiline, quoted/unquoted, and nested-envelope controls |

## Local definition of done

The hardening plan is locally complete only when:

1. persisted Session v4 state is relationally valid, not merely shape-valid;
2. accepted lifecycle work is recoverable without chat-local memory;
3. no actor-reported time can postdate the mutation that accepts it;
4. a closed session contains no actionable execution or review assignment;
5. actual registered handler execution matches application behavior, emitted
   schemas retain every host-expressible Flow constraint, and the SDK-owned
   outer-wrapper limitation is covered by a no-mutation execution proof;
6. every lifecycle invariant has executable cross-boundary proof;
7. Session v4 is the only recognized session format, with no Session v3-specific
   compatibility, quarantine, cleanup, fixture, replay, or recovery path;
8. all canonical history is produced by explicit closure with a workspace-unique
   retry identity; and
9. the focused and final reviews close with no unresolved P1/P2 findings.

Release readiness still additionally requires the predecessor's bounded
qa-scribe run and supported external environment evidence.
