type ReviewFindingClosureEvidence = {
	findingRef: string;
	status: string;
	fixRefs?: readonly string[];
	testRefs?: readonly string[];
	validationRefs?: readonly string[];
};

type ReviewFindingClosureValidationContext = {
	plannedFindingRefs?: readonly string[];
	closedFindingRefsForCompletion?: readonly string[];
	validationCommands: readonly string[];
	requireEveryPlannedFinding?: boolean;
};

function normalizedNonEmpty(values: readonly string[] = []): string[] {
	return values.map((value) => value.trim()).filter(Boolean);
}

export function describeReviewFindingClosureLedgerFailure(
	closures: readonly ReviewFindingClosureEvidence[],
	context: ReviewFindingClosureValidationContext,
): string | null {
	if (closures.length === 0) {
		return "Worker result cannot complete review-and-fix work without reviewFindingClosures evidence.";
	}

	const validationCommands = new Set(
		normalizedNonEmpty(context.validationCommands),
	);
	for (const [index, closure] of closures.entries()) {
		const label = `reviewFindingClosures[${index}]`;
		if (closure.status !== "closed") {
			return `Worker result cannot complete review-and-fix work while ${label} is '${closure.status}'. Return needs_input or continue fixing until every finding is closed.`;
		}
		if (normalizedNonEmpty(closure.fixRefs).length === 0) {
			return `Worker result cannot close ${label} without fixRefs evidence.`;
		}
		if (normalizedNonEmpty(closure.testRefs).length === 0) {
			return `Worker result cannot close ${label} without testRefs evidence.`;
		}
		const validationRefs = normalizedNonEmpty(closure.validationRefs);
		if (validationRefs.length === 0) {
			return `Worker result cannot close ${label} without validationRefs evidence.`;
		}
		for (const validationRef of validationRefs) {
			if (!validationCommands.has(validationRef)) {
				return `Worker result cannot complete because ${label}.validationRefs includes '${validationRef}', which was not recorded in validationRun.`;
			}
		}
	}

	if (!context.requireEveryPlannedFinding) {
		return null;
	}

	const plannedFindingRefs = normalizedNonEmpty(context.plannedFindingRefs);
	if (plannedFindingRefs.length === 0) {
		return null;
	}
	const closedFindingRefs = new Set(
		normalizedNonEmpty(context.closedFindingRefsForCompletion),
	);
	const missingFindingRefs = plannedFindingRefs.filter(
		(findingRef) => !closedFindingRefs.has(findingRef),
	);
	if (missingFindingRefs.length === 0) {
		return null;
	}

	return `Worker result cannot complete review-and-fix work until every planning.reviewFindings item is closed in reviewFindingClosures. Missing closures: ${missingFindingRefs.join(", ")}.`;
}
