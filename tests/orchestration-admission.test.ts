import { describe, expect, test } from "bun:test";
import type {
	OrchestrationAdmissionEvaluationV1,
	OrchestrationAdmissionPolicyV1,
	OrchestrationAdmissionReasonCode,
	OrchestrationProposalSliceV1,
	OrchestrationProposalV1,
} from "../src/domain/orchestration-policy.js";
import {
	evaluateOrchestrationProposal,
	ORCHESTRATION_ADMISSION_POLICY_VERSION,
} from "../src/domain/orchestration-policy.js";

function slices(count: number): OrchestrationProposalSliceV1[] {
	return Array.from({ length: count }, (_, index) => ({
		sliceId: `slice-${index + 1}`,
		scopeIds: [`scope-${index + 1}`],
	}));
}

function policy(
	overrides: Partial<OrchestrationAdmissionPolicyV1> = {},
): OrchestrationAdmissionPolicyV1 {
	return {
		version: ORCHESTRATION_ADMISSION_POLICY_VERSION,
		profile: "standard",
		rollout: "enforce",
		...overrides,
	};
}

function proposal(
	overrides: Partial<OrchestrationProposalV1> = {},
): OrchestrationProposalV1 {
	const workerCount = overrides.workerCount ?? 1;
	return {
		policyVersion: ORCHESTRATION_ADMISSION_POLICY_VERSION,
		proposalId: "discovery-1",
		passKind: "discovery",
		slices: slices(workerCount),
		targetClaimIds: [],
		verificationTier: "none",
		workerCount,
		dependsOn: [],
		writeScope: "none",
		implementationAuthorized: false,
		waveIndex: 1,
		scope: "broad",
		reasonCodes: [],
		...overrides,
	};
}

function codes(
	evaluation: OrchestrationAdmissionEvaluationV1,
): OrchestrationAdmissionReasonCode[] {
	return evaluation.reasons.map(({ code }) => code);
}

describe("orchestration proposal admission", () => {
	test("allows a bounded standard first discovery wave", () => {
		const evaluation = evaluateOrchestrationProposal(
			policy(),
			proposal({ workerCount: 2, slices: slices(2) }),
		);
		const oversized = evaluateOrchestrationProposal(
			policy(),
			proposal({ workerCount: 3, slices: slices(3) }),
		);

		expect(evaluation).toMatchObject({
			recommendation: "allow",
			admitted: true,
			wouldDeny: false,
			reasons: [],
		});
		expect(codes(oversized)).toEqual(["standard-worker-limit"]);
	});

	test("denies a broad second audit wave even when it has a justification", () => {
		const evaluation = evaluateOrchestrationProposal(
			policy(),
			proposal({
				proposalId: "audit-2",
				passKind: "audit",
				waveIndex: 2,
				scope: "broad",
				targetClaimIds: ["claim-authz"],
				reasonCodes: ["blocking-impact"],
			}),
		);

		expect(codes(evaluation)).toEqual(["broad-follow-up"]);
		expect(evaluation.recommendation).toBe("deny");
	});

	test("allows a justified claim-scoped follow-up audit", () => {
		const evaluation = evaluateOrchestrationProposal(
			policy(),
			proposal({
				proposalId: "audit-2",
				passKind: "audit",
				waveIndex: 2,
				scope: "targeted",
				targetClaimIds: ["claim-authz", "claim-recovery"],
				reasonCodes: ["contested", "cross-layer-gap"],
				workerCount: 2,
				slices: slices(2),
			}),
		);

		expect(evaluation.recommendation).toBe("allow");
		expect(evaluation.reasons).toEqual([]);
	});

	test("rejects an ungrounded targeted follow-up", () => {
		const evaluation = evaluateOrchestrationProposal(
			policy(),
			proposal({
				proposalId: "audit-2",
				passKind: "audit",
				waveIndex: 2,
				scope: "targeted",
				targetClaimIds: [],
				reasonCodes: ["low-confidence"],
			}),
		);

		expect(codes(evaluation)).toEqual(["follow-up-target-required"]);
	});

	test("allows five read-only workers only for the assurance broad first wave", () => {
		const firstWave = evaluateOrchestrationProposal(
			policy({ profile: "assurance" }),
			proposal({
				proposalId: "assurance-audit-1",
				passKind: "audit",
				workerCount: 5,
				slices: slices(5),
			}),
		);
		const targetedWave = evaluateOrchestrationProposal(
			policy({ profile: "assurance" }),
			proposal({
				proposalId: "assurance-audit-2",
				passKind: "audit",
				workerCount: 3,
				slices: slices(3),
				waveIndex: 2,
				scope: "targeted",
				targetClaimIds: ["claim-authz"],
				reasonCodes: ["single-source"],
			}),
		);

		expect(firstWave.recommendation).toBe("allow");
		expect(codes(targetedWave)).toEqual(["assurance-worker-limit"]);
	});

	test("keeps an assurance second wave claim-scoped", () => {
		const broad = evaluateOrchestrationProposal(
			policy({ profile: "assurance" }),
			proposal({
				proposalId: "assurance-audit-2",
				passKind: "audit",
				waveIndex: 2,
				scope: "broad",
				targetClaimIds: ["claim-authz"],
				reasonCodes: ["blocking-impact"],
			}),
		);
		const targeted = evaluateOrchestrationProposal(
			policy({ profile: "assurance" }),
			proposal({
				proposalId: "assurance-audit-2",
				passKind: "audit",
				waveIndex: 2,
				scope: "targeted",
				targetClaimIds: ["claim-authz"],
				reasonCodes: ["blocking-impact"],
			}),
		);

		expect(codes(broad)).toEqual(["broad-follow-up"]);
		expect(targeted.recommendation).toBe("allow");
	});

	test("requires explicit authorization for candidate implementation", () => {
		const candidate = proposal({
			proposalId: "candidate-1",
			passKind: "candidate-implementation",
			scope: "targeted",
			writeScope: "exact-path",
		});
		const unauthorized = evaluateOrchestrationProposal(policy(), candidate);
		const authorized = evaluateOrchestrationProposal(policy(), {
			...candidate,
			implementationAuthorized: true,
		});

		expect(codes(unauthorized)).toEqual(["candidate-authorization-required"]);
		expect(authorized.recommendation).toBe("allow");
	});

	test("rejects writes from read-only passes and concurrent candidate writes", () => {
		const readOnly = evaluateOrchestrationProposal(
			policy(),
			proposal({ writeScope: "exact-path" }),
		);
		const concurrentCandidate = evaluateOrchestrationProposal(
			policy(),
			proposal({
				proposalId: "candidate-1",
				passKind: "candidate-implementation",
				implementationAuthorized: true,
				scope: "targeted",
				writeScope: "isolated-worktree",
				workerCount: 2,
				slices: slices(2),
			}),
		);

		expect(codes(readOnly)).toEqual(["read-only-write-scope"]);
		expect(codes(concurrentCandidate)).toEqual(["concurrent-write-scope"]);
	});

	test("allows one claim-scoped verifier after synthesis", () => {
		const verifier = proposal({
			proposalId: "verification-2",
			passKind: "verification",
			waveIndex: 2,
			scope: "targeted",
			targetClaimIds: ["claim-authz"],
			reasonCodes: ["contested"],
			verificationTier: "post-synthesis",
			dependsOn: ["synthesis-1"],
		});

		expect(
			evaluateOrchestrationProposal(policy(), verifier).recommendation,
		).toBe("allow");
		expect(
			codes(
				evaluateOrchestrationProposal(policy(), {
					...verifier,
					workerCount: 2,
					slices: slices(2),
				}),
			),
		).toEqual(["verification-worker-limit"]);
	});

	test("separates observe, enforce, and control rollout behavior", () => {
		const invalid = proposal({
			proposalId: "audit-2",
			passKind: "audit",
			waveIndex: 2,
			scope: "broad",
			targetClaimIds: ["claim-authz"],
			reasonCodes: ["blocking-impact"],
		});
		const enforce = evaluateOrchestrationProposal(policy(), invalid);
		const observe = evaluateOrchestrationProposal(
			policy({ rollout: "observe" }),
			invalid,
		);
		const control = evaluateOrchestrationProposal(
			policy({ rollout: "control" }),
			invalid,
		);

		expect(enforce).toMatchObject({
			recommendation: "deny",
			admitted: false,
			wouldDeny: true,
		});
		expect(observe).toMatchObject({
			recommendation: "observe",
			admitted: true,
			wouldDeny: true,
		});
		expect(control).toMatchObject({
			recommendation: "allow",
			admitted: true,
			wouldDeny: true,
		});
		expect(codes(enforce)).toEqual(codes(observe));
		expect(codes(observe)).toEqual(codes(control));
	});

	test("reports structural failures once in deterministic reason order", () => {
		const structuralSlices = [
			{ sliceId: "slice-a", scopeIds: ["scope-shared"] },
			{ sliceId: "slice-a", scopeIds: ["scope-shared"] },
			{ sliceId: "slice-empty", scopeIds: [] },
		];
		const malformed = proposal({
			proposalId: "discovery-1",
			workerCount: 3,
			slices: structuralSlices,
			dependsOn: ["discovery-1", "discovery-1"],
		});
		const first = evaluateOrchestrationProposal(
			policy({ profile: "assurance" }),
			malformed,
		);
		const second = evaluateOrchestrationProposal(
			policy({ profile: "assurance" }),
			{
				...malformed,
				slices: [...structuralSlices].reverse(),
				dependsOn: [...malformed.dependsOn].reverse(),
			},
		);

		expect(first).toEqual(second);
		expect(codes(first)).toEqual([
			"duplicate-slice-id",
			"empty-scope",
			"overlapping-scope",
			"duplicate-dependency",
			"dependency-self-reference",
		]);
	});
});
