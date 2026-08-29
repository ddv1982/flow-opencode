import { canonicalJson } from "./canonical-json.js";
import type { ValidatedCaseCatalog } from "./catalog.js";
import { samePackedArtifact } from "./provenance.js";
import type {
	ArtifactIdentity,
	EvaluatorIdentity,
	InstructionDelivery,
	ModelIdentity,
	ValidatedReport,
} from "./report.js";

type ActorRole = "manager" | "reviewer";

export type ActualModelExpectation =
	| {
			readonly kind: "observed";
			readonly value: ModelIdentity;
	  }
	| {
			readonly kind: "allow-unobserved";
			readonly value: ModelIdentity;
			readonly reason: string;
	  };

export type ExpectedActorProvenance = {
	readonly role: ActorRole;
	readonly requestedModel: ModelIdentity;
	readonly actualModel: ActualModelExpectation;
};

export type ExpectedAttemptProvenance = {
	readonly cellId: string;
	readonly hostConfigSha256: string;
	readonly actors: readonly ExpectedActorProvenance[];
	readonly instructions: readonly InstructionDelivery[];
};

type CommonExpectedProvenance = {
	readonly evaluator: EvaluatorIdentity;
	readonly attempts: readonly ExpectedAttemptProvenance[];
};

export type ReleaseExpectedProvenance = CommonExpectedProvenance & {
	readonly kind: "release";
	readonly artifact: ArtifactIdentity;
};

export type ExpectedArtifact =
	| ArtifactIdentity
	| { readonly kind: "ordinary-opencode" };

export type PairedExpectedProvenance = CommonExpectedProvenance & {
	readonly kind: "paired";
	readonly artifacts: readonly [ExpectedArtifact, ExpectedArtifact];
};

export type ExpectedProvenance =
	| ReleaseExpectedProvenance
	| PairedExpectedProvenance;

export type ProvenanceMismatch = {
	readonly attemptId: string | null;
	readonly path: string;
	readonly message: string;
};

export type ProvenanceComparison = {
	readonly matches: boolean;
	readonly mismatches: readonly ProvenanceMismatch[];
};

export type ReleaseVerdict = "VERIFIED" | "NOT VERIFIED" | "INCONCLUSIVE";

export type DecisionReason = {
	readonly severity: "hard" | "gap";
	readonly code:
		| "provenance-mismatch"
		| "unplanned-required-case"
		| "false-completion"
		| "unsubmitted-review"
		| "below-pass-rate"
		| "campaign-integrity-failure"
		| "campaign-stopped"
		| "missing-attempt"
		| "unscored-attempt"
		| "provider-gap"
		| "sample-gap"
		| "unattributed-provider";
	readonly message: string;
	readonly caseId: string | null;
	readonly caseVersion: number | null;
	readonly provider: string | null;
};

export type ProviderReleaseCounts = {
	readonly provider: string;
	readonly scheduled: number;
	readonly scored: number;
	readonly passed: number;
	readonly passRate: number | null;
};

export type CaseReleaseCounts = {
	readonly caseId: string;
	readonly caseVersion: number;
	readonly scheduled: number;
	readonly scored: number;
	readonly passed: number;
	readonly representedProviders: number;
	readonly providers: readonly ProviderReleaseCounts[];
};

export type ReleaseDecision = {
	readonly verdict: ReleaseVerdict;
	readonly reasons: readonly DecisionReason[];
	readonly cases: readonly CaseReleaseCounts[];
	readonly totals: {
		readonly scheduled: number;
		readonly scored: number;
		readonly passed: number;
	};
};

export type WilsonInterval = {
	readonly lower: number;
	readonly upper: number;
};

export type ReviewerAnalysis = {
	readonly assignments: number;
	readonly incomplete: number;
	readonly defectLabels: number;
	readonly cleanLabels: number;
	readonly detections: number;
	readonly falsePositives: number;
	readonly unsubmitted: number;
	readonly detectionRate: number | null;
	readonly falsePositiveRate: number | null;
	readonly detectionInterval95: WilsonInterval | null;
	readonly falsePositiveInterval95: WilsonInterval | null;
};

export type PairedAnalysis = {
	readonly eligible: number;
	readonly complete: number;
	readonly incomplete: number;
	readonly ties: number;
	readonly opaqueArmWins: readonly {
		readonly armToken: string;
		readonly wins: number;
	}[];
};

function equal(left: unknown, right: unknown): boolean {
	return canonicalJson(left) === canonicalJson(right);
}

function orderedAttempts(report: ValidatedReport) {
	const order = new Map(
		report.plan.cells.map((cell, index) => [cell.cellId, index]),
	);
	return report.attempts.toSorted(
		(left, right) =>
			(order.get(left.cellId) ?? Number.MAX_SAFE_INTEGER) -
			(order.get(right.cellId) ?? Number.MAX_SAFE_INTEGER),
	);
}

function mismatch(
	mismatches: ProvenanceMismatch[],
	attemptId: string | null,
	path: string,
	message: string,
): void {
	mismatches.push({ attemptId, path, message });
}

function compareActor(
	mismatches: ProvenanceMismatch[],
	attemptId: string,
	actual: ValidatedReport["attempts"][number]["actors"][number],
	expected: ExpectedActorProvenance,
): void {
	const path = `actors.${expected.role}`;
	if (!equal(actual.requestedModel, expected.requestedModel)) {
		mismatch(
			mismatches,
			attemptId,
			`${path}.requestedModel`,
			"Requested model identity does not match expected provenance.",
		);
	}
	if (actual.actualModel.kind === "observed") {
		if (!equal(actual.actualModel.value, expected.actualModel.value)) {
			mismatch(
				mismatches,
				attemptId,
				`${path}.actualModel`,
				"Actual model identity does not match expected provenance.",
			);
		}
		return;
	}
	if (expected.actualModel.kind !== "allow-unobserved") {
		mismatch(
			mismatches,
			attemptId,
			`${path}.actualModel`,
			"Unobserved actual model lacks the expected explicit exception.",
		);
	}
}

function compareCommonProvenance(
	attempts: ValidatedReport["attempts"],
	expectedAttempts: readonly ExpectedAttemptProvenance[],
	expected: ExpectedProvenance,
	mismatches: ProvenanceMismatch[],
	exactSet: boolean,
): void {
	const expectedByCell = new Map<string, ExpectedAttemptProvenance>();
	for (const expectedAttempt of expectedAttempts) {
		if (expectedByCell.has(expectedAttempt.cellId)) {
			mismatch(
				mismatches,
				null,
				"expected.attempts",
				`Duplicate expected provenance for cell ${expectedAttempt.cellId}.`,
			);
		}
		expectedByCell.set(expectedAttempt.cellId, expectedAttempt);
	}
	const actualCells = new Set<string>();
	for (const attempt of attempts) {
		actualCells.add(attempt.cellId);
		const expectedAttempt = expectedByCell.get(attempt.cellId);
		if (expectedAttempt === undefined) {
			mismatch(
				mismatches,
				attempt.attemptId,
				"cellId",
				"Attempt has no expected provenance entry.",
			);
			continue;
		}
		if (!equal(attempt.evaluator, expected.evaluator)) {
			mismatch(
				mismatches,
				attempt.attemptId,
				"evaluator",
				"Evaluator identity does not match expected provenance.",
			);
		}
		if (attempt.hostConfigSha256 !== expectedAttempt.hostConfigSha256) {
			mismatch(
				mismatches,
				attempt.attemptId,
				"hostConfigSha256",
				"Host configuration does not match expected provenance.",
			);
		}
		if (!equal(attempt.instructions, expectedAttempt.instructions)) {
			mismatch(
				mismatches,
				attempt.attemptId,
				"instructions",
				"Instruction delivery does not match expected provenance.",
			);
		}
		const expectedActors = new Map<ActorRole, ExpectedActorProvenance>();
		for (const expectedActor of expectedAttempt.actors) {
			if (expectedActors.has(expectedActor.role)) {
				mismatch(
					mismatches,
					attempt.attemptId,
					"expected.actors",
					`Duplicate expected ${expectedActor.role} actor.`,
				);
			}
			expectedActors.set(expectedActor.role, expectedActor);
		}
		if (attempt.actors.length !== expectedActors.size) {
			mismatch(
				mismatches,
				attempt.attemptId,
				"actors",
				"Actor roles do not match expected provenance.",
			);
		}
		for (const actualActor of attempt.actors) {
			const expectedActor = expectedActors.get(actualActor.role);
			if (expectedActor === undefined) {
				mismatch(
					mismatches,
					attempt.attemptId,
					`actors.${actualActor.role}`,
					"Unexpected actor role.",
				);
				continue;
			}
			compareActor(mismatches, attempt.attemptId, actualActor, expectedActor);
		}
		for (const expectedActor of expectedActors.values()) {
			const actualActor = attempt.actors.find(
				(actor) => actor.role === expectedActor.role,
			);
			if (actualActor === undefined) {
				mismatch(
					mismatches,
					attempt.attemptId,
					`actors.${expectedActor.role}`,
					"Expected actor is missing.",
				);
			}
		}
	}
	if (exactSet) {
		for (const expectedAttempt of expectedAttempts) {
			if (!actualCells.has(expectedAttempt.cellId)) {
				mismatch(
					mismatches,
					null,
					"attempts",
					`Expected provenance cell ${expectedAttempt.cellId} has no attempt.`,
				);
			}
		}
	}
}

function compareExpectedProvenanceWithin(
	report: ValidatedReport,
	expected: ExpectedProvenance,
	includedCellIds: ReadonlySet<string> | null,
	exactSet: boolean,
): ProvenanceComparison {
	const mismatches: ProvenanceMismatch[] = [];
	const attempts =
		includedCellIds === null
			? orderedAttempts(report)
			: orderedAttempts(report).filter((attempt) =>
					includedCellIds.has(attempt.cellId),
				);
	const expectedAttempts =
		includedCellIds === null
			? expected.attempts
			: expected.attempts.filter((attempt) =>
					includedCellIds.has(attempt.cellId),
				);
	compareCommonProvenance(
		attempts,
		expectedAttempts,
		expected,
		mismatches,
		exactSet,
	);
	if (expected.kind === "release") {
		if (report.plan.analysis.kind === "paired") {
			mismatch(
				mismatches,
				null,
				"plan.analysis.kind",
				"Paired evidence cannot satisfy exact release provenance.",
			);
		}
		for (const attempt of attempts) {
			if (!equal(attempt.artifact, expected.artifact)) {
				mismatch(
					mismatches,
					attempt.attemptId,
					"artifact",
					"Release artifact does not match expected provenance.",
				);
			}
		}
	} else {
		const expectedArtifacts = expected.artifacts.map((artifact) =>
			canonicalJson(artifact),
		);
		if (report.plan.analysis.kind !== "paired") {
			mismatch(
				mismatches,
				null,
				"plan.analysis.kind",
				"Paired provenance requires a paired campaign.",
			);
		}
		if (expectedArtifacts[0] === expectedArtifacts[1]) {
			mismatch(
				mismatches,
				null,
				"expected.artifacts",
				"Paired provenance requires two distinct expected artifacts.",
			);
		}
		const byBlock = new Map<string, ValidatedReport["attempts"]>();
		for (const attempt of attempts) {
			if (!expectedArtifacts.includes(canonicalJson(attempt.artifact))) {
				mismatch(
					mismatches,
					attempt.attemptId,
					"artifact",
					"Paired artifact is outside the expected artifact set.",
				);
			}
			const blockId = attempt.blockId ?? attempt.cellId;
			const attempts = byBlock.get(blockId) ?? [];
			byBlock.set(blockId, [...attempts, attempt]);
		}
		for (const [blockId, attempts] of byBlock) {
			if (
				attempts.length === 2 &&
				!equal(
					attempts.map((attempt) => canonicalJson(attempt.artifact)).sort(),
					[...expectedArtifacts].sort(),
				)
			) {
				mismatch(
					mismatches,
					null,
					`blocks.${blockId}.artifacts`,
					"Complete paired block does not contain both expected artifacts.",
				);
			}
		}
	}
	return { matches: mismatches.length === 0, mismatches };
}

export function compareExpectedProvenance(
	report: ValidatedReport,
	expected: ExpectedProvenance,
): ProvenanceComparison {
	return compareExpectedProvenanceWithin(report, expected, null, true);
}

function decisionReason(
	reasons: DecisionReason[],
	severity: DecisionReason["severity"],
	code: DecisionReason["code"],
	message: string,
	caseId: string | null = null,
	caseVersion: number | null = null,
	provider: string | null = null,
): void {
	reasons.push({ severity, code, message, caseId, caseVersion, provider });
}

function activeCells(report: ValidatedReport) {
	const activated = new Set(report.completion.activatedReserveCellIds);
	return report.plan.cells.filter(
		(cell) => cell.schedule === "primary" || activated.has(cell.cellId),
	);
}

export function deriveReleaseDecision(input: {
	readonly report: ValidatedReport;
	readonly catalog: ValidatedCaseCatalog;
	readonly expected: ReleaseExpectedProvenance;
	readonly promotionArtifact?: ArtifactIdentity;
}): ReleaseDecision {
	const { report, catalog, expected, promotionArtifact } = input;
	const reasons: DecisionReason[] = [];
	const cases: CaseReleaseCounts[] = [];
	const attemptsByCell = new Map(
		report.attempts.map((attempt) => [attempt.cellId, attempt]),
	);
	const cells = activeCells(report);
	const requiredKeys = new Set(
		catalog
			.filter((policy) => policy.release === "required")
			.map((policy) => `${policy.caseId}\u0000${policy.caseVersion}`),
	);
	const requiredCellIds = new Set(
		cells
			.filter((cell) =>
				requiredKeys.has(`${cell.caseId}\u0000${cell.caseVersion}`),
			)
			.map((cell) => cell.cellId),
	);
	if (
		report.completion.status === "stopped" &&
		report.completion.cause === "persistence"
	) {
		decisionReason(
			reasons,
			"hard",
			"campaign-integrity-failure",
			`Campaign stopped after a ${report.completion.cause} failure.`,
		);
	}
	if (
		promotionArtifact &&
		!samePackedArtifact(expected.artifact, promotionArtifact)
	) {
		decisionReason(
			reasons,
			"hard",
			"provenance-mismatch",
			"artifact.packed: measured package does not match the promotion candidate.",
		);
	}

	for (const mismatchItem of compareExpectedProvenanceWithin(
		report,
		expected,
		requiredCellIds,
		false,
	).mismatches) {
		decisionReason(
			reasons,
			"hard",
			"provenance-mismatch",
			`${mismatchItem.path}: ${mismatchItem.message}`,
		);
	}
	for (const attempt of orderedAttempts(report)) {
		if (!requiredKeys.has(`${attempt.caseId}\u0000${attempt.caseVersion}`)) {
			continue;
		}
		if (
			attempt.outcome.kind === "failure" &&
			attempt.outcome.origin === "evaluator"
		) {
			decisionReason(
				reasons,
				"hard",
				"campaign-integrity-failure",
				`Attempt ${attempt.attemptId} failed in ${attempt.outcome.origin} code.`,
				attempt.caseId,
				attempt.caseVersion,
			);
		}
		if (attempt.outcome.kind !== "product") continue;
		const evidence = attempt.outcome.evidence;
		if ("falseCompletion" in evidence && evidence.falseCompletion) {
			decisionReason(
				reasons,
				"hard",
				"false-completion",
				`Attempt ${attempt.attemptId} recorded a false completion.`,
				attempt.caseId,
				attempt.caseVersion,
			);
		}
		if (evidence.kind === "reviewer-only" && !evidence.submitted) {
			decisionReason(
				reasons,
				"hard",
				"unsubmitted-review",
				`Attempt ${attempt.attemptId} did not submit its review.`,
				attempt.caseId,
				attempt.caseVersion,
			);
		}
		if ("unsubmittedReviews" in evidence && evidence.unsubmittedReviews > 0) {
			decisionReason(
				reasons,
				"hard",
				"unsubmitted-review",
				`Attempt ${attempt.attemptId} left ${evidence.unsubmittedReviews} review(s) unsubmitted.`,
				attempt.caseId,
				attempt.caseVersion,
			);
		}
	}

	for (const policy of catalog.filter((item) => item.release === "required")) {
		const caseCells = cells.filter(
			(cell) =>
				cell.caseId === policy.caseId &&
				cell.caseVersion === policy.caseVersion,
		);
		if (caseCells.length === 0) {
			decisionReason(
				reasons,
				"hard",
				"unplanned-required-case",
				"Required case is absent from the active frozen plan.",
				policy.caseId,
				policy.caseVersion,
			);
			cases.push({
				caseId: policy.caseId,
				caseVersion: policy.caseVersion,
				scheduled: 0,
				scored: 0,
				passed: 0,
				representedProviders: 0,
				providers: [],
			});
			continue;
		}
		const byProvider = new Map<string, typeof caseCells>();
		for (const cell of caseCells) {
			const attempt = attemptsByCell.get(cell.cellId);
			const scoringRole =
				policy.evidenceClass === "reviewer-only" ? "reviewer" : "manager";
			const scheduledModel =
				scoringRole === "manager" ? cell.managerModel : cell.reviewerModel;
			const provider =
				scheduledModel?.routeProvider ??
				attempt?.actors.find((actor) => actor.role === scoringRole)
					?.requestedModel.routeProvider;
			if (provider === undefined) {
				decisionReason(
					reasons,
					"gap",
					"unattributed-provider",
					`Scheduled cell ${cell.cellId} has no manager route provider.`,
					policy.caseId,
					policy.caseVersion,
				);
				continue;
			}
			const providerCells = byProvider.get(provider) ?? [];
			providerCells.push(cell);
			byProvider.set(provider, providerCells);
		}
		if (byProvider.size < policy.minProviders) {
			decisionReason(
				reasons,
				"gap",
				"provider-gap",
				`Case represents ${byProvider.size} provider(s), below the required ${policy.minProviders}.`,
				policy.caseId,
				policy.caseVersion,
			);
		}
		const providerCounts: ProviderReleaseCounts[] = [];
		for (const [provider, providerCells] of byProvider) {
			let scored = 0;
			let passed = 0;
			for (const cell of providerCells) {
				const attempt = attemptsByCell.get(cell.cellId);
				if (attempt === undefined) {
					decisionReason(
						reasons,
						"gap",
						"missing-attempt",
						`Scheduled cell ${cell.cellId} has no attempt.`,
						policy.caseId,
						policy.caseVersion,
						provider,
					);
					continue;
				}
				if (attempt.outcome.kind !== "product") {
					if (
						attempt.outcome.kind === "failure" &&
						(attempt.outcome.origin === "host" ||
							attempt.outcome.origin === "provider") &&
						attempt.outcome.retryable
					) {
						continue;
					}
					decisionReason(
						reasons,
						"gap",
						"unscored-attempt",
						`Attempt ${attempt.attemptId} has no product score.`,
						policy.caseId,
						policy.caseVersion,
						provider,
					);
					continue;
				}
				scored += 1;
				if (attempt.outcome.passed) passed += 1;
			}
			const passRate = scored === 0 ? null : passed / scored;
			providerCounts.push({
				provider,
				scheduled: providerCells.length,
				scored,
				passed,
				passRate,
			});
			if (scored < policy.minScoredAttempts) {
				decisionReason(
					reasons,
					"gap",
					"sample-gap",
					`Provider scored ${scored} attempt(s), below the required ${policy.minScoredAttempts}.`,
					policy.caseId,
					policy.caseVersion,
					provider,
				);
			} else if (
				policy.minPassRate !== null &&
				passRate !== null &&
				passRate < policy.minPassRate
			) {
				decisionReason(
					reasons,
					"hard",
					"below-pass-rate",
					`Provider pass rate ${passRate} is below the required ${policy.minPassRate}.`,
					policy.caseId,
					policy.caseVersion,
					provider,
				);
			}
		}
		cases.push({
			caseId: policy.caseId,
			caseVersion: policy.caseVersion,
			scheduled: caseCells.length,
			scored: providerCounts.reduce((total, item) => total + item.scored, 0),
			passed: providerCounts.reduce((total, item) => total + item.passed, 0),
			representedProviders: byProvider.size,
			providers: providerCounts,
		});
	}

	const totals = cases.reduce(
		(total, item) => ({
			scheduled: total.scheduled + item.scheduled,
			scored: total.scored + item.scored,
			passed: total.passed + item.passed,
		}),
		{ scheduled: 0, scored: 0, passed: 0 },
	);
	if (
		report.completion.status === "stopped" &&
		reasons.some(
			(reason) => reason.severity === "gap" && reason.caseId !== null,
		)
	) {
		decisionReason(
			reasons,
			"gap",
			"campaign-stopped",
			`Required evidence remained incomplete after a ${report.completion.cause} stop.`,
		);
	}
	const verdict = reasons.some((item) => item.severity === "hard")
		? "NOT VERIFIED"
		: reasons.length > 0
			? "INCONCLUSIVE"
			: "VERIFIED";
	return { verdict, reasons, cases, totals };
}

function wilson95(successes: number, total: number): WilsonInterval | null {
	if (total === 0) return null;
	const z = 1.959963984540054;
	const rate = successes / total;
	const zSquared = z * z;
	const denominator = 1 + zSquared / total;
	const center = (rate + zSquared / (2 * total)) / denominator;
	const margin =
		(z / denominator) *
		Math.sqrt((rate * (1 - rate) + zSquared / (4 * total)) / total);
	return { lower: center - margin, upper: center + margin };
}

export function analyzeReviewer(report: ValidatedReport): ReviewerAnalysis {
	if (report.plan.analysis.kind !== "reviewer") {
		return {
			assignments: 0,
			incomplete: 0,
			defectLabels: 0,
			cleanLabels: 0,
			detections: 0,
			falsePositives: 0,
			unsubmitted: 0,
			detectionRate: null,
			falsePositiveRate: null,
			detectionInterval95: null,
			falsePositiveInterval95: null,
		};
	}
	let defectLabels = 0;
	let cleanLabels = 0;
	let detections = 0;
	let falsePositives = 0;
	let unsubmitted = 0;
	for (const attempt of report.attempts) {
		if (
			attempt.outcome.kind !== "product" ||
			attempt.outcome.evidence.kind !== "reviewer-only"
		) {
			continue;
		}
		const evidence = attempt.outcome.evidence;
		if (evidence.truth === "defect") {
			defectLabels += 1;
			if (evidence.verdict === "failed") detections += 1;
		} else {
			cleanLabels += 1;
			if (evidence.verdict === "failed") falsePositives += 1;
		}
		if (!evidence.submitted) unsubmitted += 1;
	}
	const labelledAssignments = defectLabels + cleanLabels;
	const assignments = activeCells(report).length;
	return {
		assignments,
		incomplete: Math.max(0, assignments - labelledAssignments),
		defectLabels,
		cleanLabels,
		detections,
		falsePositives,
		unsubmitted,
		detectionRate: defectLabels === 0 ? null : detections / defectLabels,
		falsePositiveRate: cleanLabels === 0 ? null : falsePositives / cleanLabels,
		detectionInterval95: wilson95(detections, defectLabels),
		falsePositiveInterval95: wilson95(falsePositives, cleanLabels),
	};
}

export function analyzePairs(report: ValidatedReport): PairedAnalysis {
	if (report.plan.analysis.kind !== "paired") {
		return {
			eligible: 0,
			complete: 0,
			incomplete: 0,
			ties: 0,
			opaqueArmWins: [],
		};
	}
	const cells = activeCells(report);
	const attemptsByCell = new Map(
		report.attempts.map((attempt) => [attempt.cellId, attempt]),
	);
	const blocks = new Map<string, typeof cells>();
	for (const cell of cells) {
		const block = blocks.get(cell.blockId) ?? [];
		block.push(cell);
		blocks.set(cell.blockId, block);
	}
	let complete = 0;
	let ties = 0;
	const armWins = new Map<string, number>();
	for (const block of blocks.values()) {
		for (const cell of block) {
			if (cell.armToken !== null && !armWins.has(cell.armToken)) {
				armWins.set(cell.armToken, 0);
			}
		}
		const outcomes = block.map((cell) => {
			const attempt = attemptsByCell.get(cell.cellId);
			if (
				attempt?.outcome.kind !== "product" ||
				attempt.outcome.evidence.kind !== "paired-value"
			) {
				return null;
			}
			return {
				armToken: cell.armToken,
				correct: attempt.outcome.evidence.hiddenCorrectness,
			};
		});
		const first = outcomes[0];
		const second = outcomes[1];
		if (
			block.length !== 2 ||
			first === undefined ||
			second === undefined ||
			first === null ||
			second === null
		) {
			continue;
		}
		complete += 1;
		if (first.correct === second.correct) {
			ties += 1;
			continue;
		}
		const winner = first.correct ? first.armToken : second.armToken;
		if (winner !== null) armWins.set(winner, (armWins.get(winner) ?? 0) + 1);
	}
	return {
		eligible: blocks.size,
		complete,
		incomplete: blocks.size - complete,
		ties,
		opaqueArmWins: [...armWins]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([armToken, wins]) => ({ armToken, wins })),
	};
}
