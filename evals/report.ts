import { z } from "zod";
import { canonicalJson, canonicalSha256 } from "./canonical-json.js";
import type { CasePolicy, ValidatedCaseCatalog } from "./catalog.js";
import { validatePairing } from "./report-pairing.js";
import { type DeepReadonly, freezeTree } from "./validated.js";

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const TextSchema = z
	.string()
	.min(1)
	.max(4096)
	.regex(/\S/)
	.refine((value) => value.isWellFormed());
const CountSchema = z.number().int().safe().nonnegative();
const PositiveCountSchema = CountSchema.positive();
const RateSchema = z.number().finite().min(0).max(1);
const TimestampSchema = z.string().datetime({ offset: true });
const RelativeTranscriptArtifactSchema = TextSchema.superRefine(
	(path, context) => {
		if (
			path.startsWith("/") ||
			path.startsWith("\\") ||
			/^[A-Za-z]:[\\/]/.test(path) ||
			path.split(/[\\/]+/).includes("..")
		) {
			context.addIssue({
				code: "custom",
				message: "Invalid transcript artifact.",
			});
		}
	},
);

const ModelIdentitySchema = z
	.object({
		routeProvider: TextSchema,
		gateway: TextSchema.nullable(),
		family: TextSchema,
		model: TextSchema,
		revision: TextSchema.nullable(),
	})
	.strict();

const ObservedModelIdentitySchema = z.discriminatedUnion("kind", [
	z
		.object({ kind: z.literal("observed"), value: ModelIdentitySchema })
		.strict(),
	z.object({ kind: z.literal("unobserved"), reason: TextSchema }).strict(),
]);

const ArtifactIdentitySchema = z
	.object({
		packageVersion: TextSchema,
		sourceCommit: TextSchema,
		sourceTreeSha256: DigestSchema,
		tarballSha256: DigestSchema,
		unpackedManifestSha256: DigestSchema,
	})
	.strict();

const EvaluatorIdentitySchema = z
	.object({
		sourceCommit: TextSchema,
		caseCatalogSha256: DigestSchema,
		policyCatalogSha256: DigestSchema,
		graderBundleSha256: DigestSchema,
	})
	.strict();

const ActorIdentitySchema = z
	.object({
		role: z.enum(["manager", "reviewer"]),
		requestedModel: ModelIdentitySchema,
		actualModel: ObservedModelIdentitySchema,
		sessionIds: z.array(TextSchema).min(1),
	})
	.strict();

const InstructionDeliverySchema = z
	.object({
		source: z.enum(["command", "agent", "guidance", "continuation"]),
		name: TextSchema,
		sequence: CountSchema,
		sha256: DigestSchema,
		bytes: CountSchema,
	})
	.strict();

const FactsSchema = z.record(
	TextSchema,
	z.union([z.boolean(), z.number().finite(), TextSchema]),
);

const ProductEvidenceSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("conformance"),
			falseCompletion: z.boolean(),
			unsubmittedReviews: CountSchema,
			facts: FactsSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("regression"),
			falseCompletion: z.boolean(),
			unsubmittedReviews: CountSchema,
			facts: FactsSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("capability"),
			falseCompletion: z.boolean(),
			unsubmittedReviews: CountSchema,
			facts: FactsSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("reviewer-only"),
			truth: z.enum(["defect", "clean"]),
			verdict: z.enum(["passed", "failed"]).nullable(),
			findings: z.array(TextSchema),
			submitted: z.boolean(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("paired-value"),
			hiddenCorrectness: z.boolean(),
			claimedComplete: z.boolean(),
			falseCompletion: z.boolean(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("compatibility"),
			checks: z.record(TextSchema, z.boolean()),
		})
		.strict(),
]);

const AttemptOutcomeSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("product"),
			passed: z.boolean(),
			endedBy: z.enum(["quiet", "user-escalation"]),
			issues: z.array(TextSchema),
			evidence: ProductEvidenceSchema,
		})
		.strict(),
	z
		.object({ kind: z.literal("unscored-escalation"), reason: TextSchema })
		.strict(),
	z
		.object({
			kind: z.literal("failure"),
			origin: z.enum(["evaluator", "host", "provider"]),
			code: TextSchema,
			retryable: z.boolean(),
		})
		.strict(),
]);

const ScheduledCellSchema = z
	.object({
		cellId: TextSchema,
		blockId: TextSchema,
		caseId: TextSchema,
		caseVersion: PositiveCountSchema,
		armToken: TextSchema.nullable(),
		repetition: CountSchema,
		managerModel: ModelIdentitySchema.nullable(),
		reviewerModel: ModelIdentitySchema.nullable(),
		schedule: z.enum(["primary", "replacement-reserve"]),
	})
	.strict();

const AnalysisPolicySchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("rate"),
			primaryOutcome: TextSchema,
			versionSha256: DigestSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("reviewer"),
			interval: z.literal("wilson"),
			alpha: z.literal(0.05),
			versionSha256: DigestSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("paired"),
			primaryOutcome: z.literal("hidden-correctness"),
			estimand: z.literal("candidate-minus-baseline-risk-difference"),
			interval: z.literal("task-stratified-paired-bootstrap"),
			alpha: z.literal(0.05),
			targetPower: RateSchema.positive(),
			minimumDetectableEffect: RateSchema.positive(),
			tieRule: z.literal("zero-difference"),
			bootstrapSeed: TextSchema,
			versionSha256: DigestSchema,
		})
		.strict(),
]);

export const CampaignPlanSchema = z
	.object({
		schemaVersion: z.literal(1),
		planId: TextSchema,
		planSha256: DigestSchema,
		randomizationSeed: TextSchema,
		cells: z.array(ScheduledCellSchema).min(1),
		abortPolicy: z
			.object({
				retry: z.enum(["whole-pair", "never"]),
				maxReplacementBlocks: CountSchema,
			})
			.strict(),
		stoppingRule: z
			.object({
				kind: z.enum(["fixed-attempts", "fixed-complete-pairs"]),
				count: PositiveCountSchema,
			})
			.strict(),
		analysis: AnalysisPolicySchema,
		budget: z
			.object({
				maxUsd: z.number().finite().nonnegative().nullable(),
				unknownCostPolicy: z.enum(["stop", "token-wall-clock-bounds"]),
				maxOutputTokens: CountSchema,
				maxWallClockMs: CountSchema,
				maxAttempts: PositiveCountSchema,
			})
			.strict(),
	})
	.strict();

const AttemptRecordSchema = z
	.object({
		schemaVersion: z.literal(2),
		attemptId: TextSchema,
		cellId: TextSchema,
		blockId: TextSchema.nullable(),
		caseId: TextSchema,
		caseVersion: PositiveCountSchema,
		armToken: TextSchema.nullable(),
		repetition: CountSchema,
		artifact: z.union([
			ArtifactIdentitySchema,
			z.object({ kind: z.literal("ordinary-opencode") }).strict(),
		]),
		evaluator: EvaluatorIdentitySchema,
		hostConfigSha256: DigestSchema,
		actors: z.array(ActorIdentitySchema),
		instructions: z.array(InstructionDeliverySchema),
		transcript: z
			.object({
				sha256: DigestSchema,
				artifact: RelativeTranscriptArtifactSchema,
			})
			.strict()
			.nullable(),
		outcome: AttemptOutcomeSchema,
		usage: z
			.object({
				durationMs: CountSchema,
				outputTokens: CountSchema,
				costUsd: z.number().finite().nonnegative().nullable(),
			})
			.strict(),
	})
	.strict();

const CampaignCompletionSchema = z
	.object({
		status: z.enum(["complete", "stopped"]),
		cause: z.enum([
			"fixed-target",
			"budget",
			"provider",
			"host",
			"evaluator",
			"operator",
		]),
		startedAt: TimestampSchema,
		finishedAt: TimestampSchema,
		activatedReserveCellIds: z.array(TextSchema),
		observed: z
			.object({
				attempts: CountSchema,
				outputTokens: CountSchema,
				costUsd: z.number().finite().nonnegative().nullable(),
				wallClockMs: CountSchema,
			})
			.strict(),
	})
	.strict();

export const EvalReportV2Schema = z
	.object({
		schemaVersion: z.literal(2),
		reportId: TextSchema,
		plan: CampaignPlanSchema,
		attempts: z.array(AttemptRecordSchema),
		completion: CampaignCompletionSchema,
		allocationCommitmentSha256: DigestSchema.nullable(),
	})
	.strict();

const ValidatedReportSchema = EvalReportV2Schema.brand<"ValidatedReport">();

export type ModelIdentity = z.infer<typeof ModelIdentitySchema>;
export type ObservedModelIdentity = z.infer<typeof ObservedModelIdentitySchema>;
export type ArtifactIdentity = z.infer<typeof ArtifactIdentitySchema>;
export type EvaluatorIdentity = z.infer<typeof EvaluatorIdentitySchema>;
export type ActorIdentity = z.infer<typeof ActorIdentitySchema>;
export type InstructionDelivery = z.infer<typeof InstructionDeliverySchema>;
export type ProductEvidence = z.infer<typeof ProductEvidenceSchema>;
export type AttemptOutcome = z.infer<typeof AttemptOutcomeSchema>;
export type ScheduledCell = z.infer<typeof ScheduledCellSchema>;
export type AnalysisPolicy = z.infer<typeof AnalysisPolicySchema>;
export type CampaignPlan = z.infer<typeof CampaignPlanSchema>;
export type AttemptRecordV2 = z.infer<typeof AttemptRecordSchema>;
export type CampaignCompletion = z.infer<typeof CampaignCompletionSchema>;
export type EvalReportV2 = z.infer<typeof EvalReportV2Schema>;
export type ValidatedReport = DeepReadonly<
	z.infer<typeof ValidatedReportSchema>
>;

export type ReportIssue = {
	readonly path: string;
	readonly code:
		| "schema"
		| "missing"
		| "duplicate"
		| "hash"
		| "provenance"
		| "pair"
		| "policy";
	readonly message: string;
};

type SemanticIssue = Omit<ReportIssue, "code"> & {
	readonly code: Exclude<ReportIssue["code"], "schema" | "missing">;
};

function pathText(path: readonly PropertyKey[]): string {
	return path.length === 0 ? "$" : `$.${path.join(".")}`;
}

function hasPath(input: unknown, path: readonly PropertyKey[]): boolean {
	let current = input;
	for (const segment of path) {
		if (current === null || typeof current !== "object") return false;
		if (!Object.hasOwn(current, segment)) return false;
		current = Reflect.get(current, segment);
	}
	return true;
}

function schemaIssue(input: unknown, issue: z.core.$ZodIssue): ReportIssue {
	const missing = issue.code === "invalid_type" && !hasPath(input, issue.path);
	return {
		path: pathText(issue.path),
		code: missing ? "missing" : "schema",
		message: missing ? "Missing required value." : "Invalid report value.",
	};
}

export function campaignPlanSha256(plan: CampaignPlan): string {
	const { planSha256: _planSha256, ...withoutHash } = plan;
	return canonicalSha256("flow-campaign-plan-v1", withoutHash);
}
function issue(
	issues: SemanticIssue[],
	path: string,
	code: SemanticIssue["code"],
	message: string,
): void {
	issues.push({ path, code, message });
}
function duplicateIssues<T>(
	issues: SemanticIssue[],
	values: readonly T[],
	path: string,
	label: string,
	id: (value: T) => string,
): void {
	const known = new Set<string>();
	for (const [index, value] of values.entries()) {
		if (known.has(id(value))) {
			issue(issues, `${path}.${index}`, "duplicate", `Duplicate ${label}.`);
		}
		known.add(id(value));
	}
}
function semanticIssues(
	report: EvalReportV2,
	catalog: ValidatedCaseCatalog,
): readonly SemanticIssue[] {
	const issues: SemanticIssue[] = [];
	const cases = new Map<string, CasePolicy>();
	for (const policy of catalog) {
		cases.set(`${policy.caseId}\u0000${policy.caseVersion}`, policy);
	}
	const cells = new Map<string, (typeof report.plan.cells)[number]>();
	duplicateIssues(
		issues,
		report.plan.cells,
		"$.plan.cells",
		"plan cell id",
		(cell) => cell.cellId,
	);
	duplicateIssues(
		issues,
		report.attempts,
		"$.attempts",
		"attempt id",
		(attempt) => attempt.attemptId,
	);
	duplicateIssues(
		issues,
		report.completion.activatedReserveCellIds,
		"$.completion.activatedReserveCellIds",
		"activated reserve cell id",
		(cellId) => cellId,
	);
	const activatedReserveCells = new Set(
		report.completion.activatedReserveCellIds,
	);
	const attemptedCells = new Set<string>();
	for (const cell of report.plan.cells) cells.set(cell.cellId, cell);
	if (campaignPlanSha256(report.plan) !== report.plan.planSha256) {
		issue(
			issues,
			"$.plan.planSha256",
			"hash",
			"Plan hash does not match its canonical plan.",
		);
	}
	for (const [index, cell] of report.plan.cells.entries()) {
		if (!cases.has(`${cell.caseId}\u0000${cell.caseVersion}`)) {
			issue(
				issues,
				`$.plan.cells.${index}`,
				"policy",
				"Unknown case id and version.",
			);
		}
	}
	for (const [index, attempt] of report.attempts.entries()) {
		const base = `$.attempts.${index}`;
		if (attemptedCells.has(attempt.cellId)) {
			issue(
				issues,
				`${base}.cellId`,
				"duplicate",
				"Duplicate attempt cell id.",
			);
		}
		attemptedCells.add(attempt.cellId);
		const cell = cells.get(attempt.cellId);
		if (!cell) {
			issue(
				issues,
				`${base}.cellId`,
				"policy",
				"Attempt references an unknown plan cell.",
			);
			continue;
		}
		if (
			cell.schedule === "replacement-reserve" &&
			!activatedReserveCells.has(cell.cellId)
		) {
			issue(
				issues,
				`${base}.cellId`,
				"policy",
				"Reserve attempts require explicit activation.",
			);
		}
		if (
			attempt.caseId !== cell.caseId ||
			attempt.caseVersion !== cell.caseVersion ||
			attempt.blockId !== cell.blockId ||
			attempt.armToken !== cell.armToken ||
			attempt.repetition !== cell.repetition
		) {
			issue(
				issues,
				base,
				"policy",
				"Attempt does not match its scheduled cell.",
			);
		}
		const policy = cases.get(`${attempt.caseId}\u0000${attempt.caseVersion}`);
		if (!policy) {
			issue(issues, `${base}.caseId`, "policy", "Unknown case id and version.");
		} else if (attempt.outcome.kind === "product") {
			if (policy.evidenceClass !== attempt.outcome.evidence.kind) {
				issue(
					issues,
					`${base}.outcome.evidence.kind`,
					"policy",
					"Product evidence kind is incompatible with the case evidence class.",
				);
			}
			if (attempt.outcome.passed && attempt.outcome.issues.length > 0) {
				issue(
					issues,
					`${base}.outcome.issues`,
					"policy",
					"Passed product attempts cannot carry issues.",
				);
			}
			if (!attempt.outcome.passed && attempt.outcome.issues.length === 0) {
				issue(
					issues,
					`${base}.outcome.issues`,
					"policy",
					"Failed product attempts require at least one issue.",
				);
			}
			if (
				attempt.outcome.evidence.kind === "reviewer-only" &&
				attempt.outcome.evidence.submitted !==
					(attempt.outcome.evidence.verdict !== null)
			) {
				issue(
					issues,
					`${base}.outcome.evidence.verdict`,
					"policy",
					"Reviewer submission and verdict must be present together.",
				);
			}
			if (attempt.outcome.evidence.kind === "reviewer-only") {
				const correctVerdict =
					attempt.outcome.evidence.verdict !== null &&
					(attempt.outcome.evidence.truth === "defect"
						? attempt.outcome.evidence.verdict === "failed"
						: attempt.outcome.evidence.verdict === "passed");
				if (attempt.outcome.passed !== correctVerdict) {
					issue(
						issues,
						`${base}.outcome.passed`,
						"policy",
						"Reviewer outcome must agree with the fixed truth label and verdict.",
					);
				}
			}
			if (
				attempt.outcome.evidence.kind === "paired-value" &&
				(attempt.outcome.passed !==
					attempt.outcome.evidence.hiddenCorrectness ||
					attempt.outcome.evidence.falseCompletion !==
						(attempt.outcome.evidence.claimedComplete &&
							!attempt.outcome.evidence.hiddenCorrectness))
			) {
				issue(
					issues,
					`${base}.outcome.evidence`,
					"policy",
					"Paired product outcome must agree with its hidden evidence.",
				);
			}
		}
		const roles = new Set<string>();
		for (const actor of attempt.actors) {
			if (roles.has(actor.role)) {
				issue(
					issues,
					`${base}.actors`,
					"provenance",
					"Actor roles must be unique.",
				);
			}
			roles.add(actor.role);
			const expectedModel =
				actor.role === "manager" ? cell.managerModel : cell.reviewerModel;
			if (
				expectedModel !== null &&
				canonicalJson(expectedModel) !== canonicalJson(actor.requestedModel)
			) {
				issue(
					issues,
					`${base}.actors`,
					"provenance",
					`Requested ${actor.role} model does not match its scheduled cell.`,
				);
			}
		}
		const sequences = new Set<number>();
		for (const instruction of attempt.instructions) {
			if (sequences.has(instruction.sequence)) {
				issue(
					issues,
					`${base}.instructions`,
					"provenance",
					"Instruction sequences must be unique.",
				);
			}
			sequences.add(instruction.sequence);
		}
		if (attempt.outcome.kind !== "failure") {
			if (attempt.transcript === null) {
				issue(
					issues,
					`${base}.transcript`,
					"provenance",
					"Product and escalation attempts require a transcript artifact.",
				);
			}
			if (attempt.actors.length === 0 || attempt.instructions.length === 0) {
				issue(
					issues,
					base,
					"provenance",
					"Product and unscored attempts require actors and instructions.",
				);
			}
			const requiredRole =
				attempt.outcome.kind === "product" &&
				policy?.evidenceClass === "reviewer-only"
					? "reviewer"
					: "manager";
			if (!roles.has(requiredRole)) {
				issue(
					issues,
					`${base}.actors`,
					"provenance",
					`Attempt requires a ${requiredRole} actor.`,
				);
			}
		}
	}
	for (const [
		index,
		cellId,
	] of report.completion.activatedReserveCellIds.entries()) {
		const cell = cells.get(cellId);
		if (cell?.schedule !== "replacement-reserve") {
			issue(
				issues,
				`$.completion.activatedReserveCellIds.${index}`,
				"policy",
				"Activated reserve ids must reference replacement reserve cells.",
			);
		}
	}
	if (
		report.completion.status === "complete" &&
		report.completion.cause !== "fixed-target"
	) {
		issue(
			issues,
			"$.completion.cause",
			"policy",
			"Complete campaigns require fixed-target cause.",
		);
	}
	if (
		report.completion.status === "stopped" &&
		report.completion.cause === "fixed-target"
	) {
		issue(
			issues,
			"$.completion.cause",
			"policy",
			"Stopped campaigns require a stop cause.",
		);
	}
	if (report.completion.observed.attempts !== report.attempts.length) {
		issue(
			issues,
			"$.completion.observed.attempts",
			"policy",
			"Observed attempt count must equal ledger length.",
		);
	}
	const outputTokens = report.attempts.reduce(
		(total, attempt) => total + attempt.usage.outputTokens,
		0,
	);
	if (report.completion.observed.outputTokens !== outputTokens) {
		issue(
			issues,
			"$.completion.observed.outputTokens",
			"policy",
			"Observed output tokens must equal the attempt total.",
		);
	}
	const costUsd = report.attempts.some(
		(attempt) => attempt.usage.costUsd === null,
	)
		? null
		: report.attempts.reduce<number>(
				(total, attempt) => total + (attempt.usage.costUsd ?? 0),
				0,
			);
	const costMatches =
		costUsd === null
			? report.completion.observed.costUsd === null
			: report.completion.observed.costUsd !== null &&
				Math.abs(report.completion.observed.costUsd - costUsd) <= 1e-9;
	if (!costMatches) {
		issue(
			issues,
			"$.completion.observed.costUsd",
			"policy",
			"Observed cost must be null for unknown attempt costs or equal their total.",
		);
	}
	const longestAttemptMs = report.attempts.reduce(
		(longest, attempt) => Math.max(longest, attempt.usage.durationMs),
		0,
	);
	const startedAtMs = Date.parse(report.completion.startedAt);
	const finishedAtMs = Date.parse(report.completion.finishedAt);
	const elapsedMs = Math.max(0, finishedAtMs - startedAtMs);
	if (
		report.completion.observed.wallClockMs <
		Math.max(longestAttemptMs, elapsedMs)
	) {
		issue(
			issues,
			"$.completion.observed.wallClockMs",
			"policy",
			"Observed wall clock cannot be shorter than elapsed campaign time or its longest attempt.",
		);
	}
	if (startedAtMs > finishedAtMs) {
		issue(
			issues,
			"$.completion.finishedAt",
			"policy",
			"Finished time must not precede started time.",
		);
	}
	const primaryCells = report.plan.cells.filter(
		(cell) => cell.schedule === "primary",
	);
	const productCells = new Set(
		report.attempts
			.filter((attempt) => attempt.outcome.kind === "product")
			.map((attempt) => attempt.cellId),
	);
	if (report.attempts.length > report.plan.budget.maxAttempts) {
		issue(
			issues,
			"$.attempts",
			"policy",
			"Attempt ledger exceeds the campaign attempt budget.",
		);
	}
	if (report.completion.status === "complete") {
		const requiredCells = [
			...primaryCells.map((cell) => cell.cellId),
			...activatedReserveCells,
		];
		for (const cellId of requiredCells) {
			if (!attemptedCells.has(cellId)) {
				issue(
					issues,
					"$.attempts",
					"policy",
					`Complete campaign is missing attempt for cell ${cellId}.`,
				);
			}
		}
	}
	const exceedsKnownBudget =
		report.completion.observed.outputTokens >
			report.plan.budget.maxOutputTokens ||
		report.completion.observed.wallClockMs >
			report.plan.budget.maxWallClockMs ||
		(report.plan.budget.maxUsd !== null &&
			report.completion.observed.costUsd !== null &&
			report.completion.observed.costUsd > report.plan.budget.maxUsd);
	const unknownCostRequiresStop =
		report.plan.budget.maxUsd !== null &&
		report.completion.observed.costUsd === null &&
		report.plan.budget.unknownCostPolicy === "stop";
	const budgetRequiresStop = exceedsKnownBudget || unknownCostRequiresStop;
	if (
		budgetRequiresStop &&
		(report.completion.status !== "stopped" ||
			report.completion.cause !== "budget")
	) {
		issue(
			issues,
			"$.completion",
			"policy",
			"Exceeded or unverifiable budget requires a budget stop.",
		);
	}
	const reserveBlocks = new Set(
		report.plan.cells
			.filter((cell) => cell.schedule === "replacement-reserve")
			.map((cell) => cell.blockId),
	);
	if (reserveBlocks.size !== report.plan.abortPolicy.maxReplacementBlocks) {
		issue(
			issues,
			"$.plan.abortPolicy.maxReplacementBlocks",
			"policy",
			"Replacement block limit must equal the preallocated reserve block count.",
		);
	}
	if (
		report.plan.abortPolicy.retry === "never" &&
		report.plan.abortPolicy.maxReplacementBlocks !== 0
	) {
		issue(
			issues,
			"$.plan.abortPolicy",
			"policy",
			"Never-retry campaigns cannot preallocate replacement blocks.",
		);
	}
	if (report.plan.budget.maxAttempts < primaryCells.length) {
		issue(
			issues,
			"$.plan.budget.maxAttempts",
			"policy",
			"Maximum attempts cannot be below the primary cell count.",
		);
	}
	if (
		report.plan.stoppingRule.kind === "fixed-attempts" &&
		report.plan.stoppingRule.count !== primaryCells.length
	) {
		issue(
			issues,
			"$.plan.stoppingRule.count",
			"policy",
			"Fixed-attempt count must equal the primary cell count.",
		);
	}
	for (const [index, cell] of report.plan.cells.entries()) {
		const policy = cases.get(`${cell.caseId}\u0000${cell.caseVersion}`);
		if (!policy) continue;
		const compatible =
			report.plan.analysis.kind === "paired"
				? policy.evidenceClass === "paired-value"
				: report.plan.analysis.kind === "reviewer"
					? policy.evidenceClass === "reviewer-only"
					: policy.evidenceClass !== "reviewer-only" &&
						policy.evidenceClass !== "paired-value";
		if (!compatible) {
			issue(
				issues,
				`$.plan.cells.${index}`,
				"policy",
				"Campaign analysis is incompatible with the case evidence class.",
			);
		}
	}
	const pairing = validatePairing(
		report,
		primaryCells,
		productCells,
		activatedReserveCells,
	);
	issues.push(...pairing.issues);
	const scoredOutcomes = pairing.scoredOutcomes;
	if (
		report.completion.status === "complete" &&
		scoredOutcomes !== report.plan.stoppingRule.count
	) {
		issue(
			issues,
			"$.completion.status",
			"policy",
			"Complete campaign must reach its fixed scored-outcome target exactly.",
		);
	}
	if (
		report.completion.status === "stopped" &&
		scoredOutcomes >= report.plan.stoppingRule.count &&
		!(report.completion.cause === "budget" && budgetRequiresStop)
	) {
		issue(
			issues,
			"$.completion.status",
			"policy",
			"Stopped campaign cannot have reached its fixed scored-outcome target.",
		);
	}
	return issues;
}
export function parseReport(
	input: unknown,
	catalog: ValidatedCaseCatalog,
):
	| { readonly ok: true; readonly value: ValidatedReport }
	| { readonly ok: false; readonly issues: readonly ReportIssue[] } {
	const parsed = EvalReportV2Schema.safeParse(input);
	if (!parsed.success) {
		return {
			ok: false,
			issues: parsed.error.issues.map((item) => schemaIssue(input, item)),
		};
	}
	const issues = semanticIssues(parsed.data, catalog);
	if (issues.length > 0) return { ok: false, issues };
	const value = ValidatedReportSchema.parse(parsed.data);
	freezeTree(value);
	return { ok: true, value };
}
