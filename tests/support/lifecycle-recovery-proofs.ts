import assert from "node:assert/strict";
import {
	link,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ToolContext, tool } from "@opencode-ai/plugin";
import {
	createFlowService,
	type FlowResponse,
} from "../../src/application/flow-service.js";
import type {
	SessionRepository,
	SessionTransaction,
} from "../../src/application/ports/session-repository.js";
import { SessionSchema } from "../../src/application/schema.js";
import { MAX_SESSION_ID_LENGTH } from "../../src/domain/limits.js";
import type {
	ReviewAssignmentResultInput,
	Session,
} from "../../src/domain/session.js";
import { toSessionId } from "../../src/domain/session.js";
import { validateSessionInvariants } from "../../src/domain/session-invariants.js";
import {
	canonicalReviewAssignmentResultDigest,
	closeSession,
	createSession,
} from "../../src/domain/transitions.js";
import { createFileSessionRepository } from "../../src/infrastructure/fs/session-repository.js";
import {
	archiveAndClearSession,
	archivedSessionFilename,
	archivedSessionPath,
	flowDir,
	historyDir,
	loadSession,
	saveSession,
	sessionPath,
} from "../../src/infrastructure/fs/workspace.js";
import {
	createWorkspaceFlowService,
	flowFeatureComplete,
	flowFeatureReset,
	flowPlanApprove,
	flowPlanSave,
	flowReviewStart,
	flowRunStart,
	flowSessionClose,
	flowStatus,
} from "../../src/infrastructure/fs/workspace-flow-service.js";
import { systemTransitionEnvironment } from "../../src/infrastructure/system/transition-environment.js";
import { createTools } from "../../src/platform/opencode/tools.js";
import {
	executableProof,
	type ProofAssertions,
} from "./lifecycle-invariant-registry.js";

const OUTPUT_DIGEST = `sha256:${"d".repeat(64)}`;

type PendingFinalFixture = {
	workspace: string;
	finalAssignmentId: string;
	reviewCountBeforeCompletion: number;
};

function responseAssignmentId(response: FlowResponse): string {
	const projection = response.workflowData?.projection as
		| { assignmentId?: string }
		| undefined;
	assert.ok(projection?.assignmentId, "Expected a review assignment id.");
	return projection.assignmentId;
}

async function temporaryWorkspace(prefix: string): Promise<string> {
	const workspace = await mkdtemp(join(tmpdir(), prefix));
	await writeFile(join(workspace, "source.ts"), "export const value = 1;\n");
	return workspace;
}

async function runningWorkspace(
	prefix: string,
	featureCount = 1,
): Promise<string> {
	const workspace = await temporaryWorkspace(prefix);
	const features = [
		{
			id: "first-feature",
			title: "First feature",
			summary: "Exercise lifecycle recovery.",
			targets: ["source.ts"],
		},
		...(featureCount === 2
			? [
					{
						id: "final-feature",
						title: "Final feature",
						summary: "Complete after durable final review recovery.",
						targets: ["source.ts"],
						dependsOn: ["first-feature"],
					},
				]
			: []),
	];
	const planned = await flowPlanSave(workspace, {
		goal: "Prove Session v4 recovery",
		plan: {
			summary: "Session v4 recovery proof.",
			overview: "Recover accepted lifecycle checkpoints from durable state.",
			features,
		},
	});
	assert.equal(planned.status, "ok");
	assert.equal((await flowPlanApprove(workspace)).status, "ok");
	assert.equal((await flowRunStart(workspace, {})).status, "ok");
	return workspace;
}

function validationAt(timestamp: string, label: string) {
	return {
		command: `bun test ${label}`,
		summary: `${label} passed.`,
		startedAt: timestamp,
		completedAt: timestamp,
		exitCode: 0,
		outputDigest: OUTPUT_DIGEST,
		environmentKeys: [],
	};
}

async function startFeatureAssignment(
	workspace: string,
	featureId: string,
	operationId: string,
): Promise<string> {
	const session = await loadSession(workspace);
	assert.ok(session?.activeFeatureRunId);
	const run = session.featureRuns.find(
		(candidate) => candidate.id === session.activeFeatureRunId,
	);
	assert.ok(run);
	const response = await flowReviewStart(workspace, {
		request: {
			operationId,
			expectedRevision: session.causal.revision,
			expectedSnapshotId: session.causal.snapshotId,
			featureId,
			reviewKind: "feature",
			validationScope: "targeted",
			packet: {
				summary: `Review ${featureId}.`,
				riskLenses: ["durable continuation"],
			},
			validations: [validationAt(run.startedAt, `${featureId}-targeted`)],
		},
	});
	assert.equal(response.status, "ok", JSON.stringify(response));
	return responseAssignmentId(response);
}

function passingResult(
	assignmentId: string,
	completedAt: string,
): ReviewAssignmentResultInput {
	return {
		assignmentId,
		verdict: "passed",
		findings: [],
		completedAt,
		terminalDisposition: "submitted",
	};
}

async function completeTargetedFeature(
	workspace: string,
	featureId: string,
	assignmentId: string,
	operationId: string,
): Promise<void> {
	const session = await loadSession(workspace);
	const assignment = session?.reviewAssignments.find(
		(candidate) => candidate.id === assignmentId,
	);
	assert.ok(session && assignment);
	const response = await flowFeatureComplete(workspace, {
		request: {
			operationId,
			expectedRevision: session.causal.revision,
			expectedSnapshotId: session.causal.snapshotId,
			featureId,
			result: {
				kind: "completed",
				summary: `${featureId} completed.`,
				artifactsChanged: [],
				validationScope: "targeted",
				featureReview: passingResult(assignment.id, assignment.startedAt),
			},
		},
	});
	assert.equal(response.status, "ok", JSON.stringify(response));
}

async function pendingFinalFixture(): Promise<PendingFinalFixture> {
	const workspace = await runningWorkspace("flow-final-recovery-", 2);
	const firstAssignmentId = await startFeatureAssignment(
		workspace,
		"first-feature",
		"first-feature-review",
	);
	await completeTargetedFeature(
		workspace,
		"first-feature",
		firstAssignmentId,
		"first-feature-complete",
	);
	assert.equal(
		(await flowRunStart(workspace, { featureId: "final-feature" })).status,
		"ok",
	);
	const featureAssignmentId = await startFeatureAssignment(
		workspace,
		"final-feature",
		"final-feature-review",
	);
	const afterFeatureAssignment = await loadSession(workspace);
	const featureAssignment = afterFeatureAssignment?.reviewAssignments.find(
		(candidate) => candidate.id === featureAssignmentId,
	);
	assert.ok(afterFeatureAssignment && featureAssignment);
	const featureResult = passingResult(
		featureAssignment.id,
		featureAssignment.startedAt,
	);
	const finalStarted = await flowReviewStart(workspace, {
		request: {
			operationId: "final-broad-review",
			expectedRevision: afterFeatureAssignment.causal.revision,
			expectedSnapshotId: afterFeatureAssignment.causal.snapshotId,
			featureId: "final-feature",
			reviewKind: "final",
			validationScope: "broad",
			featureReview: featureResult,
			packet: {
				summary: "Review the final feature after broad validation.",
				riskLenses: ["context loss", "atomic review recording"],
			},
			validations: [
				validationAt(featureResult.completedAt, "final-feature-broad"),
			],
		},
	});
	assert.equal(finalStarted.status, "ok", JSON.stringify(finalStarted));
	const persisted = await loadSession(workspace);
	assert.ok(persisted);
	return {
		workspace,
		finalAssignmentId: responseAssignmentId(finalStarted),
		reviewCountBeforeCompletion: persisted.budget.reviewExecutions.length,
	};
}

async function recoverFinalWithoutCallerPrerequisite(
	fixture: PendingFinalFixture,
): Promise<Session> {
	const service = createWorkspaceFlowService(fixture.workspace);
	const persisted = await loadSession(fixture.workspace);
	const finalAssignment = persisted?.reviewAssignments.find(
		(candidate) => candidate.id === fixture.finalAssignmentId,
	);
	assert.ok(persisted && finalAssignment?.prerequisite);
	const request = {
		request: {
			operationId: "context-loss-final-complete",
			expectedRevision: persisted.causal.revision,
			expectedSnapshotId: persisted.causal.snapshotId,
			featureId: "final-feature",
			result: {
				kind: "completed",
				summary: "Final feature completed after manager context loss.",
				artifactsChanged: [],
				validationScope: "broad",
				finalReview: passingResult(
					finalAssignment.id,
					finalAssignment.startedAt,
				),
			},
		},
	} as const;
	assert.equal(JSON.stringify(request).includes("featureReview"), false);
	const completed = await service.featureComplete(request);
	assert.equal(completed.status, "ok", JSON.stringify(completed));
	const session = await loadSession(fixture.workspace);
	assert.ok(session);
	return session;
}

async function activeSessionBytes(workspace: string): Promise<string> {
	return readFile(sessionPath(workspace), "utf8");
}

export {
	timeLifecycleBoundaryProof,
	timeReviewAtomicRejectionProof,
	timeValidationPerturbationProof,
} from "./lifecycle-time-proofs.js";

export const finalDomainTransitionProof = executableProof(
	"A final assignment stores one canonical bound feature result.",
	async (assertions: ProofAssertions) => {
		const fixture = await pendingFinalFixture();
		try {
			const session = await loadSession(fixture.workspace);
			assertions.ok(session);
			const assignment = session?.reviewAssignments.find(
				(candidate) => candidate.id === fixture.finalAssignmentId,
			);
			assertions.ok(assignment?.prerequisite);
			assertions.equal(
				assignment.prerequisite.result.assignmentId,
				assignment.prerequisite.assignmentId,
			);
			assertions.equal(
				assignment.prerequisite.resultDigest,
				canonicalReviewAssignmentResultDigest(assignment.prerequisite.result),
			);
			assertions.equal(validateSessionInvariants(session), null);
		} finally {
			await rm(fixture.workspace, { force: true, recursive: true });
		}
	},
);

export const finalContextLossProof = executableProof(
	"A fresh service completes final review without the caller's feature result.",
	async (assertions: ProofAssertions) => {
		const fixture = await pendingFinalFixture();
		try {
			const completed = await recoverFinalWithoutCallerPrerequisite(fixture);
			assertions.equal(completed.status, "completed");
			assertions.equal(
				completed.budget.reviewExecutions.length,
				fixture.reviewCountBeforeCompletion + 2,
			);
			assertions.equal(
				completed.reviewAssignments
					.filter((assignment) => assignment.featureId === "final-feature")
					.every((assignment) => assignment.status === "submitted"),
				true,
			);
			assertions.equal(validateSessionInvariants(completed), null);
		} finally {
			await rm(fixture.workspace, { force: true, recursive: true });
		}
	},
);

export const finalRegisteredHostPathProof = executableProof(
	"The registered final-completion handler survives context loss and records both reviews once.",
	async (assertions: ProofAssertions) => {
		const fixture = await pendingFinalFixture();
		try {
			const persisted = await loadSession(fixture.workspace);
			const finalAssignment = persisted?.reviewAssignments.find(
				(candidate) => candidate.id === fixture.finalAssignmentId,
			);
			assertions.ok(persisted && finalAssignment?.prerequisite);
			const request = {
				request: {
					operationId: "registered-final-complete",
					expectedRevision: persisted.causal.revision,
					expectedSnapshotId: persisted.causal.snapshotId,
					featureId: "final-feature",
					result: {
						kind: "completed",
						summary: "Final feature completed through the registered handler.",
						artifactsChanged: [],
						validationScope: "broad",
						finalReview: passingResult(
							finalAssignment.id,
							finalAssignment.startedAt,
						),
					},
				},
			};
			assertions.equal(
				JSON.stringify(request).includes("featureReview"),
				false,
			);
			const definition = createTools({}).flow_feature_complete;
			assertions.ok(definition);
			const parsed = tool.schema.object(definition.args).parse(request);
			const output = await definition.execute(parsed, {
				directory: fixture.workspace,
				worktree: fixture.workspace,
			} as ToolContext);
			const response = JSON.parse(
				typeof output === "string" ? output : output.output,
			) as FlowResponse;
			assertions.equal(response.status, "ok", JSON.stringify(response));
			const completed = await loadSession(fixture.workspace);
			assertions.ok(completed);
			assertions.equal(completed.history.at(-1)?.reviewAssignmentIds.length, 2);
			assertions.equal(completed.causal.revision > 0, true);
			assertions.equal(validateSessionInvariants(completed), null);
		} finally {
			await rm(fixture.workspace, { force: true, recursive: true });
		}
	},
);

type PendingCloseFixture = {
	workspace: string;
	operationId: string;
	closed: Session;
};

async function closeWithArchiveFailure(): Promise<PendingCloseFixture> {
	const workspace = await runningWorkspace("flow-close-recovery-");
	await startFeatureAssignment(
		workspace,
		"first-feature",
		"close-pending-review",
	);
	const active = await loadSession(workspace);
	assert.ok(active);
	const operationId = "c".repeat(128);
	const repository = createFileSessionRepository(workspace);
	const failingPublication = createFlowService(
		repositoryWithTransactionOverride(repository, (transaction) => ({
			...transaction,
			archiveAndClear: async () => {
				throw new Error("before-archive-publication failpoint");
			},
		})),
		systemTransitionEnvironment,
	);
	await assert.rejects(
		failingPublication.sessionClose({
			request: {
				mode: "start",
				operationId,
				expectedRevision: active.causal.revision,
				expectedSnapshotId: active.causal.snapshotId,
				kind: "deferred",
			},
		}),
	);
	const closed = await loadSession(workspace);
	assert.ok(closed?.closure);
	return { workspace, operationId, closed };
}

export const closeFailureInjectionProof = executableProof(
	"Closure save followed by archive failure leaves one quiescent recoverable session.",
	async (assertions: ProofAssertions) => {
		const fixture = await closeWithArchiveFailure();
		try {
			assertions.equal(
				fixture.closed.closure?.retryOperationId,
				fixture.operationId,
			);
			assertions.equal(fixture.closed.activeFeatureId, null);
			assertions.equal(fixture.closed.activeFeatureRunId, null);
			assertions.equal(fixture.closed.featureRuns.at(-1)?.status, "deferred");
			assertions.equal(
				fixture.closed.reviewAssignments.at(-1)?.invalidationReason,
				"session_deferred",
			);
			assertions.equal(validateSessionInvariants(fixture.closed), null);
			assertions.cover("before-archive-publication");
		} finally {
			await rm(fixture.workspace, { force: true, recursive: true });
		}
	},
	["before-archive-publication"],
);

export const closeStatusContractProof = executableProof(
	"Compact status exposes the complete durable retry operation id.",
	async (assertions: ProofAssertions) => {
		const fixture = await closeWithArchiveFailure();
		try {
			const status = await flowStatus(fixture.workspace, {
				request: { view: "compact" },
			});
			const projection = status.workflowData?.projection as
				| { closure?: { retryOperationId?: string } }
				| undefined;
			assertions.equal(status.status, "ok");
			assertions.equal(
				projection?.closure?.retryOperationId,
				fixture.operationId,
			);
			assertions.equal(projection?.closure?.retryOperationId?.length, 128);
		} finally {
			await rm(fixture.workspace, { force: true, recursive: true });
		}
	},
);

export const closeFreshServiceRetryProof = executableProof(
	"A fresh service retries archive publication with only the durable operation id.",
	async (assertions: ProofAssertions) => {
		const fixture = await closeWithArchiveFailure();
		try {
			const freshService = createWorkspaceFlowService(fixture.workspace);
			const response = await freshService.sessionClose({
				request: { mode: "retry", operationId: fixture.operationId },
			});
			assertions.equal(response.status, "ok");
			assertions.equal(await loadSession(fixture.workspace), null);
			assertions.equal(
				(await readdir(historyDir(fixture.workspace))).filter((name) =>
					name.endsWith(".json"),
				).length,
				1,
			);
		} finally {
			await rm(fixture.workspace, { force: true, recursive: true });
		}
	},
);

export const closeNoClobberProof = executableProof(
	"A colliding archive is preserved until the durable retry can publish safely.",
	async (assertions: ProofAssertions) => {
		const workspace = await runningWorkspace("flow-close-no-clobber-");
		try {
			const active = await loadSession(workspace);
			assertions.ok(active);
			await mkdir(historyDir(workspace), { recursive: true });
			const target = archivedSessionPath(workspace, active.id);
			const competing = closeSession(
				active,
				"abandoned",
				systemTransitionEnvironment,
				"Competing valid closed Session v4 archive.",
				{
					operationId: "competing-archive-close",
					expectedRevision: active.causal.revision,
					expectedSnapshotId: active.causal.snapshotId,
				},
			);
			assertions.ok(competing.ok);
			const olderArchive = `${JSON.stringify(competing.value, null, 2)}\n`;
			await writeFile(target, olderArchive, "utf8");
			const operationId = "close-no-clobber";
			await assertions.rejects(() =>
				flowSessionClose(workspace, {
					request: {
						mode: "start",
						operationId,
						expectedRevision: active.causal.revision,
						expectedSnapshotId: active.causal.snapshotId,
						kind: "abandoned",
					},
				}),
			);
			assertions.equal(await readFile(target, "utf8"), olderArchive);
			assertions.equal(
				(await loadSession(workspace))?.closure?.retryOperationId,
				operationId,
			);
		} finally {
			await rm(workspace, { force: true, recursive: true });
		}
	},
);

export const closeHistoryScanAtomicProof = executableProof(
	"Unreadable canonical history rejects before closure save and leaves the exact close identity reusable.",
	async (assertions: ProofAssertions) => {
		const workspace = await runningWorkspace("flow-close-history-scan-");
		try {
			const active = await loadSession(workspace);
			assertions.ok(active);
			const beforeBytes = await activeSessionBytes(workspace);
			await writeFile(
				historyDir(workspace),
				"history path is blocked\n",
				"utf8",
			);
			const operationId = "history-scan-close";
			const request = {
				request: {
					mode: "start" as const,
					operationId,
					expectedRevision: active.causal.revision,
					expectedSnapshotId: active.causal.snapshotId,
					kind: "deferred" as const,
				},
			};
			const rejected = await flowSessionClose(workspace, request);
			assertions.equal(rejected.status, "error", JSON.stringify(rejected));
			assertions.match(JSON.stringify(rejected), /archive|history/i);
			assertions.equal(await activeSessionBytes(workspace), beforeBytes);
			assertions.equal(
				(await loadSession(workspace))?.causal.mutations.some(
					(mutation) => mutation.operationId === operationId,
				),
				false,
			);
			await rm(historyDir(workspace), { force: true, recursive: true });
			await mkdir(historyDir(workspace), { recursive: true });
			const corrected = await flowSessionClose(workspace, request);
			assertions.equal(corrected.status, "ok", JSON.stringify(corrected));
			assertions.equal(await loadSession(workspace), null);
			assertions.cover("canonical-history-scan-before-save");
		} finally {
			await rm(workspace, { force: true, recursive: true });
		}
	},
	["canonical-history-scan-before-save"],
);

export const closeRetryHistoryScanAtomicProof = executableProof(
	"An active durable close rescans canonical history before retry publication without changing its bytes.",
	async (assertions: ProofAssertions) => {
		const fixture = await closeWithArchiveFailure();
		try {
			const beforeBytes = await activeSessionBytes(fixture.workspace);
			await mkdir(historyDir(fixture.workspace), { recursive: true });
			const malformedArchive = join(
				historyDir(fixture.workspace),
				"malformed-retry-history.json",
			);
			await writeFile(malformedArchive, "{bad\n", "utf8");
			const rejected = await createWorkspaceFlowService(
				fixture.workspace,
			).sessionClose({
				request: { mode: "retry", operationId: fixture.operationId },
			});
			assertions.equal(rejected.status, "error", JSON.stringify(rejected));
			assertions.match(JSON.stringify(rejected), /canonical|archive|history/i);
			assertions.equal(
				await activeSessionBytes(fixture.workspace),
				beforeBytes,
			);
			assertions.equal(
				(await loadSession(fixture.workspace))?.closure?.retryOperationId,
				fixture.operationId,
			);
			await rm(malformedArchive);
			const recovered = await createWorkspaceFlowService(
				fixture.workspace,
			).sessionClose({
				request: { mode: "retry", operationId: fixture.operationId },
			});
			assertions.equal(recovered.status, "ok", JSON.stringify(recovered));
			assertions.equal(await loadSession(fixture.workspace), null);
			assertions.cover("canonical-history-rescan-before-retry-publication");
		} finally {
			await rm(fixture.workspace, { force: true, recursive: true });
		}
	},
	["canonical-history-rescan-before-retry-publication"],
);

export const closeWorkspaceHistoryIdentityProof = executableProof(
	"A close operation id is unique at acceptance and remains recoverable after a later non-close reuse.",
	async (assertions: ProofAssertions) => {
		const workspace = await runningWorkspace("flow-close-history-identity-");
		try {
			const first = await loadSession(workspace);
			assertions.ok(first);
			const sharedOperationId = "workspace-history-close-id";
			const firstClose = await flowSessionClose(workspace, {
				request: {
					mode: "start",
					operationId: sharedOperationId,
					expectedRevision: first.causal.revision,
					expectedSnapshotId: first.causal.snapshotId,
					kind: "deferred",
				},
			});
			assertions.equal(firstClose.status, "ok", JSON.stringify(firstClose));
			const planned = await flowPlanSave(workspace, {
				goal: "Second session in the same workspace",
				plan: {
					summary: "Prove workspace-history close identity uniqueness.",
					overview: "A later session must use a new close operation id.",
					features: [
						{
							id: "second-session-feature",
							title: "Second session feature",
							summary: "Exercise canonical history scanning.",
							targets: ["source.ts"],
						},
					],
				},
			});
			assertions.equal(planned.status, "ok", JSON.stringify(planned));
			assertions.equal((await flowPlanApprove(workspace)).status, "ok");
			assertions.equal((await flowRunStart(workspace, {})).status, "ok");
			const second = await loadSession(workspace);
			assertions.ok(second);
			const beforeBytes = await activeSessionBytes(workspace);
			const collision = await flowSessionClose(workspace, {
				request: {
					mode: "start",
					operationId: sharedOperationId,
					expectedRevision: second.causal.revision,
					expectedSnapshotId: second.causal.snapshotId,
					kind: "abandoned",
				},
			});
			assertions.equal(collision.status, "error", JSON.stringify(collision));
			assertions.match(
				JSON.stringify(collision),
				/archive|operation id|history/i,
			);
			assertions.equal(await activeSessionBytes(workspace), beforeBytes);
			assertions.equal((await loadSession(workspace))?.closure, null);
			const laterNonCloseReuse = await flowFeatureReset(workspace, {
				operationId: sharedOperationId,
				expectedRevision: second.causal.revision,
				expectedSnapshotId: second.causal.snapshotId,
				featureId: "second-session-feature",
			});
			assertions.equal(
				laterNonCloseReuse.status,
				"ok",
				JSON.stringify(laterNonCloseReuse),
			);
			const resetSecond = await loadSession(workspace);
			assertions.ok(resetSecond);
			const corrected = await flowSessionClose(workspace, {
				request: {
					mode: "start",
					operationId: "second-workspace-close-id",
					expectedRevision: resetSecond.causal.revision,
					expectedSnapshotId: resetSecond.causal.snapshotId,
					kind: "abandoned",
				},
			});
			assertions.equal(corrected.status, "ok", JSON.stringify(corrected));
			assertions.equal(
				(await readdir(historyDir(workspace))).filter((name) =>
					name.endsWith(".json"),
				).length,
				2,
			);
			const replayedFirst = await flowSessionClose(workspace, {
				request: { mode: "retry", operationId: sharedOperationId },
			});
			assertions.deepEqual(replayedFirst, firstClose);
			assertions.cover("historical-close-survives-later-non-close-reuse");
		} finally {
			await rm(workspace, { force: true, recursive: true });
		}
	},
	["historical-close-survives-later-non-close-reuse"],
);

export const sessionIdArchiveBoundaryProof = executableProof(
	"Bounded session identities map to fixed, case-distinct canonical archive filenames.",
	async (assertions: ProofAssertions) => {
		const now = "2026-07-19T12:00:00.000Z";
		const boundaryId = "s".repeat(MAX_SESSION_ID_LENGTH);
		const boundaryEnvironment = {
			now: () => now,
			newSessionId: () => toSessionId(boundaryId),
		};
		const boundary = createSession(
			"Archive a maximum-length session id",
			boundaryEnvironment,
		);
		assertions.equal(SessionSchema.safeParse(boundary).success, true);
		const boundaryFilename = archivedSessionFilename(boundaryId);
		assertions.match(boundaryFilename, /^[a-f0-9]{64}\.json$/);
		assertions.equal(boundaryFilename.length, 69);
		assertions.equal(
			archivedSessionFilename("CaseSession") ===
				archivedSessionFilename("casesession"),
			false,
		);
		const closed = closeSession(
			boundary,
			"deferred",
			boundaryEnvironment,
			undefined,
			{
				operationId: "maximum-session-id-close",
				expectedRevision: boundary.causal.revision,
				expectedSnapshotId: boundary.causal.snapshotId,
			},
		);
		assertions.ok(closed.ok);
		const boundaryWorkspace = await temporaryWorkspace(
			"flow-session-id-boundary-",
		);
		const overlongWorkspace = await temporaryWorkspace(
			"flow-session-id-overlong-",
		);
		try {
			await saveSession(boundaryWorkspace, closed.value);
			await archiveAndClearSession(boundaryWorkspace, closed.value);
			assertions.match(
				await readFile(
					archivedSessionPath(boundaryWorkspace, boundaryId),
					"utf8",
				),
				/"version": 4/,
			);

			const overlongId = "s".repeat(MAX_SESSION_ID_LENGTH + 1);
			const overlongEnvironment = {
				now: () => now,
				newSessionId: () => toSessionId(overlongId),
			};
			const overlong = createSession(
				"Reject an unpublishable session id",
				overlongEnvironment,
			);
			assertions.equal(SessionSchema.safeParse(overlong).success, false);
			assertions.throws(
				() => archivedSessionPath(overlongWorkspace, overlongId),
				/Invalid session id/,
			);
			const overlongClosed = closeSession(
				overlong,
				"deferred",
				overlongEnvironment,
				undefined,
				{
					operationId: "overlong-session-id-close",
					expectedRevision: overlong.causal.revision,
					expectedSnapshotId: overlong.causal.snapshotId,
				},
			);
			assertions.ok(overlongClosed.ok);
			await assertions.rejects(
				() => saveSession(overlongWorkspace, overlongClosed.value),
				/Session id is too long/,
			);
			assertions.equal(await loadSession(overlongWorkspace), null);
			assertions.cover("session-id-archive-boundary");
			assertions.cover("fixed-digest-archive-name");
			assertions.cover("case-distinct-archive-identity");
		} finally {
			await Promise.all([
				rm(boundaryWorkspace, { force: true, recursive: true }),
				rm(overlongWorkspace, { force: true, recursive: true }),
			]);
		}
	},
	[
		"session-id-archive-boundary",
		"fixed-digest-archive-name",
		"case-distinct-archive-identity",
	],
);

async function pendingArchiveFixture(
	namespace: string,
): Promise<{ workspace: string; closed: Session }> {
	const workspace = await temporaryWorkspace(`flow-pinned-${namespace}-`);
	const now = "2026-07-19T12:00:00.000Z";
	const environment = {
		now: () => now,
		newSessionId: () => toSessionId(`pinned-${namespace}`),
	};
	const active = createSession(`Prove pinned ${namespace}`, environment);
	const closed = closeSession(active, "deferred", environment, undefined, {
		operationId: `pinned-${namespace}-close`,
		expectedRevision: active.causal.revision,
		expectedSnapshotId: active.causal.snapshotId,
	});
	assert.ok(closed.ok);
	await saveSession(workspace, closed.value);
	return { workspace, closed: closed.value };
}

export const archivePinnedTopologyProof = executableProof(
	"Archive publication and active cleanup stay pinned to validated directory identities.",
	async (assertions: ProofAssertions) => {
		const historyFixture = await pendingArchiveFixture("history-topology");
		const flowFixture = await pendingArchiveFixture("flow-topology");
		const historyOutside = await temporaryWorkspace("flow-history-outside-");
		const flowOutside = await temporaryWorkspace("flow-state-outside-");
		const parkedHistory = `${historyDir(historyFixture.workspace)}-parked`;
		const parkedFlow = `${flowDir(flowFixture.workspace)}-parked`;
		try {
			let historySwapCompleted = false;
			const historyActiveBytes = await readFile(
				sessionPath(historyFixture.workspace),
				"utf8",
			);
			await assertions.rejects(() =>
				archiveAndClearSession(
					historyFixture.workspace,
					historyFixture.closed,
					{
						afterHistoryPinned: async () => {
							await rename(historyDir(historyFixture.workspace), parkedHistory);
							historySwapCompleted = true;
							await symlink(
								historyOutside,
								historyDir(historyFixture.workspace),
								"dir",
							);
						},
					},
				),
			);
			assertions.deepEqual(await readdir(historyOutside), ["source.ts"]);
			assertions.deepEqual(
				await readdir(
					historySwapCompleted
						? parkedHistory
						: historyDir(historyFixture.workspace),
				),
				[],
			);
			assertions.equal(
				await readFile(sessionPath(historyFixture.workspace), "utf8"),
				historyActiveBytes,
			);
			assertions.cover("pinned-history-publication");

			let flowSwapCompleted = false;
			await assertions.rejects(() =>
				archiveAndClearSession(flowFixture.workspace, flowFixture.closed, {
					afterFlowPinnedBeforeDelete: async () => {
						await rename(flowDir(flowFixture.workspace), parkedFlow);
						flowSwapCompleted = true;
						await symlink(flowOutside, flowDir(flowFixture.workspace), "dir");
					},
				}),
			);
			assertions.deepEqual(await readdir(flowOutside), ["source.ts"]);
			assertions.match(
				await readFile(
					join(
						flowSwapCompleted ? parkedFlow : flowDir(flowFixture.workspace),
						"session.json",
					),
					"utf8",
				),
				/"closure"/,
			);
			assertions.cover("pinned-active-deletion");
		} finally {
			await Promise.all([
				rm(historyFixture.workspace, { force: true, recursive: true }),
				rm(flowFixture.workspace, { force: true, recursive: true }),
				rm(historyOutside, { force: true, recursive: true }),
				rm(flowOutside, { force: true, recursive: true }),
			]);
		}
	},
	["pinned-history-publication", "pinned-active-deletion"],
);

export const closeArchiveSafetyProof = executableProof(
	"Archive publication is bounded, collision-safe, and preserves historical close identity.",
	async (assertions: ProofAssertions) => {
		for (const [dimension, proof] of [
			["session-id archive boundary", sessionIdArchiveBoundaryProof],
			["pinned archive topology", archivePinnedTopologyProof],
			["session-id collision", closeNoClobberProof],
			[
				"workspace close-operation identity",
				closeWorkspaceHistoryIdentityProof,
			],
		] as const) {
			const result = await proof.run();
			assertions.ok(
				result.assertionCount > 0,
				`Archive safety did not assert ${dimension}.`,
			);
			assertions.cover(dimension);
			for (const evidence of result.evidence) {
				if (evidence !== "assertions") assertions.cover(evidence);
			}
			if (dimension === "workspace close-operation identity") {
				assertions.ok(
					result.evidence.includes(
						"historical-close-survives-later-non-close-reuse",
					),
				);
				assertions.cover("historical-close-survives-later-non-close-reuse");
			}
		}
	},
	[
		"session-id archive boundary",
		"fixed-digest-archive-name",
		"case-distinct-archive-identity",
		"pinned archive topology",
		"pinned-history-publication",
		"pinned-active-deletion",
		"session-id collision",
		"workspace close-operation identity",
		"historical-close-survives-later-non-close-reuse",
	],
);

export const closeAfterStateSaveProof = executableProof(
	"A failure after closure save recovers from compact status and the durable retry id.",
	async (assertions: ProofAssertions) => {
		const workspace = await runningWorkspace("flow-after-close-save-");
		try {
			const active = await loadSession(workspace);
			assertions.ok(active);
			const operationId = "after-close-state-save";
			const repository = createFileSessionRepository(workspace);
			const failingAfterSave = createFlowService(
				repositoryWithTransactionOverride(repository, (transaction) => ({
					...transaction,
					save: async (session) => {
						await transaction.save(session);
						throw new Error("after-state-save failpoint");
					},
				})),
				systemTransitionEnvironment,
			);
			await assertions.rejects(() =>
				failingAfterSave.sessionClose({
					request: {
						mode: "start",
						operationId,
						expectedRevision: active.causal.revision,
						expectedSnapshotId: active.causal.snapshotId,
						kind: "deferred",
						summary: "Caller-local summary must not be needed for recovery.",
					},
				}),
			);
			const closed = await loadSession(workspace);
			assertions.equal(closed?.closure?.retryOperationId, operationId);
			assertions.equal(closed?.activeFeatureRunId, null);
			const status = await createWorkspaceFlowService(workspace).status({
				request: { view: "compact" },
			});
			const projection = status.workflowData?.projection as
				| { closure?: { retryOperationId?: string } }
				| undefined;
			const recoveredOperationId = projection?.closure?.retryOperationId;
			assertions.equal(recoveredOperationId, operationId);
			assertions.ok(recoveredOperationId);
			const recovered = await createWorkspaceFlowService(
				workspace,
			).sessionClose({
				request: { mode: "retry", operationId: recoveredOperationId },
			});
			assertions.equal(recovered.status, "ok");
			assertions.equal(await loadSession(workspace), null);
			assertions.cover("after-closure-state-save");
		} finally {
			await rm(workspace, { force: true, recursive: true });
		}
	},
	["after-closure-state-save"],
);

function repositoryWithTransactionOverride(
	base: SessionRepository,
	override: (transaction: SessionTransaction) => SessionTransaction,
): SessionRepository {
	return {
		read: () => base.read(),
		transact: (task) =>
			base.transact((transaction) => task(override(transaction))),
	};
}

export const atomicFailpointReplayProof = executableProof(
	"Before-save and after-delete failures converge through exact operation replay.",
	async (assertions: ProofAssertions) => {
		const beforeSaveWorkspace = await runningWorkspace("flow-before-save-");
		const afterDeleteWorkspace = await runningWorkspace("flow-after-delete-");
		try {
			const before = await loadSession(beforeSaveWorkspace);
			assertions.ok(before);
			const baseBefore = createFileSessionRepository(beforeSaveWorkspace);
			const failingSave = createFlowService(
				repositoryWithTransactionOverride(baseBefore, (transaction) => ({
					...transaction,
					save: async () => {
						throw new Error("before-save failpoint");
					},
				})),
				systemTransitionEnvironment,
			);
			const beforeRequest = {
				request: {
					mode: "start",
					operationId: "before-save-close",
					expectedRevision: before.causal.revision,
					expectedSnapshotId: before.causal.snapshotId,
					kind: "deferred",
				},
			} as const;
			await assertions.rejects(() => failingSave.sessionClose(beforeRequest));
			assertions.deepEqual(await loadSession(beforeSaveWorkspace), before);
			const recoveredBefore =
				await createWorkspaceFlowService(beforeSaveWorkspace).sessionClose(
					beforeRequest,
				);
			assertions.equal(recoveredBefore.status, "ok");
			assertions.cover("before-state-save");

			const after = await loadSession(afterDeleteWorkspace);
			assertions.ok(after);
			const baseAfter = createFileSessionRepository(afterDeleteWorkspace);
			const failingAfterDelete = createFlowService(
				repositoryWithTransactionOverride(baseAfter, (transaction) => ({
					...transaction,
					archiveAndClear: async (session) => {
						await transaction.archiveAndClear(session);
						throw new Error("after-delete failpoint");
					},
				})),
				systemTransitionEnvironment,
			);
			const afterRequest = {
				request: {
					mode: "start",
					operationId: "after-delete-close",
					expectedRevision: after.causal.revision,
					expectedSnapshotId: after.causal.snapshotId,
					kind: "abandoned",
				},
			} as const;
			await assertions.rejects(() =>
				failingAfterDelete.sessionClose(afterRequest),
			);
			assertions.equal(await loadSession(afterDeleteWorkspace), null);
			const recoveredAfter = await createWorkspaceFlowService(
				afterDeleteWorkspace,
			).sessionClose({
				request: { mode: "retry", operationId: "after-delete-close" },
			});
			assertions.equal(recoveredAfter.status, "ok");
			assertions.cover("after-active-state-delete");
		} finally {
			await Promise.all([
				rm(beforeSaveWorkspace, { force: true, recursive: true }),
				rm(afterDeleteWorkspace, { force: true, recursive: true }),
			]);
		}
	},
	["before-state-save", "after-active-state-delete"],
);

export const archivePublishedResidueProof = executableProof(
	"An already-published exact archive is cleaned up without another mutation.",
	async (assertions: ProofAssertions) => {
		const workspace = await runningWorkspace("flow-published-residue-");
		try {
			const active = await loadSession(workspace);
			assertions.ok(active);
			const operationId = "published-residue-close";
			const transitioned = closeSession(
				active,
				"deferred",
				systemTransitionEnvironment,
				undefined,
				{
					operationId,
					expectedRevision: active.causal.revision,
					expectedSnapshotId: active.causal.snapshotId,
				},
			);
			assertions.ok(transitioned.ok);
			const closed = await saveSession(workspace, transitioned.value);
			await mkdir(historyDir(workspace), { recursive: true });
			await link(
				sessionPath(workspace),
				archivedSessionPath(workspace, closed.id),
			);
			const revision = closed.causal.revision;
			const retried = await createWorkspaceFlowService(workspace).sessionClose({
				request: { mode: "retry", operationId },
			});
			assertions.equal(retried.status, "ok");
			assertions.equal(await loadSession(workspace), null);
			const archived = JSON.parse(
				await readFile(archivedSessionPath(workspace, closed.id), "utf8"),
			) as Session;
			assertions.equal(archived.causal.revision, revision);
			assertions.cover("after-publication-before-active-delete");
		} finally {
			await rm(workspace, { force: true, recursive: true });
		}
	},
	["after-publication-before-active-delete"],
);

export const closeFailureInjectionMatrixProof = executableProof(
	"Seven close cut points converge: acceptance and retry history scans, before save, after save, before publication, after publication, and after deletion.",
	async (assertions: ProofAssertions) => {
		for (const [proof, cutPoints] of [
			[
				atomicFailpointReplayProof,
				["before-state-save", "after-active-state-delete"],
			],
			[closeAfterStateSaveProof, ["after-closure-state-save"]],
			[closeFailureInjectionProof, ["before-archive-publication"]],
			[
				archivePublishedResidueProof,
				["after-publication-before-active-delete"],
			],
			[closeHistoryScanAtomicProof, ["canonical-history-scan-before-save"]],
			[
				closeRetryHistoryScanAtomicProof,
				["canonical-history-rescan-before-retry-publication"],
			],
		] as const) {
			const result = await proof.run();
			for (const cutPoint of cutPoints) {
				assertions.ok(
					result.evidence.includes(cutPoint),
					`The close proof omitted structured evidence for ${cutPoint}.`,
				);
				assertions.cover(cutPoint);
			}
		}
	},
	[
		"canonical-history-scan-before-save",
		"canonical-history-rescan-before-retry-publication",
		"before-state-save",
		"after-closure-state-save",
		"before-archive-publication",
		"after-publication-before-active-delete",
		"after-active-state-delete",
	],
);
