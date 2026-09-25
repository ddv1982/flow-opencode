# Report episode outcomes

Use these offline commands to register whole tasks and compare recorded outcomes.
Read [Whole-episode comparisons](episode-outcomes.md) for measurement and evidence
limits. These commands do not collect outcomes or authorize paid calls.

## Prepare the protocol

1. Retain the task specification, initial state, and execution instructions for
   each episode. Calculate their SHA-256 digests.
2. Write `protocol.json` using the fields below. Assign one episode per independent
   group. Keep related reruns outside this protocol.
3. Freeze exact manager models, prompts, harness digests, and reset instructions.
   Use a separate output directory for each arm during later collection.

Use the same manager model and prompt in both arms. The protocol rejects a
mismatch. Harness digests can differ to support Jev integration. Review those
differences before interpreting results.

Check calibration and holdout separation across your retained task rosters.
This command validates one protocol at a time. A calibration-evidence digest
does not prove that tasks are disjoint or that calibration passed.

The protocol requires these fields. The schema rejects unknown fields.

| Field | Value |
| --- | --- |
| `schemaVersion` | `1` |
| `split` | `calibration` or `holdout` |
| `calibrationEvidenceDigest` | SHA-256 digest, or null for calibration |
| `episodes` | Between 1 and 1,000 episode objects |
| `arms.managerOnly` | `model`, `prompt`, and `harnessDigest` |
| `arms.managerPlusJev` | The manager fields plus `jev` below |
| `execution` | Positive integer `timeoutMs` and nonempty `resetProtocol` |
| `inference` | The fixed analysis object below |

Each episode contains `id`, `taskDigest`, `initialStateDigest`,
`completionCriteria`, `sourceReference`, and `independenceGroupId`.
Keep completion criteria as retained text. Episode IDs, task digests, source
references, and independence groups must each be unique within the roster.

Use these pinned Jev settings for `arms.managerPlusJev.jev`.

```json
{
	"model": "jev-1.13.0",
	"rubric": "recovery-v1",
	"policy": "bounded-recovery-v1",
	"thresholds": { "choice": 0.9, "goal": 0.95, "suitability": 0.95 }
}
```

Set `inference` before collecting observations. Choose and retain a seed between
0 and 4,294,967,295. This example uses 42.

```json
{
	"method": "paired-bootstrap-percentile-v1",
	"seed": 42,
	"resamples": 2000,
	"confidence": 0.95
}
```

## Freeze the registration

Run the registration command before gathering outcomes.

```bash
bun run eval:recovery episode-register protocol.json registration.json
```

Retain the resulting file. Registration adds measurement definitions, a protocol
digest, and source hashes. Reporting rejects changed runtime or evaluator sources.
Use a new registration after a code change. Retain the earlier artifacts.
An output file must not already exist.

## Prepare each arm's evidence

Write separate `manager.json` and `jev.json` files using `EpisodeArmSchema` in
[episodes.ts](episodes.ts). Set `schemaVersion` to 1 and `qualification` to
`inconclusive` in both files.

Set `arm` to `manager-only` or `manager-plus-jev`. Set `registrationDigest` to the
canonical digest of the full registration. Set `armDigest` to the canonical digest
of the corresponding `registration.protocol.arms` object.

Use the existing digest command on extracted JSON objects to calculate canonical
digests. It sorts object keys before hashing and preserves array order.

```bash
bun run eval:recovery dataset-digest registration.json
```

For synthetic checks, set `origin` to `{"kind":"simulation"}`. For imported live
observations, supply this origin object with actual recording and review details.
Use distinct recorder and reviewer identities.

```text
kind: imported-attestation
declaredOrigin: live
recordedBy: recorder identity
reviewedBy: reviewer identity
reviewedAt: ISO UTC timestamp
payloadDigest: canonical digest of the arm file without origin
notes: source and review details
```

For each observed episode, add an object to `observations` with these fields.

| Field | Value |
| --- | --- |
| `episodeId` | Registered episode ID |
| `episodeDigest` | Canonical digest of the registered episode object |
| `receiptDigest` | SHA-256 digest of the retained source receipt |
| `result` | Terminal outcome or unavailable result below |
| `interruptions` | Nonnegative integer, or null |
| `activeRuntimeMs` | Measured active time, or null |
| `humanWaitMs` | Measured operator wait time, or null |
| `unsafeAcceptedActions` | Reviewed count, or null |
| `forbiddenMutations` | Reviewed count, or null |
| `reservedUsd` | Conservative spending reservation, or null |
| `safetyReview` | Bound review receipt below, or null |

Use `{"kind":"terminal","outcome":"completed"}` when the completion criteria
were met. Other terminal outcomes are `failed`, `cancelled`, and `timed-out`.
Use `{"kind":"unavailable","reason":"..."}` when the outcome cannot be
established. Omit an observation when no receipt exists. Preserve unknown telemetry
as null. Numeric telemetry must be finite, nonnegative, and at most 1,000,000,000,000.

For a safety review, supply `reviewedBy`, `reviewedAt`, `payloadDigest`, and `notes`.
Calculate that digest from an object containing `registrationDigest`, `arm`,
`episodeDigest`, `receiptDigest`, `unsafeAcceptedActions`, and `forbiddenMutations`.
Retain the supporting review. Do not derive safety counts from decision
acceptability labels.

## Generate and inspect the report

```bash
bun run eval:recovery episode-report registration.json manager.json jev.json report.json
```

Inspect both arm summaries, metric exclusions, and interval reasons. Check
`metrics.completionDelta.percentagePoints` for completion loss in percentage points.
The corresponding point and interval use fractional units. Interruption reduction
and active-runtime growth also use fractional units.

Check the report's input digests against the retained files. Treat
`interval-meets-bound` as an exploratory diagnostic. It is not release approval.
Every report remains qualification-inconclusive, including reports made from
declared live observations.

## Derive observations from event receipts

Before supplying an observation to an arm file, retain the source receipt and run:

```sh
bun run eval:recovery episode-reduce registration.json receipt.json new-draft.json
```

This offline command writes an immutable draft containing the parsed receipt and
one report-compatible `observation`. It validates the current registration and
source hashes. It makes no model calls and does not start an episode.

A receipt has these fields (unknown fields are rejected):

- `schemaVersion: 1`, `registrationDigest`, `arm`, and `armDigest`, using the same
  digest bindings as the arm evidence above.
- `episodeId`, `episodeDigest`, and `initialStateDigest`, matching the registered
  episode. The initial-state assertion must be checked against the actual reset.
- `declaredOrigin: "simulation" | "live"`, `recordedBy`, and ISO `startedAt`.
- `reservationCoverage: "complete" | "unknown"`. Declare complete only when every
  paid dispatch reservation, including retries and manager calls, was recorded.
- `events`, an ordered array of the objects below. `atMs` is a nonnegative integer
  elapsed time from a monotonic clock, in milliseconds; equal timestamps are
  allowed and array order resolves ties.

| Event | Fields beyond `kind` | Meaning |
| --- | --- | --- |
| `start` | `atMs: 0` | First event; execution is active. |
| `wait-start` | `atMs` | Execution pauses to wait for the operator. |
| `wait-end` | `atMs` | Operator wait ends and execution resumes. |
| `intervention` | `atMs` | One human recovery intervention, excluding initial instructions. |
| `reservation` | `atMs`, unique `id`, positive `usd` | One conservative dispatch reservation; retries have distinct IDs. |
| `terminal` | `atMs`, `outcome` | Last event; completed, failed, cancelled, or timed-out. |

The harness must emit transitions when they happen. Every interval is active
unless a wait is open. Emit intervention events separately: entering a wait does
not itself count a human intervention. An episode can terminate during a wait.
The harness must enforce the frozen timeout and completion criteria; the reducer
checks event structure, not whether those decisions were correct. Do not put task
text, credentials, or provider responses in event fields.

For example, start at 0, wait-start at 20, intervention at 30, wait-end at 70, and
terminal at 100 produces 50 ms active runtime, 50 ms operator wait, and one
interruption. Failed, cancelled, and timed-out runs retain their measurements.
Without a terminal event, the observation is unavailable and aggregate fields are
null; the retained receipt still contains the partial timeline. Unknown spending
coverage remains null even when some reservation events exist. Reservations do
not prove invoiced costs or authorize paid execution.

Review the retained receipt before copying `observation` into an arm evidence
file. Its `receiptDigest` hashes the parsed receipt using `datasetDigest`. Safety
counts and safety review are always null until separately reviewed. A declared
live origin never creates an imported-live attestation automatically. Follow the
arm and safety review digest procedures above after assembling the observations.
Receipt hashes bind declared content; they do not authenticate execution, clocks,
reviewer identities, or the absence of omitted events. Production harness hooks
and durable event capture remain to be implemented.

## Capture and recover a durable episode journal

The TypeScript `runEpisode` API in `episode-runner.ts` accepts a registered episode,
arm, fresh output directory, recorder, declared origin, and trusted `EpisodeDriver`.
The driver exposes `prepare`, `run`, `evaluate`, and `stop`. Its harness digest must
match the registered arm. The runner hashes the actual task and reset data before
starting. The driver cannot submit a terminal outcome.

The runner writes a private registration, header, reset receipt, ordered event
files, completion-check digest, status, and reduced draft. Each event is written
exclusively and synced before acknowledgment. Events form a sequence and digest
chain. This detects changed records but does not authenticate their origin.

A deadline covers execution, operator wait, and completion checking. Preparation
has a separate deadline of the same duration. Stop confirmation has a five-second
limit. Cancellation and timeout become terminal outcomes only after confirmed
cleanup. Execution errors, failed cleanup, and partial journals remain unavailable.
A failed completion predicate is a measured failed outcome. An evaluator exception
is unavailable. Spending coverage stays unknown.

Recover an interrupted journal without restarting execution.

```sh
bun run eval:recovery episode-recover registration.json journal-directory NEW-draft.json
```

The command reads the complete ordered files. It refuses missing sequence entries,
changed chain links, stale registration bindings, and malformed events. Unpublished
`.pending-*` files are ignored. It never resumes a request or refunds a reservation.

`createEpisodeHostDriver` in `episode-host.ts` connects the driver interface to
`EvalHost`. A fixture freezes the task instruction, initial files, exact completion
files, and optional `generatedDirectories`. Use `episodeHostIdentity` to obtain the
registered task, initial-state, and completion-criteria values. Completion criteria
encode the exact checks and generated-directory allowance. Different episode
fixtures share the arm's implementation digest.

Fixture paths must be relative, without traversal, symlinks, or host configuration
paths. Reset permits only the declared initial files. Evaluation permits the initial
files, completion files, and files below explicitly declared generated directories.
For Flow-generated state, declare `.flow` in `generatedDirectories`. A returned
prompt alone does not establish completion. An escalation starts operator wait.
Use the operator interface below to continue the same session.

**Live execution remains blocked.** The runner rejects live origin before host
startup. The [shared request gate](run-request-budget.md) enforces durable request
reservations. Command dispatch limits alone do not cap manager or subagent
spending.

The isolated treatment uses shared Flow plugin composition with an experimental
profile. Its configuration permits simulation only. Both arms use the same
composition and `/flow-auto` command. The Jev arm adds explicit recovery limits.
The fixed `guarded-reset-v1` script supports `openai/gpt-5.6-terra` and
`xai/grok-4.6`. It returns accepted or below-threshold Jev responses through the
real Jev adapter and guarded tools.
These scripted responses are not model-quality evidence.

Finishing live execution requires reviewed cost bounds for the actual routes,
independently reviewed execution evidence, and a new explicit campaign spending cap.
Simulation treatment support does not authorize live treatment activation or paid
calls. The production qualification registry remains empty.

Run the deterministic host check with:

```sh
FLOW_RECOVERY_TREATMENT_SMOKE=1 bun test tests/recovery-treatment-host.test.ts
```

The check starts isolated OpenCode hosts with synthetic credentials and scripted
responses. It seeds blocked sessions through existing Flow transitions, then
checks accepted recovery, manager-only control, and below-threshold rejection for
each manager.
Seeding a simulation fixture is not an observed live episode or a completed
qualification campaign.

## Answer an episode question

Set `operator` when creating the host driver. Freeze the resulting harness digest
in the registration before starting the episode.

```ts
operator: { kind: "file-mailbox-v1", maxInterventions: 3 }
```

From another terminal, read the current question into a new private file.

```sh
bun run eval:recovery episode-read-question journal-directory NEW-question.json
```

Read the question and options in `request.question`. Copy the top-level `digest`
into a private reply file. Supply the exact text you want to send to the manager.

```json
{
	"requestDigest": "COPY_THE_CURRENT_QUESTION_DIGEST",
	"text": "Use the existing interface and preserve the current configuration.",
	"recordedBy": "local-operator",
	"attribution": "unverified"
}
```

Submit that file once.

```sh
bun run eval:recovery episode-submit-reply journal-directory reply.json
```

The runner records the accepted reply and ends the wait before sending the text
to the same session and manager. OpenCode has already aborted the question tool.
Your text becomes an ordinary follow-up message. A subsequent question requires
a new read and a reply with its new digest.

The deadline continues during operator wait. Without an enabled operator policy,
or after the intervention limit, the episode waits for cancellation or timeout.
Reading or recovering a journal does not restart execution.

Keep the question, reply, journal, and reduced draft private. They contain actual
operator input. `recordedBy` is declared attribution. It does not authenticate the
operator or constitute independent review. The runner preserves unknown safety
and spending coverage as unknown.

Run the simulated operator check with:

```sh
FLOW_RECOVERY_OPERATOR_SMOKE=1 bun test tests/recovery-operator-host.test.ts
```

The check uses the registered episode runner and actual isolated OpenCode hosts.
It exercises question capture, response submission, exact-file completion, and
journal recovery for both managers. It also checks cancellation without a
continuation request.

## Freeze host artifact bytes

Pass the native OpenCode executable as `host.opencodeExecutable` when creating
an episode driver. Select the exact version named by `host.opencodeVersion`.
A shell or JavaScript launcher is not accepted. The driver captures artifact
identity before you freeze its `harnessDigest` in the episode registration.

The host copies Bun, OpenCode, and the packed Flow cache into private storage.
It compares their bytes with the captured manifest before direct native startup.
Source treatment records no production cache because it uses a local bundle.
Checks also run after startup and before command or prompt dispatch, including
operator continuation. Changed artifacts stop dispatch.

Keep the selected files stable from driver creation through startup. If you
replace an executable or modify the cache, create a new driver and registration.
A matching version string does not make different bytes equivalent.

The manifest covers these selected artifacts. It does not verify publisher
signatures, operating-system libraries, or arbitrary child programs. It does not
prevent a malicious process using the same account from racing filesystem writes.
Live episode execution remains disabled.

The journal retains `expectedHostArtifacts` and `artifactVerification`. The latter
records the verified manifest digest and whether Linux process verification was
available. These are host-recorded observations. They do not replace independent
execution review. Historical receipts without artifact evidence remain readable.

Run the packed-cache check without model calls. The native OpenCode binary must
report version `1.18.31`. Set `FLOW_RECOVERY_OPENCODE_EXECUTABLE` if it is not on
`PATH`. The operator smoke uses the same executable selection.

```sh
FLOW_HOST_ARTIFACT_SMOKE=1 bun test tests/host-artifacts-host.test.ts
```

The check verifies the copied production cache, changes a copied plugin file,
and requires prompt dispatch to fail before authorization is consumed.

## Run the paired simulation proof

Run the combined recovery and operator scenario on the pinned native OpenCode
1.18.31 executable. Set `FLOW_RECOVERY_OPENCODE_EXECUTABLE` if it is not on `PATH`.
Keep that executable stable for the entire run. A version mismatch refuses host
startup. Choose a new output directory to retain the evidence.

```sh
FLOW_RECOVERY_CAMPAIGN_SMOKE=1 \
FLOW_RECOVERY_CAMPAIGN_OUTPUT=/tmp/flow-paired-proof \
bun test tests/recovery-campaign-host.test.ts
```

The check runs both registered arms separately for `openai/gpt-5.6-terra` and
`xai/grok-4.6`. Each arm starts from the same frozen blocked fixture for its pair.
The treatment executes a guarded recovery before the operator question. A scripted
reply continues the same session and completes the exact output-file check.

Inspect `openai/report.json` and `xai/report.json` below the output directory.
Each manager directory also retains its registration, arm journals, and recovery
evidence. `complete.json` indexes the verified files after both pairs finish.
Observations come from recovered journals. The completion record
binds the retained recovery evidence. The test also checks request claims and
recomputes the report from retained inputs.

This command uses synthetic credentials and scripted provider responses. It makes
no paid model calls. Each manager has one deterministic pair. Reports remain
inconclusive with zero live pairs, unknown safety review, and unknown report cost.
Synthetic reservation arithmetic does not establish provider prices. Keep these
artifacts separate from qualification evidence.
