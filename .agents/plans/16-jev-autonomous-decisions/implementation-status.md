# Implementation status

The offline evaluation workflows and default-off runtime recovery mechanisms are implemented on `feat/jev-recovery-runtime`, based on JEV-1 commit `5db4e98`.

The user requested continued implementation after the live gate was explained. Construction proceeded before live qualification. Production delegated activation remains unavailable because the release-owned qualification registry is empty. The whole qualification and release plan is not complete.

| Phase | Current state |
| --- | --- |
| JEV-1 | Evaluation tooling implemented and tested. Initial live availability probe passed; real model comparison remains unmeasured. |
| JEV-2 | Policy, explicit shadow controls, shared guard, strict adapter, and status proposals implemented. |
| JEV-3 | Exact guarded recovery and continuation implemented and tested with internal qualified fixtures. Production activation refuses. |
| JEV-4 | Deterministic hardening, replay, documentation, and packed-host smoke completed. Paid model and performance qualification remain open. |

The latest implementation pass adds durable episode journals, decision safety
labels and uncertainty, reviewed calibration bindings, and qualification diagnostics.
Live episode execution still lacks all-model dollar enforcement and an isolated
Jev treatment. See the completion implementation pass at the end of this file.

## Implemented runtime behavior

Ordinary `/flow-auto` remains off for recovery advice. An explicit shadow invocation supplies call and dollar caps. Bare status never calls Jev. A proposal-bearing status call analyzes up to three remedies without mutating Session state.

The shared controller checks current host lineage, approved plan, source, revision, history, and exact pending action. Existing reset and start tools enforce the grant inside the transaction. Validation and independent review remain mandatory after a retry.

Stop, cancellation, replacement, and restart cannot restore a pending grant. Exact accepted operations replay without creating new permission. Provider work has bounded attempts, deadlines, bytes, and spending reservations. No Session v5 field or new public tool was added.

The new command syntax is a development preview, not a published release feature.

```text
/flow-auto --recovery=shadow --recovery-calls=6 --recovery-usd=0.02 <goal>
```

## Verification

The parent used Bun 1.4.0 and the frozen lockfile.

- `bun run check` passed 1,333 tests with zero failures. Its one skipped opt-in smoke was run separately.
- `bun run replay` matched all 13 gated cassettes.
- `bun run smoke:live` passed all 22 checks against the real packed OpenCode 1.18.6 host. It made no AI provider calls.
- Independent correctness, coverage, and no-comments reviews passed after four reproduced lifecycle defects were fixed and covered by regression tests.

The file-backed integration test reaches recovery, fresh controlled validation evidence, reviewer-owned completion, and the next coordinator prompt through registered tools. Controlled evidence proves mechanics. It does not establish Jev decision quality or actual execution of every validation command.

See [runtime verification](evidence/runtime-verification.json), [runtime reviews](evidence/runtime-reviews.md), and [construction decisions](runtime-design.md). The [JEV-1 receipts](evidence/implementation-verification.json) remain historical evidence for that commit. Full repository logs remain local and are identified by digest in the receipts.

## Remaining work

The live TypeSafe comparison, independent holdout corpus, calibrated thresholds, latency and cost measurements, unattended model-driven campaign, operator interaction review, and release qualification remain open. The eight starter cases are synthetic and cannot qualify production use.

The resumed Linux session has a TypeSafe credential. The user approved an initial
$0.10/24-attempt probe. Nine live attempts completed without retries, including
one through the production adapter, with estimated input cost $0.000318024.
The eight development cases admitted no Jev recovery actions under their starter
thresholds. The runtime probe also fell below its suitability threshold. See
[live probe findings](evidence/live-probe.md). This confirms availability and
response compatibility, not recovery quality. The two authorized probe dispatches
are consumed; further paid campaigns need a new explicit budget.

No caller flag can populate the release-owned qualification registry. The registry must remain empty until the exact model, rubric, packet construction, policy, and thresholds have reviewed evidence. No merge, publication, or release occurred.

## Principles applied

Model the Domain separated proposals, advice, grants, and replay. Boundary Discipline placed authorization after source hashing inside the mutation transaction. Make Operations Idempotent preserved exact replay without creating new permission. Sequence Work into Verifiable Units separated construction from activation. Prove It Works required the full tool-to-review path and a real packed-host smoke while leaving model quality unclaimed.

## Runtime evaluation preparation

The offline `eval:recovery prepare` command now evaluates Session snapshots and
proposals through the production shadow controller, retaining exact packets and
source digests. Eight synthetic development cases exercise retry, independent
work, scope expansion, unchanged remedies, injection, finding references,
dependencies, and candidate filtering. Labels are author-proposed and unreviewed;
reports remain inconclusive. See the [evaluation guide](../../../evals/recovery-decisions/README.md).
This preparation used no additional paid calls. Representative independent labels
and the qualification gates remain open.

## Runtime live collector

The `eval:recovery collect` command now uses the production adapter with a shared
campaign attempt and dollar budget. It requires a persistent paid-dispatch
authorization and a new output directory. It saves input and source digests,
reservations before HTTP dispatch, completed case receipts, and a final summary.
Cancelled or crashed campaigns cannot restart into the same directory or recover
their consumed dispatch.

The collector accepts synthetic development and independently reviewed corpora.
The bundled corpus is synthetic and unreviewed, and all reports remain inconclusive. Implementation and simulated
verification made no additional paid calls. A new explicit campaign budget is
still required before live collection.

Collector verification passed type checking, repository lint, and 57 focused
tests with 500 assertions. An isolated CLI test exercised the production adapter
with simulated HTTP responses, including a 503 retry. A separate subprocess check
verified unfunded refusal, SIGTERM exit 143 with retained receipts, and refusal to
restart into an interrupted output directory. These checks establish collection
mechanics only. See the [collector verification receipt](evidence/runtime-collector-verification.json).

## Reviewed dataset workflow

Offline commands now import sanitized snapshots into unreviewed drafts, validate
independent label-review receipts bound to exact content, and build reviewed
corpora. Validation checks runtime eligibility, duplicate snapshots, one primary
case per independence group, and task/group/family/source/session separation
between calibration and holdout. Existing synthetic fixtures remain unreviewed.

No real snapshots or independent reviewer attestations were fabricated or added.
Dataset preparation and simulated tests made no paid calls. Actual data gathering
and review, frozen holdout registration, manager comparison, calibration, and
budgeted live qualification remain open. The qualification registry stays empty.

Dataset verification passed type checking, repository lint, and 65 focused tests
with 530 assertions. Tests cover immutable CLI output, stale and self-review
rejection, required abstention, duplicate snapshots, group inflation, family-only
split contamination, and controller eligibility. See the
[dataset verification receipt](evidence/runtime-dataset-verification.json).

## Frozen comparison workflow

The runtime evaluator now registers a full reviewed corpus with one collection
split, current source and dependency hashes, exact packets, manager model and
prompt, and fixed runtime thresholds. Registered collection validates those
bindings before consuming paid authorization. Holdout registration requires a
calibration-evidence digest. It does not attest that calibration passed.

Separate manager and Jev evidence files feed an offline comparison. The report
replays raw Jev advice through the real controller and records input digests.
It separates forbidden manager proposals, unacceptable accepted selections,
abstentions, missing observations, provider failures, and deterministic filters.
Primary cases determine paired descriptive deltas. Latency and reserved-dollar
metrics include their observed sample counts.

Collector import validates retained journals, receipts, and summary accounting.
Imported live origins remain reviewed attestations, not authenticated evidence.
Missing final summaries are unsupported. The commands and exact input shapes are
in [Run a frozen decision comparison](../../../evals/recovery-decisions/run-comparison.md).

Verification passed type checking, repository lint, and 72 focused tests with 577
assertions. A separate CLI subprocess check used mocked HTTP only. It verified
selected-split collection, stale-registration refusal before paid dispatch,
immutable artifacts, import, and report generation. No paid calls occurred.
See the [comparison verification receipt](evidence/runtime-comparison-verification.json).

Representative data and independent review remain outstanding. Actual threshold
calibration, manager observations, paired uncertainty intervals, episode outcomes,
and budgeted live qualification remain open. This report cannot distinguish unsafe
from ineffective selections with the current labels. Production activation stays
disabled and every report remains qualification-inconclusive.

## Whole-episode outcome reporting

Offline episode registration and reporting now cover completion, human
interruptions, active runtime, operator wait, spending reservations, and reviewed
safety counts. The episode roster is separate from recovery snapshots. It freezes
one task per independence group, starting-state digests, completion criteria,
manager settings, harness digests, timeout, metric definitions, and analysis
settings. Both arms must use the same manager model and prompt.

The reporter retains failed, cancelled, and timed-out outcomes. Missing and
unavailable observations remain unknown. It computes interruption reduction,
completion difference, and growth in the ratio of arm medians with paired
percentile bootstrap intervals. Missing coverage, undefined draws, insufficient
pairs, and degenerate distributions prevent an interval. These intervals are
exploratory and never authorize promotion.

Registration and arm digests detect changed inputs. Safety-review digests bind
the registration, arm, episode, source receipt, and counts. Imported provenance
and reviewer identities remain attestations. The tool does not authenticate live
execution, historical order, or statistical independence.

Use [Report episode outcomes](../../../evals/recovery-decisions/run-episodes.md)
for commands and input fields. No paid calls occurred during this implementation.
The production qualification registry remains empty.

Verification passed 80 focused tests with 640 assertions, type checking, and
repository lint. A separate CLI check verified immutable artifacts, missing
coverage, and stale arm rejection. An independent Python calculation reproduced
all three point estimates and interval endpoints on six synthetic pairs. See the
[episode verification receipt](evidence/runtime-episode-verification.json).

The remaining work is explicit:

- Gather representative recovery cases and independent reviews.
- Gather manager observations and perform actual threshold calibration.
- Connect live episode instrumentation to the frozen measurement definitions and
  retain reviewed source receipts. This unit reports supplied observations.
- Run the live campaigns under a new explicit spending authorization.
- Establish the 100 paired-episode and separate 300 accepted cases per action-class
  requirements, review uncertainty, and prepare release qualification evidence.

Decision-level uncertainty and unsafe-versus-ineffective labels remain separate
gaps. Whole-episode intervals do not complete those decision-quality requirements.

## Episode receipt reduction

The offline `episode-reduce` command now converts a retained timestamped event
receipt into an unreviewed, report-compatible observation. It binds the receipt
to the current registration, arm, episode, and declared initial state. An explicit
active/operator-wait state machine measures intervals; separate intervention
events count human recovery interactions. Terminal failures retain telemetry.
Incomplete receipts produce unavailable outcomes with unknown aggregate totals.
Duplicate reservation IDs, malformed timelines, and stale bindings are rejected.
Unknown spending coverage and unreviewed safety counts remain null.

This is the receipt contract and reduction step, not live harness instrumentation.
The harness still needs durable event capture, reset/timeout enforcement, and
reviewed actual execution receipts. The reducer cannot authenticate declarations
or detect omitted events. Representative case review, calibration, decision-level
quality gaps, and newly budgeted live qualification remain open. No paid calls
were made and the production qualification registry remains empty.

Verification: 85 focused tests passed with 671 assertions, including a real CLI
subprocess round trip and overwrite refusal. Type checking and repository lint
passed. See the receipt workflow in
[Report episode outcomes](../../../evals/recovery-decisions/run-episodes.md).

## Completion implementation pass

Decision comparisons now accept independently reviewed candidate safety outcomes,
separate unsafe from ineffective and unreviewed selections, and retain selected
candidate/action identity. Primary action classes have separate zero-error risk
bounds. Paired decision differences have conservative Hoeffding intervals only
when primary coverage is complete. Neither calculation establishes independence
or execution safety by itself.

The offline calibration workflow recomputes the fixed-policy comparison, binds an
independent review, and verifies an exact holdout connection. The qualification
report recomputes raw decision and episode inputs. It reports missing gates and
never promotes a profile. Any observed unsafe Jev selection vetoes qualification,
including secondary cases, without inflating primary statistical denominators.
See [calibration and qualification workflow](../../../evals/recovery-decisions/run-qualification.md).

The episode runner now persists private, ordered, synced event files and recovers
partial journals read-only. It verifies task/reset hashes, evaluates frozen
completion criteria, and requires confirmed cleanup before a terminal event.
Execution and evaluator errors remain unavailable even if cleanup crosses the
episode deadline. The host adapter connects to `EvalHost`, verifies real seeded
file data, and binds exact completion checks per episode. Fixtures share the arm's
implementation digest. Explicit generated-directory allowances cover Flow state
without accepting arbitrary extra output. Tests use injected hosts, not live models.

Local implementation is still incomplete at the live execution boundary:

- Enforce a shared dollar cap on every manager, subagent, retry, and Jev request.
  The existing host dispatch count is insufficient. Provider/model selection is
  needed to implement the actual metered request adapter.
- Provide an isolated experimental Jev treatment without changing the production
  qualification registry. The current host adapter rejects that treatment.
- Connect real operator wait/resume/intervention events and retain reviewed source
  receipts. The current adapter records escalation and waits for cancellation.
- Verify package-cache and executable artifact bytes for live harness identity.
- Prove the adapter against a real isolated host. Its current tests inject a host.

The runner refuses all live execution before host startup. No new paid calls,
production activation, commit, push, or publication occurred. Representative
snapshots, independent review, real calibration judgment, new campaign budget,
and live qualification remain external gates. A passing local suite does not
complete those gates.

Final verification passed `bun run check`: type checking, lint, release metadata,
build, and 1,397 tests with 7,317 assertions. The opt-in packed-host smoke was
skipped and was not rerun in this pass. `git diff --check` passed. See the
[verification receipt](evidence/runtime-completion-verification.json) and
[independent review findings](evidence/runtime-completion-review.md).

## Manager model selection

The user selected `openai/gpt-5.6-terra` and `xai/grok-4.6`. Local OpenCode 1.18.31
lists both exact model IDs as active. Both existing provider connections use OAuth.
The new offline `manager-preflight` command saves a filtered, immutable catalog
receipt, preserves exact requested IDs, and keeps billing and inference access
unverified. Each manager requires its own paired comparison and qualification.
See [the catalog receipt](evidence/manager-preflight.json).

The installed OpenCode version differs from the earlier 1.18.6 packed-host smoke.
The receipt records 1.18.31 and does not claim the earlier host verified these
routes. No credential values were retained and no inference calls were made. The model
selection question is resolved. Metering must now target the actual OAuth request
boundary rather than assume direct API-key billing. The live execution gate remains
closed; new paid campaigns still require an explicit cap.

Selection verification passed type checking, repository lint, and 27 focused tests
with 161 assertions. The real `manager-preflight` CLI produced the linked receipt.

## Request-level budget enforcement

The shared request ledger now enforces explicit request and integer-microdollar
reservation caps across OpenAI, xAI, and Jev. Each HTTP attempt reserves durably
before forwarding. Concurrent hosts share exclusive claim slots; retries and
uncertain failures retain their reservations. Expiry, cancellation, changed
bindings, malformed ledgers, unknown models, and unmetered routes refuse dispatch.

An evaluation-only plugin installs the gate after OAuth rewriting. Budgeted
`EvalHost` instances disable native LLM/WebSocket paths and verify installation in
the server process group. Ordinary hosts remain unchanged. Both selected OAuth
adapters have now been exercised in real OpenCode 1.18.31 with simulated tokens and
responses. Each exhausted exactly two request reservations. No paid inference or
real credential copy occurred in these checks.

This closes request-path interception and durable shared reservation enforcement.
It does not establish the reviewed per-request monetary bounds for the real OAuth
connections. Live authorizations require those review attestations, and a new
campaign still requires an explicit spending cap. It is not an OS network sandbox
for arbitrary shell programs. The isolated Jev treatment, operator-resume handling,
artifact-byte verification, and live qualification remain open. The episode runner
continues to refuse live execution and the production qualification registry stays
empty.

See [request budget workflow](../../../evals/recovery-decisions/run-request-budget.md).

Verification passed `bun run check` with 1,409 tests and 7,384 assertions. Its three
opt-in tests were skipped. Both new real-host OAuth budget smokes were then run
separately and passed with eight assertions. The older packed Flow smoke was not
rerun in this pass. `git diff --check` passed. See the
[request-budget verification receipt](evidence/runtime-request-budget-verification.json).

## Isolated simulation treatment

The evaluation host now supports manager-plus-Jev through a separate experimental
entrypoint. It shares the production plugin composition, command hooks, message
ancestry checks, tools, and recovery controller. Each plugin instance owns its
controller. Injected profiles report `experimental-evaluation`; production still
uses the empty release registry and refuses delegated activation.

Both simulation arms use the same bundled composition and `/flow-auto` command.
The Jev arm adds explicit recovery limits. Startup requires a simulation budget,
the selected manager and Jev model entries, and a matching gate receipt from the
host process. The receipt binds the treatment, response script, and experimental
bundle. Simulation startup strips inherited credentials and installs synthetic
OAuth locally. Its provider transport never forwards inference or refresh calls.

The fixed response script supports `openai/gpt-5.6-terra` and `xai/grok-4.6` through
their actual OAuth Responses routes. It obtains session revisions, finding IDs,
and the exact recovery mutation from real tool results. Accepted recovery advances
the revision, supersedes the blocked run, and creates an active replacement.
Manager-only control and below-threshold rejection leave the session unchanged.
All requests retain their shared reservations, including auxiliary host requests.

The real-host smoke seeds blocked sessions through existing Flow transitions
after host configuration establishes source identity. This proves treatment
wiring against a simulated provider. It does not establish a complete frozen
episode campaign, model quality, or pricing. The episode runner still refuses live
execution. Operator wait/resume, representative independently reviewed cases,
reviewed request-cost bounds, executable and package-cache identity, a new paid
campaign cap, and live qualification remain open.

See the [design decision](treatment-design.md).

The current-head [verification receipt](evidence/runtime-treatment-verification.json)
records the full `bun run check` totals and source digests.
Its nine opt-in tests were skipped. Six treatment host checks passed separately
with 98 assertions on OpenCode 1.18.31. Both existing OAuth budget checks also
passed. The packaged production smoke passed on its pinned OpenCode 1.18.6 host.
No paid inference occurred.

## Operator intervention and continuation

Evaluation operators can now read the actual manager question and submit one
response through `episode-read-question` and `episode-submit-reply`. The runner
owns the file inbox, intervention limit, deadline, and durable wait transaction.
The host captures question content and call IDs before OpenCode aborts the pending
question. An accepted response continues as an ordinary message in the same
session with the registered manager.

The private journal retains the question and exact accepted reply. A shared state
transition function validates recording and recovery. Replies bind to the current
wait, episode, arm, and header. Stale, duplicate, malformed, oversized, and symlink
inputs cannot trigger continuation. Persistence must complete before another
manager request. Cancellation prevents late continuation. The parsed operator
policy is frozen and participates in harness identity. Historical timing-only
receipts remain readable.

Final parent verification passed `bun run check` with 1,426 tests and 7,451
assertions. Its 13 opt-in checks were skipped. Four real-host operator cases passed
separately with 52 assertions on OpenCode 1.18.31. Both selected managers completed
registered simulated episodes through the actual CLI response commands and
recovered their journals. Cancellation cases consumed no continuation request.
Six existing treatment cases also passed in the implementation owner's combined
host run. The final operator rerun includes the subsequent input-size and policy
immutability fixes. Focused verification passed 36 tests with 169 assertions.

This closes the local operator continuation interface and demonstrates one frozen
simulated episode per manager. It does not prove a full paired campaign or an
episode combining a delegated recovery with a later operator intervention.
Operator attribution remains unverified. Independent source review, representative
cases, reviewed cost bounds, executable and package-cache byte identity, a new
paid campaign cap, and live qualification remain open. Journal recovery never
replays execution. The production registry remains empty and the runner still
refuses live origins. No paid inference occurred.

See the [operator design decision](operator-resume-design.md),
[operator workflow](../../../evals/recovery-decisions/run-episodes.md#answer-an-episode-question),
and [verification receipt](evidence/runtime-operator-verification.json).

## Executable and package-cache identity

Episode drivers now require an explicit native OpenCode executable. Their harness
identity includes the Bun and OpenCode bytes and the complete applicable package
cache. Hosts copy those artifacts into private storage, verify the copies and
reported versions, and launch OpenCode directly. Linux checks read the actual
process executable handles for OpenCode and the Bun treatment builder.

Checks run after startup and before every command or prompt, including operator
continuation. Cancellation is checked again after hashing. Cache identity covers
regular-file bytes, executable bits, directories, and contained relative links.
Escaping links and special files fail. A symlink at the source cache root becomes
an independent directory copy. The journal retains the expected manifest and a
startup verification receipt with its digest and observation method. Recovery
validates their correspondence. These host-recorded observations still require
independent execution review. Historical receipts remain readable.

Verification passed `bun run check` with 1,435 tests and 7,480 assertions. Its 14
opt-in cases were skipped. Five relevant host checks passed separately with 65
assertions on the final source bytes and native OpenCode 1.18.31. They cover both
managers' operator resume and cancellation, real packed-cache startup, and copied
cache drift that blocks prompt dispatch. Focused tests passed 41 cases with 179
assertions. The independent reviewer ran 12 artifact and receipt cases with 53
assertions and reported no unresolved material findings.

An earlier host run timed out in xAI cancellation while final source changes and
repository checks were running. The complete stable-source rerun passed. The
initial packed-cache check refused external links created by a test install with
`HOME` omitted. Restoring the normal package-preparation environment produced a
contained cache without relaxing validation. The nine older opt-in treatment,
request-budget, and packaged production cases were not rerun in this pass.

This closes byte verification for the selected executable and package artifacts.
It does not establish publisher authenticity, identify every child executable or
OS library, or prevent hostile same-account filesystem races. Next, prove a full
paired simulated campaign, including delegated recovery followed by operator
intervention. Representative independently reviewed cases, reviewed cost bounds,
a new explicit paid campaign cap, and live qualification remain open. Live
episodes remain refused and the production registry remains empty. No paid
inference occurred.

See the [design decision](artifact-identity-design.md),
[workflow](../../../evals/recovery-decisions/run-episodes.md#freeze-host-artifact-bytes),
and [verification receipt](evidence/runtime-artifact-verification.json).

## Paired simulated recovery and operator campaign

The new opt-in campaign check runs both registered arms for each selected manager.
A deterministic fixture contains the blocked Flow session before registration.
Both actual hosts verify the same reset bytes and approved source digest before
dispatch. Generated host configuration is excluded by frozen fixture Git ignore
rules. The check never inserts session state after reset verification.

The combined simulation follows matched tool calls and results. Treatment applies
the exact returned reset grant before asking the operator. Control asks the same
question without a delegated reset or Jev request. Both arms consume one scripted
operator response and complete through the same manager session.

A local evaluation wrapper retains the observed grant, reset order, persisted Flow
state, dispatches, and completion checks before cleanup. The episode completion
record binds that evidence. The test derives arm observations from recovered
journals, recomputes each manager's report from retained files, and hashes the
retained evidence before writing a complete index. Wrapper and fixture-support
source hashes participate in the registered harness identity.

The pinned native campaign exercised four hosts and recorded one scripted operator
intervention in each arm. Both manager reports correctly show zero completed arms:
the control remains blocked, and treatment's granted reset does not by itself
complete a reviewed workflow. The request-budget ledger retains each arm's
reservations, while the report leaves reserved-dollar means unavailable for these
failed outcomes. It records zero live pairs and inconclusive qualification. No
paid inference occurred.

The current-head [verification receipt](evidence/runtime-paired-simulation-verification.json)
records the repository, focused, pinned native campaign, and packaged-smoke checks
with their source and log hashes. The native campaign establishes scripted host
sequencing and guard behavior, not successful workflow completion or model quality.
Representative independently reviewed cases, reviewed bounds for actual provider
costs, a new explicit paid campaign cap, live execution support and qualification,
and release review remain open. Live episodes remain refused and the production
qualification registry remains empty.
The implementation stack still requires review and merge.

See the [design decision](paired-simulation-design.md) and
[reproduction command](../../../evals/recovery-decisions/run-episodes.md#run-the-paired-simulation-proof).

## Private recovery input capture

Operators can explicitly select an evaluation-only capture plugin to retain the
exact session, source digest, and proposal supplied to the recovery guard. The
controller wrapper records a cloned payload before asynchronous publication and
uses that same clone for assessment. Ordinary plugin composition is unchanged.
The capture provider always returns unavailable and cannot send Jev requests.

Each recorder claims a fresh private directory outside the canonical workspace.
Exclusive files preserve complete records. Synchronous reservations enforce
128 records, 1 MiB per encoded record, and 16 MiB total per recorder. Write failures
and exhausted limits stop the opted-in proposal before assessment. Rejected
proposals can still produce records because capture precedes controller checks.

The raw schema explicitly records unverified origin and unreviewed state. Its
payload digest provides an integrity check, not authenticated provenance. Raw
records cannot enter the existing dataset importer. Operators must sanitize
separate copies, establish provenance, and obtain independent label review.

Parent focused checks passed 66 tests with 840 assertions. Full repository checks
passed 1,448 tests with 7,640 assertions and skipped 15 opt-in tests. Independent
review reported no unresolved findings and separately passed eight capture tests
with 112 assertions. The comment audit found no added comments or suppressions.

A parent-run native OpenCode 1.18.31 check loaded the documented source plugin
entry and invoked the actual `flow_status` tool through a loopback scripted
manager. It retained one exact input record with private permissions and left
the source digest unchanged. The proposal then received the expected inactive
recovery error. Capture precedes that controller check. Three requests reached
the local responder. This is integration proof, not operational model evidence.

Earlier native setup attempts stalled before any model request. Bundling and
preinstalling the SDK did not resolve that stall. An explicit system PATH and
normal package-registry access produced a working run. Those two changes do not
isolate the original cause. One later proof request had empty finding IDs and
failed tool validation. Using a fixture finding ID corrected the proof input.
Both the bundled run and final documented-source run then passed.

This closes the raw-input export gap. Representative operational cases, independent
reviews, real provider cost bounds, a new explicit paid campaign cap, live episode
execution and qualification, and release review remain open. Production profiles
remain empty. No paid inference occurred.

See the [design decision](recovery-capture-design.md),
[capture workflow](../../../evals/recovery-decisions/run-capture.md), and
[verification receipt](evidence/runtime-capture-verification.json).

## Episode reservation accounting

Budgeted episode hosts now attach an immutable execution scope to each atomic
request claim. The scope identifies the registered episode, arm, composed driver,
and unique execution. Historical unscoped claims remain readable. The shared
request and dollar limits still cover all claims across concurrent hosts.

After confirmed shutdown, the native driver validates the ledger and selects its
exact scoped claims. A final reconciliation event retains the authorization,
claims, digest, and integer microdollar sum. Recovery validates this evidence
without the original ledger. Missing capability, failed shutdown, or failed
reconciliation leaves spending unknown. A reconciliation error preserves a valid
terminal task outcome. Accounting time does not inflate active runtime.

Parent focused verification passed 47 tests with 248 assertions. Full repository
checks passed 1,456 tests with 7,695 assertions and skipped 15 opt-in cases.
Independent review reported no unresolved findings and separately passed 43 tests
with 229 assertions. The comment audit found no added comments or suppressions.

The parent ran all four paired simulation hosts on pinned native OpenCode 1.18.31.
Both managers recovered one completed control and treatment through actual
operator continuation. Each control retained five manager reservations totaling
25,000 synthetic microdollars. Each treatment retained six manager reservations
and one Jev reservation totaling 33,000 synthetic microdollars. Recovered reports
contain those exact totals. The parent independently checked the disjoint scope
sets and 27 retained artifact and source hashes. The native check passed two tests
with 233 assertions. The other 14 opt-in cases were not rerun in this pass.

This closes per-episode reservation reporting for the instrumented host path.
Synthetic prices do not establish real provider costs. Hashes do not authenticate
a hostile actor who can rewrite both ledger and journal. Live execution remains
refused, production profiles remain empty, and no paid inference occurred.

Representative operational data, independent review, reviewed provider cost bounds,
a new explicit campaign cap, live treatment and execution support, qualification,
and release review remain open. The implementation stack still requires merge.

See the [design decision](episode-reservations-design.md),
[accounting guide](../../../evals/recovery-decisions/run-episodes.md#understand-episode-reservation-totals),
and [verification receipt](evidence/runtime-reservation-verification.json).
