import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createFlowService,
	type FlowResponse,
} from "../../src/application/flow-service.js";
import { canonicalizeReplayJson } from "../../src/application/replay/canonical-json.js";
import { SessionSchema } from "../../src/application/schema.js";
import {
	type ReviewAssignment,
	type ReviewAssignmentResultInput,
	type Session,
	toFeatureId,
	toSessionId,
} from "../../src/domain/session.js";
import { validateSessionInvariants } from "../../src/domain/session-invariants.js";
import {
	applyPlan,
	approvePlan,
	canonicalValidationCommandDigest,
	createSession,
	startRun,
	type TransitionEnvironment,
} from "../../src/domain/transitions.js";
import { validationCommandClass } from "../../src/domain/validation-command.js";
import type {
	ValidationCoverageScope,
	ValidationReceiptRef,
} from "../../src/domain/validation-receipt.js";
import { createFileSessionRepository } from "../../src/infrastructure/fs/session-repository.js";
import {
	loadSession,
	saveSession,
	sessionPath,
} from "../../src/infrastructure/fs/workspace.js";
import {
	executableProof,
	type ProofAssertions,
} from "./lifecycle-invariant-registry.js";
import { publishValidationReceiptForWorkspace } from "./validation-receipt.js";

const EPOCH = Date.parse("2026-07-19T12:00:00.000Z");
const RUN_AT = timestamp(0);
const FEATURE_ASSIGNMENT_AT = timestamp(100);
const ACCEPTANCE_AT = timestamp(1_000);
const FAR_FUTURE = timestamp(86_400_000);
const FIRST_FEATURE_ID = toFeatureId("time-first-feature");
const FINAL_FEATURE_ID = toFeatureId("time-final-feature");

const TIME_BOUNDARIES = [
	"run-validation-start",
	"validation-start-completion",
	"validation-completion-assignment-start",
	"assignment-start-reported-result",
	"reported-result-runtime-acceptance",
	"feature-result-broad-validation-start",
	"broad-validation-completion-final-assignment",
] as const;

const TIME_DELTAS = ["-1", "0", "+1", "future"] as const;

type TimeBoundary = (typeof TIME_BOUNDARIES)[number];
type TimeDelta = (typeof TIME_DELTAS)[number];

export const TIME_BOUNDARY_EVIDENCE_IDS = TIME_BOUNDARIES.flatMap((boundary) =>
	TIME_DELTAS.map((delta) => `${boundary}:${delta}`),
);

const EQUALITY_BOUNDARY_EVIDENCE_IDS = TIME_BOUNDARIES.map(
	(boundary) => `${boundary}:0`,
);

const ATOMIC_REJECTION_EVIDENCE_IDS = [
	"assignment-start-reported-result:-1",
	"assignment-start-reported-result:future",
	"reported-result-runtime-acceptance:+1",
	"reported-result-runtime-acceptance:future",
] as const;

function timestamp(offsetMilliseconds: number): string {
	return new Date(EPOCH + offsetMilliseconds).toISOString();
}

function portable(value: string): string {
	return value.replaceAll("+", "plus").replaceAll(":", "-");
}

function environment(at: string, namespace: string): TransitionEnvironment {
	let runtimeId = 0;
	return {
		now: () => at,
		newSessionId: () => toSessionId(`time-${namespace}`),
		newOperationId: (revision) => `time-${namespace}-implicit-${revision}`,
		newRuntimeId: (kind) => `${kind}:time-${namespace}-${++runtimeId}`,
	};
}

function runningSession(namespace: string, finalOnly: boolean): Session {
	const env = environment(RUN_AT, namespace);
	const created = createSession("Prove every Session v4 time boundary", env);
	const planned = applyPlan(
		created,
		{
			summary: "Exercise the canonical chronology.",
			overview: "Perturb one adjacent lifecycle timestamp at a time.",
			features: finalOnly
				? [
						{
							id: FINAL_FEATURE_ID,
							title: "Final time boundary",
							summary: "Exercise final-review chronology.",
						},
					]
				: [
						{
							id: FIRST_FEATURE_ID,
							title: "First time boundary",
							summary: "Exercise feature-review chronology.",
						},
						{
							id: FINAL_FEATURE_ID,
							title: "Later final boundary",
							summary: "Keep the first feature non-final.",
							dependsOn: [FIRST_FEATURE_ID],
						},
					],
		},
		env,
	);
	assert.ok(planned.ok);
	const approved = approvePlan(planned.value, env);
	assert.ok(approved.ok);
	const started = startRun(
		approved.value,
		env,
		finalOnly ? FINAL_FEATURE_ID : FIRST_FEATURE_ID,
	);
	assert.ok(started.ok);
	return started.value.session;
}

async function persistedWorkspace(
	namespace: string,
	finalOnly = false,
): Promise<string> {
	const workspace = await mkdtemp(join(tmpdir(), `flow-time-${namespace}-`));
	await writeFile(join(workspace, "source.ts"), "export const value = 1;\n");
	await saveSession(workspace, runningSession(namespace, finalOnly));
	return workspace;
}

async function publishValidationReceiptRef(
	workspace: string,
	startedAt: string,
	completedAt: string,
	label: string,
	coverageScope: ValidationCoverageScope = "focused",
): Promise<ValidationReceiptRef> {
	const command = `bun test ${label}`;
	if (Date.parse(completedAt) >= Date.parse(startedAt)) {
		return publishValidationReceiptForWorkspace(workspace, {
			startedAt,
			completedAt,
			command,
			coverageScope,
		});
	}

	// The reversed-time case proves that a malformed runtime artifact is rejected
	// atomically. It cannot pass through the canonical test publisher by design.
	const repository = createFileSessionRepository(workspace);
	return repository.transact(async (transaction) => {
		const session = await transaction.load();
		if (!session?.activeFeatureId || !session.activeFeatureRunId) {
			throw new Error("Expected an active time-proof feature run.");
		}
		const source = await transaction.computeSourceIdentity();
		const bytes = new TextEncoder().encode(
			canonicalizeReplayJson({
				schemaVersion: 1,
				kind: "validation_receipt_v1",
				featureRunId: session.activeFeatureRunId,
				featureId: session.activeFeatureId,
				sourceDigest: source.digest,
				startedAt,
				completedAt,
				command,
				commandDigest: canonicalValidationCommandDigest(command),
				commandClass: validationCommandClass(command),
				coverageScope,
				exitCode: 0,
				outputDigest: `sha256:${"e".repeat(64)}`,
				outputCompleteness: "complete",
				environmentKeys: [],
			}),
		);
		const artifactRef = await transaction.publishEvidenceArtifact(bytes);
		return {
			kind: "validation_receipt_ref_v1",
			digest: artifactRef.digest,
			byteLength: artifactRef.byteLength,
		};
	});
}

function passingResult(
	assignment: ReviewAssignment,
	completedAt: string,
): ReviewAssignmentResultInput {
	return {
		assignmentId: assignment.id,
		verdict: "passed",
		findings: [],
		completedAt,
		terminalDisposition: "submitted",
	};
}

function mutationOperationId(boundary: TimeBoundary, delta: TimeDelta): string {
	return `time-${portable(boundary)}-${portable(delta)}`;
}

function expectedAcceptance(boundary: TimeBoundary, delta: TimeDelta): boolean {
	switch (boundary) {
		case "run-validation-start":
		case "validation-start-completion":
		case "assignment-start-reported-result":
		case "feature-result-broad-validation-start":
			return delta === "0" || delta === "+1";
		case "validation-completion-assignment-start":
		case "reported-result-runtime-acceptance":
		case "broad-validation-completion-final-assignment":
			return delta === "-1" || delta === "0";
	}
}

function valueForDelta(
	delta: TimeDelta,
	minusOne: string,
	equal: string,
	plusOne: string,
): string {
	switch (delta) {
		case "-1":
			return minusOne;
		case "0":
			return equal;
		case "+1":
			return plusOne;
		case "future":
			return FAR_FUTURE;
	}
}

async function roundTripPersistedSession(
	workspace: string,
	operationId: string,
	assertions: ProofAssertions,
): Promise<void> {
	const bytes = await readFile(sessionPath(workspace), "utf8");
	const parsed = SessionSchema.parse(JSON.parse(bytes));
	const loaded = await loadSession(workspace);
	assertions.ok(loaded);
	assertions.deepEqual(parsed, loaded);
	assertions.equal(validateSessionInvariants(parsed), null);
	assertions.equal(
		parsed.causal.mutations.filter(
			(mutation) => mutation.operationId === operationId,
		).length,
		1,
	);
}

type MutationAttempt = () => Promise<FlowResponse>;

async function proveMutationCase(
	workspace: string,
	operationId: string,
	expectedAccepted: boolean,
	attempt: MutationAttempt,
	corrected: MutationAttempt,
	assertions: ProofAssertions,
): Promise<void> {
	const beforeBytes = await readFile(sessionPath(workspace), "utf8");
	const response = await attempt();
	if (expectedAccepted) {
		assertions.equal(response.status, "ok", JSON.stringify(response));
	} else {
		assertions.equal(response.status, "error", JSON.stringify(response));
		assertions.equal(
			await readFile(sessionPath(workspace), "utf8"),
			beforeBytes,
		);
		const rejectedState = await loadSession(workspace);
		assertions.ok(rejectedState);
		assertions.equal(
			rejectedState.causal.mutations.some(
				(mutation) => mutation.operationId === operationId,
			),
			false,
		);
		const correctedResponse = await corrected();
		assertions.equal(
			correctedResponse.status,
			"ok",
			JSON.stringify(correctedResponse),
		);
	}
	await roundTripPersistedSession(workspace, operationId, assertions);
}

async function startFeatureAssignment(
	workspace: string,
	namespace: string,
	finalOnly: boolean,
): Promise<{ session: Session; assignment: ReviewAssignment }> {
	const before = await loadSession(workspace);
	assert.ok(before?.activeFeatureId);
	const run = before.featureRuns.find(
		(candidate) => candidate.id === before.activeFeatureRunId,
	);
	assert.ok(run);
	const operationId = `time-${namespace}-setup-feature-review`;
	const service = createFlowService(
		createFileSessionRepository(workspace),
		environment(FEATURE_ASSIGNMENT_AT, `${namespace}-feature-setup`),
	);
	const validationRef = await publishValidationReceiptRef(
		workspace,
		run.startedAt,
		run.startedAt,
		namespace,
	);
	const response = await service.reviewStart({
		request: {
			operationId,
			expectedRevision: before.causal.revision,
			expectedSnapshotId: before.causal.snapshotId,
			featureId: finalOnly ? FINAL_FEATURE_ID : FIRST_FEATURE_ID,
			reviewKind: "feature",
			validationScope: "targeted",
			packet: {
				summary: "Create the feature assignment used by the time proof.",
				riskLenses: ["canonical chronology"],
			},
			validationRefs: [validationRef],
		},
	});
	assert.equal(response.status, "ok", JSON.stringify(response));
	const session = await loadSession(workspace);
	const assignment = session?.reviewAssignments.find(
		(candidate) => candidate.operationId === operationId,
	);
	assert.ok(session && assignment);
	return { session, assignment };
}

function reviewStartRequest(
	session: Session,
	operationId: string,
	validationRef: ValidationReceiptRef,
) {
	return {
		request: {
			operationId,
			expectedRevision: session.causal.revision,
			expectedSnapshotId: session.causal.snapshotId,
			featureId: FIRST_FEATURE_ID,
			reviewKind: "feature" as const,
			validationScope: "targeted" as const,
			packet: {
				summary: "Exercise one adjacent validation chronology boundary.",
				riskLenses: ["canonical chronology"],
			},
			validationRefs: [validationRef],
		},
	};
}

function completionRequest(
	session: Session,
	assignment: ReviewAssignment,
	operationId: string,
	completedAt: string,
) {
	return {
		request: {
			operationId,
			expectedRevision: session.causal.revision,
			expectedSnapshotId: session.causal.snapshotId,
			featureId: FIRST_FEATURE_ID,
			result: {
				kind: "completed" as const,
				summary: "Exercise one adjacent review-result chronology boundary.",
				artifactsChanged: [],
				validationScope: "targeted" as const,
				featureReview: passingResult(assignment, completedAt),
			},
		},
	};
}

function finalReviewRequest(
	session: Session,
	featureAssignment: ReviewAssignment,
	operationId: string,
	featureCompletedAt: string,
	validationRef: ValidationReceiptRef,
) {
	return {
		request: {
			operationId,
			expectedRevision: session.causal.revision,
			expectedSnapshotId: session.causal.snapshotId,
			featureId: FINAL_FEATURE_ID,
			reviewKind: "final" as const,
			validationScope: "broad" as const,
			featureReview: passingResult(featureAssignment, featureCompletedAt),
			packet: {
				summary: "Exercise one adjacent final-review chronology boundary.",
				riskLenses: ["canonical chronology"],
			},
			validationRefs: [validationRef],
		},
	};
}

async function proveReviewStartBoundary(
	boundary: Extract<
		TimeBoundary,
		| "run-validation-start"
		| "validation-start-completion"
		| "validation-completion-assignment-start"
	>,
	delta: TimeDelta,
	assertions: ProofAssertions,
): Promise<void> {
	const namespace = portable(`${boundary}-${delta}`);
	const workspace = await persistedWorkspace(namespace);
	try {
		const session = await loadSession(workspace);
		const run = session?.featureRuns.find(
			(candidate) => candidate.id === session.activeFeatureRunId,
		);
		assert.ok(session && run);
		const operationId = mutationOperationId(boundary, delta);
		const acceptedAt = ACCEPTANCE_AT;
		let startedAt: string;
		let completedAt: string;
		switch (boundary) {
			case "run-validation-start": {
				startedAt = valueForDelta(
					delta,
					timestamp(-1),
					run.startedAt,
					timestamp(1),
				);
				completedAt = startedAt;
				break;
			}
			case "validation-start-completion": {
				startedAt = timestamp(10);
				completedAt = valueForDelta(
					delta,
					timestamp(9),
					startedAt,
					timestamp(11),
				);
				break;
			}
			case "validation-completion-assignment-start": {
				startedAt = run.startedAt;
				completedAt = valueForDelta(
					delta,
					timestamp(999),
					acceptedAt,
					timestamp(1_001),
				);
				break;
			}
		}
		const validationRef = await publishValidationReceiptRef(
			workspace,
			startedAt,
			completedAt,
			namespace,
		);
		const correctedValidationRef = await publishValidationReceiptRef(
			workspace,
			run.startedAt,
			acceptedAt,
			`${namespace}-corrected`,
		);
		const service = createFlowService(
			createFileSessionRepository(workspace),
			environment(acceptedAt, namespace),
		);
		await proveMutationCase(
			workspace,
			operationId,
			expectedAcceptance(boundary, delta),
			() =>
				service.reviewStart(
					reviewStartRequest(session, operationId, validationRef),
				),
			() =>
				service.reviewStart(
					reviewStartRequest(session, operationId, correctedValidationRef),
				),
			assertions,
		);
	} finally {
		await rm(workspace, { force: true, recursive: true });
	}
}

async function proveCompletionBoundary(
	boundary: Extract<
		TimeBoundary,
		"assignment-start-reported-result" | "reported-result-runtime-acceptance"
	>,
	delta: TimeDelta,
	assertions: ProofAssertions,
): Promise<void> {
	const namespace = portable(`${boundary}-${delta}`);
	const workspace = await persistedWorkspace(namespace);
	try {
		const fixture = await startFeatureAssignment(workspace, namespace, false);
		const operationId = mutationOperationId(boundary, delta);
		const completedAt =
			boundary === "assignment-start-reported-result"
				? valueForDelta(
						delta,
						timestamp(99),
						fixture.assignment.startedAt,
						timestamp(101),
					)
				: valueForDelta(delta, timestamp(999), ACCEPTANCE_AT, timestamp(1_001));
		const service = createFlowService(
			createFileSessionRepository(workspace),
			environment(ACCEPTANCE_AT, namespace),
		);
		await proveMutationCase(
			workspace,
			operationId,
			expectedAcceptance(boundary, delta),
			() =>
				service.featureComplete(
					completionRequest(
						fixture.session,
						fixture.assignment,
						operationId,
						completedAt,
					),
				),
			() =>
				service.featureComplete(
					completionRequest(
						fixture.session,
						fixture.assignment,
						operationId,
						boundary === "assignment-start-reported-result"
							? fixture.assignment.startedAt
							: ACCEPTANCE_AT,
					),
				),
			assertions,
		);
	} finally {
		await rm(workspace, { force: true, recursive: true });
	}
}

async function proveFinalReviewBoundary(
	boundary: Extract<
		TimeBoundary,
		| "feature-result-broad-validation-start"
		| "broad-validation-completion-final-assignment"
	>,
	delta: TimeDelta,
	assertions: ProofAssertions,
): Promise<void> {
	const namespace = portable(`${boundary}-${delta}`);
	const workspace = await persistedWorkspace(namespace, true);
	try {
		const fixture = await startFeatureAssignment(workspace, namespace, true);
		const operationId = mutationOperationId(boundary, delta);
		const featureCompletedAt = timestamp(200);
		const broadStartedAt =
			boundary === "feature-result-broad-validation-start"
				? valueForDelta(
						delta,
						timestamp(199),
						featureCompletedAt,
						timestamp(201),
					)
				: featureCompletedAt;
		const broadCompletedAt =
			boundary === "feature-result-broad-validation-start"
				? broadStartedAt
				: valueForDelta(delta, timestamp(999), ACCEPTANCE_AT, timestamp(1_001));
		const validationRef = await publishValidationReceiptRef(
			workspace,
			broadStartedAt,
			broadCompletedAt,
			`${portable(operationId)}-broad`,
			"broad",
		);
		const correctedValidationRef = await publishValidationReceiptRef(
			workspace,
			featureCompletedAt,
			ACCEPTANCE_AT,
			`${portable(operationId)}-broad-corrected`,
			"broad",
		);
		const service = createFlowService(
			createFileSessionRepository(workspace),
			environment(ACCEPTANCE_AT, namespace),
		);
		await proveMutationCase(
			workspace,
			operationId,
			expectedAcceptance(boundary, delta),
			() =>
				service.reviewStart(
					finalReviewRequest(
						fixture.session,
						fixture.assignment,
						operationId,
						featureCompletedAt,
						validationRef,
					),
				),
			() =>
				service.reviewStart(
					finalReviewRequest(
						fixture.session,
						fixture.assignment,
						operationId,
						featureCompletedAt,
						correctedValidationRef,
					),
				),
			assertions,
		);
	} finally {
		await rm(workspace, { force: true, recursive: true });
	}
}

async function proveBoundaryCase(
	boundary: TimeBoundary,
	delta: TimeDelta,
	assertions: ProofAssertions,
): Promise<void> {
	if (
		boundary === "run-validation-start" ||
		boundary === "validation-start-completion" ||
		boundary === "validation-completion-assignment-start"
	) {
		await proveReviewStartBoundary(boundary, delta, assertions);
	} else if (
		boundary === "assignment-start-reported-result" ||
		boundary === "reported-result-runtime-acceptance"
	) {
		await proveCompletionBoundary(boundary, delta, assertions);
	} else {
		await proveFinalReviewBoundary(boundary, delta, assertions);
	}
	assertions.cover(`${boundary}:${delta}`);
}

async function proveCases(
	assertions: ProofAssertions,
	filter: (boundary: TimeBoundary, delta: TimeDelta) => boolean,
): Promise<void> {
	for (const boundary of TIME_BOUNDARIES) {
		for (const delta of TIME_DELTAS) {
			if (filter(boundary, delta)) {
				await proveBoundaryCase(boundary, delta, assertions);
			}
		}
	}
}

export const timeLifecycleBoundaryProof = executableProof(
	"Equality is accepted at all seven adjacent Session v4 chronology boundaries.",
	(assertions) => proveCases(assertions, (_boundary, delta) => delta === "0"),
	EQUALITY_BOUNDARY_EVIDENCE_IDS,
);

export const timeValidationPerturbationProof = executableProof(
	"All seven adjacent chronology boundaries execute deterministic -1, equality, +1, and future service transitions.",
	(assertions) => proveCases(assertions, () => true),
	TIME_BOUNDARY_EVIDENCE_IDS,
);

export const timeReviewAtomicRejectionProof = executableProof(
	"Rejected review-result chronology preserves bytes and leaves the same operation id reusable.",
	(assertions) =>
		proveCases(assertions, (boundary, delta) =>
			ATOMIC_REJECTION_EVIDENCE_IDS.includes(
				`${boundary}:${delta}` as (typeof ATOMIC_REJECTION_EVIDENCE_IDS)[number],
			),
		),
	ATOMIC_REJECTION_EVIDENCE_IDS,
);
