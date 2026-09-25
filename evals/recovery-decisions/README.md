# Runtime recovery evaluation

Prepare the synthetic development cases without credentials or network calls:

```sh
bun run eval:recovery prepare evals/recovery-decisions/development.json /tmp/recovery-preparation.json
```

The output path must be new and its parent directory must exist. A nonzero exit
indicates invalid input, publication failure, or an eligibility-label mismatch.
The report retains packets, packet digests, controller outcomes, and source
digests. Source digests hash the source file bytes.

The harness feeds validated Session snapshots and proposals into the production
`RecoveryController` in shadow mode. The controller constructs `recovery-v1`
packets, filters candidates, and applies the current production shadow thresholds.
No qualification profile is injected. Sessions are cloned and checked for mutation.
The offline command has no provider integration and never reads an API key.

`evaluateRecoveryCorpus` also accepts a provider for controlled tests. It reports
label agreement only for answered observations; unavailable responses are not
correct abstentions. The tests use simulated scores to verify acceptance and
rejection through the controller. These scores are not model evidence.

The eight authored cases cover supported repair, independent approved work,
goal expansion, unchanged repair, injected instructions, unknown findings,
unmet dependencies, and mixed eligible/ineligible candidates. Snapshots were
constructed through the application service with two failed reviews. They are
synthetic, share a scenario, and have **unreviewed author-proposed labels**.
They are neither independent holdout episodes nor representative production data.
Every report remains `inconclusive`; this tool cannot populate the release registry.

## Collect live development observations

The `collect` command uses the production Jev adapter and the same shadow
controller as preparation. It requires an explicit campaign budget and an unused
paid dispatch from `FLOW_EVAL_AUTHORIZATION`. Supply the credential through
`TYPESAFE_API_KEY`. No command creates authorization automatically.

After obtaining a new approved budget, run the collector with those limits:

```sh
bun run eval:recovery collect evals/recovery-decisions/development.json /tmp/recovery-campaign --max-calls "$APPROVED_ATTEMPTS" --max-usd "$APPROVED_USD"
```

The output directory must not exist. Its parent directory must exist. Keep the
directory after an interrupted run. Reusing it is refused, and the paid dispatch
remains consumed. A new campaign requires a new output directory and an available
authorized dispatch.

The attempt and dollar limits apply across every case and HTTP retry. Each attempt
reserves the production transport's conservative cost allowance before dispatch.
Reservations are never refunded. They are spending estimates under the transport's
versioned assumptions, not provider invoice totals.
Receipt `calls` and `attempts` count reservations. A reserved request might not
reach the provider if the process stops before sending it. Reported token usage
covers answered responses only, so failures and retries can leave usage unknown.

The collector retains frozen inputs, source digests, reservation receipts, and
completed case results incrementally. SIGINT and SIGTERM cancel provider work.
An abrupt process kill can leave a partial campaign without a final summary.
Retained reservations still count even when no response was recorded.
The output contains `manifest.json`, numbered `attempt-*.json` and `case-*.json`
receipts, and `summary.json` when final publication succeeds. A kill during a
reservation write can leave an incomplete journal entry. Do not reuse that run.
Exit code 0 means collection completed. It does not mean that Jev passed a quality
gate. Exit code 2 reports an error or incomplete collection. Cancellation returns
130 for SIGINT or 143 for SIGTERM.

Collection does not qualify a release. The bundled development cases remain
synthetic and unreviewed. All collection results remain `inconclusive`. Provider failures and
missing answers do not count as successful abstentions.

## Remaining qualification work

1. Assemble representative, sanitized runtime snapshots with provenance and
   independently reviewed candidate labels. Split by scenario family before
   calibration; reserve an untouched holdout.
2. Freeze corpus and source digests, rubric, thresholds, and policy. Review the
   emitted packets, particularly the evidence available for independent work.
3. Obtain a new explicit campaign budget before paid calls. The collector's shared
   limits bound one campaign. The paid-dispatch ledger separately bounds campaign
   starts and does not grant an aggregate dollar allowance across multiple starts.
4. Compare manager-only decisions and Jev decisions on paired episodes, then run
   the acceptance-volume, latency/cost, unattended, and operator review gates in
   the feature plan. Preparation and synthetic agreement cannot replace them.

## Reviewed datasets

The dataset commands import **already sanitized** observed recovery snapshots and
record independent label review. They do not turn the development fixtures into
real evidence. No representative cases or reviewer attestations are shipped.
All reports still have `qualification: inconclusive`.

Run this offline workflow before requesting a live campaign budget:

1. [Capture the recovery input](run-capture.md) to retain the exact `session`,
   `sourceDigest`, and `proposal` at the recovery boundary. Remove private data
   before bringing the snapshot into this dataset.
   Preserve internally consistent session IDs, revision, candidate IDs, and
   evidence references. Keep a private mapping to the original source if needed.
2. Create a snapshot JSON with `id`, those three payload fields, and `provenance`.
   Provenance requires `origin: "observed-recovery"`, `sourceReference`,
   `originatingTaskId`, `independenceGroupId`, `scenarioFamily`, `capturedAt`
   (UTC ISO timestamp), `importedBy`, and `sanitization`.
   Sanitization records `reviewedBy`, `reviewedAt`, `notes`, and `payloadDigest`.
   Hash a JSON object containing exactly `session`, `sourceDigest`, and `proposal`
   with `dataset-digest` to obtain `payloadDigest` (bare SHA-256 hex).
3. Import into a new draft. The importer validates bindings and the sanitization
   digest and rejects common credential patterns and the configured TypeSafe key.
   This scan supplements the recorded sanitization review; it is not exhaustive.
4. An author creates `labels`: `snapshotDigest` (hash of the draft's `snapshot`
   object), `authoredBy`, `rationale`, `expected`, `split`, and `primary`.
   `expected` contains `eligibleCandidateIds` and nonempty `acceptableSelections`.
   Use exactly `["abstain"]` when abstention is required. Eligible choices describe
   deterministic permission; acceptable choices describe useful, safe decisions.
   Assign `calibration` or `holdout` before evaluating responses.
5. A different reviewer examines the snapshot and labels, then supplies `review`:
   `reviewedBy`, `reviewedAt`, `labelDigest` (hash of the complete labels object),
   `verdict: "approved"`, and `notes`. The reviewer must differ from both the label
   author and importer. Put `labels` and `review` into one submission JSON.
6. Review each draft, assemble the resulting case objects into a JSON array, and
   build the corpus. Building also checks labels against actual controller
   eligibility without contacting a provider.

```sh
bun run eval:recovery dataset-digest payload.json
bun run eval:recovery dataset-import snapshot.json new-draft.json
bun run eval:recovery dataset-digest snapshot.json
bun run eval:recovery dataset-digest labels.json
bun run eval:recovery dataset-review new-draft.json submission.json new-case.json
bun run eval:recovery dataset-build reviewed-cases.json new-corpus.json
bun run eval:recovery prepare new-corpus.json new-preparation.json
```

Digests use recursively sorted object keys, preserve array order, and ignore JSON
whitespace. Hash the parsed draft snapshot for label binding. The standalone
snapshot JSON has the same digest if it contains the same normalized values.
Commands refuse to overwrite output files. A changed snapshot, label, split, or
primary designation requires a fresh matching review receipt.

Corpus validation rejects duplicate IDs and snapshot payloads. Cases sharing a
task, independence group, scenario family, source reference, or session cannot
cross splits. Cases sharing a task, session, or source must share one independence
group, with exactly one primary case per group. Related variants therefore do not
increase independent sample counts. Both splits need not be present in an interim
corpus; this is validation infrastructure, not a qualification sample-size gate.
Validate the complete dataset together: validating separate files cannot detect
relationships across those files. Keep family and group identifiers stable.

Reviewer identities and observed-source provenance are attestations, not verified
identities or cryptographic signatures. The operator must establish that the
review actually occurred and that the source is real. The tool cannot establish
statistical independence from names alone. Synthetic fixtures remain explicitly
unreviewed. Test-only attestations in unit tests are not evaluation evidence.

`prepare` and `collect` accept either the original development corpus or this
reviewed corpus, retaining its provenance and split assignments in the collection
manifest. Without registration, they evaluate every supplied case. Registered collection
evaluates only its selected split. Do not run holdout cases while tuning thresholds. Actual calibration, reviewed manager observations, sufficient independent samples,
and release qualification remain later steps. The registration and comparison
commands below provide the offline tooling. Explicit paid authorization
and both collection caps remain mandatory.


## Frozen comparison tooling

See [Frozen decision comparisons](comparison.md) for the comparison model and
its evidence limits. Registration freezes an explicit split of a complete
reviewed corpus before collection. The paired report compares manager selections
with Jev advice replayed through the production controller. Episode-level
qualification remains separate.

## Whole-episode tooling

See [Whole-episode comparisons](episode-outcomes.md) for completion, interruption,
and active-runtime measurements with exploratory paired uncertainty intervals.
The episode protocol uses an explicit task roster. Recovery snapshots do not
count as whole episodes. Use [Report episode outcomes](run-episodes.md) for the
offline commands and evidence format.

For fixed-policy review and the combined gate report, use
[Review calibration and qualification evidence](run-qualification.md).
For durable journals and the live-run limitations, use
[Report episode outcomes](run-episodes.md#capture-and-recover-a-durable-episode-journal).

## Selected manager models

The recovery evaluation uses `openai/gpt-5.6-terra` and `xai/grok-4.6`. Each model
needs its own manager-only and manager-plus-Jev comparison, with identical manager
settings within that pair. Do not pool the two models' qualification evidence.

Check the installed OpenCode catalog without running inference.

```sh
bun run eval:recovery manager-preflight NEW-manager-preflight.json
```

The command records the OpenCode version, exact selected IDs, SDK, connection type,
and filtered cost/limit metadata. It refuses missing, redirected, or inactive
models and never replaces a requested model with an alias or fast variant. It does
not retain credentials, headers, provider URLs, or arbitrary provider options.

Catalog membership does not prove inference access. Zero cost metadata does not
prove free inference. The observed connections are OAuth; public API price tables
alone do not establish their billing behavior. For reference, the vendors publish
[GPT-5.6 Terra API pricing](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
and [xAI API pricing](https://docs.x.ai/developers/pricing). A live request adapter
must verify the actual connection route and enforce the campaign's spending rules.
Preflight creates no spending authorization and leaves live execution disabled.

For shared request-level reservations and the verified OAuth interception path,
use [Enforce a shared evaluation request budget](run-request-budget.md).
