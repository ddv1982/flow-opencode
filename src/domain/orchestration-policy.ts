export type OrchestrationPassEvidence = {
	kind: string;
	decision?: string | undefined;
	candidateEligibility: string;
	candidateDecision?: string | undefined;
	decisionFactors: readonly string[];
	modes: readonly string[];
	workerCount: number;
	candidateWorkerCount: number;
	verifierWorkerCount: number;
};

export type OrchestrationPolicyIssue = {
	path: string;
	message: string;
};

const CANDIDATE_SHAPED_DECISIONS: ReadonlySet<string> = new Set([
	"candidate-exact-path",
	"candidate-worktree",
	"tournament",
]);

export function isCandidateShapedDecision(
	decision: string | undefined,
): boolean {
	return decision !== undefined && CANDIDATE_SHAPED_DECISIONS.has(decision);
}

export function hasCandidateExecutionEvidence(pass: {
	kind: string;
	modes: readonly string[];
	candidateWorkerCount: number;
}): boolean {
	return (
		pass.kind === "candidate" ||
		pass.modes.includes("candidate-implementation") ||
		pass.candidateWorkerCount > 0
	);
}

export function hasVerifierExecutionEvidence(pass: {
	kind: string;
	modes: readonly string[];
	verifierWorkerCount: number;
}): boolean {
	return (
		pass.kind === "verification" ||
		pass.modes.includes("verifier") ||
		pass.verifierWorkerCount > 0
	);
}

export function validateOrchestrationPassPolicy(
	value: OrchestrationPassEvidence,
): OrchestrationPolicyIssue[] {
	const issues: OrchestrationPolicyIssue[] = [];
	const issue = (path: string, message: string): void => {
		issues.push({ path, message });
	};
	const isImplementationDecision = value.kind === "implementation-decision";
	const candidateEligibilityIsUnknown =
		value.candidateEligibility === "unknown";

	if (value.candidateWorkerCount > value.workerCount) {
		issue(
			"candidateWorkerCount",
			"candidateWorkerCount cannot exceed total workerCount.",
		);
	}
	if (value.verifierWorkerCount > value.workerCount) {
		issue(
			"verifierWorkerCount",
			"verifierWorkerCount cannot exceed total workerCount.",
		);
	}
	if (
		isCandidateShapedDecision(value.decision) &&
		!hasCandidateExecutionEvidence(value)
	) {
		issue(
			"decision",
			"Candidate-shaped decisions require candidate execution evidence: a candidate pass, candidate-implementation mode, or candidateWorkerCount > 0.",
		);
	}
	if (isImplementationDecision) {
		if (value.decision === "parallel") {
			issue(
				"decision",
				"Implementation decisions cannot use decision 'parallel'; use 'serial', 'skipped', or a candidate-shaped decision.",
			);
		}
		if (candidateEligibilityIsUnknown) {
			issue(
				"candidateEligibility",
				"Implementation decisions must include explicit candidateEligibility.",
			);
		}
		if (!value.candidateDecision) {
			issue(
				"candidateDecision",
				"Implementation decisions must include explicit candidateDecision.",
			);
		}
		if (!value.decision) {
			issue(
				"decision",
				"Implementation decisions must include explicit decision.",
			);
		}
		if (value.decisionFactors.length === 0) {
			issue(
				"decisionFactors",
				"Implementation decisions must include at least one decisionFactor.",
			);
		}
	}
	if (!value.candidateDecision) return issues;
	if (!isImplementationDecision && candidateEligibilityIsUnknown) {
		issue(
			"candidateEligibility",
			"Candidate eligibility must be explicit when candidateDecision is set.",
		);
	}
	if (
		!isImplementationDecision &&
		(value.candidateDecision === "skipped" ||
			value.candidateDecision === "serial_required")
	) {
		issue(
			"candidateDecision",
			"Candidate decisions 'skipped' and 'serial_required' are only valid on implementation-decision records.",
		);
	}
	if (
		value.candidateEligibility === "not_eligible" &&
		value.candidateDecision === "used"
	) {
		issue(
			"candidateDecision",
			"Candidate decision 'used' requires eligible candidate work.",
		);
	}
	if (
		value.candidateEligibility === "eligible" &&
		value.candidateDecision === "serial_required"
	) {
		issue(
			"candidateDecision",
			"Candidate decision 'serial_required' requires not_eligible candidate work.",
		);
	}
	if (
		value.candidateDecision === "skipped" &&
		value.candidateEligibility !== "eligible"
	) {
		issue(
			"candidateDecision",
			"Candidate decision 'skipped' requires eligible candidate work.",
		);
	}
	if (
		isImplementationDecision &&
		value.decision === "skipped" &&
		value.candidateDecision !== "skipped"
	) {
		issue(
			"decision",
			"Implementation decision 'skipped' requires candidateDecision 'skipped'.",
		);
	}
	if (
		isImplementationDecision &&
		value.candidateDecision === "skipped" &&
		value.decision &&
		value.decision !== "skipped"
	) {
		issue(
			"candidateDecision",
			"Candidate decision 'skipped' requires implementation decision 'skipped'.",
		);
	}
	if (
		isImplementationDecision &&
		value.candidateDecision === "serial_required" &&
		value.decision &&
		value.decision !== "serial"
	) {
		issue(
			"candidateDecision",
			"Candidate decision 'serial_required' requires implementation decision 'serial'.",
		);
	}
	if (value.candidateDecision === "used") {
		if (!hasCandidateExecutionEvidence(value)) {
			issue(
				"candidateDecision",
				"Candidate decision 'used' requires a candidate pass, candidate mode, or candidate worker count.",
			);
		}
		if (value.decision && !isCandidateShapedDecision(value.decision)) {
			issue(
				"decision",
				"Candidate decision 'used' requires an omitted or candidate-shaped decision.",
			);
		}
	}
	return issues;
}
