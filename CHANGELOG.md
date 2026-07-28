# Changelog

One short entry per release, written for users deciding whether to upgrade.

## [Unreleased]

The last route to a dishonest `completed` closure is closed, and the two claims
that rested on prompt prose are now measured.

- **A plan declares its canonical gate.** `plan.gate` is the exact command that
  validates the whole repository, named at planning time and locked by approval. A
  `broad` observation has to run that command byte-for-byte, and the gate joins the
  vetoed-command set, so its latest failure blocks review whatever scope an
  observation claimed. This closes the escape [ADR
  0009](docs/adr/0009-scope-keyed-validation-veto.md) recorded as open: a measured
  run had closed `completed` by claiming `git diff --check` as its gate — a command
  that cannot fail, so nothing was ever observed red.
- **A plan declares evidence this host cannot produce.** `plan.externalEvidence`
  names each acceptance observation needing an operating system, service, credential,
  or device this machine may lack, with the exact command whose passing is that
  observation. Final review and `completed` closure are both refused until that
  command passes, so a self-written proxy cannot stand in for it. The first
  three-provider eval matrix found three runs substituting one — two closed
  `completed` over a Windows-only criterion on a Linux host, with the independent
  review passing, and the suite's own false-completion metric reported zero. Each
  entry also names the `platform` that can observe it — `win32`, `darwin`, `linux`, or
  `other` for a service, credential, or device — and Flow records the host every
  observation ran on, so the declared command passing on the wrong machine no longer
  discharges it. The next matrix run found exactly that: a declared Windows entry
  cleared by its own command's exit zero on Linux, green because the Windows case is
  skipped there. The refusal now distinguishes a command never observed from one that
  passed on the wrong host, because those call for opposite moves. See
  [ADR 0011](docs/adr/0011-declared-external-evidence.md).
- **Acceptance evidence names test cases, not exit codes.** Each `externalEvidence`
  entry also declares `assertions`: the case names whose passing *is* that
  observation. `flow_validation_start` takes `resultsPath`, the JUnit XML the command
  writes, and Flow records what that report said about each declared name. An entry is
  satisfied only when every one is reported `passed` — `skipped` and `absent`
  discharge nothing. This closes the limitation ADR 0011 recorded rather than fixed:
  comparing the host closed the *wrong machine* and left the same skip on the right
  one, where a case guarded, filtered, renamed out of the run, or never written still
  exits zero. The names come from the approved plan and never from the caller, and a
  report that predates the arming is read as no report at all. Declare an empty list
  when the evidence is not a test result; that keeps the exit-code rule, which is the
  honest answer for a credential or a device. See
  [ADR 0012](docs/adr/0012-named-results-over-exit-codes.md).
- **The reviewer can see the two commands the plan declares.** Its plan context now
  carries `gate` and `externalEvidence`, which it was asked to judge and was never
  shown: it could not tell a `broad` observation that ran the canonical gate from one
  that ran something else, and could not check a declared environment against the host
  the observation recorded.
- **Session v5 schema:** `plan.gate` is a new optional string. A document written by
  an earlier build still hydrates and keeps the older rule where `broad` is the
  claimant's word; `flow_plan_save` requires the field for any new plan, so a plan
  this build writes always declares one. `plan.externalEvidence` is a new optional
  array under the same rule: older documents declare nothing and owe no acceptance
  observation, and `flow_plan_save` requires the field — an empty list is the answer
  when the goal is fully observable here. Each entry carries an optional `platform`
  that `flow_plan_save` likewise requires for a new plan, and each validation
  observation carries an optional runtime-written `hostPlatform`; an entry hydrated
  without a platform keeps the command-only rule. Each entry also carries an optional
  `assertions` list that `flow_plan_save` requires for a new plan, and each observation
  may carry a `resultsPath` and the `observedAssertions` the runtime read from it; an
  entry hydrated without assertions keeps the exit-code rule. Rolling an active session
  back to a build without these fields is not supported, as with every previous
  widening.
- **The bar is published, not described.** [What Flow
  guarantees](docs/guarantees.md) states which claims are enforced by types, attested
  by the host, declared by the caller, judged by a model, or unenforced.
  [Release qualification](docs/release-qualification.md) publishes the eval
  thresholds a release clears, and `bun run qualify` applies them.
- **Evals measure false completion and reviewer activity**, derived from durable
  documents rather than model prose, and a scheduled workflow runs the suite against
  at least two providers weekly. A new scenario checks that a requirement no run can
  observe is never reported as verified. A run that aborts mid-flight is counted and
  excluded rather than scored as a failure — one wedged attempt was the only failing
  threshold in a measured report, on a guarantee that never ran — and `bun run
  qualify` refuses a report holding one on a gated pair. A wedge diagnostic now names
  the command each incomplete tool call was running.
- **Recorded model decisions replay for free.** Every paid attempt now writes a
  cassette — its tool calls, in order, with their arguments — and `bun run replay`
  feeds those back through the real handlers against a fresh workspace with no model
  and no host. It is deliberately the decision layer, not the HTTP wire: freezing tool
  results too would mean Flow's own refusals never execute on replay, which is the one
  class of defect this suite exists to catch. Every runtime change up to now needed
  another paid matrix before anyone knew it had not broken a sequence a model already
  performed. CI gates the committed cassettes; a run whose recording holds something a
  decision-layer replay cannot reproduce is reported rather than gated.
- **Eval reports now include the reviewer.** Subtask sessions are read too, so a
  report finally contains the independent review's own tool calls. Before this, no
  recorded report held a single `flow_feature_complete` call, the check for rejected
  submissions could never fire, and the reviewer's tokens went uncounted — so token and
  cost totals from earlier reports are lower than the same runs would report now.
- **`/flow-auto` says when your host cannot continue.** Continuation needs assistant
  message parentage; a host that does not report it now gets a plain note at startup
  and an `autoContinuation` field on status, instead of a lifecycle that appears to
  stop after every feature for no reason.
- **Positioning, including when not to use Flow.** See
  [positioning](docs/positioning.md) and the new README section.

The prompt surface got smaller, not larger: the typed gate replaced the prose that
asked the model to judge whether its own coverage claim was honest.

## [7.0.2] - 2026-07-27

Documentation only. The docs still called the product Flow v6 two majors after
the fact, including the sentence in `CONTEXT.md` whose whole job is to name the
generation.

- Where naming the generation is the point, it now reads v7. Where the version
  added nothing to the sentence it is gone, so the claim cannot go stale a third
  time: the layering diagram, the maintainer contract's invariants, and the
  README's version-change note all describe Flow rather than a numbered Flow.
- The forward-reading compatibility note said newer builds accept state written
  by earlier *v6* builds, which stopped being the full truth when 7.0.0 shipped.
  It now says earlier builds.
- References to the v6 cutover itself are unchanged, because that boundary is
  genuinely v6: pre-v6 active state is still not migrated, and the absence of a
  cross-version gate still rests on v6 having been a hard cutover.

No source, dependency, or behaviour change. The Session v5 schema and every
durable document are exactly as in 7.0.1, so there is nothing here to upgrade
for unless you read the docs from the package.

Install or update:

```bash
opencode plugin opencode-plugin-flow@7.0.2 --global --force
```

## [7.0.1] - 2026-07-27

Dependency currency, with one bump that changes what is actually tested:

- The pinned OpenCode host moves from 1.18.3 to 1.18.6. Flow's peer range has
  always admitted it (`>=1.18.3 <2`), so anyone running a 1.18.4-1.18.6 host was
  installing against a version no check here had launched. That pin is also the
  host `bun run smoke:live` starts, so 7.0.1 is the first release whose live
  smoke ran on 1.18.6.
- Build-time only: `@biomejs/biome` 2.5.5, `@types/node` 26.1.1 (with the
  repo-wide `overrides` entry moved with it), and `actions/checkout` v7.0.1
  across all seven pinned workflow references. None of these reach the published
  package.
- `.github/dependabot.yml` referred maintainers to compatibility checks
  "described in docs/development.md" that were never written there. They are now,
  including why the peer range must not admit a host no check has launched.

No runtime source changed. The Session v5 schema, every durable document, and
Flow's behaviour are identical to 7.0.0; upgrade only if you run an OpenCode
host newer than 1.18.3 and would rather it be one Flow has been smoke-tested
against.

Install or update:

```bash
opencode plugin opencode-plugin-flow@7.0.1 --global --force
```

## [7.0.0] - 2026-07-27

A `broad` validation claim now has to be one, and the two review-finding fields
6.9.0 introduced are reachable for the first time:

- **Breaking.** A command recorded at `broad` scope is refused when it selects
  which tests it runs, either by naming a test file or by filtering with `-t`,
  `--test-name-pattern`, `--testNamePattern`, `-k`, `-run`, `--grep` or
  `--filter`. 6.9.0 accepted all of these. A repository whose canonical gate is a
  filtered command must record that command as `focused` and arm the whole suite
  for the broad observation a final review requires.
- **Breaking.** A failing broad observation now blocks its own feature's review
  until that exact command passes again for the current workspace content.
  Previously a red repository gate was discharged by arming something smaller
  under the same label: every field of the resulting record true, and the gate
  itself never passing.
- `reviewFinding` in the host tool schema was `.strict()` without `scopeBlocker`
  or `findingId`, so every submission the review skill instructs was rejected at
  the boundary even though the durable schema accepts both and `nextAction`
  already reads `scopeBlocker`. Both fields now pass, with a parity test holding
  the host schema to the durable one.
- An explicit grant of authority over already-planned work reads as continuation
  rather than a goal change. A session planned with "do not implement anything
  yet" and then told "you have my approval to implement it end to end" no longer
  refuses the authorization it was just given. New or different outcomes are
  still refused.
- Three architecture gates make the layering enforceable rather than described:
  every `src` export must be imported outside its declaring file, every
  `@opencode-ai/*` import must route through `src/platform/opencode/sdk.ts`, and
  the source and documentation budgets report their remaining headroom instead of
  speaking up only once they are exceeded.

The durable-invariant checker moved out of `transitions.ts` into
`src/domain/session-invariants.ts`, with its rule families explained and eleven
tests covering them; it previously had no direct coverage at all. The README is
half its former size. ADR 0009 now records what the model-driven harness measured
rather than what its guards were expected to do, including one escape left
deliberately open: a `broad` command that cannot fail, such as `git diff --check`,
is still accepted, because refusing it means deciding which commands count as
tests.

The Session v5 schema is unchanged, and no durable document written by a 6.x
build is rejected on load. Both refusals above apply when new evidence is
recorded, so a session carrying a filtered broad observation from 6.9.0 keeps it
and needs a whole-suite pass before its final review.

Install or update:

```bash
opencode plugin opencode-plugin-flow@7.0.0 --global --force
```

## [6.9.0] - 2026-07-26

Rules the prompts used to restate are now enforced by the runtime, and Flow no
longer assumes an OpenCode-shaped host:

- Review findings carry two typed fields instead of prose conventions. An
  optional `scopeBlocker` boolean surfaces as `blockedFeature.scopeBlocker` and
  is accounted for by `nextAction`, so a scope blocker checkpoints for user
  direction at the first failed review rather than depending on the manager
  noticing a `[scope-blocker]` marker; the marker is gone everywhere. A
  `findingId` is set to a prior id for a recurrence and omitted for a new issue,
  which the runtime numbers as `<feature-id>.R<revision>-<NN>` and supplies back
  as `priorFindings` with `nextFindingIdPrefix`. A failed result that drops a
  live prior id is rejected instead of silently losing that history.
- The reviewer is asked to report every problem it finds and to use severity
  purely for routing, replacing guidance that reserved `blocking` for issues
  invalidating the outcome. Published guidance for current models indicates that
  conservative review instructions suppress findings.
- The delivery projection carries a runtime-rendered `report`, so every surface
  relays one formatted handoff verbatim instead of restating the same field list
  four times.
- Validation on a host that reports no structured Bash exit code, or no
  output-truncation flag, records a durable observation marked
  `exit-code-unavailable` or `output-completeness-unknown` rather than failing the
  capture. Such an observation never satisfies a gate, so the limitation is
  visible instead of blocking. Worker-wave dispatch no longer instructs a single
  assistant tool-use turn; a host that runs tasks serially is expected and
  reported as serial.
- A tool call rejected by the runtime guard returns the same
  `workflowData.failure.recovery` envelope every other Flow failure uses, which is
  what the prompts already told the model to read. `flow_guidance` answers in
  markdown, so its rejection is markdown rather than a JSON blob.
- `/flow-auto` on a host that reports no assistant message parentage now says so.
  Continuation anchors on the assistant message owning the lease, so such a host
  can never continue and correctly stops after each feature; previously that was
  indistinguishable from a Flow defect. The warning now names the host limitation
  and points at `/flow-run`.

Prompt text is now measured rather than argued about. Total shipped prompt bytes
drop from 42,466 to 38,495 and cross-surface near-duplicate rule statements from
18 pairs to 12, with every removed instruction either replaced by an enforced
guard or a runtime-rendered value, or verified against the model. `flow-run`, the
dominant surface, loses 2,422 bytes: the elaborate revision-token protocol
collapses to the one rule that routes (`passed: false` never arms review), the
manager no longer reconstructs which prior findings are still live or tracks
their disposition in prose now that the runtime supplies `priorFindings` with
each finding's current severity and wording, and the prose describing internals
Flow already enforces — the strict review-start schema, the derived review kind,
the auto-continuation gate, and several statements that Flow persists no ledger —
is gone. Absolute-rule markers in `flow-run` fall from 62 to 51, which both
vendors' guidance treats as a compliance gain rather than a loss. `tests/prompt-quality.test.ts` and
`tests/documentation-contract.test.ts` no longer pin ordered prose phrases; they
assert structure, source-derived inventories, and budgets that ratchet down, so
tightening prompts is cheap and growth is what fails. Model behaviour is measured
by the new opt-in `evals/` harness, which drives the real slash commands against
a real model in a throwaway OpenCode host and asserts durable session state.

The harness arrived part-way through this release, so the cuts are not all
evidenced equally. The last one — the manager-side prior-finding reconstruction,
replaced by runtime `priorFindings` — was validated directly: `happy-path`,
`plan-only-stops` and `goal-change-refused` each passed three of three attempts
at the reduced footprint. Earlier cuts predate the harness and rest on the guards
and rendered values that replaced them, checked against a repeat-3 baseline
recorded once the harness existed. A fourth scenario, `failing-gate-blocks`,
passes at roughly even odds; it was measured to be equally unreliable at 6.8.0,
so it is reported but carries no signal about these prompts either way. Its cause
is a pre-existing gap rather than a prompt defect: `exitCode` and `scope` on a
validation observation are supplied by the model and never executed by Flow, so a
model that misreports a red gate as green is accepted by every predicate. Treat a
passing gate as a claim the model made, not one Flow verified.

The Session v5 schema adds two optional finding fields and widens `exitCode` to
allow `null`. Earlier v6 builds read the added fields as absent, but reject a
document containing a `null` exit code, so finish or close active work before
downgrading.

Install or update:

```bash
opencode plugin opencode-plugin-flow@6.9.0 --global --force
```

## [6.8.0] - 2026-07-24

Checkpoint-safe continuation and leaner review convergence:

- `/flow-auto` now remains waiting through same-revision checkpoint replies and
  enqueues exactly one continuation only after the same host observes an
  accepted Flow mutation whose tool assistant resolves through cached
  `message.updated` parentage to the authoritative user reply; missing or
  mismatched provenance fails closed. Mechanical progress must match that
  revision exactly, except for the single state-constrained reviewer-result
  revision after an authenticated `flow_review_start`.
- Compaction carries reply authority only across an authenticated trigger
  assistant, automatic compaction marker, summary assistant, and successor user
  lineage while authority remains unchanged; incomplete or unrelated lineage
  fails closed.
- From idle, auto-routing requires a same-host accepted non-replayed
  `flow_plan_save` for the newly created Flow session; a baseline that already
  has a pending reviewer retains a narrow temporal exception.
- `/flow-auto stop` and `/flow-auto cancel` now revoke the process-local
  continuation lease without closing, deferring, abandoning, or otherwise
  mutating the durable Flow session.
- Manager command rewrites preserve every nonblank raw request, including
  exterior whitespace, exactly once while keeping synthetic guidance separate.
- Initial auto/run prompts, dynamically loaded run guidance, compaction context,
  and synthetic continuations share one concise manager kernel for reserved
  roles, the exact `failedReviewCount === 1` retry gate, and current-source plus
  relevant baseline evidence.
- Guidance represents race-heavy risk checks as one transition matrix and
  preserves stable finding IDs, relevant baseline facts, and prior dispositions.
  Ordinary reviewer summaries keep IDs mapped to the active feature or supplied
  explicitly in its packet; final review covers every approved requirement or
  feature ID. Both keep each still-live prior finding through failed reviews; a
  proven repair remains pending until a later passing review, so closure and
  archive replay need no prerequisite detail read or unbounded historical
  ledger. The Session v5 schema is unchanged.
  Provider/model execution remains unverified unless the opt-in manual canary
  is run.

Install or update:

```bash
opencode plugin opencode-plugin-flow@6.8.0 --global --force
```

## [6.7.0] - 2026-07-23

Bounded auto-continuation lore keeps user-authorized goals moving while making
checkpoints, retries, and validation freshness explicit:

- `/flow-auto` now treats ready features and completed sessions as mechanical
  loop states, so authorized work continues without an intermediate “ready for
  the next feature” handoff. Its host lease starts from a provisional compact
  baseline and auto-routes only after the initiating turn advances that same
  Flow session; unchanged or replacement sessions fail closed, while
  conversational plan approval remains resumable.
- Failed features are never selected implicitly while their latest relevant
  reviewed outcome remains failed. Auto mode may continue untouched independent
  work; when only retry-required candidates remain it waits for direction.
  While a failed run is blocked, optional `nextFeatureId` makes its authorized
  reset and exact next run atomic. Once that run is superseded and status is
  ready, explicit `flow_run_start(featureId)` starts its authorized retry. This
  adds no durable hold or retry ledger.
- Each feature now receives a before-edit evidence/environment preflight and
  adversarial risk checklist. Manager policy withholds review while required
  evidence is knowingly skipped, and reviewers treat missing proof as blocking;
  no skipped-evidence state is persisted. Workers receive the checklist before
  coding, and reviewers explicitly inspect adjacent/repeated transitions,
  overlapping invariants, base diffs, and file modes.
- Stable source finding IDs remain traceable in immutable feature prose.
  Active Flow work uses only the reserved worker and reviewer roles, while
  precise missing-evidence review failures can request manager-run proof.
- Accepted validation markers expose their recorded revision as a concurrency
  token, avoiding status reads made only to recover it. Only `passed: true` may
  feed review while all runtime gates hold; failed, incomplete, and
  source-drifted observations may use the token only for fresh validation. A
  drifted marker reports `passed: false` plus its explicit ineligibility reason.
  New review admission requires its current-source pass to be newer than the
  latest relevant failure or drift; accepted reviews remain grandfathered.
- Status workflow data now includes a small non-authoritative timer for the
  latest `/flow-auto` in the current plugin process. Active milliseconds are
  coordinator-classified wall time, not CPU or pure coding time; user-wait
  milliseconds cover only projected plan-approval and
  `await-user-direction` checkpoints. Paused, inactive, errored, and
  unprojected waits are excluded, and reload resets the timer.

Install or update:

```bash
opencode plugin opencode-plugin-flow@6.7.0 --global --force
```

## [6.6.0] - 2026-07-22

Projection-guided recovery lore makes Flow's next step easier to understand
without adding persisted diagnostics or more orchestration:

- `/flow-run` now follows one ordered compact-status route, handles idle and
  planning entry explicitly, and refreshes execution state before dispatching a
  recovered reviewer assignment so stale work is reset rather than redispatched.
- Status failures report the exact summary and optional recovery guidance.
  Post-review uncertainty no longer incorrectly claims that no lifecycle
  mutation occurred.
- Blocked-review handoffs now explain attempts, recurring and new findings,
  validation evidence, Flow-reported artifacts, completed and untouched work,
  the exact next action, and whether another repair attempt needs authorization.
  `/flow-status` obtains that evidence through one detail read.
- Typed status, execution, reviewer, detail, delivery, operation, and close
  recovery projections replace broad record casts. Accepted archive retry,
  accepted manual recovery, unconfirmed replay, and archive lookup collision
  remain distinct without changing Session v5 or persisted state.
- OpenCode tool serialization preserves those specialized response types while
  requiring every handler to return the Flow response envelope. Expanded prompt,
  runtime, close-recovery, and integration tests cover the contracts; the
  failed-review retry boundary and bounded worker waves remain unchanged.

Install or update:

```bash
opencode plugin opencode-plugin-flow@6.6.0 --global --force
```

## [6.5.0] - 2026-07-22

Convergence-safe recovery lore makes long Flow sessions easier to trust
without adding another state model:

- Before every manager-owned mutation, Flow aligns the request with the active
  goal. Same-goal approved plan-only requests report immutable plan progress and
  stop; materially new or expanded work waits for explicit closure. Exact
  cleanup of an already-accepted close runs before alignment and grants no new
  work authority.
- Prospectively, a known failed exact plan-listed command needs a byte-identical
  current-source pass at new review admission. Accepted Session v5 pending and
  completed reviews remain grandfathered; close adds no retroactive veto.
- A run can retain the maximum 64 exact planned gates plus separate broad
  evidence. This widens a Session v5 writer bound, so active rollback to an
  older Flow build is intentionally unsupported rather than hidden behind a
  migration or capability layer.
- Only the first in-scope failed review receives one automatic fresh full retry.
  A `[scope-blocker]` is the sole special finding marker and checkpoints
  immediately, while a second failure projects `await-user-direction` before
  another user-authorized attempt.
- Every durably accepted close returns the same concise delivery summary on
  success, archive recovery, or replay. Delivery is derived rather than
  persisted, reporting each feature's attempt count, latest outcome, terminal
  findings, and explicitly Flow-reported artifact paths rather than an exact Git
  delta.
- Exact close replay confirms the existing active document and filesystem
  durability boundary without rewriting Session v5. Archive recovery re-syncs
  publication and cleanup even when a previous attempt already removed active
  state; closed status re-derives a conflicting archive so automatic retry stays
  stopped for manual inspection after interruption.

Install or update:

```bash
opencode plugin opencode-plugin-flow@6.5.0 --global --force
```

## [6.4.0] - 2026-07-21

Continuous-flow lore keeps an authorized goal inside Flow while preserving the
small, single-run architecture:

- `/flow-auto` is the normal end-to-end driver. An active session remains
  authoritative until explicit completed, deferred, or abandoned closure, and
  existing implementation authority carries across plan approval, feature
  outcomes, qualifying worker waves, and in-scope failed-review repair.
- Direct `/flow-run` remains a one-feature advanced or recovery control. Work
  stays inside the active feature, serial execution remains the default, and
  bounded parallel waves still add no scheduler, durable wave state, telemetry,
  or concurrent active features.
- Reviewers now receive every applicable passing validation while final review
  still requires a broad gate. Reviewer guidance explicitly permits
  workspace-local non-shell inspection, removing an ambiguity that could block
  valid reviews.
- Deterministic coverage now exercises concurrent completion replay,
  configuration collisions and warnings, the documented 1-through-1000 review
  step range, temporary-workspace cleanup, and release-version derivation.
- Real-provider evidence completed an overlapping two-worker wave, a serial
  integration feature, failed-review reset and repair, and ten ordinary
  `/flow-auto` sessions through explicit closure.

Install or update:

```bash
opencode plugin opencode-plugin-flow@6.4.0 --global --force
```

## [6.3.1] - 2026-07-21

Read-only retry lore closes the recovery and documentation gaps in 6.3.0:

- While Session v5 remains active, every caller with tool access now receives an
  exact accepted completion through the read-only replay path before a new
  reviewer submission is considered. Reviewer retries no longer cancel
  validation capture or write session state.
- Replay documentation now states the active Session v5 boundary, and release
  language accurately describes secret avoidance as manager guidance rather
  than runtime filtering or redaction.
- The documentation contract keeps the rolling `Unreleased` changelog heading
  without requiring its contents to remain `No changes yet.`

Install or update:

```bash
opencode plugin opencode-plugin-flow@6.3.1 --global --force
```

## [6.3.0] - 2026-07-21

Reviewer-owned submission lore strengthens independent review without turning
Flow back into a heavy orchestration framework:

- The reserved reviewer now submits its own result through
  `flow_feature_complete`. The host authorizes new completions by agent identity,
  while exact previously accepted requests remain read-only replays for active
  Session v5 workflows.
- Pending-review recovery is source-aware: current assignments can be
  redispatched after interruption, stale source routes to reset and full
  revalidation, and fingerprint failures fail closed with repair guidance.
- Final reviewers receive the approved plan targets and validation intent,
  completed feature IDs, and only assignment-linked evidence. Broad validation
  is treated as a coverage claim; manager guidance warns against putting secrets
  in durable commands, and raw output is reduced to completeness plus a digest.
- Closed-world permission tests and the pinned OpenCode host smoke cover every
  registered Flow tool. Documentation distinguishes lifecycle mutation from
  fail-closed quarantine maintenance.

Install or update:

```bash
opencode plugin opencode-plugin-flow@6.3.0 --global --force
```

## [6.2.0] - 2026-07-21

Low-friction bounded-wave lore keeps Flow small while making parallel
contribution practical:

- Ordinary worker edits no longer stop for approval. Bash, `.flow` and `.git`
  metadata paths, external-directory access, skills, delegation, and Flow
  lifecycle tools stay denied; the manager runs every executable check and
  audits assigned versus changed paths.
- `flow-run` now instructs the manager to issue every cohort task in one
  tool-use turn and report a serialized host/model execution honestly. Serial,
  two-worker, three-worker, and one-follow-up canaries exercised failure,
  convergence, validation, review, and closure; a final candidate canary also
  completed an overlapping two-worker run with zero approval prompts. None of
  this adds a scheduler or durable wave state.
- An exact validation command that has started remains eligible for its
  after-hook; only a command that never starts expires after 15 minutes.
- Review-result semantics now have one domain-owned rule set, and the duplicate
  runtime guard exposes only its operational result, reason, and message.
- Operator documentation is shorter and leads with exact install/update,
  approval, status, and recovery behavior. Installation now pins `6.2.0`.

## [6.1.0] - 2026-07-21

Bounded intra-feature wave lore restores useful host-native parallel
contribution without restoring the former orchestration framework:

- A reusable hidden `flow-worker` can run as two or three concurrent instances
  with exact, non-overlapping slices inside the one active run, followed by at
  most one targeted follow-up cohort.
- The manager still owns integration, evidence acceptance, authoritative
  validation, and review dispatch. No wave state, sidecar, admission profile,
  telemetry, or concurrent feature lifecycle is added.
- This restores a capability; it does not claim a measured performance gain.
- Installation guidance now pins the exact `6.1.0` npm release.

## [6.0.0] - 2026-07-21

Simplicity-first lifecycle lore turns Flow back into a small, durable serial
workflow:

- Session v5 replaces Session v4 with one canonical feature-run aggregate,
  revision/operation-ID idempotency, session-native validation, derived status,
  and no wall-clock correctness fields.
- Every run receives one independent review. The final feature derives one
  final review requiring broad validation; failed reviews reset to a fresh full
  run instead of entering correction modes, and blocking findings require
  concrete evidence.
- The public surface is reduced to ten tools, five commands, and one hidden
  read-only `flow-reviewer`.
- Orchestration profiles and admission, audit-ledger rendering, replay and
  prompt-evaluation systems, detached validation receipts, and activation/cache
  repair are removed.
- Installation uses OpenCode's own plugin command with an exact npm version.
  Flow ships no installer, cache inventory, or automatic configuration repair.

Breaking changes: Flow v6 does not migrate active pre-v6 sessions or replay
their operations. Finish or close them before upgrading. Old archives remain
inert history. Validation interrupted before Session v5 persistence must be
rerun, and plugin configuration conflicts require manual repair.

## [5.3.4] - 2026-07-20

Retry-safe release publishing lore makes partial registry or GitHub outages
recoverable without moving a tag or weakening package integrity:

- A rerun skips an existing npm version only when the registry SHA-512 exactly
  matches the freshly packed tarball; conflicting bytes fail closed.
- GitHub release metadata is created independently from tarball and checksum
  uploads, so one failed asset no longer rolls back the release transaction.
- Idempotent release edits and asset uploads use bounded retries, while release
  lookup distinguishes a missing release from an unavailable GitHub API.

## [5.3.3] - 2026-07-20

Project-scoped runtime leadership lore restores global Flow activation in the
OpenCode desktop app without weakening duplicate-version safety:

- One exact globally installed Flow version may initialize independently for
  every open project. Those legitimate project instances no longer disable one
  another.
- Duplicate Flow copies or versions within the same project context still fail
  closed, while unrelated projects remain operational.
- Scoped registrations retain the existing shared registry envelope so an
  unscoped older runtime remains a conservative conflict during upgrades.
- Unit and composed-plugin regressions cover eleven simultaneous projects,
  isolated same-project conflicts, cleanup, capacity, and older-runtime
  compatibility; package and pinned OpenCode smoke remain release gates.

## [5.3.2] - 2026-07-20

Crash-safe single-version installation lore makes upgrading converge on the
invoked latest package without leaving an older active or staged copy behind:

- The new `install` command immediately writes its embedded exact package
  version, refuses downgrades, removes recognized older Flow activation entries,
  and permanently deletes only ownership-proven wrappers and manifest-proven
  inactive cache artifacts after verification.
- Activation journal v2 records a durable deletion commit point. A later install
  safely rolls back an interrupted pre-commit run or finishes verified deletion
  after a committed interruption; read-only checks block on unresolved recovery
  instead of reporting a false success.
- Inventory and CLI output now state the honest coverage boundary: global sources
  plus the selected project. Projects with their own OpenCode configuration must
  be converged separately rather than relying on an unsafe filesystem-wide scan.
- Public installation guidance resolves `@latest` once because `install` performs
  its own exact-version post-apply check. Package smoke and real `SIGKILL` tests
  cover installation, reversible staging, retry, and committed cleanup.

## [5.3.1] - 2026-07-20

Windows validation lore keeps the single-version harness release portable:

- Activation's symbolic-link safety test now unlinks the link itself with the
  cross-platform filesystem primitive instead of asking Bun to recursively
  remove a Windows directory link.
- The persistence integration test that exercises four pinned-helper closure
  paths now has an explicit 30-second budget, matching the existing
  process-spawning integration gates without weakening production timeouts.

## [5.3.0] - 2026-07-20

Single-version harness lore makes the installed package, runtime authority,
validation evidence, correction review, and audit promotion path explicit:

- `activation-check` inventories Flow activation across OpenCode config,
  plugin directories, and package cache. `activation-apply` plans by default,
  then uses an exact canonical pin, backups, quarantine, and a recovery journal
  with `--apply`; ambiguous or externally managed sources require manual
  remediation. Post-mutation failure attempts exact safe rollback and records
  whether recovery converged or needs journal-backed manual repair.
- Process-global runtime leadership permits one operational Flow instance.
  Duplicate versions fail closed; a deterministic highest-version identity is
  diagnostic only and cannot silently take control.
- Three bounded harness profiles (`control`, `standard`, and `assurance`) and
  three rollout modes (`control`, `observe`, and `enforce`) now drive optional
  worker admission through a trusted runtime-policy footer. Worker model and
  current OpenCode `steps` routing are configurable by role.
- Validation is runtime-attested: `flow_validation_start` binds the current run
  and source to the exact next Bash command, which emits an immutable receipt
  reference consumed through `flow_review_start.request.validationRefs`.
  Failed, incomplete, stale, altered, or duplicate receipts cannot become
  review evidence.
- Correction review binds the latest recorded failure to authoritative source
  manifests and a deterministic delta. Narrow correction context is used only
  when complete and safe; broad, security-sensitive, persistence-sensitive,
  missing, unavailable, or oversized context falls back to full review. A
  bounded correction-only public-contract/cross-layer hint can elevate semantic
  scope to full without overriding more specific runtime reasons. The existing
  two-failure run-scoped cap remains authoritative.
- `AuditLedgerV1` now provides bounded typed findings, conservative severity
  rules, explicit refutations and falsifiers, derived summaries, and
  deterministic reconciled Markdown through `flow_audit_render`.
- Privacy-safe bounded host observation and the sanitized full-repository audit
  oracle separate observed zero from unavailable data and require same-source,
  same-model quality parity plus lower observed work before a candidate profile
  can be promoted. The checked-in standard and assurance observations remain
  unavailable, so enforcement is not yet a release claim.

## [5.2.2] - 2026-07-19

Code-quality and persistence-hardening lore makes Flow safer at its input,
replay, packaging, and filesystem boundaries without changing valid Session v4
workflows:

- Lifecycle admission now applies exact UTF-8 and collection bounds before
  state I/O, reserves reachable execution and reviewer projections including
  the longest persisted run identity, validates dependency graphs iteratively,
  rejects duplicate pending assignments, and requires explicit timestamp
  offsets.
- Optional orchestration telemetry has bounded raw and retained collections,
  keeps malformed optional records warning-only, and saturates aggregate
  counters instead of allowing valid large observations to corrupt persisted
  state.
- Replay validates session identity, complete mutation sequencing, crash and
  recovery revision ownership, and monotonic durable revision, digest, and
  status observations while preserving deterministic report bytes.
- Source and evidence persistence use bounded descriptor reads, identity and
  topology revalidation, streaming traversal, exact filename checks, and
  deterministic publication, collision, growth, and ancestor-substitution
  probes.
- Release and package gates validate exact metadata, prune internal declaration
  output, assert the complete packed-file allowlist, audit high-severity
  advisories separately, pin workflow tooling, and keep Linux, macOS, Windows,
  Node 24/26, and the real OpenCode host as blocking compatibility signals.
- Maintained documentation is indexed and source-checked; stale guidance,
  confirmed dead exports and aliases, debug-era wrappers, and test cleanup
  leaks are removed while uncertain external surfaces remain intact.

## [5.2.1] - 2026-07-19

Desktop helper runtime lore restores durable session closure under OpenCode
Desktop while preserving Flow's pinned-filesystem safety boundary:

- Electron-hosted Flow now starts its short-lived filesystem helper through the
  host executable's Node mode. Bun-hosted OpenCode retains its dedicated CLI
  mode, and ordinary Node hosts remain unchanged.
- Helper launch and protocol failures are classified separately from malformed
  or ambiguous canonical history. Recovery guidance preserves the active
  session and its exact durable close operation instead of blaming healthy
  archive state.
- Persistence coverage exercises the Electron launch contract end to end and
  proves that runtime failures remain atomic and receive the correct guidance.

## [5.2.0] - 2026-07-19

Runtime-owned review assignment lore removes the recovery loops seen in long
Flow runs while preserving independent review and stale-source protection:

- Session v4 separates plan features from execution runs. Reset preserves old
  evidence and attempts as audit history but gives restarted work fresh run and
  retry identity. It is the sole supported session contract; every other version
  is generic unsupported input rather than a migration or compatibility path.
- New manager-only `flow_review_start` records source-bound validation and
  creates a durable reviewer assignment. Reviewers recover only by assignment
  id and no longer invent attempt, pass, packet, evidence, snapshot, start-time,
  or review-depth fields.
- `flow_feature_complete` now accepts one nested `completed` or `blocked`
  result. Invalid or stale input is mutation-free and leaves its operation id
  reusable; a genuine review blocker is an accepted mutation that consumes the
  bounded run-scoped retry budget.
- Final assignments retain the exact passing feature-assignment result as a
  durable bound prerequisite. A broad final feature outcome submits only the
  final-assignment result; Flow records both review executions atomically even
  after manager context loss. Same-source final-review retries recover the first
  binding from detail status; compact and reviewer status keep it out.
- Reported validation and review times must follow active-execution,
  validation, and assignment order and cannot postdate runtime acceptance.
- Completed, deferred, and abandoned closure are quiescent. If archive
  publication is interrupted, compact status exposes one retry operation id;
  retry needs no reconstructed summary or causal guards. New close ids are
  unique across active and canonical archived mutation history.
- Saving a different goal never silently archives or replaces an unclosed
  session, including an unapproved draft. Explicit deferred or abandoned close
  owns that disposition before the next goal begins.
- Archive publication and canonical history now require non-null explicit
  closure; closureless Session v4 archives fail closed.
- Lifecycle tools expose strict nested `request` unions. Application,
  registered, emitted, executed, prompt, and documented contracts now exercise
  the same semantic request set with no flat compatibility adapter. Registered
  handlers validate again at entry because schema advertisement alone does not
  stop every invalid host invocation.
- Validation applicability uses source identity plus feature run instead of the
  latest review-ledger revision. Distinct silent validation commands retain
  distinct command identities, while source edits and reset still stale prior
  assignments.
- Manager, reviewer, recovery, README, lifecycle, causal-state, and maintainer
  contracts now describe the nine-tool assignment handshake and final-feature
  economy order. Deterministic lifecycle, transport-budget, prompt, package,
  persistence, and schema coverage exercise the cutover.

## [5.1.1] - 2026-07-19

Durable ignore publication lore keeps concurrent restricted-evidence setup
portable without weakening the crash-safety boundary:

- Exact-content convergence is accepted only for the Windows `EPERM` rename
  race it was designed to tolerate.
- POSIX parent-directory sync failures and unrelated atomic-write errors remain
  fatal, so evidence publication cannot continue without a durable ignore
  policy.
- Isolated fault-injection coverage proves that visible expected bytes do not
  turn a failed directory sync into success.

## [5.1.0] - 2026-07-18

Causal evidence and review truth lore makes long-running Flow work compact,
retry-safe, and auditable without putting raw evidence into model-visible state:

- Session v3 gains additive revision and snapshot identity, an authenticated
  mutation ledger, and guarded idempotent operations. Existing sparse v3
  sessions hydrate to the canonical revision-zero state without a migration.
- `flow_status` now separates compact routing, complete execution, bounded
  detail, reviewer, and revision-delta projections. Mutations return receipts
  instead of the full session; the checked-in six-feature fixture preserves all
  transition decisions while reducing measured stateful response bytes by
  93.95%, with the unavailable historical same-corpus gate reported as such.
- Validation evidence is bound to a deterministic source digest. Optional raw
  output lives in an owner-only, hash-addressed `.flow/evidence` store with
  strict size, permission, symlink, integrity, and no-clobber checks; ordinary
  state records only typed digest and length references, and concurrent
  publishers converge on the same ignore policy across platforms.
- Review executions are durable independently of completion, with stable
  attempt and logical-pass identity, typed finding fingerprints, append-only
  failed-to-passed retry history, contradiction checks, and explicit final-
  feature chronology. Malformed optional orchestration telemetry can no longer
  erase valid core review evidence.
- A provider-neutral sanitized replay oracle derives terminal and retry truth
  from event causality, rejects private or unsafe fixture content, and keeps
  host facts, Flow-ledger claims, supplied observations, and replay-derived
  facts distinct. New `replay:report` and `transport:report` commands expose the
  reproducible local reports.
- Manager and reviewer guidance now routes from compact status to exact
  execution context, records every observed review attempt, performs final
  feature validation and reviews in economy order, and closes only from a
  refreshed compact projection.

## [5.0.0] - 2026-07-18

TypeScript 7 hard-cutover lore makes Flow 5 smaller, stricter, and easier to
recover without carrying a v4 compatibility layer:

- The compiler is TypeScript 7.0.2; the pinned toolchain is Bun 1.3.14,
  Biome 2.5.4, OpenCode plugin 1.18.3, and Zod 4.4.3. Published code now
  requires Node.js 24 or newer and CI covers Node 24 and 26.
- Source code now follows `domain -> application -> infrastructure ->
  platform`: pure transitions use injected time and IDs, application use cases
  depend on repository ports, filesystem state is an outer implementation,
  and OpenCode owns only host transport and rendering.
- OpenCode's embedded validator is private to the host adapter. Flow's core
  schemas use its direct Zod dependency, shared fixtures keep both wire
  contracts aligned, and declaration emit no longer leaks package-manager or
  nested-validator paths.
- Persisted sessions use schema version 3. Version 2 sessions are not migrated;
  they are reported as unsupported and preserved in quarantine so a new v5
  session can start safely.
- Public use-case results have an explicit typed operation status. Repository-
  and caller-controlled prose is confined to `workflowData`; top-level
  summaries, next actions, and recovery fields remain plugin-authored. Feature
  and session IDs are branded, feature IDs are consistently lowercase
  kebab-case at every input boundary, and all superseded `src/runtime` and
  `src/adapters` entrypoints are removed.
- Source and declaration imports follow NodeNext ESM rules with explicit `.js`
  specifiers, and the packed-package smoke test compiles a strict NodeNext
  consumer without skipping library checks before importing the plugin in Node.
- Workspace roots are canonicalized and every Flow-managed directory and file
  rejects symbolic links before read or mutation. Archive publication is
  no-clobber and retry-safe, while lock contention and malformed owner metadata
  fail closed for manual inspection instead of using age or liveness to steal a
  lock. Completion outcomes require an explicit discriminator, and domain
  transitions copy caller-owned plan and evidence collections before recording
  them.
- Flow no longer synchronizes Markdown into OpenCode's global skill registry.
  Core command guidance and optional helpers are embedded in the plugin;
  `flow_guidance` returns exact package-versioned documents by stable id, plugin
  startup performs no global skill filesystem work, and `flow_status` no longer
  carries setup/restart health.
- Plugin configuration only registers commands and agents; it performs no
  workspace filesystem I/O and maintains no ambient instruction projection.
  `/flow-review` validates OpenCode's native subtask identity and agent before
  rewriting only its prompt, so malformed dispatch fails closed.
- Orchestration telemetry retains at most 50 recent pass records and accepts at
  most 50 per completion. Deduplication is scoped to that retained telemetry
  window, and failed completion mutations now update `timestamps.updatedAt`
  from the same instant recorded in `lastError`.
- The experimental compaction hook, token telemetry, phase boundaries, resume
  packets, and acknowledgement protocol are gone. Review retry exhaustion uses
  the ordinary blocked-feature/reset path, while a recorded closure makes the
  session archive-only until retry-safe publication succeeds.
- The old doctor/sync/uninstall CLI is replaced by explicit
  `legacy-cleanup --dry-run|--apply`. Apply never deletes: it moves only
  marker-proven pristine v4 folders to a recovery archive and refuses
  foreign, edited, extra, malformed, or symlinked content.

## [4.4.0] - 2026-07-17

Prompt economy lore makes Flow's instructions smaller, more role-specific, and
easier to verify without weakening runtime, validation, or review gates:

- Public commands and hidden workers now compile role- and phase-specific
  prompts from canonical skill fragments instead of concatenating whole skills
  or maintaining parallel prompt copies in TypeScript.
- Parallel guidance uses progressive disclosure: a short routing index loads
  decision rules first, manifest and execution rules only after fan-out is
  selected, and synthesis rules only when handoffs return. Serial-decision
  context is about 76% smaller while the complete advanced contract remains
  available.
- Each hidden worker receives one role contract and one matching handoff schema;
  empty, malformed, partial, and blocked handoffs remain explicit coverage gaps,
  and candidate implementation stays subordinate to the root `flow-run`
  manager.
- Runtime-unavailable guards, planned review depth, cleanup/UI/audit evidence,
  bounded review repair, and root-manager state ownership are covered across
  the compiled surfaces.
- Skills no longer estimate context pressure or request host compaction, and
  the experimental compaction hook and environment switch have been removed;
  durable runtime phase boundaries remain the continuation mechanism.
- New deterministic prompt-quality tooling covers 18 scenarios and 52 static
  criteria, with an opt-in structured model evaluator for GPT-5.4, GPT-5.6 Sol,
  and other configured OpenCode models.

## [4.3.9] - 2026-07-08

Candidate accounting coherence lore makes the 4.3.8 orchestration accounting
rules self-consistent, so valid manager records stop bouncing off the schema:

- `decision: "parallel"` on implementation-decision records is now rejected
  with one clear message (it stays valid for discovery, audit, and review
  passes); previously every `candidateDecision` pairing produced contradictory
  errors.
- Candidate-shaped decisions now require candidate execution evidence on every
  pass kind, so a decision label alone can no longer validate while being
  excluded from `candidatePassCount`.
- Candidate and verifier worker counts are checked per subtype instead of
  summed, so one worker may fill both roles on a single pass row.
- Orchestration pass dedup now remembers every recorded pass id in
  `recordedPassIds`, so resubmitted completions no longer double-count
  telemetry after the recent-pass window rolls over.
- The candidate accounting rules are documented once, in
  `skills/flow/references/parallel-orchestration.md`; the run skill, handoff
  format, and wiki point there instead of restating them, and the two doc
  instructions that contradicted the schema (omitted `decision` on decision
  records, `workerCount=0` with positive `candidateWorkerCount`) are fixed.

## [4.3.8] - 2026-07-08

Parallel orchestration accounting lore makes broad worker use visible without
turning Flow state into a transcript store:

- `flow_feature_complete` can now record compact `orchestrationPasses` for
  serial, skipped, exact-path candidate, isolated-worktree, tournament,
  validation, review, and verifier passes.
- `flow_status` reports aggregate pass telemetry under
  `session.budget.orchestration`, including worker counts, candidate/verifier
  usage, skipped candidate decisions, and recent pass records.
- Completion now records orchestration telemetry on success, validation-gate
  failures, failed reviews, and `needs_input`, while deduping retry payloads and
  retaining only the latest compact pass records.
- Flow planning and running guidance now requires explicit implementation pass
  decisions for broad work and keeps full handoffs, logs, and manager scratch
  artifacts outside `.flow/**`.
- README runtime wording now matches the 4.3.6 behavior: completed feature
  counts are telemetry only, not a three-feature stop.

## [4.3.7] - 2026-07-08

Package-smoke patience lore keeps the 4.3.6 release path portable across slower
macOS Node 24 runners:

- The package smoke test now has an explicit timeout large enough for the packed
  consumer declaration check to finish on CI, avoiding a runner-speed-only
  failure after the Release workflow already passed.

## [4.3.6] - 2026-07-08

Phase-continuity lore removes the rough stop after three completed features and
adds sharper handoffs around long Flow sessions:

- Completed feature counts are now telemetry only; approved plans keep moving to
  the next runnable feature instead of requiring a fresh session after three
  completions.
- `flow_status` now includes a human-readable progress line, `nextFeature`,
  `pendingFeatures`, and remaining feature count so resumed sessions name the
  exact next slice.
- Hidden worker prompts now fail closed on empty or unstructured handoffs, and
  worker model routing can be configured with `OPENCODE_FLOW_*_WORKER_MODEL`
  environment variables.
- Release publishing now has `bun run release:monitor`, which watches the
  release commit's CI and tag-triggered Release workflow before declaring the
  release healthy.

## [4.3.5] - 2026-07-08

Flow now stops long autonomous loops more deliberately without making reviews
shallower:

- Runtime budget telemetry records completed features since the last phase
  boundary, feature/final review counts, failed review counts, per-feature
  retry attempts, and host token telemetry availability.
- Failed feature and final reviews now pause by default, allow only one
  autonomous repair plus one retry, then block the feature with a compact
  resume packet instead of continuing to edit in the same root session.
- Feature completion now records `featureReviewDepth` and rejects evidence that
  is shallower than the approved feature requires.
- Large sessions now checkpoint after three completed features and require an
  explicit `phaseBoundaryAck` in a fresh phase before the next feature starts.
- Flow planning, running, review, README, maintainer docs, and wiki pages now
  describe scoped review packets, risk-based review depth, retry limits, and
  phase-boundary handoffs.

## [4.3.4] - 2026-07-07

Planning and final-review lore sharpened without changing the runtime surface:

- `flow-plan` now has a pre-approval quality gate that checks outcome,
  requirements, decisions, uncertainty, feature shape, bounded targets,
  validation levels, dependencies, and review policy before a plan is saved or
  approved.
- Planning examples now cover bugfix, UI/frontend, runtime/schema, docs-only,
  audit-first, and stronger validation patterns, giving agents better few-shot
  guidance for common Flow sessions.
- Final review now includes a convergence scan that traces the original goal,
  approved requirements, every planned feature, changed artifacts, and
  validation evidence before returning a passing `finalReview`.
- The new planning checklist is shipped through synced skills and bundled
  `/flow-plan` and `/flow-auto` command instructions, so fresh and stale skill
  discovery paths get the same guidance.

## [4.3.3] - 2026-07-07

Verification only — no behavior change:

- The live OpenCode smoke test now proves the hidden read-only workers'
  isolation actually binds at runtime: against a real server it asserts each
  worker's resolved permission rules deny the state-changing `flow_*` tools,
  `task`, `skill`, and `edit`, while keeping `flow_status` readable. This
  confirms OpenCode compiles Flow's tool-name and wildcard permission keys
  (which are absent from the SDK's simplified permission type) rather than
  silently dropping them, closing the one unverified question from the 4.3.2
  review.

## [4.3.2] - 2026-07-07

Correctness and safety hardening from a full-project review, repairing two
edges introduced in 4.3.1 and several older ones:

- Uninstall no longer deletes a user file that merely resembles a backup name:
  a file counts as removable Flow residue only when its name and its content
  checksum both match Flow's backup format. Doctor applies the same check.
- Sync no longer overwrites a user-owned skill folder that has files at managed
  paths but no `SKILL.md` — any managed folder without a Flow marker is left
  untouched, not clobbered without a backup.
- An empty `HOME` no longer makes the skills root a current-directory-relative
  path (which sync wrote into and uninstall removed); it falls back to the OS
  home. `engines` now requires Node `>=20.12` (doctor/uninstall rely on it).
- The CLI no longer aborts on a stray `flow-*` file in the skills root, and a
  CRLF-converted skill marker is no longer misreported as outdated.
- Session locks recover from more failure modes: a far-future or foreign-host
  lock timestamp and a recycled process id are now reclaimable instead of
  wedging every Flow call, and stale-lock reclamation no longer races two
  waiters into holding the lock at once.
- `flow_status` re-checks the session under the lock before quarantining, so a
  session written by a concurrent process can't be quarantined by mistake; a
  session file with an archive-unsafe id now routes to quarantine recovery
  instead of wedging every archive; and its output is framed as data to blunt
  instruction-injection from a cloned repo's session file.
- A user command named like an object built-in (e.g. `/toString`) no longer
  crashes command preflight, and a Flow command invoked with an attachment now
  keeps its worker isolated instead of double-running the instructions.
- Session history is bounded so long autonomous loops cannot grow the session
  file without limit. Docs corrected to match the current uninstall/doctor
  behavior.

## [4.3.1] - 2026-07-06

Doctor and uninstall now account for the `.backup` files Flow writes when it
retires a locally-edited managed skill file:

- `doctor` reports leftover `.backup` files as action-required instead of
  saying "ok", lists each one, and explains that they hold your earlier edits
  and can be deleted once you no longer need the saved copy.
- `uninstall` treats a folder that is pristine apart from Flow-created
  `.backup` residue as removable and names the removed backup files, so the
  cleanup is no longer silently blocked or silently destructive.

## [4.3.0] - 2026-07-06

Parallel orchestration reworked into a single pass playbook, plus sharper
planning and routing:

- The parallel-orchestration references collapse into one playbook with an
  explicit loop — orient, slice, manifest, fan out, account, verify,
  synthesize, extend or stop — so a manager reads one file instead of four
  cross-linked ones. Every bundled public Flow command got smaller as a result.
- A new pass manifest doubles as the pre-fan-out coverage gate and the
  accounting contract: one row per slice with its scope, expected coverage, and
  verification tier, and N rows spawned means N handoffs accounted for before
  synthesis.
- A worker-failure ladder handles a slice that errors, blocks, or returns
  partial: re-spawn once narrower, cover it directly, or carry it into the
  synthesis explicitly as not-covered — never as if coverage were complete.
- `flow-plan` gains uncertainty-typed decomposition: resolve specification
  uncertainty by stating an assumption (or asking when a wrong guess is costly)
  and environment uncertainty by inspecting, never by asking.
- Frontmatter descriptions for `flow-plan`, `flow-run`, and `flow-review` now
  describe only when to reach for each skill, so single-phase asks route
  cleanly.

## [4.2.1] - 2026-07-05

Skill routing and boundary clarity across the managed skill set:

- Frontmatter descriptions now route single-phase asks cleanly: `flow`
  defers plan-only work to `flow-plan` and single-feature execution to
  `flow-run`, `flow-test` no longer claims every testing intent,
  `flow-deslop` leaves review verdicts to `flow-review`, and
  `flow-ui-quality` hands browser-run mechanics to `flow-test`.
- `flow-deslop` and `flow-ui-quality` now state explicitly that they are
  helper skills: they contribute evidence only, and the manager owns every
  state-changing `flow_*` call.
- The `flow` skill gained a routing note covering plan-only, single-feature,
  and status-only asks, and `flow-review` names its manager context
  accurately (the `flow`/`flow-run` skills or a bundled public Flow command).
- The repo-local contribution preflight now states its output is commit/push
  readiness evidence only and never substitutes for Flow validation or
  review evidence.
- README lists all four managed non-command helper skills.

## [4.2.0] - 2026-07-01

Safety and usability overhaul across the runtime, packaging, skills, and docs:

- Uninstall no longer deletes managed skill folders that contain your own
  files or have a damaged version marker; `uninstall --dry-run` previews
  removals.
- Crashed sessions recover: stale session locks expire automatically and the
  lock timeout error names the manual fix; corrupt or older-version
  `session.json` files are quarantined into `.flow/history/` with recovery
  guidance instead of failing every tool with a raw validation dump.
- Fixed a batch of small correctness bugs: `$`-sequences in goals no longer
  get mangled, attachments to Flow commands are preserved, failed plan saves
  no longer discard the previous session, replacing a draft plan archives it,
  and `needs_input` no longer reports a stale prior error.
- OpenCode compatibility: the peer dependency is now a range
  (`>=1.17.3 <2`) so newer OpenCode versions install cleanly; a live smoke
  test boots a real OpenCode server against the packed tarball in CI; CI runs
  on macOS and Node 20/22/24; published bundles are no longer minified and
  ship sourcemaps.
- Skills: repo-specific content removed from distributed skills, duplicated
  orchestration rules consolidated (smaller command prompts), the read-only
  reviewer no longer receives instructions it cannot execute, and managers
  are told to paste handoff templates into worker prompts.
- New opt-in `FLOW_EXPERIMENTAL_COMPACTION=1` injects the active session
  summary into OpenCode session compaction; the default stays hook-free.
- README rewritten around a quick start; install/repair depth moved to
  `docs/troubleshooting.md`.

## [4.1.18] - 2026-07-01

Review-skill guidance: keep the audit rubric bundled with `/flow-review`,
restrict commit preflight to the staged boundary, and make long reference
docs easier to navigate.

## [4.1.17] - 2026-06-28

Parallel-pass guidance: verify worker handoffs before use, prune retired
managed skill files during sync, and state explicitly that only the manager
synthesizes worker output.

## [4.1.16] - 2026-06-22

Quote skill frontmatter values so GitHub renders SKILL.md previews correctly;
CI now guards against future YAML frontmatter regressions.

## [4.1.15] - 2026-06-22

Add a condensed "quick path" to the orchestration guidance, bundle a worked
parallel-pass example, test that skill doc links resolve, and document the
trusted-publishing release process.

## [4.1.14] - 2026-06-22

Publish through npm trusted publishing (GitHub Actions OIDC) so releases no
longer depend on expiring npm tokens.

## [4.1.13] - 2026-06-21

Walk a full parallel pass in the orchestration guidance and pin hidden worker
permissions to a tested documentation table.

## [4.1.12] - 2026-06-18

Harden hidden worker prompts, add scriptable `doctor --check`/`--strict`
modes, type the package smoke test, and tighten session edge-case contracts
without changing the v4 runtime surface.

## [4.1.11] - 2026-06-17

Give bundled Flow commands a real title seed so OpenCode can name new chats,
while keeping the heavy command instructions out of the visible prompt.

## [4.1.10] - 2026-06-17

Move ambient Flow session context onto stable OpenCode `config.instructions`;
experimental chat hooks no longer shape default runtime context.

## [4.1.9] - 2026-06-17

Make public Flow commands fully self-contained so stale native skill
discovery cannot block the required loop.

## [4.1.8] - 2026-06-17

Command preflight now replaces stale resolved Flow command bodies with
current bundled instructions; review instructions are bundled where skill
discovery can lag.

## [4.1.7] - 2026-06-17

Sharpen the flow-test and flow-commit skills' triggers, and require explicit
maintainer intent before any `.flow/**` artifacts are committed.

## [4.1.6] - 2026-06-16

Recommend `--force` in the pinned installer command so OpenCode replaces
older global plugin entries instead of leaving stale versions behind.

## [4.1.5] - 2026-06-16

Adopt OpenCode's native plugin installer as the primary install path, with a
pre-start skill sync and a manual-config fallback for older versions.

## [4.1.4] - 2026-06-16

Make skill loading restart-aware across every command, add manual sync
repair, and treat missing optional helper skills as explicit coverage gaps.

## [4.1.3] - 2026-06-16

Align final-review language between skills and runtime, broaden gate test
coverage, add CLI smoke tests, and route command preflight through skill
awareness.

## [4.1.2] - 2026-06-15

Surface skill-registry lag with restart-aware setup warnings, add the
`doctor` command, and bundle a review fallback for stale OpenCode startups.

## [4.1.1] - 2026-06-15

Keep local session state out of Git by default with a generated
`.flow/.gitignore`, while preserving opt-in versioning for teams that
intentionally archive session evidence.

## [4.1.0] - 2026-06-15

Add Flow-native orchestration handoffs, verification gates, and a hidden
verifier worker, inspired by Ray Fernando's parallel agent workflow skill
work and RepoPrompt CE's context-engineering approach. Public runtime surface
unchanged.

## [4.0.1] - 2026-06-15

Fan out through named evidence, validation, audit, review, and candidate
workers while keeping runtime state changes manager-owned.

## [4.0.0] - 2026-06-14

Breaking overhaul: Flow is now a skills-first plugin with a minimal v4
runtime ledger, seven tools, one active `.flow/session.json`, archived
history, review evidence embedded in completion, and no context-pack or
separate review-decision framework.
