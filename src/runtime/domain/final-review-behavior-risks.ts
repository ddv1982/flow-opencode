import {
	artifactPathsForWorker,
	type FinalReviewWorkerEvidence,
	validationCommandsForWorker,
} from "./final-review-coverage-evidence";
import {
	isSafeReviewArtifactRef,
	isTestPath,
	normalizeArtifactPath,
	pathForReviewArtifactRef,
} from "./final-review-coverage-paths";
import type { ReviewContextPack } from "./review-content-discovery";

export const FINAL_REVIEW_BEHAVIOR_RISK_CLASSES = [
	"async_event_ordering",
	"lifecycle_reentrancy",
	"state_commit_rollback",
	"persistence_recovery",
	"interaction_geometry",
	"accessibility_semantics",
	"test_evidence_authenticity",
] as const;

export type FinalReviewBehaviorRiskClass =
	(typeof FINAL_REVIEW_BEHAVIOR_RISK_CLASSES)[number];

export type FinalReviewBehaviorCheck = {
	riskClass: FinalReviewBehaviorRiskClass;
	result: "passed" | "gap_recorded" | "not_applicable" | "needs_fix";
	invariant: string;
	entrypointRefs: string[];
	stateOwnerRefs: string[];
	lifecycleOwnerRefs: string[];
	failurePath: string;
	testEvidenceRefs: string[];
	validationRefs: string[];
	remainingGap?: string | undefined;
};

export type FinalReviewValidationCoverage = {
	command: string;
	behaviorClasses: FinalReviewBehaviorRiskClass[];
	proves: string[];
	gaps: string[];
	testEvidenceRefs: string[];
};

export type FinalReviewBehaviorCoverageTarget = {
	evidenceRefs?:
		| {
				validationCommands: string[];
		  }
		| undefined;
	declaredReviewScope?:
		| readonly {
				id: string;
				kind: string;
				target: string;
		  }[]
		| undefined;
	remainingGaps?: string[] | undefined;
	suggestedValidation?: string[] | undefined;
	behaviorChecks?: FinalReviewBehaviorCheck[] | undefined;
	validationCoverage?: FinalReviewValidationCoverage[] | undefined;
	reviewContextPack?: ReviewContextPack | undefined;
};

export type BehaviorValidationLedgerTarget = Pick<
	FinalReviewBehaviorCoverageTarget,
	| "evidenceRefs"
	| "remainingGaps"
	| "suggestedValidation"
	| "behaviorChecks"
	| "validationCoverage"
	| "reviewContextPack"
>;

const FLOW_INFRASTRUCTURE_SRC_DOMAINS = new Set([
	"runtime",
	"prompts",
	"audit",
	"adapters",
	"core",
	"persistence",
	"workflow",
	"types",
]);

const ASYNC_EVENT_TEXT_PATTERN =
	/\b(async|await|promise|deferred?|race|event|listener|handler|callback|queue|timer|timeout|interval|concurrent|interleav(?:e|ing)|click)\b/i;
const REVIEW_SCOPE_WILDCARD_PATTERN = /[*?[\]{}]/;

function addRequired(
	required: Set<FinalReviewBehaviorRiskClass>,
	...riskClasses: FinalReviewBehaviorRiskClass[]
): void {
	for (const riskClass of riskClasses) {
		required.add(riskClass);
	}
}

function genericAppDomainForPath(path: string): string | null {
	const match = /^src\/([^/]+)\//.exec(path);
	if (!match) {
		return null;
	}
	const domain = match[1];
	if (!domain) {
		return null;
	}
	return FLOW_INFRASTRUCTURE_SRC_DOMAINS.has(domain) ? null : domain;
}

function reviewContextPackHasAsyncEventSignal(
	pack: ReviewContextPack,
): boolean {
	for (const context of pack.includedContext) {
		if (
			ASYNC_EVENT_TEXT_PATTERN.test(
				[
					context.path,
					context.reason,
					context.surface ?? "",
					context.summary ?? "",
				].join(" "),
			)
		) {
			return true;
		}
	}
	for (const relationship of pack.relationships) {
		if (
			ASYNC_EVENT_TEXT_PATTERN.test(
				[
					relationship.from,
					relationship.to,
					relationship.kind,
					relationship.summary,
				].join(" "),
			)
		) {
			return true;
		}
	}
	return false;
}

function concreteDeclaredReviewScopePath(
	scope: NonNullable<
		FinalReviewBehaviorCoverageTarget["declaredReviewScope"]
	>[number],
): string | null {
	const target = normalizeArtifactPath(scope.target);
	if (
		!target.includes("/") ||
		REVIEW_SCOPE_WILDCARD_PATTERN.test(target) ||
		!isSafeReviewArtifactRef(target)
	) {
		return null;
	}
	return target;
}

function declaredReviewScopePaths(
	review: Pick<FinalReviewBehaviorCoverageTarget, "declaredReviewScope">,
): string[] {
	return (review.declaredReviewScope ?? [])
		.map(concreteDeclaredReviewScopePath)
		.filter((target): target is string => target !== null);
}

export function deriveRequiredFinalReviewBehaviorRisks(
	worker: FinalReviewWorkerEvidence,
	review: Pick<
		FinalReviewBehaviorCoverageTarget,
		"reviewContextPack" | "declaredReviewScope"
	> = {},
): FinalReviewBehaviorRiskClass[] {
	const required = new Set<FinalReviewBehaviorRiskClass>();
	const artifactPaths = artifactPathsForWorker(worker);
	const reviewScopePaths = declaredReviewScopePaths(review);
	const behaviorRiskPaths = [...artifactPaths, ...reviewScopePaths];
	const genericAppDomains = new Set(
		behaviorRiskPaths
			.map(genericAppDomainForPath)
			.filter((domain): domain is string => domain !== null),
	);
	const testsTouched = behaviorRiskPaths.some(isTestPath);
	const pack = review.reviewContextPack;

	if (pack) {
		if (
			pack.includedContext.some((context) => context.reason === "state_owner")
		) {
			addRequired(required, "state_commit_rollback");
		}
		if (
			pack.includedContext.some(
				(context) => context.reason === "lifecycle_owner",
			)
		) {
			addRequired(required, "lifecycle_reentrancy");
		}
		if (reviewContextPackHasAsyncEventSignal(pack)) {
			addRequired(required, "async_event_ordering");
		}
	}

	if (genericAppDomains.size >= 2) {
		addRequired(
			required,
			"async_event_ordering",
			"lifecycle_reentrancy",
			"state_commit_rollback",
		);
	}

	if (
		required.size > 0 &&
		(testsTouched ||
			validationCommandsForWorker(worker).length > 0 ||
			(pack?.validationEvidence.length ?? 0) > 0)
	) {
		addRequired(required, "test_evidence_authenticity");
	}

	return FINAL_REVIEW_BEHAVIOR_RISK_CLASSES.filter((riskClass) =>
		required.has(riskClass),
	);
}

function hasText(value: string | undefined): boolean {
	return Boolean(value?.trim());
}

function validationCommandRefsForReview(
	review: FinalReviewBehaviorCoverageTarget,
): string[] {
	return (review.evidenceRefs?.validationCommands ?? [])
		.map((command) => command.trim())
		.filter((command) => command.length > 0);
}

function normalizedStringSet(
	values: readonly string[] | undefined,
): Set<string> {
	return new Set(
		(values ?? [])
			.map((value) => value.trim())
			.filter((value) => value.length > 0),
	);
}

function validationCoverageForRisk(
	validationCoverage: readonly FinalReviewValidationCoverage[],
	riskClass: FinalReviewBehaviorRiskClass,
	commands: ReadonlySet<string>,
): FinalReviewValidationCoverage[] {
	return validationCoverage.filter(
		(item) =>
			commands.has(item.command.trim()) &&
			item.behaviorClasses.includes(riskClass),
	);
}

type BehaviorRefField =
	| "entrypointRefs"
	| "stateOwnerRefs"
	| "lifecycleOwnerRefs"
	| "testEvidenceRefs";

function reviewContextGroundingPaths(
	review: FinalReviewBehaviorCoverageTarget,
): Set<string> {
	const pack = review.reviewContextPack;
	return new Set([
		...declaredReviewScopePaths(review),
		...(pack?.changedFiles ?? []),
		...(pack?.includedContext.map((context) => context.path) ?? []),
		...(pack?.relationships.flatMap((relationship) => [
			relationship.from,
			relationship.to,
		]) ?? []),
	]);
}

function pathIsMentionedByValidationCommand(
	path: string,
	commands: ReadonlySet<string>,
): boolean {
	return [...commands].some((command) => command.includes(path));
}

function behaviorRefGroundingFailureReasons(
	worker: FinalReviewWorkerEvidence,
	review: FinalReviewBehaviorCoverageTarget,
): string[] {
	const reasons: string[] = [];
	const artifactPathSet = new Set(artifactPathsForWorker(worker));
	const contextPathSet = reviewContextGroundingPaths(review);
	const validationCommandSet = normalizedStringSet([
		...validationCommandsForWorker(worker),
		...(review.evidenceRefs?.validationCommands ?? []),
		...(review.reviewContextPack?.validationEvidence.map(
			(evidence) => evidence.command,
		) ?? []),
	]);
	const isGrounded = (ref: string) => {
		const path = pathForReviewArtifactRef(ref);
		return (
			artifactPathSet.has(path) ||
			contextPathSet.has(path) ||
			pathIsMentionedByValidationCommand(path, validationCommandSet)
		);
	};
	const checkRefList = (
		label: string,
		field: BehaviorRefField,
		refs: readonly string[],
	) => {
		for (const ref of refs) {
			if (!isSafeReviewArtifactRef(ref)) {
				reasons.push(
					`${label}.${field} includes '${ref}', which is not a safe relative path reference`,
				);
				continue;
			}
			if (!isGrounded(ref)) {
				reasons.push(
					`${label}.${field} includes '${ref}', which is not grounded by changed artifacts, reviewContextPack paths, or test evidence`,
				);
			}
		}
	};

	for (const [index, check] of (review.behaviorChecks ?? []).entries()) {
		const label = `behaviorChecks[${index}]`;
		checkRefList(label, "entrypointRefs", check.entrypointRefs);
		checkRefList(label, "stateOwnerRefs", check.stateOwnerRefs);
		checkRefList(label, "lifecycleOwnerRefs", check.lifecycleOwnerRefs);
		checkRefList(label, "testEvidenceRefs", check.testEvidenceRefs);
	}
	for (const [index, item] of (review.validationCoverage ?? []).entries()) {
		checkRefList(
			`validationCoverage[${index}]`,
			"testEvidenceRefs",
			item.testEvidenceRefs,
		);
	}

	return reasons;
}

export function behaviorValidationLedgerFailureReasons(
	recordedValidationCommands: readonly string[],
	review: BehaviorValidationLedgerTarget,
	requiredRisks: readonly FinalReviewBehaviorRiskClass[],
	options: {
		rejectNeedsFix?: boolean;
	} = {},
): string[] {
	const behaviorChecks = review.behaviorChecks ?? [];
	const validationCoverage = review.validationCoverage ?? [];
	const actualValidationCommandSet = normalizedStringSet(
		recordedValidationCommands,
	);
	const validationCoverageCommandSet = new Set(
		validationCoverage.map((item) => item.command.trim()),
	);
	const reviewRemainingGapSet = normalizedStringSet(review.remainingGaps);
	const validationCommandRefs = validationCommandRefsForReview(review);
	const reasons: string[] = [];

	const rejectNeedsFix = options.rejectNeedsFix ?? true;

	for (const [index, check] of behaviorChecks.entries()) {
		const label = `behaviorChecks[${index}]`;
		if (rejectNeedsFix && check.result === "needs_fix") {
			reasons.push(
				`${label} cannot use result needs_fix in an approved/passing final review`,
			);
		}
		for (const validationRef of check.validationRefs) {
			const command = validationRef.trim();
			if (!actualValidationCommandSet.has(command)) {
				reasons.push(
					`${label}.validationRefs includes '${validationRef}', which was not recorded in validationRun`,
				);
			}
		}
	}

	for (const [index, item] of validationCoverage.entries()) {
		const command = item.command.trim();
		if (!actualValidationCommandSet.has(command)) {
			reasons.push(
				`validationCoverage[${index}].command '${item.command}' was not recorded in validationRun`,
			);
		}
	}

	if (requiredRisks.length === 0) {
		return reasons;
	}

	const missingRisks = requiredRisks.filter(
		(riskClass) =>
			!behaviorChecks.some((check) => check.riskClass === riskClass),
	);
	if (missingRisks.length > 0) {
		reasons.push(
			`must account for required behavior risk classes: ${missingRisks.join(", ")}`,
		);
	}

	for (const riskClass of requiredRisks) {
		for (const [index, check] of behaviorChecks.entries()) {
			if (check.riskClass !== riskClass) {
				continue;
			}
			const label = `behaviorChecks[${index}] (${riskClass})`;
			const behaviorValidationCommandSet = normalizedStringSet([
				...validationCommandRefs,
				...check.validationRefs,
			]);
			for (const validationRef of check.validationRefs) {
				const command = validationRef.trim();
				if (
					command.length > 0 &&
					actualValidationCommandSet.has(command) &&
					!validationCoverageCommandSet.has(command)
				) {
					reasons.push(
						`${label}.validationRefs includes '${validationRef}', which is not mapped in validationCoverage`,
					);
				}
			}
			if (check.result === "passed") {
				if (!hasText(check.invariant)) {
					reasons.push(`${label} must include an invariant`);
				}
				if (!hasText(check.failurePath)) {
					reasons.push(`${label} must include a failurePath`);
				}
				if (
					check.entrypointRefs.length === 0 &&
					check.stateOwnerRefs.length === 0 &&
					check.lifecycleOwnerRefs.length === 0
				) {
					reasons.push(
						`${label} must include entrypointRefs, stateOwnerRefs, or lifecycleOwnerRefs`,
					);
				}
				if (
					check.testEvidenceRefs.length === 0 &&
					check.validationRefs.length === 0
				) {
					reasons.push(
						`${label} must include testEvidenceRefs or validationRefs`,
					);
				}
				const mappedCoverage = validationCoverageForRisk(
					validationCoverage,
					riskClass,
					behaviorValidationCommandSet,
				);
				if (mappedCoverage.length === 0) {
					reasons.push(
						`${label} passed must map ${riskClass} in validationCoverage`,
					);
				} else if (!mappedCoverage.some((item) => item.proves.length > 0)) {
					reasons.push(
						`${label} passed validationCoverage must include proves`,
					);
				}
			}
			if (check.result === "gap_recorded") {
				const remainingGap = check.remainingGap?.trim();
				if (!remainingGap) {
					reasons.push(`${label} gap_recorded must include remainingGap`);
				}
				if (!review.remainingGaps?.length) {
					reasons.push(
						`${label} gap_recorded must also list the gap in remainingGaps`,
					);
				} else if (remainingGap && !reviewRemainingGapSet.has(remainingGap)) {
					reasons.push(
						`${label} gap_recorded remainingGap must match an entry in remainingGaps`,
					);
				}
				if (
					!review.suggestedValidation?.length &&
					!review.reviewContextPack?.suggestedValidation.length
				) {
					reasons.push(
						`${label} gap_recorded must include suggestedValidation`,
					);
				}
				const mappedCoverage = validationCoverageForRisk(
					validationCoverage,
					riskClass,
					behaviorValidationCommandSet,
				);
				if (mappedCoverage.length === 0) {
					reasons.push(
						`${label} gap_recorded must map ${riskClass} in validationCoverage`,
					);
				} else if (!mappedCoverage.some((item) => item.gaps.length > 0)) {
					reasons.push(
						`${label} gap_recorded validationCoverage must include gaps`,
					);
				}
			}
			if (check.result === "not_applicable") {
				reasons.push(
					`${label} required behavior risk cannot use not_applicable; use passed or gap_recorded`,
				);
				if (!hasText(check.invariant)) {
					reasons.push(`${label} not_applicable must include an invariant`);
				}
				if (!hasText(check.failurePath)) {
					reasons.push(
						`${label} not_applicable must explain the failurePath boundary`,
					);
				}
			}
		}
	}

	const unmappedValidationRefs = validationCommandRefs.filter(
		(command) => !validationCoverageCommandSet.has(command),
	);
	if (unmappedValidationRefs.length > 0) {
		reasons.push(
			`must map evidenceRefs.validationCommands in validationCoverage when behavior risks are required: ${unmappedValidationRefs.join(", ")}`,
		);
	}

	return reasons;
}

export function suppliedFinalReviewBehaviorEvidenceFailureReasons(
	worker: FinalReviewWorkerEvidence,
	review: FinalReviewBehaviorCoverageTarget,
): string[] {
	return [
		...behaviorRefGroundingFailureReasons(worker, review),
		...behaviorValidationLedgerFailureReasons(
			validationCommandsForWorker(worker),
			review,
			[],
		),
	];
}

export function finalReviewBehaviorCoverageFailureReasons(
	worker: FinalReviewWorkerEvidence,
	review: FinalReviewBehaviorCoverageTarget,
): string[] {
	const requiredRisks = deriveRequiredFinalReviewBehaviorRisks(worker, review);
	const reasons: string[] = [
		...behaviorRefGroundingFailureReasons(worker, review),
		...behaviorValidationLedgerFailureReasons(
			validationCommandsForWorker(worker),
			review,
			requiredRisks,
		),
	];
	return reasons;
}
