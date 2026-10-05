# Separate advisory decision pilot

This offline pilot compares independent GPT-6.1 Sol decisions on the same packet,
with Jev advice visible only in the treatment context. `compareCampaign` instead
compares manager choices with replayed Jev controller choices. These are distinct
measurements. This pilot performs no inference, recovery action or qualification.

Prepare frozen packet and prompt bindings with an explicit ordering seed:

```sh
bun evals/recovery-decisions/advisory-pilot.ts prepare \
  evals/recovery-decisions/development.json 1234 new-preparation.json
```

The bundled corpus contains eight synthetic, unreviewed controls, including six
eligible packets and two prefiltered cases. It is not observed blocker evidence.
A genuine captured corpus must satisfy the existing reviewed corpus schema.
Holdout cases are rejected by this development pilot. Neither schema validation
nor a separately filtered file proves representative or independent sampling.

After separately authorized collection, bind advice rows. Each row contains
`caseId`, the preparation's `packetDigest`, and raw `advice` or null. Preserve
collector manifest, case and attempt receipts, their digest and import review.

```sh
bun evals/recovery-decisions/advisory-pilot.ts bind \
  new-preparation.json advice-rows.json new-treatment.json
```

Later inference must use separate read-only contexts in the retained seeded
order, with no shared conversation. Use the exact stored prompts and Sol route.
No Flow tools or delegated recovery are involved. Production shadow advice still
requires a stop. This preparation does not authorize calls or activate budgets.

Baseline and advice arms declare `schemaVersion: 1`, `qualification:
"inconclusive"`, their arm, `model: "openai/gpt-6.1-sol"`, `preparationDigest`,
`origin` and `observations`. Treatment also binds `treatmentDigest`. Each
observation binds case, packet and prompt digests, a result, nullable latency,
reservation and response usage. Results are selection with `candidateId`,
abstain, unavailable with reason, or filtered. Omitted observations stay missing.
`origin` is simulation or retained-model-responses. Both are declarations; retain
actual manager output and serving-route evidence separately for future review.

```sh
bun evals/recovery-decisions/advisory-pilot.ts check \
  new-preparation.json new-treatment.json baseline-arm.json advice-arm.json \
  new-report.json
```

The checker rederives source, corpus, packet and complete prompt bindings. Invalid
advice stays a diagnostic and is replaced by unavailable advice in the prompt.
It separates all attempted treatment contexts from the answered-advice subset.
Forbidden IDs are eligibility violations. Bundled control label matches and
abstentions are unreviewed decision diagnostics. Reviewed calibration labels
remain decision diagnostics, not unsafe actions or actual workflow stops.
Safety and recovery rates remain unknown. Model and Jev provenance remain
unverified declarations. Manager latency differs from Jev transport latency;
reservations are not invoices. Usage covers validated final responses only.
