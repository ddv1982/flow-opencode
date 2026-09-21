# Run a frozen decision comparison

Start with a complete reviewed corpus produced by `dataset-build`. Keep both
calibration and holdout assignments in that corpus. See the
[dataset workflow](README.md#reviewed-datasets) for its preparation commands.

## Register the campaign

Create `config.json` with this shape. Replace the manager identity and prompt with
the exact configuration used to obtain manager observations.

```json
{
  "split": "calibration",
  "calibrationEvidenceDigest": null,
  "manager": {
    "model": "your-pinned-manager-model",
    "prompt": "Your exact manager observation prompt",
    "protocol": "recovery-observation-v1"
  }
}
```

Run registration before collection.

```sh
bun run eval:recovery campaign-register corpus.json config.json new-registration.json
```

For a holdout campaign, set `split` to `holdout` and supply the canonical digest of
the frozen calibration evidence in `calibrationEvidenceDigest`. Use
`dataset-digest` to compute canonical JSON digests. Preserve the original evidence.
A digest records a binding. It does not establish that calibration passed.

Registration uses the current fixed runtime thresholds. It does not select new
thresholds. Keep the source checkout unchanged while collecting and reporting.
Registration hashes all TypeScript files under `src`, the evaluator files,
`package.json`, and `bun.lock`. Even unrelated runtime edits require a new
registration. This conservative rule prevents omitted runtime dependencies from
escaping the source check.

## Collect the registered split

Obtain a separate explicit campaign budget and paid-dispatch authorization before
running collection. The example below uses placeholders for approved caps.

```sh
bun run eval:recovery collect corpus.json new-run-directory \
  --registration new-registration.json \
  --max-calls APPROVED_ATTEMPT_CAP --max-usd APPROVED_DOLLAR_CAP
```

Set `TYPESAFE_API_KEY` and `FLOW_EVAL_AUTHORIZATION` as described in the
[collector guide](README.md). Pass the full original corpus. Registered collection
selects the requested split and verifies its bindings before paid dispatch.
Keep the registration, manifest, attempt journals, case receipts, and summary.

## Prepare the manager arm

Use `arm: "manager-only"`, `schemaVersion: 1`, and
`qualification: "inconclusive"` at the top level. Set `registrationDigest` to the
canonical digest of the registration. Copy `model` and `promptDigest` from its
manager configuration. Add an `observations` array.

Each observation has these fields.

| Field | Value |
| --- | --- |
| `caseId` | A case ID from the registered split. |
| `caseDigest` | That case's registered digest. |
| `packetDigest` | The registered packet digest, or `null` for a filtered case. |
| `latencyMs` | Recorded decision latency, or `null` when unknown. |
| `reservedUsd` | Recorded spending reservation, or `null` when unknown. |
| `result` | A selection, abstention, unavailable response, or deterministic filter. |

Use one of these result objects.

```json
{"kind": "selection", "candidateId": "recorded-candidate-id"}
```

```json
{"kind": "abstain"}
```

```json
{"kind": "unavailable", "reason": "recorded failure"}
```

```json
{"kind": "filtered"}
```

Omit a case only when its observation is missing. The report retains that missing
case. Do not replace it with an abstention. A selection can name a forbidden
candidate so the report can show the rejected manager proposal.

For simulated checks, use `origin: {"kind": "simulation"}`. For imported live
observations, supply an `imported-attestation` origin with `declaredOrigin: "live"`,
`reviewedBy`, `reviewedAt`, `notes`, and `evidenceDigest`. Compute that digest over
the complete arm object with `origin` omitted. Keep the source observations and
review record. The tool records the attestation but does not authenticate it.


## Import the Jev collection

Compute the digest of the retained collection.

```sh
bun run eval:recovery campaign-collection-digest new-run-directory
```

Review its manifest, attempt journals, case receipts, and summary. Create a review
receipt with `kind: "imported-attestation"`, `declaredOrigin: "live"`, `reviewedBy`,
`reviewedAt`, `notes`, and the printed digest as `evidenceDigest`.
For a collection explicitly marked as simulation, the receipt must instead be
`{"kind": "simulation"}`.

```sh
bun run eval:recovery campaign-import-jev new-registration.json new-run-directory review-receipt.json new-jev-arm.json
```

The importer checks registration bindings, receipt order, packet contents, and
reservation accounting. It retains the raw collection digest as
`origin.sourceEvidenceDigest` for attested imports. It binds the converted arm
payload separately as `origin.evidenceDigest`.

Keep incomplete or cancelled runs. They can be imported when their retained
summary and receipts are consistent. A run without a final summary cannot be
imported by this command. Do not reconstruct missing results. The report lists
missing observations and keeps rejected controller advice unavailable.

## Compare retained observations

Supply separate arm files for the manager and Jev observations. Copy the exact
registration, case, and packet digests into each observation. Bind the manager
file to the registered model and prompt digest. Do not invent observations for
missing cases.

The manager arm must come from actual manager observations under the registered
configuration. The comparison command does not call a manager model. See
[comparison semantics](comparison.md) before interpreting its output.

```sh
bun run eval:recovery campaign-report new-registration.json manager-arm.json new-jev-arm.json new-report.json
```

All output paths must be new. A report remains qualification-inconclusive even
when all supplied pairs agree with reviewed labels.


## Review decision safety and uncertainty

A label submission can include `candidateOutcomes`, keyed by every eligible
candidate ID. Values are `safe-effective`, `safe-ineffective`, or `unsafe`.
`safe-effective` IDs must equal the acceptable non-abstain selections. The label
review digest binds these outcomes. Existing submissions without this field remain
valid, but their accepted selections have unknown safety.

Comparison rows retain the selected candidate, registered action class, and reviewed
outcome. Reports separate unsafe, ineffective, and unreviewed selections. Primary
cases determine the per-class accepted counts. Secondary cases cannot enlarge the
risk sample. With complete review and zero unsafe observations, the report gives
`1 - 0.05^(1/n)` as the one-sided 95% zero-error upper bound. It is about 0.009936
at 300 independent accepted cases. The independence and label-correctness assumptions
remain explicit. Shadow selections do not prove executed-action safety.

The paired acceptable-selection difference includes a conservative two-sided 95%
Hoeffding interval on differences in `[-1, 1]`. Missing, filtered, or unavailable
primary pairs suppress the interval. The observed conditional mean remains visible.
The interval assumes independent primary pairs and never authorizes promotion.

Continue with [Review calibration and qualification evidence](run-qualification.md).
