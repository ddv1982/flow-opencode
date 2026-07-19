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

export const ORCHESTRATION_ADMISSION_POLICY_VERSION = 1 as const;

export type OrchestrationAdmissionProfile = "standard" | "assurance";

export type OrchestrationAdmissionRollout = "control" | "observe" | "enforce";

export type OrchestrationAdmissionPolicyV1 = {
	version: typeof ORCHESTRATION_ADMISSION_POLICY_VERSION;
	profile: OrchestrationAdmissionProfile;
	rollout: OrchestrationAdmissionRollout;
};

export type OrchestrationProposalPassKind =
	| "discovery"
	| "audit"
	| "verification"
	| "candidate-implementation";

export type OrchestrationProposalScope = "broad" | "targeted";

export type OrchestrationProposalVerificationTier =
	| "none"
	| "claim-scoped"
	| "post-synthesis";

export type OrchestrationProposalWriteScope =
	| "none"
	| "manager-serial"
	| "exact-path"
	| "isolated-worktree"
	| "mixed";

export type OrchestrationFollowupReasonCode =
	| "blocking-impact"
	| "contested"
	| "low-confidence"
	| "single-source"
	| "cross-layer-gap";

export type OrchestrationProposalSliceV1 = {
	sliceId: string;
	scopeIds: readonly string[];
};

export type OrchestrationProposalV1 = {
	policyVersion: typeof ORCHESTRATION_ADMISSION_POLICY_VERSION;
	proposalId: string;
	passKind: OrchestrationProposalPassKind;
	slices: readonly OrchestrationProposalSliceV1[];
	targetClaimIds: readonly string[];
	verificationTier: OrchestrationProposalVerificationTier;
	workerCount: number;
	dependsOn: readonly string[];
	writeScope: OrchestrationProposalWriteScope;
	implementationAuthorized: boolean;
	waveIndex: number;
	scope: OrchestrationProposalScope;
	reasonCodes: readonly OrchestrationFollowupReasonCode[];
};

export type OrchestrationAdmissionReasonCode =
	| "policy-version-mismatch"
	| "invalid-proposal-id"
	| "invalid-wave-index"
	| "invalid-worker-count"
	| "invalid-slice-id"
	| "duplicate-slice-id"
	| "empty-scope"
	| "invalid-scope-id"
	| "overlapping-scope"
	| "worker-slice-mismatch"
	| "invalid-target-claim-id"
	| "duplicate-target-claim-id"
	| "invalid-dependency-id"
	| "duplicate-dependency"
	| "dependency-self-reference"
	| "standard-worker-limit"
	| "assurance-worker-limit"
	| "read-only-write-scope"
	| "concurrent-write-scope"
	| "standard-broad-pass-kind"
	| "broad-follow-up"
	| "recursive-discovery"
	| "follow-up-target-required"
	| "follow-up-reason-required"
	| "verification-worker-limit"
	| "verification-after-synthesis-required"
	| "verification-tier-required"
	| "candidate-authorization-required"
	| "candidate-targeted-scope-required"
	| "candidate-write-scope-required";

export type OrchestrationAdmissionReason = {
	code: OrchestrationAdmissionReasonCode;
	path: string;
	message: string;
};

export type OrchestrationAdmissionRecommendation = "allow" | "deny" | "observe";

export type OrchestrationAdmissionEvaluationV1 = {
	version: typeof ORCHESTRATION_ADMISSION_POLICY_VERSION;
	profile: OrchestrationAdmissionProfile;
	rollout: OrchestrationAdmissionRollout;
	recommendation: OrchestrationAdmissionRecommendation;
	admitted: boolean;
	wouldDeny: boolean;
	reasons: readonly OrchestrationAdmissionReason[];
};

const ADMISSION_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

const ADMISSION_REASON_DETAILS = {
	"policy-version-mismatch": {
		path: "policyVersion",
		message:
			"The proposal policyVersion must match the active admission policy.",
	},
	"invalid-proposal-id": {
		path: "proposalId",
		message: "proposalId must be a stable orchestration identifier.",
	},
	"invalid-wave-index": {
		path: "waveIndex",
		message: "waveIndex must identify the first or second bounded wave.",
	},
	"invalid-worker-count": {
		path: "workerCount",
		message: "workerCount must be a positive safe integer.",
	},
	"invalid-slice-id": {
		path: "slices",
		message: "Every sliceId must be a stable orchestration identifier.",
	},
	"duplicate-slice-id": {
		path: "slices",
		message: "A proposal cannot contain duplicate sliceIds.",
	},
	"empty-scope": {
		path: "slices",
		message: "Every worker slice must name at least one stable scopeId.",
	},
	"invalid-scope-id": {
		path: "slices",
		message: "Every scopeId must be a stable orchestration identifier.",
	},
	"overlapping-scope": {
		path: "slices",
		message: "ScopeIds cannot overlap within or across worker slices.",
	},
	"worker-slice-mismatch": {
		path: "slices",
		message:
			"Each concurrent worker must have exactly one explicit scope slice.",
	},
	"invalid-target-claim-id": {
		path: "targetClaimIds",
		message: "Every target claim must use a stable claim identifier.",
	},
	"duplicate-target-claim-id": {
		path: "targetClaimIds",
		message: "A proposal cannot target the same claim more than once.",
	},
	"invalid-dependency-id": {
		path: "dependsOn",
		message: "Every dependency must be a stable orchestration identifier.",
	},
	"duplicate-dependency": {
		path: "dependsOn",
		message: "A proposal cannot contain duplicate dependencies.",
	},
	"dependency-self-reference": {
		path: "dependsOn",
		message: "A proposal cannot depend on itself.",
	},
	"standard-worker-limit": {
		path: "workerCount",
		message:
			"The standard profile permits at most two concurrent read-only workers.",
	},
	"assurance-worker-limit": {
		path: "workerCount",
		message:
			"The assurance profile permits at most five first-wave broad workers and two targeted workers.",
	},
	"read-only-write-scope": {
		path: "writeScope",
		message: "Discovery, audit, and verification proposals must be read-only.",
	},
	"concurrent-write-scope": {
		path: "workerCount",
		message: "Writable candidate implementation must remain serial.",
	},
	"standard-broad-pass-kind": {
		path: "passKind",
		message:
			"The standard profile reserves its single broad first wave for discovery.",
	},
	"broad-follow-up": {
		path: "scope",
		message: "A second wave must be claim-scoped rather than broad.",
	},
	"recursive-discovery": {
		path: "passKind",
		message: "Discovery cannot recursively launch a follow-up wave.",
	},
	"follow-up-target-required": {
		path: "targetClaimIds",
		message:
			"Follow-up audit and verification must name at least one target claim.",
	},
	"follow-up-reason-required": {
		path: "reasonCodes",
		message:
			"Follow-up audit and verification require blocking, contested, confidence, source, or cross-layer justification.",
	},
	"verification-worker-limit": {
		path: "workerCount",
		message: "Post-synthesis verification uses exactly one verifier.",
	},
	"verification-after-synthesis-required": {
		path: "dependsOn",
		message:
			"Verification must be a second-wave pass with a synthesis dependency.",
	},
	"verification-tier-required": {
		path: "verificationTier",
		message: "Verification must use the post-synthesis verification tier.",
	},
	"candidate-authorization-required": {
		path: "implementationAuthorized",
		message:
			"Candidate implementation requires explicit implementation authorization.",
	},
	"candidate-targeted-scope-required": {
		path: "scope",
		message: "Candidate implementation must use targeted scope.",
	},
	"candidate-write-scope-required": {
		path: "writeScope",
		message: "Candidate implementation must declare its write isolation scope.",
	},
} as const satisfies Readonly<
	Record<OrchestrationAdmissionReasonCode, { path: string; message: string }>
>;

const ADMISSION_REASON_ORDER = Object.keys(
	ADMISSION_REASON_DETAILS,
) as OrchestrationAdmissionReasonCode[];

const FOLLOWUP_REASON_CODES: ReadonlySet<string> = new Set([
	"blocking-impact",
	"contested",
	"low-confidence",
	"single-source",
	"cross-layer-gap",
]);

function isAdmissionIdentifier(value: string): boolean {
	return ADMISSION_IDENTIFIER.test(value);
}

export function evaluateOrchestrationProposal(
	policy: OrchestrationAdmissionPolicyV1,
	proposal: OrchestrationProposalV1,
): OrchestrationAdmissionEvaluationV1 {
	const found = new Set<OrchestrationAdmissionReasonCode>();
	const add = (code: OrchestrationAdmissionReasonCode): void => {
		found.add(code);
	};

	if (proposal.policyVersion !== policy.version) {
		add("policy-version-mismatch");
	}
	if (!isAdmissionIdentifier(proposal.proposalId)) {
		add("invalid-proposal-id");
	}
	if (
		!Number.isSafeInteger(proposal.waveIndex) ||
		proposal.waveIndex < 1 ||
		proposal.waveIndex > 2
	) {
		add("invalid-wave-index");
	}
	if (!Number.isSafeInteger(proposal.workerCount) || proposal.workerCount < 1) {
		add("invalid-worker-count");
	}
	if (proposal.slices.length !== proposal.workerCount) {
		add("worker-slice-mismatch");
	}

	const sliceIds = new Set<string>();
	const scopeIds = new Set<string>();
	if (proposal.slices.length === 0) add("empty-scope");
	for (const slice of proposal.slices) {
		if (!isAdmissionIdentifier(slice.sliceId)) add("invalid-slice-id");
		if (sliceIds.has(slice.sliceId)) add("duplicate-slice-id");
		sliceIds.add(slice.sliceId);
		if (slice.scopeIds.length === 0) add("empty-scope");
		for (const scopeId of slice.scopeIds) {
			if (!isAdmissionIdentifier(scopeId)) add("invalid-scope-id");
			if (scopeIds.has(scopeId)) add("overlapping-scope");
			scopeIds.add(scopeId);
		}
	}

	const targetClaimIds = new Set<string>();
	let groundedTargetCount = 0;
	for (const targetClaimId of proposal.targetClaimIds) {
		if (!isAdmissionIdentifier(targetClaimId)) {
			add("invalid-target-claim-id");
		} else {
			groundedTargetCount += 1;
		}
		if (targetClaimIds.has(targetClaimId)) add("duplicate-target-claim-id");
		targetClaimIds.add(targetClaimId);
	}

	const dependencies = new Set<string>();
	for (const dependency of proposal.dependsOn) {
		if (!isAdmissionIdentifier(dependency)) add("invalid-dependency-id");
		if (dependencies.has(dependency)) add("duplicate-dependency");
		if (dependency === proposal.proposalId) add("dependency-self-reference");
		dependencies.add(dependency);
	}

	const isCandidateImplementation =
		proposal.passKind === "candidate-implementation";
	if (isCandidateImplementation) {
		if (!proposal.implementationAuthorized) {
			add("candidate-authorization-required");
		}
		if (proposal.scope !== "targeted") {
			add("candidate-targeted-scope-required");
		}
		if (proposal.writeScope === "none") {
			add("candidate-write-scope-required");
		}
		if (proposal.workerCount > 1) add("concurrent-write-scope");
	} else {
		if (proposal.writeScope !== "none") add("read-only-write-scope");
		if (policy.profile === "standard" && proposal.workerCount > 2) {
			add("standard-worker-limit");
		}
		const assuranceWorkerLimit =
			proposal.waveIndex === 1 && proposal.scope === "broad" ? 5 : 2;
		if (
			policy.profile === "assurance" &&
			proposal.workerCount > assuranceWorkerLimit
		) {
			add("assurance-worker-limit");
		}
	}

	if (
		policy.profile === "standard" &&
		proposal.waveIndex === 1 &&
		proposal.scope === "broad" &&
		proposal.passKind !== "discovery"
	) {
		add("standard-broad-pass-kind");
	}
	if (proposal.waveIndex > 1 && proposal.scope === "broad") {
		add("broad-follow-up");
	}
	if (proposal.waveIndex > 1 && proposal.passKind === "discovery") {
		add("recursive-discovery");
	}

	const isFollowupAuditOrVerification =
		proposal.waveIndex > 1 &&
		(proposal.passKind === "audit" || proposal.passKind === "verification");
	if (isFollowupAuditOrVerification) {
		if (groundedTargetCount === 0) add("follow-up-target-required");
		if (
			!proposal.reasonCodes.some((reason) => FOLLOWUP_REASON_CODES.has(reason))
		) {
			add("follow-up-reason-required");
		}
	}

	if (proposal.passKind === "verification") {
		if (proposal.workerCount !== 1) add("verification-worker-limit");
		if (proposal.waveIndex !== 2 || proposal.dependsOn.length === 0) {
			add("verification-after-synthesis-required");
		}
		if (proposal.verificationTier !== "post-synthesis") {
			add("verification-tier-required");
		}
	}

	const reasons = ADMISSION_REASON_ORDER.flatMap((code) => {
		if (!found.has(code)) return [];
		return [{ code, ...ADMISSION_REASON_DETAILS[code] }];
	});
	const wouldDeny = reasons.length > 0;
	const recommendation: OrchestrationAdmissionRecommendation = wouldDeny
		? policy.rollout === "enforce"
			? "deny"
			: policy.rollout === "observe"
				? "observe"
				: "allow"
		: "allow";

	return {
		version: ORCHESTRATION_ADMISSION_POLICY_VERSION,
		profile: policy.profile,
		rollout: policy.rollout,
		recommendation,
		admitted: recommendation !== "deny",
		wouldDeny,
		reasons,
	};
}

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
