import { expect } from "bun:test";
import { ArchiveCollisionError } from "../src/application/errors.js";
import {
	createFlowService,
	type FlowService,
} from "../src/application/flow-service.js";
import type {
	SessionRepository,
	SessionTransaction,
} from "../src/application/ports/session-repository.js";
import {
	persistObservedValidation,
	prepareValidation,
} from "../src/application/prepare-validation.js";
import type {
	Plan,
	ReviewAssignment,
	ReviewFinding,
	Session,
	SourceDigest,
} from "../src/domain/session.js";
import type { TransitionEnvironment } from "../src/domain/transitions.js";

export const FEATURE = "runtime-kernel";
export const SOURCE_A = `sha256:${"a".repeat(64)}` as SourceDigest;
export const SOURCE_B = `sha256:${"b".repeat(64)}` as SourceDigest;
export const OUTPUT = `sha256:${"c".repeat(64)}` as SourceDigest;

export const plan: Plan = {
	summary: "Implement the runtime kernel.",
	overview: "Exercise the public application boundary.",
	requirements: ["Persist validation directly in Session v5."],
	decisions: ["Use a single final review for the final feature."],
	gate: "bun test",
	externalEvidence: [],
	features: [
		{
			id: FEATURE,
			title: "Runtime kernel",
			summary: "Implement and verify the kernel.",
			targets: ["src"],
			validation: ["bun test"],
			dependsOn: [],
		},
	],
};
export class MemorySessionRepository implements SessionRepository {
	session: Session | null = null;
	sourceDigest = SOURCE_A;
	sourceDigestFailure: Error | null = null;
	archiveFailure: Error | null = null;
	archiveFailureAfterMutation: Error | null = null;
	archiveReadFailure: Error | null = null;
	confirmActiveFailure: Error | null = null;
	saveFailure: Error | null = null;
	saveFailureAfterMutation: Error | null = null;
	readFailure: Error | null = null;
	quarantineCount = 0;
	archiveCount = 0;
	confirmActiveCount = 0;
	saveCount = 0;
	transactionCount = 0;
	readonly archives = new Map<string, Session>();

	readonly transaction: SessionTransaction = {
		load: () => Promise.resolve(this.session),
		loadArchive: (sessionId) =>
			this.archiveReadFailure
				? Promise.reject(this.archiveReadFailure)
				: Promise.resolve(this.archives.get(sessionId) ?? null),
		save: (session) => {
			if (this.saveFailure) return Promise.reject(this.saveFailure);
			this.saveCount += 1;
			this.session = session;
			if (this.saveFailureAfterMutation) {
				return Promise.reject(this.saveFailureAfterMutation);
			}
			return Promise.resolve(session);
		},
		confirmActiveDurability: (session) => {
			this.confirmActiveCount += 1;
			if (this.confirmActiveFailure) {
				return Promise.reject(this.confirmActiveFailure);
			}
			if (JSON.stringify(this.session) !== JSON.stringify(session)) {
				return Promise.reject(
					new ArchiveCollisionError(
						"Active state changed before durability confirmation.",
					),
				);
			}
			return Promise.resolve();
		},
		archiveAndClear: (session) => {
			this.archiveCount += 1;
			if (this.archiveFailure) return Promise.reject(this.archiveFailure);
			this.archives.set(session.id, session);
			this.session = null;
			if (this.archiveFailureAfterMutation) {
				return Promise.reject(this.archiveFailureAfterMutation);
			}
			return Promise.resolve();
		},
		quarantineUnreadable: () => {
			this.quarantineCount += 1;
			this.session = null;
			return Promise.resolve("memory://quarantined-session");
		},
		computeSourceDigest: () =>
			this.sourceDigestFailure
				? Promise.reject(this.sourceDigestFailure)
				: Promise.resolve(this.sourceDigest),
	};

	read(): Promise<Session | null> {
		if (this.readFailure) return Promise.reject(this.readFailure);
		return Promise.resolve(this.session);
	}

	transact<T>(
		task: (transaction: SessionTransaction) => Promise<T>,
	): Promise<T> {
		this.transactionCount += 1;
		return task(this.transaction);
	}
}
export function deterministicEnvironment(): TransitionEnvironment {
	const sequences = new Map<string, number>();
	return {
		newId(kind) {
			const next = (sequences.get(kind) ?? 0) + 1;
			sequences.set(kind, next);
			return `${kind}-${next}`;
		},
	};
}

export function revision(repository: MemorySessionRepository): number {
	if (!repository.session) throw new Error("Expected an active session.");
	return repository.session.revision;
}

export function activeReview(
	repository: MemorySessionRepository,
): ReviewAssignment {
	const review = repository.session?.runs
		.find((run) => run.state === "active")
		?.reviews.at(-1);
	if (!review) throw new Error("Expected a review assignment.");
	return review;
}

export function expectOk<
	T extends Readonly<{ status: "ok" | "error"; summary: string }>,
>(response: T): asserts response is Extract<T, { status: "ok" }> {
	expect(response.status).toBe("ok");
	if (response.status !== "ok") throw new Error(response.summary);
}

export function expectError<
	T extends Readonly<{ status: "ok" | "error"; summary: string }>,
>(response: T): asserts response is Extract<T, { status: "error" }> {
	expect(response.status).toBe("error");
	if (response.status !== "error") {
		throw new Error(`Expected an error response: ${response.summary}`);
	}
}

export async function startSession(
	repository: MemorySessionRepository,
	environment: TransitionEnvironment,
): Promise<FlowService> {
	const flow = await approveSession(repository, environment);
	await startFeatureRun(flow, repository, FEATURE, "runtime");
	return flow;
}

export async function approveSession(
	repository: MemorySessionRepository,
	environment: TransitionEnvironment,
	options: Readonly<{
		goal?: string;
		plan?: Plan;
		suffix?: string;
	}> = {},
): Promise<FlowService> {
	const suffix = options.suffix ?? "runtime";
	const flow = createFlowService(repository, environment);
	expectOk(
		await flow.planSave({
			request: {
				operationId: `plan-save-${suffix}`,
				expectedRevision: 0,
				goal: options.goal ?? "Ship the runtime",
				plan: options.plan ?? plan,
			},
		}),
	);
	expectOk(
		await flow.planApprove({
			request: {
				operationId: `plan-approve-${suffix}`,
				expectedRevision: revision(repository),
			},
		}),
	);
	return flow;
}

export async function startFeatureRun(
	flow: FlowService,
	repository: MemorySessionRepository,
	featureId: string,
	suffix: string,
): Promise<void> {
	expectOk(
		await flow.runStart({
			request: {
				operationId: `run-start-${suffix}`,
				expectedRevision: revision(repository),
				featureId,
			},
		}),
	);
}

async function reviewActiveRun(
	flow: FlowService,
	repository: MemorySessionRepository,
	options: Readonly<{
		featureId?: string;
		suffix: string;
		command?: string;
		scope?: "focused" | "broad";
		artifacts?: string[];
	}>,
): Promise<ReviewAssignment> {
	const featureId = options.featureId ?? FEATURE;
	await recordObservedValidation(repository, {
		featureId,
		captureId: `capture-${options.suffix}`,
		...(options.command === undefined ? {} : { command: options.command }),
		...(options.scope === undefined ? {} : { scope: options.scope }),
	});
	expectOk(
		await flow.reviewStart({
			request: {
				operationId: `review-start-${options.suffix}`,
				expectedRevision: revision(repository),
				featureId,
				artifactsChanged: (options.artifacts ?? []).map((path) => ({ path })),
				packet: {
					summary: `Review ${options.suffix}.`,
					riskLenses: ["runtime integrity"],
				},
			},
		}),
	);
	return activeReview(repository);
}

export async function startReviewedRun(
	flow: FlowService,
	repository: MemorySessionRepository,
	options: Parameters<typeof reviewActiveRun>[2],
): Promise<ReviewAssignment> {
	await startFeatureRun(
		flow,
		repository,
		options.featureId ?? FEATURE,
		options.suffix,
	);
	return reviewActiveRun(flow, repository, options);
}

export async function submitReview(
	flow: FlowService,
	repository: MemorySessionRepository,
	options: Readonly<{
		featureId?: string;
		suffix: string;
		summary: string;
		verdict: "passed" | "failed";
		findings?: ReviewFinding[];
		terminalDisposition?: "submitted" | "observed_unsubmitted";
	}>,
): Promise<void> {
	expectOk(
		await flow.featureComplete({
			request: {
				operationId: `complete-${options.suffix}`,
				expectedRevision: revision(repository),
				featureId: options.featureId ?? FEATURE,
				assignmentId: activeReview(repository).id,
				summary: options.summary,
				result: {
					verdict: options.verdict,
					findings: options.findings ?? [],
					terminalDisposition: options.terminalDisposition ?? "submitted",
				},
			},
		}),
	);
}

export async function resetFeatureRun(
	flow: FlowService,
	repository: MemorySessionRepository,
	featureId: string,
	suffix: string,
): Promise<void> {
	expectOk(
		await flow.featureReset({
			request: {
				operationId: `reset-${suffix}`,
				expectedRevision: revision(repository),
				featureId,
			},
		}),
	);
}

export async function recordObservedValidation(
	repository: MemorySessionRepository,
	options: Readonly<{
		featureId?: string;
		command?: string;
		scope?: "focused" | "broad";
		captureId: string;
		exitCode?: number;
	}>,
) {
	const prepared = await prepareValidation(repository, {
		expectedRevision: revision(repository),
		featureId: options.featureId ?? FEATURE,
		command: options.command ?? "bun test",
		scope: options.scope ?? "broad",
	});
	return persistObservedValidation(repository, {
		...prepared,
		captureId: options.captureId,
		exitCode: options.exitCode ?? 0,
		outputDigest: OUTPUT,
		outputComplete: true,
	});
}
