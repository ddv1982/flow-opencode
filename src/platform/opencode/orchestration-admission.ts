import { randomUUID } from "node:crypto";
import {
	evaluateOrchestrationProposal,
	ORCHESTRATION_ADMISSION_POLICY_VERSION,
	type OrchestrationAdmissionEvaluationV1,
	type OrchestrationAdmissionPolicyV1,
	type OrchestrationProposalPassKind,
	type OrchestrationProposalV1,
} from "../../domain/orchestration-policy.js";
import type { Hooks } from "./sdk.js";

const DEFAULT_ADMISSION_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_MAX_PENDING_ADMISSIONS = 128;

const FLOW_AGENT_FOR_PASS = {
	discovery: "flow-evidence-worker",
	audit: "flow-audit-worker",
	verification: "flow-verifier-worker",
	"candidate-implementation": "flow-candidate-worker",
} as const satisfies Record<OrchestrationProposalPassKind, string>;

const FLOW_WORKER_AGENTS: ReadonlySet<string> = new Set(
	Object.values(FLOW_AGENT_FOR_PASS),
);

type PendingAdmission = {
	admissionId: string;
	proposalId: string;
	expectedAgent: string;
	remainingWorkers: number;
	expiresAt: number;
};

export type OrchestrationAdmissionCoordinatorOptions = {
	policy: OrchestrationAdmissionPolicyV1;
	now?: () => number;
	randomId?: () => string;
	maxPendingAdmissions?: number;
	admissionTtlMs?: number;
};

export type OrchestrationAdmissionDecision = {
	evaluation: OrchestrationAdmissionEvaluationV1;
	admissionId: string | null;
	expiresAt: string | null;
};

export type OrchestrationAdmissionRuntimeReport = {
	schemaVersion: 1;
	profile: OrchestrationAdmissionPolicyV1["profile"];
	rollout: OrchestrationAdmissionPolicyV1["rollout"];
	proposals: number;
	allowed: number;
	wouldDeny: number;
	denied: number;
	admittedWorkerDispatches: number;
	unadmittedFlowWorkerDispatches: number;
};

type ToolBeforeInput = Parameters<NonNullable<Hooks["tool.execute.before"]>>[0];
type ToolBeforeOutput = Parameters<
	NonNullable<Hooks["tool.execute.before"]>
>[1];

export class OrchestrationAdmissionError extends Error {
	readonly code = "FLOW_ORCHESTRATION_ADMISSION";
}

function taskAgent(args: unknown): string | null {
	if (!args || typeof args !== "object") return null;
	const record = args as Record<string, unknown>;
	for (const key of ["subagent_type", "agent"] as const) {
		if (typeof record[key] === "string") return record[key];
	}
	return null;
}

export function orchestrationPolicy(options: {
	profile: "control" | "standard" | "assurance";
	rollout: "control" | "observe" | "enforce";
}): OrchestrationAdmissionPolicyV1 {
	return {
		version: ORCHESTRATION_ADMISSION_POLICY_VERSION,
		profile: options.profile === "assurance" ? "assurance" : "standard",
		rollout: options.profile === "control" ? "control" : options.rollout,
	};
}

export class OrchestrationAdmissionCoordinator {
	readonly #policy: OrchestrationAdmissionPolicyV1;
	readonly #now: () => number;
	readonly #randomId: () => string;
	readonly #maxPending: number;
	readonly #ttlMs: number;
	readonly #pendingBySession = new Map<string, PendingAdmission>();
	readonly #report: OrchestrationAdmissionRuntimeReport;

	constructor(options: OrchestrationAdmissionCoordinatorOptions) {
		this.#policy = Object.freeze({ ...options.policy });
		this.#now = options.now ?? Date.now;
		this.#randomId = options.randomId ?? randomUUID;
		this.#maxPending =
			options.maxPendingAdmissions ?? DEFAULT_MAX_PENDING_ADMISSIONS;
		this.#ttlMs = options.admissionTtlMs ?? DEFAULT_ADMISSION_TTL_MS;
		if (
			!Number.isSafeInteger(this.#maxPending) ||
			this.#maxPending < 1 ||
			!Number.isSafeInteger(this.#ttlMs) ||
			this.#ttlMs < 1
		) {
			throw new RangeError("Orchestration admission bounds must be positive.");
		}
		this.#report = {
			schemaVersion: 1,
			profile: this.#policy.profile,
			rollout: this.#policy.rollout,
			proposals: 0,
			allowed: 0,
			wouldDeny: 0,
			denied: 0,
			admittedWorkerDispatches: 0,
			unadmittedFlowWorkerDispatches: 0,
		};
	}

	#prune(): void {
		const now = this.#now();
		for (const [sessionID, admission] of this.#pendingBySession) {
			if (admission.expiresAt > now) continue;
			this.#pendingBySession.delete(sessionID);
		}
	}

	evaluateAndArm(
		sessionID: string,
		proposal: OrchestrationProposalV1,
	): OrchestrationAdmissionDecision {
		this.#prune();
		this.#report.proposals += 1;
		const evaluation = evaluateOrchestrationProposal(this.#policy, proposal);
		if (evaluation.wouldDeny) this.#report.wouldDeny += 1;
		if (!evaluation.admitted) {
			this.#report.denied += 1;
			return { evaluation, admissionId: null, expiresAt: null };
		}
		this.#report.allowed += 1;
		if (this.#pendingBySession.has(sessionID)) {
			throw new OrchestrationAdmissionError(
				"This session already has an unconsumed orchestration admission.",
			);
		}
		if (this.#pendingBySession.size >= this.#maxPending) {
			throw new OrchestrationAdmissionError(
				"Flow reached its bounded pending admission capacity.",
			);
		}
		const expiresAt = this.#now() + this.#ttlMs;
		const admission: PendingAdmission = {
			admissionId: this.#randomId(),
			proposalId: proposal.proposalId,
			expectedAgent: FLOW_AGENT_FOR_PASS[proposal.passKind],
			remainingWorkers: proposal.workerCount,
			expiresAt,
		};
		this.#pendingBySession.set(sessionID, admission);
		return {
			evaluation,
			admissionId: admission.admissionId,
			expiresAt: new Date(expiresAt).toISOString(),
		};
	}

	observeToolBefore(input: ToolBeforeInput, output: ToolBeforeOutput): void {
		if (input.tool.toLowerCase() !== "task") return;
		const agent = taskAgent(output.args);
		if (!agent || !FLOW_WORKER_AGENTS.has(agent)) return;
		this.#prune();
		const pending = this.#pendingBySession.get(input.sessionID);
		if (!pending) {
			this.#report.unadmittedFlowWorkerDispatches += 1;
			if (this.#policy.rollout === "enforce") {
				throw new OrchestrationAdmissionError(
					`Flow ${agent} dispatch requires a current admitted proposal.`,
				);
			}
			return;
		}
		if (agent !== pending.expectedAgent) {
			this.#pendingBySession.delete(input.sessionID);
			this.#report.unadmittedFlowWorkerDispatches += 1;
			if (this.#policy.rollout === "enforce") {
				throw new OrchestrationAdmissionError(
					`The admitted proposal expected ${pending.expectedAgent}, not ${agent}.`,
				);
			}
			return;
		}
		pending.remainingWorkers -= 1;
		this.#report.admittedWorkerDispatches += 1;
		if (pending.remainingWorkers === 0) {
			this.#pendingBySession.delete(input.sessionID);
		}
	}

	cancel(sessionID: string, admissionId?: string): boolean {
		const pending = this.#pendingBySession.get(sessionID);
		if (!pending || (admissionId && admissionId !== pending.admissionId)) {
			return false;
		}
		return this.#pendingBySession.delete(sessionID);
	}

	report(): OrchestrationAdmissionRuntimeReport {
		return { ...this.#report };
	}
}
