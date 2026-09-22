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

See the [design decision](treatment-design.md) and the
[verification receipt](evidence/runtime-treatment-verification.json).

Final verification passed `bun run check` with 1,416 tests and 7,410 assertions.
Its nine opt-in tests were skipped. Six treatment host checks passed separately
with 98 assertions on OpenCode 1.18.31. Both existing OAuth budget checks also
passed. The packaged production smoke passed on its pinned OpenCode 1.18.6 host.
No paid inference occurred.
