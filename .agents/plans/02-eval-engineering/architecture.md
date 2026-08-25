# Eval engineering architecture

## Usage

Maintainers build one candidate artifact, run the evidence tier they need, and
qualify explicit inputs. The commands below are the target interface introduced
by the phases. Commands never select the newest report implicitly.

```bash
bun run eval:pack -- --out .artifacts/opencode-plugin-flow.tgz
bun run eval:smoke -- --artifact .artifacts/opencode-plugin-flow.tgz --model openai/gpt-5.6-sol
bun run eval:release -- --plan evals/plans/release-v2.json --artifact .artifacts/opencode-plugin-flow.tgz
bun run eval:reviewer -- --plan evals/plans/reviewer-v1.json --artifact .artifacts/opencode-plugin-flow.tgz
bun run eval:compare -- --plan evals/plans/paired-value-v1.json --candidate .artifacts/opencode-plugin-flow.tgz
bun run eval:canary prepare -- --artifact .artifacts/opencode-plugin-flow.tgz
bun run eval:canary record -- --workspace <fixture> --release <version>
bun run qualify -- --report <report.json> --artifact .artifacts/opencode-plugin-flow.tgz --canary <canary.json>
```

Every decision ends with one verdict.

```text
VERIFIED
NOT VERIFIED
INCONCLUSIVE
```

Cheap smoke is always inconclusive for release. Reviewer and paired experiments
remain advisory until a calibrated policy promotes their exact plan version.

## Core shape

The source of truth is a frozen campaign plan plus write-once attempt records.
Summaries are derived views.

```ts
type Verdict = "VERIFIED" | "NOT VERIFIED" | "INCONCLUSIVE";
type EvidenceClass =
	| "conformance"
	| "regression"
	| "capability"
	| "compatibility"
	| "reviewer-only"
	| "paired-value";

type ProductEvidence =
	| { readonly kind: "conformance" | "regression" | "capability"; readonly falseCompletion: boolean; readonly unsubmittedReviews: number; readonly facts: Readonly<Record<string, boolean | number | string>> }
	| { readonly kind: "reviewer-only"; readonly truth: "defect" | "clean"; readonly verdict: "passed" | "failed" | null; readonly findings: readonly string[]; readonly submitted: boolean }
	| { readonly kind: "paired-value"; readonly hiddenCorrectness: boolean; readonly claimedComplete: boolean; readonly falseCompletion: boolean }
	| { readonly kind: "compatibility"; readonly checks: Readonly<Record<string, boolean>> };

type AttemptOutcome =
	| { readonly kind: "product"; readonly passed: boolean; readonly endedBy: "quiet" | "user-escalation"; readonly issues: readonly string[]; readonly evidence: ProductEvidence }
	| { readonly kind: "unscored-escalation"; readonly reason: string }
	| { readonly kind: "failure"; readonly origin: "evaluator" | "host" | "provider"; readonly code: string; readonly retryable: boolean };

type ArtifactIdentity = {
	readonly packageVersion: string;
	readonly sourceCommit: string;
	readonly sourceTreeSha256: string;
	readonly tarballSha256: string;
	readonly unpackedManifestSha256: string;
};

type EvaluatorIdentity = {
	readonly sourceCommit: string;
	readonly caseCatalogSha256: string;
	readonly policyCatalogSha256: string;
	readonly graderBundleSha256: string;
};

type ActorIdentity = {
	readonly role: "manager" | "reviewer";
	readonly requestedModel: ModelIdentity;
	readonly actualModel: ObservedModelIdentity;
	readonly sessionIds: readonly string[];
};

type ModelIdentity = {
	readonly routeProvider: string;
	readonly gateway: string | null;
	readonly family: string;
	readonly model: string;
	readonly revision: string | null;
};

type ObservedModelIdentity =
	| { readonly kind: "observed"; readonly value: ModelIdentity }
	| { readonly kind: "unobserved"; readonly reason: string };

type InstructionDelivery = {
	readonly source: "command" | "agent" | "guidance" | "continuation";
	readonly name: string;
	readonly sequence: number;
	readonly sha256: string;
	readonly bytes: number;
};

type AttemptRecordV2 = {
	readonly schemaVersion: 2;
	readonly attemptId: string;
	readonly cellId: string;
	readonly blockId: string | null;
	readonly caseId: string;
	readonly caseVersion: number;
	readonly armToken: string | null;
	readonly repetition: number;
	readonly artifact: ArtifactIdentity | { readonly kind: "ordinary-opencode" };
	readonly evaluator: EvaluatorIdentity;
	readonly hostConfigSha256: string;
	readonly actors: readonly ActorIdentity[];
	readonly instructions: readonly InstructionDelivery[];
	readonly transcript: { readonly sha256: string; readonly artifact: string } | null;
	readonly outcome: AttemptOutcome;
	readonly usage: { readonly durationMs: number; readonly outputTokens: number; readonly costUsd: number | null };
};

type ScheduledCell = {
	readonly cellId: string;
	readonly blockId: string;
	readonly caseId: string;
	readonly caseVersion: number;
	readonly armToken: string | null;
	readonly repetition: number;
	readonly managerModel: ModelIdentity | null;
	readonly reviewerModel: ModelIdentity | null;
	readonly schedule: "primary" | "replacement-reserve";
};

type AnalysisPolicy =
	| { readonly kind: "rate"; readonly primaryOutcome: string; readonly versionSha256: string }
	| { readonly kind: "reviewer"; readonly interval: "wilson"; readonly alpha: 0.05; readonly versionSha256: string }
	| { readonly kind: "paired"; readonly primaryOutcome: "hidden-correctness"; readonly estimand: "candidate-minus-baseline-risk-difference"; readonly interval: "task-stratified-paired-bootstrap"; readonly alpha: 0.05; readonly targetPower: number; readonly minimumDetectableEffect: number; readonly tieRule: "zero-difference"; readonly bootstrapSeed: string; readonly versionSha256: string };

type ReviewerPromotionRecord = {
	readonly schemaVersion: 1;
	readonly planSha256: string;
	readonly calibrationReportSha256: string;
	readonly caseCatalogSha256: string;
	readonly humanLabelsSha256: string;
	readonly artifactSha256: string;
	readonly reviewerModels: readonly ModelIdentity[];
	readonly defectCases: number;
	readonly cleanCases: number;
	readonly ratersPerCase: number;
	readonly agreement: { readonly method: "krippendorff-alpha"; readonly value: number; readonly minimum: number };
	readonly observed: { readonly detectionRate: number; readonly detectionInterval95: readonly [number, number]; readonly falsePositiveRate: number; readonly falsePositiveInterval95: readonly [number, number] };
	readonly minimumDetectionRate: number;
	readonly maximumFalsePositiveRate: number;
	readonly recordedAt: string;
};

type CampaignPlan = {
	readonly schemaVersion: 1;
	readonly planId: string;
	readonly planSha256: string;
	readonly randomizationSeed: string;
	readonly cells: readonly ScheduledCell[];
	readonly abortPolicy: { readonly retry: "whole-pair" | "never"; readonly maxReplacementBlocks: number };
	readonly stoppingRule: { readonly kind: "fixed-attempts" | "fixed-complete-pairs"; readonly count: number };
	readonly analysis: AnalysisPolicy;
	readonly budget: { readonly maxUsd: number | null; readonly unknownCostPolicy: "stop" | "token-wall-clock-bounds"; readonly maxOutputTokens: number; readonly maxWallClockMs: number; readonly maxAttempts: number };
};

type CampaignCompletion = {
	readonly status: "complete" | "stopped";
	readonly cause: "fixed-target" | "budget" | "provider" | "host" | "evaluator" | "operator";
	readonly startedAt: string;
	readonly finishedAt: string;
	readonly activatedReserveCellIds: readonly string[];
	readonly observed: { readonly attempts: number; readonly outputTokens: number; readonly costUsd: number | null; readonly wallClockMs: number };
};

type EvalReportV2 = {
	readonly schemaVersion: 2;
	readonly reportId: string;
	readonly plan: CampaignPlan;
	readonly attempts: readonly AttemptRecordV2[];
	readonly completion: CampaignCompletion;
	readonly allocationCommitmentSha256: string | null;
};

type AllocationRecord = {
	readonly schemaVersion: 1;
	readonly reportId: string;
	readonly allocationCommitmentSha256: string;
	readonly maskedAnalysisSha256: string;
	readonly arms: Readonly<Record<string, "candidate" | "baseline">>;
	readonly revealedAt: string;
};

type MaskedAnalysisRecord = {
	readonly schemaVersion: 1;
	readonly reportId: string;
	readonly allocationCommitmentSha256: string;
	readonly analysisPolicySha256: string;
	readonly opaqueArmEstimate: number;
	readonly interval95: readonly [number, number];
	readonly frozenAt: string;
	readonly sha256: string;
};

type ReportIssue = {
	readonly path: string;
	readonly code: "schema" | "missing" | "duplicate" | "hash" | "provenance" | "pair" | "policy";
	readonly message: string;
};

type ValidatedReport = EvalReportV2 & { readonly __validated: unique symbol };

type ExpectedProvenance = {
	readonly artifact: ArtifactIdentity;
	readonly evaluator: EvaluatorIdentity;
	readonly hostConfigSha256: string;
	readonly actors: { readonly manager: ModelIdentity; readonly reviewer: ModelIdentity | null };
};

type CanaryRecord = {
	readonly schemaVersion: 1;
	readonly status: "passed" | "failed" | "incomplete";
	readonly artifactSha256: string;
	readonly checklistVersion: string;
	readonly checklistSha256: string;
	readonly releaseTag: string;
	readonly operator: string;
	readonly recordedAt: string;
	readonly expiresAt: string;
	readonly hostConfigSha256: string;
	readonly actors: readonly ModelIdentity[];
	readonly checks: Readonly<Record<string, boolean>>;
	readonly sanitizedSessionSha256: string | null;
};

type DecisionRecord = {
	readonly schemaVersion: 1;
	readonly verdict: Verdict;
	readonly reportSha256: string;
	readonly artifactSha256: string;
	readonly canarySha256: string | null;
	readonly catalogSha256: string;
	readonly expectedProvenanceSha256: string;
	readonly analyzerVersionSha256: string;
	readonly decisionInputSha256: string;
	readonly reasons: readonly string[];
	readonly recordedAt: string;
};
```

Decision records live at `evals/decisions/<reportId>.json`. Release canaries live
at `evals/canary/<version>.json`. A reviewed commit containing the record is the
operator attestation. Tag CI reads only the exact version path from the tagged
commit and verifies every digest again.

Case policy lives beside executable case definitions.

```ts
type CasePolicy = {
	readonly caseId: string;
	readonly caseVersion: number;
	readonly evidenceClass: EvidenceClass;
	readonly oracle: "durable-state" | "hidden-executable" | "trajectory" | "fixed-review-label";
	readonly release: "required" | "report-only";
	readonly minProviders: number;
	readonly minScoredAttempts: number;
	readonly minPassRate: number | null;
	readonly reviewerPromotionRecordSha256: string | null;
};
```

## Pure boundary

```ts
declare function parseReport(input: unknown, catalog: readonly CasePolicy[]):
	| { readonly ok: true; readonly value: ValidatedReport }
	| { readonly ok: false; readonly issues: readonly ReportIssue[] };

declare function deriveReleaseDecision(input: {
	readonly report: ValidatedReport;
	readonly catalog: readonly CasePolicy[];
	readonly expected: ExpectedProvenance;
	readonly canary: CanaryRecord | null;
}): { readonly verdict: Verdict; readonly reasons: readonly string[] };

declare function analyzeReviewer(report: ValidatedReport): {
	readonly detectionRate: number | null;
	readonly falsePositiveRate: number | null;
	readonly detectionInterval95: readonly [number, number] | null;
	readonly falsePositiveInterval95: readonly [number, number] | null;
};

declare function analyzePairs(report: ValidatedReport, masked: MaskedAnalysisRecord, allocation: AllocationRecord): {
	readonly completePairs: number;
	readonly incompletePairs: number;
	readonly candidateWins: number;
	readonly baselineWins: number;
	readonly ties: number;
	readonly riskDifference: number | null;
	readonly interval95: readonly [number, number] | null;
};
```

Phase 2 implements the pure release decision without a canary input. Phase 9 adds
the canary gate at the release-alignment boundary. Phase 2 paired analysis returns
only opaque complete, incomplete, tie, and arm-win counts. Phase 7 adds masked
allocation, directional risk difference, and bootstrap intervals. Release sample
and pass floors apply per represented scheduled provider within each required case.

Parsing and provenance validation happen once at the JSON boundary. Internal
analysis trusts `ValidatedReport`. CLI, filesystem, host, and provider concerns
stay in thin shells.

## Data flow

```text
typed catalog -> frozen campaign plan -> existing EvalHost -> write-once attempt files
attempt files -> strict parser and finalizer -> validated report
validated report + independently computed provenance + canary -> pure decision -> immutable decision record
```

The current packed host, cassette replay, Session runtime, and narrow live smoke
remain. New code adds evidence semantics and analysis around them.

## Decision rules

- The plan defines the denominator. Results never invent coverage.
- `planSha256` hashes RFC 8785 canonical JSON with that field omitted and a
  `flow-campaign-plan-v1` domain prefix.
- Missing, duplicated, unknown, or internally inconsistent evidence is `NOT VERIFIED`.
- Provider, host, evaluator, or budget stops that exhaust declared replacements
  leave required evidence `INCONCLUSIVE`.
- Complete product failures are `NOT VERIFIED`.
- All three verdicts produce immutable decision records. Release automation accepts
  only a matching `VERIFIED` record.
- A scored failure is immutable. Resumes fill only cells that never produced a
  product result.
- Paired retries activate a new whole block. One arm never reruns alone.
- Pair analysis uses complete pairs and keeps incomplete pairs visible.
- Attempts and reports carry opaque arm tokens. The allocation map stays separate
  until a `MaskedAnalysisRecord` is hashed. The allocation record must name that
  exact hash before unblinding supplies the candidate-minus-baseline direction.
- Campaign finalization records the terminal cause and observed budgets, so a
  truncated ledger cannot impersonate a declared inconclusive stop.
- The primary paired outcome is hidden executable correctness. False completion,
  latency, tokens, and cost are secondary.
- Reviewer experiments use fixed defect and clean states. They record actual
  reviewer identity and report detection plus false-positive rates.
- Same-model review supports a structural-independence claim only.
- Qualification records bind report, artifact, source, policy, evaluator, manager,
  reviewer, analyzer, expected-provenance, decision-input, and canary digests.
- Every packed-byte release needs matching conformance evidence and a manual
  OpenCode canary. Only tags publish.
- Paired tasks hide evaluation labels and fixture purpose from the model, arm
  assignment from the grader, and candidate labels from the analyst until the
  masked analysis is frozen. The model cannot be blinded to whether Flow tools
  exist, so the report states that limitation instead of claiming treatment
  blinding.

## Module map

- `evals/report.ts` owns v2 types, strict parsing, integrity checks, and verdicts;
  `evals/canonical-json.ts` owns canonical serialization and domain-separated hashes.
- `evals/validated.ts` owns the shared deep-readonly and runtime-freeze boundary.
- `evals/report-pairing.ts` owns paired plan and complete-pair invariants.
- `evals/report-store.ts` owns canonical write-once attempt files and finalization.
- `evals/provenance.ts` owns source, artifact, evaluator, host, actor, and instruction digests.
- `evals/catalog.ts` owns typed case policies and campaign planning.
- `evals/analysis.ts` owns pure release, reviewer, and paired analysis.
- `evals/allocation.ts` owns arm commitments and controlled unblinding.
- Existing runners adapt outcomes into attempt records. `EvalHost` remains the host boundary.
- `scripts/qualify-release.ts` becomes a thin CLI over parsed reports and pure analysis.

## First implementation unit

Add the strict report boundary and synthetic fixtures. Reproduce the current
summary-only qualification exploit as a failing test. Do not change the live
runner, statistics, or release workflow until malformed and partial evidence fail
closed.
