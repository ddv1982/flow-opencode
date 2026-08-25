# Phase 7 architecture synthesis

## Grounding

The legacy benchmark shuffles independent Flow and ordinary jobs, keeps results in
memory, and writes marginal summaries. The v2 boundary already owns paired cells,
whole-pair reserve validation, opaque product evidence, exact provenance, atomic
attempt storage, and descriptive opaque win counts. Phase 7 adds an experiment
layer and adapts the runner; it does not create another report or persistence
system.

## Arena

- Terra supplied the strongest runner adaptation and rejection rules.
- Luna supplied the selected pure `experiment.ts` base and macro task-stratified
  estimand.
- One candidate exceeded the time box and is recorded as a dropout.
- The independent judge scored the inspectable base 16/25 and required a salted
  commitment, exact report binding, coherent token semantics, and corrected
  finalization order.

## Usage

The runner constructs and persists one frozen plan before starting either arm.
Each primary `(case, repetition)` block has two opaque tokens. A private allocation
maps them to candidate and ordinary baseline. Preallocated reserve blocks repeat
the same `(case, repetition)` and token mapping.

```ts
const experiment = createPairedPlan({
  cases,
  model,
  repetitions,
  reservePairsPerBlock,
  randomizationSeed,
  allocationSeed,
  commitmentNonce,
  budget,
});

const report = await store.finalize({
  reportId,
  completion,
  allocationCommitmentSha256: experiment.allocationCommitmentSha256,
});
const masked = freezeMaskedAnalysis({ report, scans, frozenAt });
await store.writeMaskedAnalysis(masked);
const revealed = revealPairedAnalysis({ report, masked, secret, revealedAt });
await store.writeAllocation(revealed.allocation);
```

The order is mandatory. A crash before the masked write publishes no allocation.
A crash after the masked write leaves a valid opaque analysis and no directional
claim. Only a reveal that binds the exact plan, report, masked record, commitment,
nonce, and token map can produce candidate-minus-baseline results.

## Selected shape

`evals/experiment.ts` owns the pure contracts.

```ts
type Arm = "candidate" | "baseline";

type BlockAllocation = {
  readonly blockId: string;
  readonly caseId: string;
  readonly caseVersion: number;
  readonly repetition: number;
  readonly tokens: readonly [string, string];
  readonly tokenToArm: Readonly<Record<string, Arm>>;
};

type AllocationSecret = {
  readonly schemaVersion: 1;
  readonly planSha256: string;
  readonly nonce: string;
  readonly blocks: readonly BlockAllocation[];
};

type MaskedAnalysisRecord = {
  readonly schemaVersion: 1;
  readonly reportId: string;
  readonly planSha256: string;
  readonly reportSha256: string;
  readonly allocationCommitmentSha256: string;
  readonly analysisPolicySha256: string;
  readonly observations: readonly MaskedPairObservation[];
  readonly completePairs: number;
  readonly unresolvedPairs: number;
  readonly ties: number;
  readonly opaqueEstimate: number | null;
  readonly interval95: readonly [number, number] | null;
  readonly scannerSha256: string;
  readonly scannerPassed: boolean;
  readonly treatmentBlinding: "flow-tool-presence-visible";
  readonly frozenAt: string;
  readonly sha256: string;
};

type AllocationRecord = {
  readonly schemaVersion: 1;
  readonly reportId: string;
  readonly planSha256: string;
  readonly reportSha256: string;
  readonly maskedAnalysisSha256: string;
  readonly allocationCommitmentSha256: string;
  readonly nonce: string;
  readonly blocks: readonly BlockAllocation[];
  readonly revealedAt: string;
};
```

Pure entry points are `createPairedPlan`, `scanPairedTranscript`,
`freezeMaskedAnalysis`, `revealPairedAnalysis`, and
`taskStratifiedPairedBootstrap`. Strict Zod schemas validate masked and allocation
records at the boundary. Domain-separated canonical hashes omit only a record's
own `sha256` field.

Tokens are unique per primary block and allocation is independently seeded within
each block. A reserve for that block reuses its case, repetition, tokens, and
mapping. This avoids the rejected contradiction between two global tokens and
per-block random assignment. The masked record freezes canonical per-block
outcomes without candidate or baseline labels. Directional bootstrap happens only
after reveal.

The estimand is the equal-weight macro average of each task's mean paired hidden-
correctness difference. Bootstrap resamples complete pairs within each task,
preserves stratum size, treats ties as zero, and uses the policy seed and a
versioned fixed replicate count. Power metadata uses a documented conservative
paired-difference bound. Insufficient planned power, unresolved pairs, scanner
findings, incomplete completion, an invalid policy digest, or an interval wider
than twice the minimum detectable effect prevents a directional claim.

## Runner and storage

`evals/benchmark-run.ts` becomes a thin v2 shell. It packs and inspects the
candidate once, runs both cells in every started block, grades hidden correctness
symmetrically, persists redacted transcripts and exact attempt provenance, and
activates only a complete preallocated reserve block after host, provider, or
evaluator failure. A scored product failure is never retried. Scanner findings are
immutable stop-gate evidence, not a reason to rerun until a clean transcript
appears.

`evals/report-store.ts` adds immutable masked-analysis and allocation writes using
its existing write-once primitive. It verifies that a masked record exists and its
hash matches before accepting an allocation record. The underlying report remains
opaque and exact; the allocation file is a later reveal artifact.

## Rejections

- No marginal `summarizeBenchmark()` result is used for a paired claim.
- No unsalted two-choice commitment is accepted.
- No candidate or baseline label enters the plan, transcript, or masked record.
- No allocation is written before exact report finalization and durable masked
  analysis.
- No single-arm retry or silent removal of an incomplete block is allowed.
- No scanner failure is repaired by replacement sampling.
- No claim of full treatment blinding is made because Flow tool presence is
  observable.

## Verification contract

Focused tests cover deterministic planning, per-block arm permutation, commitment
tampering, report and masked hash drift, reveal ordering, known paired effects,
bootstrap reproducibility, power metadata, ties, unresolved pairs, reserve
replacement, budget stops, scanner labels and ground-truth paths, and the honest
tool-presence limitation. The runner must emit one strict v2 low-budget pilot and
freeze its masked record before allocation reveal.
