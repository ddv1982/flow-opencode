import { describe, expect, test } from "bun:test";
import type { OrchestrationProposalV1 } from "../src/domain/orchestration-policy.js";
import { ORCHESTRATION_ADMISSION_POLICY_VERSION } from "../src/domain/orchestration-policy.js";
import {
	OrchestrationAdmissionCoordinator,
	OrchestrationAdmissionError,
	orchestrationPolicy,
} from "../src/platform/opencode/orchestration-admission.js";

function proposal(
	overrides: Partial<OrchestrationProposalV1> = {},
): OrchestrationProposalV1 {
	return {
		policyVersion: ORCHESTRATION_ADMISSION_POLICY_VERSION,
		proposalId: "discovery-1",
		passKind: "discovery",
		slices: [{ sliceId: "slice-1", scopeIds: ["scope-1"] }],
		targetClaimIds: [],
		verificationTier: "none",
		workerCount: 1,
		dependsOn: [],
		writeScope: "none",
		implementationAuthorized: false,
		waveIndex: 1,
		scope: "broad",
		reasonCodes: [],
		...overrides,
	};
}

function task(
	coordinator: OrchestrationAdmissionCoordinator,
	agent = "flow-evidence-worker",
	sessionID = "session-1",
) {
	return coordinator.observeToolBefore(
		{ tool: "task", callID: crypto.randomUUID(), sessionID },
		{ args: { subagent_type: agent, prompt: "private prompt" } },
	);
}

describe("runtime orchestration admission", () => {
	test("arms exactly the admitted number and class of worker dispatches", () => {
		const coordinator = new OrchestrationAdmissionCoordinator({
			policy: orchestrationPolicy({ profile: "standard", rollout: "enforce" }),
			randomId: () => "admission-1",
		});
		const decision = coordinator.evaluateAndArm(
			"session-1",
			proposal({
				workerCount: 2,
				slices: [
					{ sliceId: "slice-1", scopeIds: ["scope-1"] },
					{ sliceId: "slice-2", scopeIds: ["scope-2"] },
				],
			}),
		);
		expect(decision.admissionId).toBe("admission-1");
		expect(() => task(coordinator)).not.toThrow();
		expect(() => task(coordinator)).not.toThrow();
		expect(() => task(coordinator)).toThrow(OrchestrationAdmissionError);
	});

	test("enforce blocks denied proposals and unadmitted Flow workers", () => {
		const coordinator = new OrchestrationAdmissionCoordinator({
			policy: orchestrationPolicy({ profile: "standard", rollout: "enforce" }),
		});
		const decision = coordinator.evaluateAndArm(
			"session-1",
			proposal({
				passKind: "audit",
				proposalId: "audit-2",
				waveIndex: 2,
				scope: "broad",
				targetClaimIds: ["claim-1"],
				reasonCodes: ["blocking-impact"],
			}),
		);
		expect(decision.evaluation.recommendation).toBe("deny");
		expect(decision.admissionId).toBeNull();
		expect(() => task(coordinator, "flow-audit-worker")).toThrow(
			"requires a current admitted proposal",
		);
	});

	test("observe records would-deny but does not block the control dispatch", () => {
		const coordinator = new OrchestrationAdmissionCoordinator({
			policy: orchestrationPolicy({ profile: "standard", rollout: "observe" }),
		});
		const decision = coordinator.evaluateAndArm(
			"session-1",
			proposal({
				passKind: "audit",
				proposalId: "audit-2",
				waveIndex: 2,
				scope: "broad",
				targetClaimIds: ["claim-1"],
				reasonCodes: ["blocking-impact"],
			}),
		);
		expect(decision.evaluation).toMatchObject({
			recommendation: "observe",
			admitted: true,
			wouldDeny: true,
		});
		expect(() => task(coordinator, "flow-audit-worker")).not.toThrow();
		expect(coordinator.report()).toMatchObject({
			wouldDeny: 1,
			admittedWorkerDispatches: 1,
		});
	});

	test("maps explicit control to nonblocking standard evaluation", () => {
		expect(
			orchestrationPolicy({ profile: "control", rollout: "enforce" }),
		).toEqual({ version: 1, profile: "standard", rollout: "control" });
	});

	test("rejects a worker class different from the admitted pass", () => {
		const coordinator = new OrchestrationAdmissionCoordinator({
			policy: orchestrationPolicy({ profile: "assurance", rollout: "enforce" }),
		});
		coordinator.evaluateAndArm(
			"session-1",
			proposal({
				proposalId: "audit-1",
				passKind: "audit",
			}),
		);
		expect(() => task(coordinator, "flow-evidence-worker")).toThrow(
			"expected flow-audit-worker",
		);
	});

	test("does not govern non-Flow tasks", () => {
		const coordinator = new OrchestrationAdmissionCoordinator({
			policy: orchestrationPolicy({ profile: "standard", rollout: "enforce" }),
		});
		expect(() => task(coordinator, "general")).not.toThrow();
		expect(coordinator.report().unadmittedFlowWorkerDispatches).toBe(0);
	});

	test("expires bounded pending admissions", () => {
		let now = 0;
		const coordinator = new OrchestrationAdmissionCoordinator({
			policy: orchestrationPolicy({ profile: "standard", rollout: "enforce" }),
			now: () => now,
			admissionTtlMs: 10,
		});
		coordinator.evaluateAndArm("session-1", proposal());
		now = 11;
		expect(() => task(coordinator)).toThrow(
			"requires a current admitted proposal",
		);
	});
});
