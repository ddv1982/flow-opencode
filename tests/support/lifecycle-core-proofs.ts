import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../../package.json" with { type: "json" };
import {
	createFlowService,
	type FlowService,
} from "../../src/application/flow-service.js";
import { SessionSchema } from "../../src/application/schema.js";
import {
	type Session,
	toFeatureId,
	toSessionId,
} from "../../src/domain/session.js";
import { validateSessionInvariants } from "../../src/domain/session-invariants.js";
import {
	applyPlan,
	approvePlan,
	canonicalReviewAssignmentResultDigest,
	closeSession,
	createSession,
	resetFeature,
	startRun,
	type TransitionEnvironment,
} from "../../src/domain/transitions.js";
import { createFileSessionRepository } from "../../src/infrastructure/fs/session-repository.js";
import {
	historyDir,
	loadSession,
	saveSession,
	sessionPath,
} from "../../src/infrastructure/fs/workspace.js";
import {
	executableProof,
	type ProofAssertions,
} from "./lifecycle-invariant-registry.js";
import { runPackageSurfaceSmoke } from "./lifecycle-package-smoke.js";
import {
	REQUIRED_REPOSITORY_SEQUENCE_ACTIONS,
	runDeterministicRepositoryLifecycleSequence,
} from "./lifecycle-repository-sequence.js";
import { runningSequenceSession } from "./lifecycle-sequence.js";
import { auditSessionV4OnlyState } from "./lifecycle-v4-absence.js";

const FEATURE_ID = toFeatureId("core-proof-feature");
const OWNERSHIP_FEATURE_ID = toFeatureId("ownership-proof-feature");
const OWNERSHIP_TRAILING_FEATURE_ID = toFeatureId(
	"ownership-proof-trailing-feature",
);
const OWNERSHIP_OUTPUT_DIGEST = `sha256:${"e".repeat(64)}`;

function offsetBefore(timestamp: string): string {
	return new Date(Date.parse(timestamp) - 1).toISOString();
}

function offsetAfter(timestamp: string): string {
	return new Date(Date.parse(timestamp) + 1).toISOString();
}

function environment(): TransitionEnvironment {
	let runtimeId = 0;
	return {
		now: () => "2026-07-19T12:00:00.000Z",
		newSessionId: () => toSessionId("core-proof-session"),
		newOperationId: (revision) => `core-proof-operation-${revision}`,
		newRuntimeId: (kind) => `${kind}:core-proof-${++runtimeId}`,
	};
}

function oneFeaturePlan() {
	return {
		summary: "Prove the lifecycle contract.",
		overview: "Exercise one bounded feature.",
		features: [
			{
				id: FEATURE_ID,
				title: "Core proof feature",
				summary: "Prove transition and persistence invariants.",
			},
		],
	};
}

function ownershipEnvironment(
	namespace: string,
	constantTime = false,
): TransitionEnvironment {
	let tick = 0;
	let runtimeId = 0;
	const epoch = Date.parse("2026-07-19T13:00:00.000Z");
	return {
		now: () =>
			new Date(epoch + (constantTime ? 0 : tick++ * 1_000)).toISOString(),
		newSessionId: () => toSessionId(`ownership-${namespace}`),
		newOperationId: (revision) => `ownership-${namespace}-implicit-${revision}`,
		newRuntimeId: (kind) => `${kind}:ownership-${namespace}-${++runtimeId}`,
	};
}

async function pendingOwnershipReview(
	namespace: string,
	constantTime = false,
	includeTrailingFeature = false,
): Promise<{
	assignmentId: string;
	service: FlowService;
	session: Session;
	workspace: string;
}> {
	const workspace = await mkdtemp(
		join(tmpdir(), `flow-ownership-${namespace}-`),
	);
	await writeFile(join(workspace, "source.ts"), "export const value = 1;\n");
	const service = createFlowService(
		createFileSessionRepository(workspace),
		ownershipEnvironment(namespace, constantTime),
	);
	const planned = await service.planSave({
		goal: `Prove ${namespace} runtime ownership`,
		plan: {
			summary: "Prove runtime-owned lifecycle timestamps.",
			overview: "Create one pending review assignment.",
			features: [
				{
					id: OWNERSHIP_FEATURE_ID,
					title: "Ownership proof feature",
					summary: "Exercise terminal and invalidation ownership.",
					targets: ["source.ts"],
				},
				...(includeTrailingFeature
					? [
							{
								id: OWNERSHIP_TRAILING_FEATURE_ID,
								title: "Trailing ownership proof feature",
								summary: "Keep the equal-clock feature non-final.",
								dependsOn: [OWNERSHIP_FEATURE_ID],
							},
						]
					: []),
			],
		},
	});
	if (planned.status !== "ok") throw new Error(JSON.stringify(planned));
	const approved = await service.planApprove();
	if (approved.status !== "ok") throw new Error(JSON.stringify(approved));
	const started = await service.runStart({ featureId: OWNERSHIP_FEATURE_ID });
	if (started.status !== "ok") throw new Error(JSON.stringify(started));
	const running = await loadSession(workspace);
	const run = running?.featureRuns.find(
		(candidate) => candidate.id === running.activeFeatureRunId,
	);
	if (!running || !run) throw new Error("Expected one ownership-proof run.");
	const operationId = `ownership-${namespace}-review-start`;
	const assigned = await service.reviewStart({
		request: {
			operationId,
			expectedRevision: running.causal.revision,
			expectedSnapshotId: running.causal.snapshotId,
			featureId: OWNERSHIP_FEATURE_ID,
			reviewKind: "feature",
			validationScope: "targeted",
			packet: {
				summary: "Create a pending ownership-proof assignment.",
				riskLenses: ["runtime timestamp ownership"],
			},
			validations: [
				{
					command: "bun test ownership-proof",
					summary: "Ownership proof validation passed.",
					startedAt: run.startedAt,
					completedAt: run.startedAt,
					exitCode: 0,
					outputDigest: OWNERSHIP_OUTPUT_DIGEST,
					environmentKeys: [],
				},
			],
		},
	});
	if (assigned.status !== "ok") throw new Error(JSON.stringify(assigned));
	const session = await loadSession(workspace);
	const assignment = session?.reviewAssignments.find(
		(candidate) => candidate.operationId === operationId,
	);
	if (!session || !assignment) {
		throw new Error("Expected one pending ownership-proof assignment.");
	}
	return { assignmentId: assignment.id, service, session, workspace };
}

function failedOwnershipResult(assignmentId: string, completedAt: string) {
	return {
		assignmentId,
		verdict: "failed" as const,
		findings: [
			{
				taxonomy: "implementation_defect" as const,
				subject: "runtime ownership",
				requirementOrRisk: "Terminal failure must retain one owner.",
				evidenceLocator: "ownership-proof",
				summary: "Exercise one failed review attempt.",
				severity: "blocking" as const,
			},
		],
		completedAt,
		terminalDisposition: "submitted" as const,
	};
}

async function blockedOwnershipSession(): Promise<{
	session: Session;
	workspace: string;
}> {
	const prepared = await pendingOwnershipReview("blocked");
	let current = prepared.session;
	for (const attempt of [1, 2]) {
		const assignment = current.reviewAssignments.find(
			(candidate) =>
				candidate.id ===
				(attempt === 1
					? prepared.assignmentId
					: current.reviewAssignments.at(-1)?.id),
		);
		if (!assignment) throw new Error("Expected the failed review assignment.");
		const completed = await prepared.service.featureComplete({
			request: {
				operationId: `ownership-blocked-complete-${attempt}`,
				expectedRevision: current.causal.revision,
				expectedSnapshotId: current.causal.snapshotId,
				featureId: OWNERSHIP_FEATURE_ID,
				result: {
					kind: "blocked",
					summary: `Ownership blocker ${attempt}.`,
					review: failedOwnershipResult(assignment.id, assignment.startedAt),
				},
			},
		});
		if (completed.status !== "ok") throw new Error(JSON.stringify(completed));
		current = (await loadSession(prepared.workspace)) as Session;
		if (attempt === 1) {
			const run = current.featureRuns.find(
				(candidate) => candidate.id === current.activeFeatureRunId,
			);
			if (!run) throw new Error("Expected the retryable ownership run.");
			const assigned = await prepared.service.reviewStart({
				request: {
					operationId: "ownership-blocked-review-start-2",
					expectedRevision: current.causal.revision,
					expectedSnapshotId: current.causal.snapshotId,
					featureId: OWNERSHIP_FEATURE_ID,
					reviewKind: "feature",
					validationScope: "targeted",
					packet: {
						summary: "Create the second failed ownership assignment.",
						riskLenses: ["terminal blocked ownership"],
					},
					validations: [
						{
							command: "bun test ownership-proof-retry",
							summary: "Ownership retry validation passed.",
							startedAt: run.startedAt,
							completedAt: run.startedAt,
							exitCode: 0,
							outputDigest: OWNERSHIP_OUTPUT_DIGEST,
							environmentKeys: [],
						},
					],
				},
			});
			if (assigned.status !== "ok") throw new Error(JSON.stringify(assigned));
			current = (await loadSession(prepared.workspace)) as Session;
		}
	}
	return { session: current, workspace: prepared.workspace };
}

async function equalClockCompletedSession(): Promise<{
	session: Session;
	workspace: string;
}> {
	const prepared = await pendingOwnershipReview(
		"equal-clock-completed",
		true,
		true,
	);
	const firstAssignment = prepared.session.reviewAssignments.find(
		(candidate) => candidate.id === prepared.assignmentId,
	);
	if (!firstAssignment) throw new Error("Expected the equal-clock assignment.");
	const failed = await prepared.service.featureComplete({
		request: {
			operationId: "ownership-equal-clock-failure",
			expectedRevision: prepared.session.causal.revision,
			expectedSnapshotId: prepared.session.causal.snapshotId,
			featureId: OWNERSHIP_FEATURE_ID,
			result: {
				kind: "blocked",
				summary: "Record a retryable equal-clock failure.",
				review: failedOwnershipResult(
					firstAssignment.id,
					firstAssignment.startedAt,
				),
			},
		},
	});
	if (failed.status !== "ok") throw new Error(JSON.stringify(failed));
	let current = (await loadSession(prepared.workspace)) as Session;
	const run = current.featureRuns.find(
		(candidate) => candidate.id === current.activeFeatureRunId,
	);
	if (!run) throw new Error("Expected the retryable equal-clock run.");
	const assigned = await prepared.service.reviewStart({
		request: {
			operationId: "ownership-equal-clock-review-start-2",
			expectedRevision: current.causal.revision,
			expectedSnapshotId: current.causal.snapshotId,
			featureId: OWNERSHIP_FEATURE_ID,
			reviewKind: "feature",
			validationScope: "targeted",
			packet: {
				summary: "Create the successful equal-clock assignment.",
				riskLenses: ["equal terminal timestamp ownership"],
			},
			validations: [
				{
					command: "bun test ownership-equal-clock",
					summary: "Equal-clock retry validation passed.",
					startedAt: run.startedAt,
					completedAt: run.startedAt,
					exitCode: 0,
					outputDigest: OWNERSHIP_OUTPUT_DIGEST,
					environmentKeys: [],
				},
			],
		},
	});
	if (assigned.status !== "ok") throw new Error(JSON.stringify(assigned));
	current = (await loadSession(prepared.workspace)) as Session;
	const secondAssignment = current.reviewAssignments.at(-1);
	if (!secondAssignment) throw new Error("Expected the equal-clock retry.");
	const completed = await prepared.service.featureComplete({
		request: {
			operationId: "ownership-equal-clock-complete",
			expectedRevision: current.causal.revision,
			expectedSnapshotId: current.causal.snapshotId,
			featureId: OWNERSHIP_FEATURE_ID,
			result: {
				kind: "completed",
				summary: "Complete after an equal-clock retry.",
				artifactsChanged: [],
				validationScope: "targeted",
				featureReview: {
					assignmentId: secondAssignment.id,
					verdict: "passed",
					findings: [],
					completedAt: secondAssignment.startedAt,
					terminalDisposition: "submitted",
				},
			},
		},
	});
	if (completed.status !== "ok") throw new Error(JSON.stringify(completed));
	return {
		session: (await loadSession(prepared.workspace)) as Session,
		workspace: prepared.workspace,
	};
}

async function closedOwnershipSession(
	kind: "deferred" | "abandoned",
): Promise<{ session: Session; workspace: string }> {
	const prepared = await pendingOwnershipReview(kind);
	const closed = await prepared.service.sessionClose({
		request: {
			mode: "start",
			operationId: `ownership-${kind}-close`,
			expectedRevision: prepared.session.causal.revision,
			expectedSnapshotId: prepared.session.causal.snapshotId,
			kind,
		},
	});
	if (closed.status !== "ok") throw new Error(JSON.stringify(closed));
	const [archive] = await readdir(historyDir(prepared.workspace));
	if (!archive) throw new Error("Expected one ownership-proof archive.");
	return {
		session: SessionSchema.parse(
			JSON.parse(
				await readFile(join(historyDir(prepared.workspace), archive), "utf8"),
			),
		),
		workspace: prepared.workspace,
	};
}

export const stateSchemaCorruptionProof = executableProof(
	"Session parsing rejects a mismatched active feature/run pair.",
	(assertions: ProofAssertions) => {
		const running = runningSequenceSession(701);
		const corruptions = [
			{ ...running, activeFeatureRunId: null },
			{
				...running,
				featureRuns: running.featureRuns.map((run) =>
					run.id === running.activeFeatureRunId
						? { ...run, status: "completed" as const, endedAt: run.startedAt }
						: run,
				),
			},
			{
				...running,
				plan: running.plan
					? {
							...running.plan,
							features: running.plan.features.map((feature) =>
								feature.id === running.activeFeatureId
									? { ...feature, status: "pending" as const }
									: feature,
							),
						}
					: null,
			},
			{
				...running,
				closure: {
					kind: "deferred" as const,
					summary: "Corrupted closure retains active execution.",
					recordedAt: running.timestamps.updatedAt,
					retryOperationId: "missing-close-mutation",
				},
			},
		];
		assertions.match(
			validateSessionInvariants(corruptions[0] ?? running) ?? "",
			/active feature and active feature run/i,
		);
		for (const corrupted of corruptions) {
			assertions.ok(validateSessionInvariants(corrupted));
			assertions.equal(SessionSchema.safeParse(corrupted).success, false);
		}
	},
);

export const stateTransitionTableProof = executableProof(
	"Plan, approval, and run transitions enforce their state table.",
	(assertions: ProofAssertions) => {
		const env = environment();
		const created = createSession("Prove the transition table", env);
		const prematureApproval = approvePlan(created, env);
		assertions.equal(prematureApproval.ok, false);
		const planned = applyPlan(created, oneFeaturePlan(), env);
		assertions.equal(planned.ok, true);
		assertions.ok(planned.ok);
		const approved = approvePlan(planned.value, env);
		assertions.equal(approved.ok, true);
		assertions.ok(approved.ok);
		const running = startRun(approved.value, env, FEATURE_ID);
		assertions.equal(running.ok, true);
		assertions.ok(running.ok);
		assertions.equal(running.value.session.status, "running");
		assertions.equal(validateSessionInvariants(running.value.session), null);
	},
);

export const stateMachineProof = executableProof(
	"A seeded repository sequence covers the complete lifecycle, reloads accepted state, and preserves rejected bytes.",
	async (assertions: ProofAssertions) => {
		const result = await runDeterministicRepositoryLifecycleSequence(811, 24);
		assertions.deepEqual(
			new Set(result.actionCoverage),
			new Set(REQUIRED_REPOSITORY_SEQUENCE_ACTIONS),
		);
		for (const action of result.actionCoverage) assertions.cover(action);
		assertions.ok(result.acceptedMutationCount >= 15);
		assertions.ok(result.atomicRejectionCount >= 2);
		assertions.ok(result.repositoryReloadCount >= result.acceptedMutationCount);
		assertions.equal(result.archivedSession.closure?.kind, "completed");
	},
	REQUIRED_REPOSITORY_SEQUENCE_ACTIONS,
);

export const persistenceReloadProof = executableProof(
	"An accepted running state serializes and reloads without identity loss.",
	async (assertions: ProofAssertions) => {
		const workspace = await mkdtemp(join(tmpdir(), "flow-invariant-reload-"));
		try {
			const running = runningSequenceSession(907);
			const saved = await saveSession(workspace, running);
			const bytes = await readFile(sessionPath(workspace), "utf8");
			const loaded = await loadSession(workspace);
			assertions.ok(loaded);
			assertions.deepEqual(loaded, saved);
			assertions.deepEqual(SessionSchema.parse(JSON.parse(bytes)), saved);
			assertions.equal(validateSessionInvariants(saved), null);
		} finally {
			await rm(workspace, { force: true, recursive: true });
		}
	},
);

export const timePersistenceParseProof = executableProof(
	"Persisted run, evidence, assignment, review, prerequisite, and mutation chronology corruptions are rejected.",
	async (assertions: ProofAssertions) => {
		const running = runningSequenceSession(1103);
		const stateEnvironment = environment();
		const planning = createSession(
			"Prove persisted aggregate state",
			stateEnvironment,
		);
		const planned = applyPlan(planning, oneFeaturePlan(), stateEnvironment);
		assertions.ok(planned.ok);
		const ready = approvePlan(planned.value, stateEnvironment);
		assertions.ok(ready.ok);
		const activeRunCorruption = {
			...running,
			featureRuns: running.featureRuns.map((run) =>
				run.status === "active"
					? { ...run, endedAt: "2026-07-19T11:59:59.999Z" }
					: run,
			),
		};
		assertions.match(
			validateSessionInvariants(activeRunCorruption) ?? "",
			/status must agree with its end time|ends before it starts/i,
		);
		const rich = (await runDeterministicRepositoryLifecycleSequence(1103, 20))
			.archivedSession;
		const assigned = rich.reviewAssignments.find(
			(assignment) => assignment.status === "submitted",
		);
		const validation = rich.causal.evidence.find(
			(evidence) =>
				evidence.kind === "validation" &&
				assigned?.validationEvidenceRefs.includes(evidence.evidenceId),
		);
		const execution = rich.budget.reviewExecutions[0];
		const finalAssignment = rich.reviewAssignments.find(
			(assignment) => assignment.reviewKind === "final",
		);
		assertions.ok(validation && assigned && execution && finalAssignment);
		const run = rich.featureRuns.find(
			(candidate) => candidate.id === validation.featureRunId,
		);
		assertions.ok(run);
		const corrupt = (mutate: (session: Session) => void): Session => {
			const clone = structuredClone(rich);
			mutate(clone);
			return clone;
		};
		const corruptions = [
			[
				"active-run-status",
				activeRunCorruption,
				/status must agree with its end time/i,
			],
			[
				"run-end",
				corrupt((session) => {
					const target = session.featureRuns.find(
						(candidate) => candidate.id === run.id,
					);
					if (target) target.endedAt = offsetBefore(target.startedAt);
				}),
				/ends before it starts/i,
			],
			[
				"validation-run",
				corrupt((session) => {
					const target = session.causal.evidence.find(
						(evidence) => evidence.evidenceId === validation.evidenceId,
					);
					if (target) target.startedAt = offsetBefore(run.startedAt);
				}),
				/violates feature-run chronology/i,
			],
			[
				"assignment-validation",
				corrupt((session) => {
					const targetAssignment = session.reviewAssignments.find(
						(candidate) => candidate.id === assigned.id,
					);
					const targetValidation = session.causal.evidence.find(
						(evidence) => evidence.evidenceId === validation.evidenceId,
					);
					if (targetAssignment && targetValidation) {
						targetValidation.completedAt = offsetAfter(
							targetAssignment.startedAt,
						);
					}
				}),
				/postdates its accepting mutation/i,
			],
			[
				"review-assignment",
				corrupt((session) => {
					const targetExecution = session.budget.reviewExecutions.find(
						(candidate) => candidate.assignmentId === execution.assignmentId,
					);
					const targetAssignment = session.reviewAssignments.find(
						(candidate) => candidate.id === execution.assignmentId,
					);
					if (targetExecution && targetAssignment) {
						const completedAt = offsetBefore(targetExecution.startedAt);
						targetExecution.completedAt = completedAt;
						targetAssignment.completedAt = completedAt;
					}
				}),
				/inconsistent with its assignment/i,
			],
			[
				"mutation-order",
				corrupt((session) => {
					const mutation = session.causal.mutations[1];
					if (mutation)
						mutation.recordedAt = offsetBefore(session.timestamps.createdAt);
				}),
				/violates runtime chronology/i,
			],
			[
				"final-prerequisite",
				corrupt((session) => {
					const target = session.reviewAssignments.find(
						(candidate) => candidate.id === finalAssignment.id,
					);
					if (target?.prerequisite) {
						target.prerequisite.result.completedAt = offsetAfter(
							target.startedAt,
						);
						target.prerequisite.resultDigest =
							canonicalReviewAssignmentResultDigest(target.prerequisite.result);
					}
				}),
				/invalid canonical review identity|predates its prerequisite result/i,
			],
		] as const;
		for (const [dimension, corrupted, expectedError] of corruptions) {
			assertions.match(
				validateSessionInvariants(corrupted) ?? "",
				expectedError,
			);
			assertions.equal(SessionSchema.safeParse(corrupted).success, false);
			assertions.cover(dimension);
		}

		const blockedFixture = await blockedOwnershipSession();
		const deferredFixture = await closedOwnershipSession("deferred");
		const abandonedFixture = await closedOwnershipSession("abandoned");
		const equalClockFixture = await equalClockCompletedSession();
		const blockedFeature = blockedFixture.session.plan?.features.find(
			(feature) => feature.status === "blocked",
		);
		assertions.ok(blockedFeature);
		const resetBlocked = resetFeature(
			blockedFixture.session,
			blockedFeature.id,
			{
				now: () => offsetAfter(blockedFixture.session.timestamps.updatedAt),
				newSessionId: () => blockedFixture.session.id,
			},
			{
				operationId: "aggregate-blocked-reset",
				expectedRevision: blockedFixture.session.causal.revision,
				expectedSnapshotId: blockedFixture.session.causal.snapshotId,
			},
		);
		assertions.ok(resetBlocked.ok);
		const restartedBlocked = startRun(
			resetBlocked.value,
			{
				now: () => offsetAfter(resetBlocked.value.timestamps.updatedAt),
				newSessionId: () => resetBlocked.value.id,
			},
			blockedFeature.id,
		);
		assertions.ok(restartedBlocked.ok);
		const closedPlanning = closeSession(
			planning,
			"deferred",
			stateEnvironment,
			"Close valid planning state.",
			{
				operationId: "aggregate-planning-close",
				expectedRevision: planning.causal.revision,
				expectedSnapshotId: planning.causal.snapshotId,
			},
		);
		const closedReady = closeSession(
			ready.value,
			"abandoned",
			stateEnvironment,
			"Close valid ready state.",
			{
				operationId: "aggregate-ready-close",
				expectedRevision: ready.value.causal.revision,
				expectedSnapshotId: ready.value.causal.snapshotId,
			},
		);
		const closedReadyDefault = closeSession(
			ready.value,
			"deferred",
			stateEnvironment,
			undefined,
			{
				operationId: "aggregate-ready-default-close",
				expectedRevision: ready.value.causal.revision,
				expectedSnapshotId: ready.value.causal.snapshotId,
			},
		);
		const closedBlocked = closeSession(
			blockedFixture.session,
			"deferred",
			{
				now: () => offsetAfter(blockedFixture.session.timestamps.updatedAt),
				newSessionId: () => blockedFixture.session.id,
			},
			"Close valid blocked state.",
			{
				operationId: "aggregate-blocked-close",
				expectedRevision: blockedFixture.session.causal.revision,
				expectedSnapshotId: blockedFixture.session.causal.snapshotId,
			},
		);
		assertions.ok(
			closedPlanning.ok &&
				closedReady.ok &&
				closedReadyDefault.ok &&
				closedBlocked.ok,
		);
		try {
			for (const fixture of [
				blockedFixture.session,
				resetBlocked.value,
				restartedBlocked.value.session,
				deferredFixture.session,
				abandonedFixture.session,
				equalClockFixture.session,
				closedPlanning.value,
				closedReady.value,
				closedReadyDefault.value,
				closedBlocked.value,
			]) {
				assertions.equal(validateSessionInvariants(fixture), null);
				assertions.equal(SessionSchema.safeParse(fixture).success, true);
			}
			assertions.cover("state-valid-closure-variants");
			const equalClockRun = equalClockFixture.session.featureRuns.find(
				(run) => run.status === "completed",
			);
			assertions.ok(equalClockRun);
			const equalClockCompletions =
				equalClockFixture.session.causal.mutations.filter(
					(mutation) =>
						mutation.operationKind === "feature_complete" &&
						mutation.featureRunId === equalClockRun.id,
				);
			assertions.equal(equalClockCompletions.length, 2);
			assertions.equal(
				new Set(equalClockCompletions.map((mutation) => mutation.recordedAt))
					.size,
				1,
			);
			assertions.equal(equalClockCompletions[0]?.changedEntity.kind, "review");
			assertions.equal(equalClockCompletions[1]?.changedEntity.kind, "feature");
			assertions.cover("history-equal-clock-terminal-owner");
			const completedRun = rich.featureRuns.find(
				(candidate) => candidate.status === "completed",
			);
			const resetRun = rich.featureRuns.find(
				(candidate) => candidate.status === "reset",
			);
			const resetMutation = rich.causal.mutations.find(
				(mutation) =>
					mutation.operationKind === "feature_reset" &&
					mutation.featureRunId === resetRun?.id,
			);
			const dependentFeature = rich.plan?.features.find(
				(feature) => feature.dependsOn.length > 0,
			);
			const dependentRun = rich.featureRuns.find(
				(run) =>
					run.featureId === dependentFeature?.id && run.status === "completed",
			);
			const dependentStartMutation = rich.causal.mutations.find(
				(mutation) =>
					mutation.operationKind === "run_start" &&
					mutation.featureRunId === dependentRun?.id,
			);
			const dependencyCompletionMutation = rich.causal.mutations
				.filter(
					(mutation) =>
						mutation.operationKind === "feature_complete" &&
						mutation.changedEntity.kind === "feature" &&
						mutation.changedEntity.id === dependentFeature?.dependsOn[0] &&
						mutation.revision < (dependentStartMutation?.revision ?? -1),
				)
				.at(-1);
			const sourceInvalidation = rich.reviewAssignments.find(
				(assignment) => assignment.invalidationReason === "source_changed",
			);
			const resetInvalidation = rich.reviewAssignments.find(
				(assignment) => assignment.invalidationReason === "feature_reset",
			);
			const sourceInvalidationHistory = rich.history.find(
				(entry) => entry.featureRunId === sourceInvalidation?.featureRunId,
			);
			assertions.ok(
				completedRun &&
					resetRun &&
					resetMutation &&
					dependentFeature &&
					dependentRun &&
					dependentStartMutation &&
					dependencyCompletionMutation &&
					sourceInvalidation &&
					resetInvalidation &&
					sourceInvalidationHistory,
			);
			const ownershipCorruptions: Array<readonly [string, Session, RegExp]> = [
				[
					"run-start-owner",
					corrupt((session) => {
						const target = session.featureRuns.find(
							(candidate) => candidate.id === completedRun.id,
						);
						if (target) target.startedAt = offsetBefore(target.startedAt);
					}),
					/runtime-owned start mutation/i,
				],
				[
					"run-completed-owner",
					corrupt((session) => {
						const target = session.featureRuns.find(
							(candidate) => candidate.id === completedRun.id,
						);
						if (target?.endedAt) target.endedAt = offsetAfter(target.endedAt);
					}),
					/runtime-owned terminal mutation/i,
				],
				[
					"run-reset-owner",
					corrupt((session) => {
						const target = session.featureRuns.find(
							(candidate) => candidate.id === resetRun.id,
						);
						if (target?.endedAt) target.endedAt = offsetAfter(target.endedAt);
					}),
					/runtime-owned terminal mutation/i,
				],
				[
					"invalidation-source-owner",
					corrupt((session) => {
						const target = session.reviewAssignments.find(
							(candidate) => candidate.id === sourceInvalidation.id,
						);
						if (target?.invalidatedAt) {
							target.invalidatedAt = offsetAfter(target.invalidatedAt);
						}
					}),
					/runtime-owned invalidation mutation/i,
				],
				[
					"invalidation-reset-owner",
					corrupt((session) => {
						const target = session.reviewAssignments.find(
							(candidate) => candidate.id === resetInvalidation.id,
						);
						if (target?.invalidatedAt) {
							target.invalidatedAt = offsetBefore(target.invalidatedAt);
						}
					}),
					/runtime-owned invalidation mutation/i,
				],
			];
			for (const [dimension, fixture, status, invalidationReason] of [
				["run-blocked-owner", blockedFixture.session, "blocked", null],
				[
					"run-deferred-owner",
					deferredFixture.session,
					"deferred",
					"session_deferred",
				],
				[
					"run-abandoned-owner",
					abandonedFixture.session,
					"abandoned",
					"session_abandoned",
				],
			] as const) {
				const terminalCorruption = structuredClone(fixture);
				const terminalRun = terminalCorruption.featureRuns.find(
					(candidate) => candidate.status === status,
				);
				if (terminalRun?.endedAt) {
					terminalRun.endedAt = offsetAfter(terminalRun.endedAt);
				}
				ownershipCorruptions.push([
					dimension,
					terminalCorruption,
					/runtime-owned terminal mutation/i,
				]);
				if (invalidationReason) {
					const invalidationCorruption = structuredClone(fixture);
					const invalidated = invalidationCorruption.reviewAssignments.find(
						(assignment) =>
							assignment.invalidationReason === invalidationReason,
					);
					if (invalidated?.invalidatedAt) {
						invalidated.invalidatedAt = offsetBefore(invalidated.invalidatedAt);
					}
					ownershipCorruptions.push([
						`invalidation-${status}-owner`,
						invalidationCorruption,
						/runtime-owned invalidation mutation/i,
					]);
				}
			}
			for (const [
				dimension,
				corrupted,
				expectedError,
			] of ownershipCorruptions) {
				assertions.match(
					validateSessionInvariants(corrupted) ?? "",
					expectedError,
				);
				assertions.equal(SessionSchema.safeParse(corrupted).success, false);
				assertions.cover(dimension);
			}

			const reviewEvidence = rich.causal.evidence.find(
				(record): record is Extract<typeof record, { kind: "review" }> =>
					record.kind === "review" &&
					record.assignmentId === execution.assignmentId,
			);
			const historyWithValidation = rich.history.find(
				(entry) => entry.validationEvidenceRefs.length > 0,
			);
			const finalHistory = rich.history.find(
				(entry) => entry.reviewAssignmentIds.length === 2,
			);
			const blockedHistory = blockedFixture.session.history.at(-1);
			const unrelatedBlockedValidation =
				blockedFixture.session.causal.evidence.find(
					(record) =>
						record.kind === "validation" &&
						record.featureRunId === blockedHistory?.featureRunId &&
						!blockedHistory.validationEvidenceRefs.includes(record.evidenceId),
				);
			const failedRunId = Object.keys(
				blockedFixture.session.budget.failedReviewAttemptsByFeatureRun,
			)[0];
			assertions.ok(
				reviewEvidence &&
					historyWithValidation &&
					finalHistory &&
					blockedHistory &&
					unrelatedBlockedValidation &&
					failedRunId,
			);
			const blockedCorrupt = (mutate: (session: Session) => void): Session => {
				const clone = structuredClone(blockedFixture.session);
				mutate(clone);
				return clone;
			};
			const stateCorrupt = (
				base: Session,
				mutate: (session: Session) => void,
			): Session => {
				const clone = structuredClone(base);
				mutate(clone);
				return clone;
			};
			const graphCorruptions: Array<readonly [string, Session, RegExp]> = [
				[
					"state-zero-mutation-time-order",
					stateCorrupt(planning, (session) => {
						session.timestamps.updatedAt = offsetBefore(
							session.timestamps.createdAt,
						);
					}),
					/update time cannot precede its creation time/i,
				],
				[
					"mutation-evidence-resolution",
					corrupt((session) => {
						const mutation = session.causal.mutations.find(
							(candidate) => candidate.operationKind === "plan_approve",
						);
						if (mutation) {
							mutation.evidenceRefs.push(`sha256:${"f".repeat(64)}`);
						}
					}),
					/references missing evidence/i,
				],
				[
					"state-running-approval",
					stateCorrupt(running, (session) => {
						session.approval = "pending";
					}),
					/approval must be pending exactly while the session is planning/i,
				],
				[
					"state-ready-approval",
					stateCorrupt(ready.value, (session) => {
						session.approval = "pending";
					}),
					/approval must be pending exactly while the session is planning/i,
				],
				[
					"state-planning-approval",
					stateCorrupt(planned.value, (session) => {
						session.approval = "approved";
					}),
					/approval must be pending exactly while the session is planning/i,
				],
				[
					"state-completed-feature-status",
					corrupt((session) => {
						const feature = session.plan?.features[0];
						if (feature) feature.status = "pending";
					}),
					/completed session requires every plan feature to be completed/i,
				],
				[
					"state-completed-timestamp",
					corrupt((session) => {
						session.timestamps.completedAt = null;
					}),
					/completed status must agree with its valid completion timestamp/i,
				],
				[
					"state-plan-duplicate-feature",
					corrupt((session) => {
						const first = session.plan?.features[0];
						const second = session.plan?.features[1];
						if (first && second) second.id = first.id;
					}),
					/plan feature.*is duplicated/i,
				],
				[
					"state-plan-dependency-cycle",
					stateCorrupt(ready.value, (session) => {
						const feature = session.plan?.features[0];
						if (feature) feature.dependsOn = [feature.id];
					}),
					/plan feature.*cannot depend on itself/i,
				],
				[
					"state-last-error-status",
					stateCorrupt(running, (session) => {
						session.lastError = blockedFixture.session.lastError;
					}),
					/persisted lifecycle error must exist exactly while the session is blocked/i,
				],
				[
					"state-blocked-last-error",
					blockedCorrupt((session) => {
						session.lastError = null;
					}),
					/persisted lifecycle error must exist exactly while the session is blocked/i,
				],
				[
					"state-blocked-error-binding",
					blockedCorrupt((session) => {
						if (session.lastError) {
							session.lastError.summary = "Divergent blocker summary.";
						}
					}),
					/blocked session error must exactly match its latest terminal history outcome/i,
				],
				[
					"state-multiple-blocked-features",
					blockedCorrupt((session) => {
						const blocked = session.plan?.features.find(
							(feature) => feature.status === "blocked",
						);
						if (blocked && session.plan) {
							session.plan.features.push({
								...blocked,
								id: toFeatureId("forged-secondary-blocker"),
								dependsOn: [],
							});
						}
					}),
					/exactly one blocked feature/i,
				],
				[
					"reset-affected-closure",
					corrupt((session) => {
						const mutation = session.causal.mutations.find(
							(candidate) =>
								candidate.operationId === resetMutation.operationId,
						);
						if (mutation) {
							mutation.blockerDelta.removed =
								mutation.blockerDelta.removed.filter(
									(featureId) => featureId !== resetRun.featureId,
								);
						}
					}),
					/feature reset.*must record its exact dependency closure/i,
				],
				[
					"run-terminal-causal-order",
					corrupt((session) => {
						const start = session.causal.mutations.find(
							(mutation) =>
								mutation.operationKind === "run_start" &&
								mutation.featureRunId === completedRun.id,
						);
						const terminal = session.causal.mutations.find(
							(mutation) =>
								mutation.operationKind === "feature_complete" &&
								mutation.featureRunId === completedRun.id &&
								mutation.changedEntity.kind === "feature",
						);
						if (start && terminal) terminal.revision = start.revision;
					}),
					/runtime-owned terminal mutation/i,
				],
				[
					"run-reset-before-rerun",
					stateCorrupt(restartedBlocked.value.session, (session) => {
						const secondRun = session.featureRuns.find(
							(run) =>
								run.featureId === blockedFeature.id && run.sequence === 2,
						);
						const secondStart = session.causal.mutations.find(
							(mutation) =>
								mutation.operationKind === "run_start" &&
								mutation.featureRunId === secondRun?.id,
						);
						const reset = session.causal.mutations.find(
							(mutation) => mutation.operationId === "aggregate-blocked-reset",
						);
						if (reset && secondStart) reset.revision = secondStart.revision;
					}),
					/requires a causal feature reset after its prior run and before its start/i,
				],
				[
					"run-dependency-causal-order",
					corrupt((session) => {
						const completion = session.causal.mutations.find(
							(mutation) =>
								mutation.operationId ===
								dependencyCompletionMutation.operationId,
						);
						if (completion) {
							completion.revision = dependentStartMutation.revision;
						}
					}),
					/started before dependency.*had a current successful completion/i,
				],
				[
					"state-feature-run-binding",
					stateCorrupt(ready.value, (session) => {
						const feature = session.plan?.features[0];
						if (feature && session.plan) {
							feature.status = "completed";
							session.plan.features.push({
								...feature,
								id: toFeatureId("forged-pending-feature"),
								dependsOn: [],
								status: "pending",
							});
						}
					}),
					/completed plan feature.*requires a latest completed feature run/i,
				],
				[
					"state-feature-run-sequence",
					corrupt((session) => {
						const run = session.featureRuns[0];
						if (run) run.sequence += 1;
					}),
					/feature run.*is out of sequence/i,
				],
				[
					"state-feature-status-after-reset",
					stateCorrupt(resetBlocked.value, (session) => {
						session.status = "blocked";
						session.lastError = structuredClone(
							blockedFixture.session.lastError,
						);
						const feature = session.plan?.features.find(
							(candidate) => candidate.id === blockedFeature.id,
						);
						if (feature) feature.status = "blocked";
					}),
					/cannot retain terminal status after a later feature reset/i,
				],
				[
					"state-pending-feature-without-reset",
					corrupt((session) => {
						session.status = "ready";
						session.timestamps.completedAt = null;
						session.closure = null;
						const feature = session.plan?.features.at(-1);
						if (feature) feature.status = "pending";
					}),
					/pending plan feature.*requires a later feature reset/i,
				],
				[
					"closure-kind-binding",
					stateCorrupt(deferredFixture.session, (session) => {
						if (session.closure) session.closure.kind = "abandoned";
					}),
					/closure must identify its accepted close mutation/i,
				],
				[
					"closure-default-summary-binding",
					stateCorrupt(closedReadyDefault.value, (session) => {
						if (session.closure) {
							session.closure.summary = "Tampered default close summary.";
						}
					}),
					/closure must identify its accepted close mutation/i,
				],
				[
					"review-evidence-binding",
					corrupt((session) => {
						const target = session.causal.evidence.find(
							(record) => record.evidenceId === reviewEvidence.evidenceId,
						);
						if (target?.kind === "review") {
							target.sourceDigest = `sha256:${"f".repeat(64)}`;
						}
					}),
					/review evidence.*inconsistent with its assignment and execution/i,
				],
				[
					"assignment-causal-order",
					corrupt((session) => {
						const target = session.reviewAssignments.find(
							(candidate) => candidate.id === assigned.id,
						);
						const assignmentStart = session.causal.mutations.find(
							(mutation) => mutation.operationId === target?.operationId,
						);
						const runStart = session.causal.mutations.find(
							(mutation) =>
								mutation.operationKind === "run_start" &&
								mutation.featureRunId === target?.featureRunId,
						);
						if (assignmentStart && runStart) {
							assignmentStart.revision = runStart.revision;
						}
					}),
					/violates start chronology|runtime-owned invalidation mutation/i,
				],
				[
					"review-acceptance-causal-order",
					corrupt((session) => {
						const target = session.reviewAssignments.find(
							(candidate) => candidate.id === reviewEvidence.assignmentId,
						);
						const assignmentStart = session.causal.mutations.find(
							(mutation) => mutation.operationId === target?.operationId,
						);
						const acceptance = session.causal.mutations.find((mutation) =>
							mutation.evidenceRefs.includes(reviewEvidence.evidenceId),
						);
						if (assignmentStart && acceptance) {
							acceptance.revision = assignmentStart.revision;
						}
					}),
					/review evidence.*is inconsistent with its assignment and execution/i,
				],
				[
					"invalidation-causal-order",
					corrupt((session) => {
						const target = session.reviewAssignments.find(
							(candidate) => candidate.id === sourceInvalidation.id,
						);
						const assignmentStart = session.causal.mutations.find(
							(mutation) => mutation.operationId === target?.operationId,
						);
						const invalidation = session.causal.mutations.find(
							(mutation) =>
								mutation.operationKind === "review_start" &&
								mutation.recordedAt === target?.invalidatedAt &&
								mutation.operationId !== target?.operationId,
						);
						if (assignmentStart && invalidation) {
							invalidation.revision = assignmentStart.revision;
						}
					}),
					/runtime-owned invalidation mutation/i,
				],
				...([rich, blockedFixture.session] as const).flatMap((base, index) => {
					const status = index === 0 ? "completed" : "blocked";
					const label = status === "completed" ? "completed" : "blocked";
					const assignmentCorruption = stateCorrupt(base, (session) => {
						const entry = session.history.find(
							(candidate) => candidate.status === status,
						);
						const terminal = session.causal.mutations
							.filter(
								(mutation) =>
									mutation.operationKind === "feature_complete" &&
									mutation.featureRunId === entry?.featureRunId &&
									mutation.recordedAt === entry?.recordedAt,
							)
							.at(-1);
						const terminalAssignmentId = entry?.reviewAssignmentIds.at(-1);
						const terminalAssignment = session.reviewAssignments.find(
							(assignment) => assignment.id === terminalAssignmentId,
						);
						const assignmentStart = session.causal.mutations.find(
							(mutation) =>
								mutation.operationId === terminalAssignment?.operationId,
						);
						if (terminal && assignmentStart) {
							assignmentStart.revision = terminal.revision;
						}
					});
					const acceptanceCorruption = stateCorrupt(base, (session) => {
						const entry = session.history.find((candidate) => {
							if (candidate.status !== status) return false;
							return (
								session.causal.mutations.filter(
									(mutation) =>
										mutation.operationKind === "feature_complete" &&
										mutation.featureRunId === candidate.featureRunId,
								).length > 1
							);
						});
						const completions = session.causal.mutations.filter(
							(mutation) =>
								mutation.operationKind === "feature_complete" &&
								mutation.featureRunId === entry?.featureRunId,
						);
						const terminal = completions.at(-1);
						const earlierAcceptance = completions.at(-2);
						if (terminal && earlierAcceptance) {
							earlierAcceptance.revision = terminal.revision + 1;
						}
					});
					return [
						[
							`${label}-assignment-before-terminal`,
							assignmentCorruption,
							/review evidence.*is inconsistent with its assignment and execution|violates start chronology/i,
						],
						[
							`${label}-acceptance-before-terminal`,
							acceptanceCorruption,
							/review evidence.*is inconsistent with its assignment and execution/i,
						],
					] as const;
				}),
				[
					"execution-assignment-binding",
					corrupt((session) => {
						const target = session.budget.reviewExecutions.find(
							(candidate) => candidate.assignmentId === execution.assignmentId,
						);
						if (target) target.attemptId = "review-attempt:corrupted";
					}),
					/recorded review execution.*inconsistent with its assignment/i,
				],
				[
					"history-validation-type",
					corrupt((session) => {
						const target = session.history.find(
							(entry) =>
								entry.featureRunId === historyWithValidation.featureRunId,
						);
						if (target) {
							target.validationEvidenceRefs[0] = reviewEvidence.evidenceId;
						}
					}),
					/history entry.*unresolved evidence or assignment reference/i,
				],
				[
					"history-summary-binding",
					corrupt((session) => {
						const target = session.history.find(
							(entry) =>
								entry.featureRunId === historyWithValidation.featureRunId,
						);
						if (target) target.outcome.summary = "Divergent outcome summary.";
					}),
					/history entry.*does not match its terminal feature run/i,
				],
				[
					"history-terminal-assignment",
					corrupt((session) => {
						const target = session.history.find(
							(entry) =>
								entry.featureRunId === sourceInvalidationHistory.featureRunId,
						);
						if (target) target.reviewAssignmentIds[0] = sourceInvalidation.id;
					}),
					/history entry.*unresolved evidence or assignment reference/i,
				],
				[
					"history-final-assignment-sequence",
					corrupt((session) => {
						const target = session.history.find(
							(entry) => entry.featureRunId === finalHistory.featureRunId,
						);
						const finalAssignmentId = target?.reviewAssignmentIds.at(-1);
						if (target && finalAssignmentId) {
							target.reviewAssignmentIds = [finalAssignmentId];
						}
					}),
					/history entry.*disagrees with its terminal review outcomes/i,
				],
				[
					"history-validation-membership",
					blockedCorrupt((session) => {
						const target = session.history.find(
							(entry) => entry.featureRunId === blockedHistory.featureRunId,
						);
						if (target) {
							target.validationEvidenceRefs[0] =
								unrelatedBlockedValidation.evidenceId;
						}
					}),
					/history entry.*disagrees with its terminal review outcomes/i,
				],
				[
					"history-causal-order",
					corrupt((session) => {
						session.history = [...session.history].reverse();
					}),
					/canonical history must retain the latest terminal feature outcomes in causal order/i,
				],
				[
					"assignment-review-scope",
					corrupt((session) => {
						const target = session.reviewAssignments.find(
							(candidate) => candidate.id === assigned.id,
						);
						if (target) {
							target.validationScope =
								target.validationScope === "targeted" ? "broad" : "targeted";
						}
					}),
					/validation scope inconsistent with its review kind/i,
				],
				[
					"assignment-review-depth",
					corrupt((session) => {
						const target = session.reviewAssignments.find(
							(candidate) => candidate.id === assigned.id,
						);
						if (target) {
							target.requiredDepth =
								target.requiredDepth === "quick" ? "standard" : "quick";
						}
					}),
					/required depth disagrees with approved plan policy/i,
				],
				[
					"assignment-packet-identity",
					corrupt((session) => {
						const target = session.reviewAssignments.find(
							(candidate) => candidate.id === assigned.id,
						);
						if (target) target.packetSummary = "Divergent reviewer packet.";
					}),
					/review evidence.*is inconsistent with its assignment and execution|invalid canonical review identity/i,
				],
				[
					"assignment-attempt-identity",
					corrupt((session) => {
						const target = session.reviewAssignments.find(
							(candidate) => candidate.id === assigned.id,
						);
						if (target) target.attemptId = `review-attempt:${"f".repeat(32)}`;
					}),
					/review evidence.*is inconsistent with its assignment and execution|invalid canonical review identity/i,
				],
				[
					"assignment-logical-pass-identity",
					corrupt((session) => {
						const target = session.reviewAssignments.find(
							(candidate) => candidate.id === assigned.id,
						);
						if (target) {
							target.logicalPassId = `review-pass:${"f".repeat(32)}`;
						}
					}),
					/invalid canonical review identity/i,
				],
				[
					"execution-finding-identity",
					blockedCorrupt((session) => {
						const finding = session.budget.reviewExecutions
							.flatMap((record) => record.findings)
							.at(0);
						if (finding) {
							finding.fingerprint = `finding-v1-${"f".repeat(32)}`;
						}
					}),
					/noncanonical finding fingerprint/i,
				],
				[
					"evidence-canonical-identity",
					corrupt((session) => {
						const target = session.causal.evidence.find(
							(record) => record.evidenceId === validation.evidenceId,
						);
						if (target?.kind === "validation") {
							target.outputDigest = `sha256:${"a".repeat(64)}`;
						}
					}),
					/does not match its canonical identity/i,
				],
				[
					"assignment-validation-uniqueness",
					corrupt((session) => {
						const target = session.reviewAssignments.find(
							(candidate) => candidate.id === assigned.id,
						);
						const reference = target?.validationEvidenceRefs[0];
						if (target && reference) {
							target.validationEvidenceRefs.push(reference);
						}
					}),
					/validation evidence disagrees with its start mutation|invalid canonical review identity/i,
				],
				[
					"closure-completed-kind",
					corrupt((session) => {
						if (session.closure) session.closure.kind = "deferred";
					}),
					/closure kind must agree with completed workflow status/i,
				],
				[
					"ledger-failed-total",
					blockedCorrupt((session) => {
						session.budget.failedReviewCount += 1;
					}),
					/failed-review counters must exactly match/i,
				],
				[
					"ledger-failed-by-run",
					blockedCorrupt((session) => {
						session.budget.failedReviewAttemptsByFeatureRun[failedRunId] =
							(session.budget.failedReviewAttemptsByFeatureRun[failedRunId] ??
								0) + 1;
					}),
					/failed-review counters must exactly match/i,
				],
				[
					"ledger-lifecycle",
					blockedCorrupt((session) => {
						session.budget.reviewLifecycle.featureAttemptCount += 1;
					}),
					/review lifecycle counters must exactly match/i,
				],
				[
					"ledger-completed-review-count",
					corrupt((session) => {
						session.budget.reviewCount += 1;
					}),
					/completed-review count must equal review evidence accepted by successful feature completions/i,
				],
			];
			for (const [dimension, corrupted, expectedError] of graphCorruptions) {
				assertions.match(
					validateSessionInvariants(corrupted) ?? "",
					expectedError,
				);
				assertions.equal(SessionSchema.safeParse(corrupted).success, false);
				assertions.cover(dimension);
			}
		} finally {
			await Promise.all(
				[
					blockedFixture.workspace,
					deferredFixture.workspace,
					abandonedFixture.workspace,
					equalClockFixture.workspace,
				].map((workspace) => rm(workspace, { force: true, recursive: true })),
			);
		}
	},
	[
		"active-run-status",
		"run-end",
		"validation-run",
		"assignment-validation",
		"review-assignment",
		"mutation-order",
		"final-prerequisite",
		"run-start-owner",
		"run-completed-owner",
		"run-blocked-owner",
		"run-reset-owner",
		"run-deferred-owner",
		"run-abandoned-owner",
		"invalidation-source-owner",
		"invalidation-reset-owner",
		"invalidation-deferred-owner",
		"invalidation-abandoned-owner",
		"history-equal-clock-terminal-owner",
		"state-valid-closure-variants",
		"state-zero-mutation-time-order",
		"mutation-evidence-resolution",
		"state-running-approval",
		"state-ready-approval",
		"state-planning-approval",
		"state-completed-feature-status",
		"state-completed-timestamp",
		"state-plan-duplicate-feature",
		"state-plan-dependency-cycle",
		"state-last-error-status",
		"state-blocked-last-error",
		"state-blocked-error-binding",
		"state-multiple-blocked-features",
		"reset-affected-closure",
		"run-terminal-causal-order",
		"run-reset-before-rerun",
		"run-dependency-causal-order",
		"state-feature-run-binding",
		"state-feature-run-sequence",
		"state-feature-status-after-reset",
		"state-pending-feature-without-reset",
		"closure-kind-binding",
		"closure-default-summary-binding",
		"review-evidence-binding",
		"assignment-causal-order",
		"review-acceptance-causal-order",
		"invalidation-causal-order",
		"completed-assignment-before-terminal",
		"completed-acceptance-before-terminal",
		"blocked-assignment-before-terminal",
		"blocked-acceptance-before-terminal",
		"execution-assignment-binding",
		"history-validation-type",
		"history-terminal-assignment",
		"history-summary-binding",
		"history-final-assignment-sequence",
		"history-validation-membership",
		"history-causal-order",
		"assignment-review-scope",
		"assignment-review-depth",
		"assignment-packet-identity",
		"assignment-attempt-identity",
		"assignment-logical-pass-identity",
		"execution-finding-identity",
		"evidence-canonical-identity",
		"assignment-validation-uniqueness",
		"closure-completed-kind",
		"ledger-failed-total",
		"ledger-failed-by-run",
		"ledger-lifecycle",
		"ledger-completed-review-count",
	],
);

export const exactV4SchemaProof = executableProof(
	"The session schema rejects a generic non-v4 version.",
	(assertions: ProofAssertions) => {
		const session = createSession("Reject unsupported state", environment());
		assertions.equal(
			SessionSchema.safeParse({ ...session, version: 99 }).success,
			false,
		);
		assertions.equal(SessionSchema.safeParse(session).success, true);
	},
);

export const packageSurfaceProof = executableProof(
	"The actual built tarball exposes valid metadata, declarations, CLI, type consumer, and runtime consumer.",
	async (assertions: ProofAssertions) => {
		assertions.deepEqual(packageJson.files, [
			"dist",
			"LICENSE",
			"README.md",
			"CHANGELOG.md",
		]);
		assertions.equal(
			packageJson.files.some((path) =>
				/^(?:tests|skills|docs|scripts)(?:\/|$)/.test(path),
			),
			false,
		);
		const evidence = await runPackageSurfaceSmoke();
		assertions.cover("build");
		assertions.cover("pack");
		assertions.equal(evidence.packageVersion, packageJson.version);
		assertions.ok(evidence.tarballEntryCount > 0);
		assertions.ok(evidence.declarationCount > 0);
		assertions.cover("declarations");
		assertions.equal(evidence.cliVersion, packageJson.version);
		assertions.equal(evidence.legacyCleanupDryRun, true);
		assertions.equal(evidence.consumerTypechecked, true);
		assertions.cover("type-consumer");
		assertions.equal(evidence.runtimeImported, true);
		assertions.cover("runtime-consumer");
	},
	["build", "pack", "declarations", "type-consumer", "runtime-consumer"],
);

export const staticV4AbsenceProof = executableProof(
	"Active code, tests, fixtures, and guidance contain no superseded session-version path.",
	async (assertions: ProofAssertions) => {
		assertions.deepEqual(await auditSessionV4OnlyState(), []);
	},
);
