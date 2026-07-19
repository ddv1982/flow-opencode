import { describe, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import {
	chmod,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { UnsupportedFlowSessionVersionError } from "../src/application/errors.js";
import { createFlowService } from "../src/application/flow-service.js";
import { ArchivedSessionLookupError } from "../src/application/ports/session-repository.js";
import { SessionSchema } from "../src/application/schema.js";
import { MAX_SESSION_ID_LENGTH } from "../src/domain/limits.js";
import type {
	ReviewAssignment,
	ReviewAssignmentResultInput,
} from "../src/domain/session.js";
import { toSessionId } from "../src/domain/session.js";
import { closeSession, createSession } from "../src/domain/transitions.js";
import { createFileSessionRepository } from "../src/infrastructure/fs/session-repository.js";
import {
	ArchiveCollisionError,
	archiveAndClearSession,
	archivedSessionFilename,
	archivedSessionPath,
	assertMutableWorkspaceRoot,
	findArchivedSessionByOperationId,
	flowDir,
	historyDir,
	loadSession,
	quarantineUnreadableSession,
	saveSession,
	sessionPath,
	UnclosedSessionArchiveError,
	UnsafeFlowWorkspaceLayoutError,
	withSessionLock,
} from "../src/infrastructure/fs/workspace.js";
import {
	createWorkspaceFlowService,
	flowFeatureComplete as executeFlowFeatureComplete,
	flowFeatureReset as executeFlowFeatureReset,
	flowReviewStart as executeFlowReviewStart,
	flowSessionClose as executeFlowSessionClose,
	flowStatus as executeFlowStatus,
	flowPlanApprove,
	flowPlanSave,
	flowRunStart,
} from "../src/infrastructure/fs/workspace-flow-service.js";
import { systemTransitionEnvironment } from "../src/infrastructure/system/transition-environment.js";

const SOURCE_DIGEST = `sha256:${"c".repeat(64)}`;
const OUTPUT_DIGEST = `sha256:${"d".repeat(64)}`;
let operationSequence = 0;

async function expectPinnedDirectorySwapRejected(
	action: () => Promise<unknown>,
	swapCompleted: () => boolean,
): Promise<void> {
	let rejection: unknown;
	try {
		await action();
	} catch (error) {
		rejection = error;
	}
	if (!rejection)
		throw new Error("Expected the pinned directory swap to fail.");
	if (swapCompleted()) {
		expect(rejection).toBeInstanceOf(UnsafeFlowWorkspaceLayoutError);
		return;
	}
	expect(process.platform).toBe("win32");
	const code = (rejection as NodeJS.ErrnoException).code;
	if (!code) throw new Error("Expected a Windows filesystem rejection code.");
	expect(["EBUSY", "EPERM", "EACCES"]).toContain(code);
}

function validationObservation(featureId: string, recordedAt: string) {
	return {
		command: `bun test ${featureId}`,
		summary: "Focused persistence check passed.",
		startedAt: recordedAt,
		completedAt: recordedAt,
		exitCode: 0,
		outputDigest: OUTPUT_DIGEST,
		environmentKeys: [],
	};
}

async function startReview(
	workspace: string,
	featureId: string,
	reviewKind: "feature" | "final",
	featureReview?: ReviewAssignmentResultInput,
): Promise<ReviewAssignment> {
	const current = await loadSession(workspace);
	if (!current) throw new Error("Expected active persistence session.");
	const pending = current.reviewAssignments.find(
		(assignment) =>
			assignment.featureRunId === current.activeFeatureRunId &&
			assignment.reviewKind === reviewKind &&
			assignment.status === "pending",
	);
	if (pending) return pending;
	const activeRun = current.featureRuns.find(
		(run) => run.id === current.activeFeatureRunId,
	);
	if (!activeRun) throw new Error("Expected active feature-run state.");
	const validationAt = featureReview?.completedAt ?? activeRun.startedAt;
	const response = await executeFlowReviewStart(workspace, {
		request: {
			operationId: `persistence-operation-${++operationSequence}`,
			expectedRevision: current.causal.revision,
			expectedSnapshotId: current.causal.snapshotId,
			featureId,
			reviewKind,
			validationScope: reviewKind === "final" ? "broad" : "targeted",
			...(featureReview ? { featureReview } : {}),
			packet: {
				summary: `Persistence ${reviewKind} review.`,
				riskLenses: [],
			},
			validations: [validationObservation(featureId, validationAt)],
		},
	});
	const projection = response.workflowData?.projection as
		| { assignmentId?: string }
		| undefined;
	if (response.status !== "ok" || !projection?.assignmentId) {
		throw new Error(`Expected ${reviewKind} assignment: ${response.summary}`);
	}
	const persisted = await loadSession(workspace);
	const assignment = persisted?.reviewAssignments.find(
		(candidate) => candidate.id === projection.assignmentId,
	);
	if (!assignment) throw new Error("Expected persisted review assignment.");
	return assignment;
}

function passedReview(
	assignment: ReviewAssignment,
): ReviewAssignmentResultInput {
	return {
		assignmentId: assignment.id,
		verdict: "passed",
		findings: [],
		completedAt: assignment.startedAt,
		terminalDisposition: "submitted",
	};
}

function failedReview(
	assignment: ReviewAssignment,
): ReviewAssignmentResultInput {
	return {
		assignmentId: assignment.id,
		verdict: "failed",
		findings: [
			{
				taxonomy: "implementation_defect",
				subject: assignment.featureId,
				requirementOrRisk: "completion requires operator input",
				evidenceLocator: assignment.featureId,
				summary: "Missing credentials.",
				severity: "blocking",
			},
		],
		completedAt: assignment.startedAt,
		terminalDisposition: "submitted",
	};
}

async function submitFeatureResult(workspace: string, input: unknown) {
	const session = await loadSession(workspace);
	const payload =
		typeof input === "object" && input !== null
			? (input as Record<string, unknown>)
			: {};
	return executeFlowFeatureComplete(workspace, {
		request: {
			operationId: `persistence-operation-${++operationSequence}`,
			expectedRevision: session?.causal.revision ?? 0,
			expectedSnapshotId: session?.causal.snapshotId ?? SOURCE_DIGEST,
			...payload,
		},
	});
}

async function completeOnlyFeature(workspace: string) {
	const featureAssignment = await startReview(
		workspace,
		"only-feature",
		"feature",
	);
	const finalAssignment = await startReview(
		workspace,
		"only-feature",
		"final",
		passedReview(featureAssignment),
	);
	return submitFeatureResult(workspace, {
		featureId: "only-feature",
		result: {
			kind: "completed",
			summary: "Completed the goal.",
			artifactsChanged: [{ path: "src/only.ts" }],
			validationScope: "broad",
			finalReview: passedReview(finalAssignment),
		},
	});
}

async function submitFailedFeatureReview(workspace: string, summary: string) {
	const assignment = await startReview(workspace, "only-feature", "feature");
	return submitFeatureResult(workspace, {
		featureId: "only-feature",
		result: {
			kind: "blocked",
			summary,
			review: failedReview(assignment),
		},
	});
}

async function exhaustFeatureReviewRetryBudget(
	workspace: string,
	summary: string,
) {
	const first = await submitFailedFeatureReview(workspace, summary);
	if (first.status !== "ok") return first;
	return submitFailedFeatureReview(workspace, summary);
}

async function flowFeatureReset(workspace: string, input: unknown) {
	const session = await loadSession(workspace);
	const payload =
		typeof input === "object" && input !== null
			? (input as Record<string, unknown>)
			: {};
	return executeFlowFeatureReset(workspace, {
		operationId: `persistence-operation-${++operationSequence}`,
		expectedRevision: session?.causal.revision ?? 0,
		expectedSnapshotId: session?.causal.snapshotId ?? SOURCE_DIGEST,
		...payload,
	});
}

async function flowSessionClose(workspace: string, input: unknown) {
	const session = await loadSession(workspace);
	const payload =
		typeof input === "object" && input !== null
			? (input as Record<string, unknown>)
			: {};
	return executeFlowSessionClose(workspace, {
		request: {
			mode: "start",
			operationId: `persistence-operation-${++operationSequence}`,
			expectedRevision: session?.causal.revision ?? 0,
			expectedSnapshotId: session?.causal.snapshotId ?? SOURCE_DIGEST,
			...payload,
		},
	});
}

async function flowStatus(workspace: string, input: unknown = {}) {
	const request =
		typeof input === "object" && input !== null && "view" in input
			? input
			: { view: "compact" };
	const response = await executeFlowStatus(workspace, { request });
	const session = await loadSession(workspace);
	return session?.closure
		? {
				...response,
				statusSummary: `Session closed as ${session.closure.kind}; archival is pending.`,
			}
		: response;
}

async function tempWorkspace(): Promise<string> {
	const root = join(tmpdir(), `flow-workspace-${crypto.randomUUID()}`);
	await mkdir(root, { recursive: true });
	return root;
}

async function waitForPath(path: string, timeoutMs = 2_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			await stat(path);
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Timed out waiting for test path: ${path}`);
}

async function waitForChild(child: ChildProcess): Promise<{
	code: number | null;
	stderr: string;
}> {
	let stderr = "";
	child.stderr?.setEncoding("utf8");
	child.stderr?.on("data", (chunk: string) => {
		stderr += chunk;
	});
	return await new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code) => resolve({ code, stderr }));
	});
}

function oneFeaturePlan() {
	return {
		summary: "Deliver one feature.",
		overview: "Single feature session.",
		requirements: [],
		decisions: [],
		finalReviewPolicy: "broad" as const,
		features: [
			{
				id: "only-feature",
				title: "Only feature",
				summary: "Complete the goal.",
				targets: ["src/only.ts"],
				validation: ["full check"],
				dependsOn: [],
			},
		],
	};
}

describe("Flow workspace persistence", () => {
	test("rejects unsafe workspace roots", () => {
		expect(() => assertMutableWorkspaceRoot("/")).toThrow();
		expect(() => assertMutableWorkspaceRoot(homedir())).toThrow();
	});

	test("canonicalizes workspace aliases and still rejects aliases to HOME", async () => {
		const workspace = await tempWorkspace();
		const alias = join(tmpdir(), `flow-workspace-alias-${crypto.randomUUID()}`);
		await symlink(workspace, alias, "dir");
		expect(assertMutableWorkspaceRoot(alias)).toBe(
			assertMutableWorkspaceRoot(workspace),
		);

		const previousHome = process.env.HOME;
		process.env.HOME = workspace;
		try {
			expect(() => assertMutableWorkspaceRoot(alias)).toThrow(/HOME/);
		} finally {
			if (previousHome === undefined) delete process.env.HOME;
			else process.env.HOME = previousHome;
		}
	});

	test("refuses a symlinked Flow directory without touching its target", async () => {
		const workspace = await tempWorkspace();
		const outside = await tempWorkspace();
		const marker = join(outside, "outside-marker");
		await writeFile(marker, "outside marker\n", "utf8");
		await symlink(outside, flowDir(workspace), "dir");

		await expect(
			flowPlanSave(workspace, { goal: "Never escape the workspace" }),
		).rejects.toBeInstanceOf(UnsafeFlowWorkspaceLayoutError);
		expect(await readFile(marker, "utf8")).toBe("outside marker\n");
		expect(await readdir(outside)).toEqual(["outside-marker"]);
	});

	test("refuses symlinked managed files before writing session state", async () => {
		const workspace = await tempWorkspace();
		const outside = await tempWorkspace();
		const outsideIgnore = join(outside, "outside-ignore");
		await mkdir(flowDir(workspace), { recursive: true });
		await writeFile(outsideIgnore, "outside marker\n", "utf8");
		await symlink(outsideIgnore, join(flowDir(workspace), ".gitignore"));

		await expect(
			flowPlanSave(workspace, { goal: "Keep managed files contained" }),
		).rejects.toBeInstanceOf(UnsafeFlowWorkspaceLayoutError);
		expect(await readFile(outsideIgnore, "utf8")).toBe("outside marker\n");
		await expect(stat(sessionPath(workspace))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	test("refuses a non-file ignore path before publishing session state", async () => {
		const workspace = await tempWorkspace();
		await mkdir(join(flowDir(workspace), ".gitignore"), { recursive: true });

		await expect(
			flowPlanSave(workspace, { goal: "Protect state before publication" }),
		).rejects.toBeInstanceOf(UnsafeFlowWorkspaceLayoutError);
		await expect(stat(sessionPath(workspace))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	test("refuses symlinked lock and history directories", async () => {
		const lockWorkspace = await tempWorkspace();
		const outsideLock = await tempWorkspace();
		await mkdir(flowDir(lockWorkspace), { recursive: true });
		await symlink(
			outsideLock,
			join(flowDir(lockWorkspace), "session.lock"),
			"dir",
		);
		await expect(
			withSessionLock(lockWorkspace, async () => "unreachable"),
		).rejects.toBeInstanceOf(UnsafeFlowWorkspaceLayoutError);
		expect(await readdir(outsideLock)).toEqual([]);

		const historyWorkspace = await tempWorkspace();
		const outsideHistory = await tempWorkspace();
		await flowPlanSave(historyWorkspace, {
			goal: "Keep archives contained",
			plan: oneFeaturePlan(),
		});
		const activeBytes = await readFile(sessionPath(historyWorkspace), "utf8");
		await symlink(outsideHistory, historyDir(historyWorkspace), "dir");
		const rejected = await flowSessionClose(historyWorkspace, {
			kind: "deferred",
			summary: "Archive safely.",
		});
		expect(rejected.status).toBe("error");
		expect(rejected.summary).toContain("could not prove");
		expect(await readdir(outsideHistory)).toEqual([]);
		expect(await readFile(sessionPath(historyWorkspace), "utf8")).toBe(
			activeBytes,
		);
		expect((await loadSession(historyWorkspace))?.goal).toBe(
			"Keep archives contained",
		);
	});

	test("rejects duplicate keys in session JSON", async () => {
		const workspace = await tempWorkspace();
		await mkdir(join(workspace, ".flow"), { recursive: true });
		await writeFile(
			sessionPath(workspace),
			'{"version":4,"version":4}\n',
			"utf8",
		);

		await expect(loadSession(workspace)).rejects.toThrow(/duplicate/i);
	});

	test("rejects malformed session JSON", async () => {
		const workspace = await tempWorkspace();
		await mkdir(join(workspace, ".flow"), { recursive: true });
		await writeFile(sessionPath(workspace), '{"version":4,\n', "utf8");

		await expect(loadSession(workspace)).rejects.toThrow(/not valid JSON/i);
	});

	test("rejects nested duplicate keys in session JSON", async () => {
		const workspace = await tempWorkspace();
		await mkdir(join(workspace, ".flow"), { recursive: true });
		await writeFile(
			sessionPath(workspace),
			'{"version":4,"timestamps":{"createdAt":"now","createdAt":"later"}}\n',
			"utf8",
		);

		await expect(loadSession(workspace)).rejects.toThrow(/duplicate/i);
	});

	test("hashes canonical session archives outside the quarantine namespace", async () => {
		const now = "2026-07-19T12:00:00.000Z";
		const environment = {
			now: () => now,
			newSessionId: () => toSessionId("quarantine-reserved"),
		};
		const session = createSession(
			"Keep canonical hashes separate from quarantine names",
			environment,
		);
		expect(SessionSchema.safeParse(session).success).toBe(true);
		const closeOperationId = "quarantine-prefix-close-operation";
		const closed = closeSession(session, "deferred", environment, undefined, {
			operationId: closeOperationId,
			expectedRevision: session.causal.revision,
			expectedSnapshotId: session.causal.snapshotId,
		});
		expect(closed.ok).toBe(true);
		if (!closed.ok) throw new Error(closed.message);
		const workspace = await tempWorkspace();
		await saveSession(workspace, closed.value);
		await archiveAndClearSession(workspace, closed.value);
		expect(await readdir(historyDir(workspace))).toEqual([
			archivedSessionFilename(session.id),
		]);
		expect(
			(await findArchivedSessionByOperationId(workspace, closeOperationId))?.id,
		).toBe(session.id);
	});

	test("bounds session ids before closure can become an unpublishable archive", async () => {
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
		expect(SessionSchema.safeParse(boundary).success).toBe(true);

		const boundaryClosed = closeSession(
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
		expect(boundaryClosed.ok).toBe(true);
		if (!boundaryClosed.ok) throw new Error(boundaryClosed.message);
		const boundaryWorkspace = await tempWorkspace();
		await saveSession(boundaryWorkspace, boundaryClosed.value);
		await archiveAndClearSession(boundaryWorkspace, boundaryClosed.value);
		await expect(
			stat(archivedSessionPath(boundaryWorkspace, boundaryId)),
		).resolves.toBeDefined();

		const overlongId = "s".repeat(MAX_SESSION_ID_LENGTH + 1);
		const overlongEnvironment = {
			now: () => now,
			newSessionId: () => toSessionId(overlongId),
		};
		const overlong = createSession(
			"Reject an unpublishable session id",
			overlongEnvironment,
		);
		expect(SessionSchema.safeParse(overlong).success).toBe(false);
		expect(() => archivedSessionPath(boundaryWorkspace, overlongId)).toThrow(
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
		expect(overlongClosed.ok).toBe(true);
		if (!overlongClosed.ok) throw new Error(overlongClosed.message);
		const overlongWorkspace = await tempWorkspace();
		await expect(
			saveSession(overlongWorkspace, overlongClosed.value),
		).rejects.toThrow(/Session id is too long/);
		await expect(stat(sessionPath(overlongWorkspace))).rejects.toMatchObject({
			code: "ENOENT",
		});
		await expect(stat(historyDir(overlongWorkspace))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	test("publishes case-distinct ids to distinct canonical hashes", async () => {
		const workspace = await tempWorkspace();
		const now = "2026-07-19T12:00:00.000Z";
		const ids = ["CaseSession", "casesession"];
		const filenames: string[] = [];
		for (const [index, id] of ids.entries()) {
			const environment = {
				now: () => now,
				newSessionId: () => toSessionId(id),
			};
			const active = createSession(`Archive case variant ${id}`, environment);
			const operationId = `case-distinct-close-${index}`;
			const closed = closeSession(active, "deferred", environment, undefined, {
				operationId,
				expectedRevision: active.causal.revision,
				expectedSnapshotId: active.causal.snapshotId,
			});
			if (!closed.ok) throw new Error(closed.message);
			await saveSession(workspace, closed.value);
			await archiveAndClearSession(workspace, closed.value);
			filenames.push(archivedSessionFilename(id));
			expect(
				(await findArchivedSessionByOperationId(workspace, operationId))?.id,
			).toBe(toSessionId(id));
		}
		expect(filenames[0]).not.toBe(filenames[1]);
		expect(filenames.every((name) => /^[a-f0-9]{64}\.json$/.test(name))).toBe(
			true,
		);
		expect((await readdir(historyDir(workspace))).sort()).toEqual(
			filenames.sort(),
		);
	});

	test("rejects case-folded canonical filename aliases before publication", async () => {
		const workspace = await tempWorkspace();
		const environment = {
			now: () => "2026-07-19T12:00:00.000Z",
			newSessionId: () => toSessionId("case-fold-collision"),
		};
		const active = createSession(
			"Reject a case-folded archive alias",
			environment,
		);
		const closed = closeSession(active, "deferred", environment, undefined, {
			operationId: "case-fold-close",
			expectedRevision: active.causal.revision,
			expectedSnapshotId: active.causal.snapshotId,
		});
		if (!closed.ok) throw new Error(closed.message);
		await saveSession(workspace, closed.value);
		await mkdir(historyDir(workspace));
		const alias = archivedSessionFilename(active.id).toUpperCase();
		const aliasPath = join(historyDir(workspace), alias);
		await writeFile(
			aliasPath,
			"case-fold alias must remain untouched\n",
			"utf8",
		);
		const activeBytes = await readFile(sessionPath(workspace), "utf8");

		await expect(
			archiveAndClearSession(workspace, closed.value),
		).rejects.toBeInstanceOf(UnsafeFlowWorkspaceLayoutError);
		expect(await readFile(aliasPath, "utf8")).toBe(
			"case-fold alias must remain untouched\n",
		);
		expect(await readFile(sessionPath(workspace), "utf8")).toBe(activeBytes);
	});

	test("rejects a case-fold alias introduced after the publication scan", async () => {
		const workspace = await tempWorkspace();
		const environment = {
			now: () => "2026-07-19T12:00:00.000Z",
			newSessionId: () => toSessionId("case-fold-publish-race"),
		};
		const active = createSession(
			"Reject a publication-time alias",
			environment,
		);
		const closed = closeSession(active, "deferred", environment, undefined, {
			operationId: "case-fold-publish-race-close",
			expectedRevision: active.causal.revision,
			expectedSnapshotId: active.causal.snapshotId,
		});
		if (!closed.ok) throw new Error(closed.message);
		await saveSession(workspace, closed.value);
		const activeBytes = await readFile(sessionPath(workspace), "utf8");
		const targetName = archivedSessionFilename(active.id);
		const aliasName = targetName.toUpperCase();
		const targetPath = join(historyDir(workspace), targetName);
		const aliasPath = join(historyDir(workspace), aliasName);

		await expect(
			archiveAndClearSession(workspace, closed.value, {
				afterHistoryPinned: async () => {
					await writeFile(aliasPath, "case-fold alias\n", {
						encoding: "utf8",
						flag: "wx",
					});
					try {
						await writeFile(targetPath, "exact-name collision\n", {
							encoding: "utf8",
							flag: "wx",
						});
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
					}
				},
			}),
		).rejects.toBeInstanceOf(UnsafeFlowWorkspaceLayoutError);
		expect(await readFile(sessionPath(workspace), "utf8")).toBe(activeBytes);
		expect(await readFile(aliasPath, "utf8")).toBe("case-fold alias\n");
	});

	test.skipIf(process.platform === "win32")(
		"publishes a maximum-length id from a workspace deeper than the absolute archive path limit",
		async () => {
			const base = await tempWorkspace();
			let workspace = base;
			let segment = 0;
			const targetRootLength = process.platform === "darwin" ? 935 : 4_010;
			try {
				while (workspace.length < targetRootLength) {
					workspace = join(
						workspace,
						`segment-${String(segment++).padStart(4, "0")}`,
					);
					await mkdir(workspace);
				}
				const id = "s".repeat(MAX_SESSION_ID_LENGTH);
				const environment = {
					now: () => "2026-07-19T12:00:00.000Z",
					newSessionId: () => toSessionId(id),
				};
				const active = createSession(
					"Archive from a deep workspace",
					environment,
				);
				await saveSession(workspace, active);
				const operationId = "deep-workspace-close";
				const closed = await createWorkspaceFlowService(workspace).sessionClose(
					{
						request: {
							mode: "start",
							operationId,
							expectedRevision: active.causal.revision,
							expectedSnapshotId: active.causal.snapshotId,
							kind: "deferred",
						},
					},
				);
				expect(closed.status).toBe("ok");
				expect(await loadSession(workspace)).toBeNull();
				expect(
					(await findArchivedSessionByOperationId(workspace, operationId))?.id,
				).toBe(toSessionId(id));
				expect(await readdir(historyDir(workspace))).toEqual([
					archivedSessionFilename(id),
				]);
			} finally {
				await rm(base, { recursive: true, force: true });
			}
		},
		20_000,
	);

	test("pins history publication and preserves active state across a directory swap", async () => {
		const workspace = await tempWorkspace();
		const outside = await tempWorkspace();
		const environment = {
			now: () => "2026-07-19T12:00:00.000Z",
			newSessionId: () => toSessionId("history-topology-race"),
		};
		const active = createSession(
			"Reject a swapped history parent",
			environment,
		);
		const closed = closeSession(active, "deferred", environment, undefined, {
			operationId: "history-topology-close",
			expectedRevision: active.causal.revision,
			expectedSnapshotId: active.causal.snapshotId,
		});
		if (!closed.ok) throw new Error(closed.message);
		await saveSession(workspace, closed.value);
		const activeBytes = await readFile(sessionPath(workspace), "utf8");
		const parked = `${historyDir(workspace)}-parked`;
		let swapCompleted = false;
		await expectPinnedDirectorySwapRejected(
			() =>
				archiveAndClearSession(workspace, closed.value, {
					afterHistoryPinned: async () => {
						await rename(historyDir(workspace), parked);
						swapCompleted = true;
						await symlink(outside, historyDir(workspace), "dir");
					},
				}),
			() => swapCompleted,
		);
		expect(await readdir(outside)).toEqual([]);
		expect(await readFile(sessionPath(workspace), "utf8")).toBe(activeBytes);
		if (swapCompleted) {
			expect(await readdir(parked)).toEqual([]);
			await rm(historyDir(workspace));
			await rename(parked, historyDir(workspace));
		} else {
			expect(await readdir(historyDir(workspace))).toEqual([]);
		}
		await archiveAndClearSession(workspace, closed.value);
		expect(await loadSession(workspace)).toBeNull();
		await rm(outside, { recursive: true, force: true });
	});

	test("pins Flow active deletion and refuses a swapped Flow parent", async () => {
		const workspace = await tempWorkspace();
		const outside = await tempWorkspace();
		const environment = {
			now: () => "2026-07-19T12:00:00.000Z",
			newSessionId: () => toSessionId("flow-topology-race"),
		};
		const active = createSession("Reject a swapped Flow parent", environment);
		const closed = closeSession(active, "deferred", environment, undefined, {
			operationId: "flow-topology-close",
			expectedRevision: active.causal.revision,
			expectedSnapshotId: active.causal.snapshotId,
		});
		if (!closed.ok) throw new Error(closed.message);
		await saveSession(workspace, closed.value);
		const activeBytes = await readFile(sessionPath(workspace), "utf8");
		const parked = `${flowDir(workspace)}-parked`;
		let swapCompleted = false;
		await expectPinnedDirectorySwapRejected(
			() =>
				archiveAndClearSession(workspace, closed.value, {
					afterFlowPinnedBeforeDelete: async () => {
						await rename(flowDir(workspace), parked);
						swapCompleted = true;
						await symlink(outside, flowDir(workspace), "dir");
					},
				}),
			() => swapCompleted,
		);
		expect(await readdir(outside)).toEqual([]);
		const preservedFlowDir = swapCompleted ? parked : flowDir(workspace);
		await expect(
			readFile(join(preservedFlowDir, "session.json"), "utf8"),
		).resolves.toBe(activeBytes);
		if (swapCompleted) {
			await rm(flowDir(workspace));
			await rename(parked, flowDir(workspace));
		}
		await archiveAndClearSession(workspace, closed.value);
		expect(await loadSession(workspace)).toBeNull();
		await rm(outside, { recursive: true, force: true });
	});

	test("revalidates exact archive spelling inside pinned active deletion", async () => {
		const workspace = await tempWorkspace();
		const environment = {
			now: () => "2026-07-19T12:00:00.000Z",
			newSessionId: () => toSessionId("case-fold-delete-race"),
		};
		const active = createSession("Reject a deletion-time rename", environment);
		const closed = closeSession(active, "deferred", environment, undefined, {
			operationId: "case-fold-delete-race-close",
			expectedRevision: active.causal.revision,
			expectedSnapshotId: active.causal.snapshotId,
		});
		if (!closed.ok) throw new Error(closed.message);
		await saveSession(workspace, closed.value);
		const activeBytes = await readFile(sessionPath(workspace), "utf8");
		const canonicalPath = archivedSessionPath(workspace, active.id);
		const aliasPath = join(
			historyDir(workspace),
			archivedSessionFilename(active.id).toUpperCase(),
		);

		await expect(
			archiveAndClearSession(workspace, closed.value, {
				afterFlowPinnedBeforeDelete: async () => {
					await rename(canonicalPath, aliasPath);
				},
			}),
		).rejects.toBeInstanceOf(UnsafeFlowWorkspaceLayoutError);
		expect(await readFile(sessionPath(workspace), "utf8")).toBe(activeBytes);
		expect(await readFile(aliasPath, "utf8")).toBe(activeBytes);

		await rename(aliasPath, canonicalPath);
		await archiveAndClearSession(workspace, closed.value);
		expect(await loadSession(workspace)).toBeNull();
	});

	test.skipIf(process.platform === "win32")(
		"bounds malformed, missing, and stalled pinned-helper protocols",
		async () => {
			const cases = [
				{
					name: "malformed-ready",
					script: "#!/bin/sh\nprintf '%s\\n' 'not-json'\nexec sleep 10\n",
					expected: /invalid ready event/i,
				},
				{
					name: "no-ready",
					script: "#!/bin/sh\nexec sleep 10\n",
					expected: /timed out before readiness/i,
				},
				{
					name: "stalled-after-ready",
					script:
						"#!/bin/sh\nprintf '%s\\n' '{\"event\":\"pinned\"}'\nIFS= read -r ignored\nexec sleep 10\n",
					expected: /timed out before completion/i,
				},
			] as const;

			for (const helperCase of cases) {
				const workspace = await tempWorkspace();
				const environment = {
					now: () => "2026-07-19T12:00:00.000Z",
					newSessionId: () => toSessionId(`helper-${helperCase.name}`),
				};
				const active = createSession(
					`Reject ${helperCase.name} helper protocol`,
					environment,
				);
				const closed = closeSession(
					active,
					"deferred",
					environment,
					undefined,
					{
						operationId: `${helperCase.name}-close`,
						expectedRevision: active.causal.revision,
						expectedSnapshotId: active.causal.snapshotId,
					},
				);
				if (!closed.ok) throw new Error(closed.message);
				await saveSession(workspace, closed.value);
				const activeBytes = await readFile(sessionPath(workspace), "utf8");
				const executable = join(workspace, `${helperCase.name}.sh`);
				await writeFile(executable, helperCase.script, "utf8");
				await chmod(executable, 0o700);

				await expect(
					archiveAndClearSession(workspace, closed.value, {
						pinnedHelperTestExecutable: executable,
						pinnedHelperReadyTimeoutMs: 1_000,
						pinnedHelperCompletionTimeoutMs: 1_000,
					}),
				).rejects.toThrow(helperCase.expected);
				expect(await readFile(sessionPath(workspace), "utf8")).toBe(
					activeBytes,
				);
				expect(await readdir(historyDir(workspace))).toEqual([]);
			}
		},
		5_000,
	);

	test("pins corrupt-session quarantine across a history swap", async () => {
		const workspace = await tempWorkspace();
		const outside = await tempWorkspace();
		await mkdir(flowDir(workspace));
		const corruptBytes = "not valid Session v4\n";
		await writeFile(sessionPath(workspace), corruptBytes, "utf8");
		const parked = `${historyDir(workspace)}-parked`;
		let swapCompleted = false;
		await expectPinnedDirectorySwapRejected(
			() =>
				quarantineUnreadableSession(workspace, {
					afterHistoryPinned: async () => {
						await rename(historyDir(workspace), parked);
						swapCompleted = true;
						await symlink(outside, historyDir(workspace), "dir");
					},
				}),
			() => swapCompleted,
		);
		expect(await readdir(outside)).toEqual([]);
		expect(await readFile(sessionPath(workspace), "utf8")).toBe(corruptBytes);
		if (swapCompleted) {
			expect(await readdir(parked)).toEqual([]);
			await rm(historyDir(workspace));
			await rename(parked, historyDir(workspace));
		} else {
			expect(await readdir(historyDir(workspace))).toEqual([]);
		}
		const quarantined = await quarantineUnreadableSession(workspace);
		expect(quarantined).not.toBeNull();
		if (!quarantined) throw new Error("Expected a quarantine path.");
		expect(await readFile(quarantined, "utf8")).toBe(corruptBytes);
		await expect(stat(sessionPath(workspace))).rejects.toMatchObject({
			code: "ENOENT",
		});
		await rm(outside, { recursive: true, force: true });
	});

	test("upgrades generated Flow gitignore to ignore runtime state", async () => {
		const workspace = await tempWorkspace();
		await mkdir(join(workspace, ".flow"), { recursive: true });
		await writeFile(join(workspace, ".flow", ".gitignore"), "session.lock/\n");

		await flowPlanSave(workspace, { goal: "Use the new ignore defaults" });

		await expect(
			readFile(join(workspace, ".flow", ".gitignore"), "utf8"),
		).resolves.toBe(
			"session.json\nhistory/\nevidence/\nsession.lock/\n.gitignore\n",
		);
	});

	test.skipIf(process.platform === "win32")(
		"does not mistake a directory-sync failure for concurrent ignore publication",
		async () => {
			const workspace = await tempWorkspace();
			const workspaceModule = pathToFileURL(
				join(process.cwd(), "src/infrastructure/fs/workspace.ts"),
			).href;
			const child = spawn(
				process.execPath,
				[
					"--eval",
					`import { open } from "node:fs/promises";
import { ensureFlowGitignore } from ${JSON.stringify(workspaceModule)};
const probe = await open(process.env.FLOW_TEST_WORKSPACE, "r");
const fileHandlePrototype = Object.getPrototypeOf(probe);
await probe.close();
const originalSync = fileHandlePrototype.sync;
fileHandlePrototype.sync = async function () {
  const info = await this.stat();
  if (info.isDirectory()) {
    const error = new Error("Synthetic directory sync failure.");
    error.code = "EIO";
    throw error;
  }
  return originalSync.call(this);
};
let failureCode;
try { await ensureFlowGitignore(process.env.FLOW_TEST_WORKSPACE); }
catch (error) { failureCode = error?.code; }
if (failureCode !== "EIO") process.exitCode = 2;`,
				],
				{
					cwd: process.cwd(),
					env: { ...process.env, FLOW_TEST_WORKSPACE: workspace },
					stdio: ["ignore", "ignore", "pipe"],
				},
			);

			expect(await waitForChild(child)).toEqual({ code: 0, stderr: "" });
			await expect(
				readFile(join(workspace, ".flow", ".gitignore"), "utf8"),
			).resolves.toBe(
				"session.json\nhistory/\nevidence/\nsession.lock/\n.gitignore\n",
			);
		},
	);

	test("rejects an unsupported active version without moving or rewriting it", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Reject unsupported session input",
			plan: oneFeaturePlan(),
		});
		const raw = JSON.parse(await readFile(sessionPath(workspace), "utf8")) as {
			version: number;
		};
		raw.version = 999;
		const unsupportedBytes = `${JSON.stringify(raw)}\n`;
		await writeFile(sessionPath(workspace), unsupportedBytes, "utf8");

		await expect(loadSession(workspace)).rejects.toBeInstanceOf(
			UnsupportedFlowSessionVersionError,
		);
		expect(await readFile(sessionPath(workspace), "utf8")).toBe(
			unsupportedBytes,
		);
		await expect(stat(historyDir(workspace))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	test("deferred and abandoned close archives and clears the active session", async () => {
		for (const kind of ["deferred", "abandoned"] as const) {
			const workspace = await tempWorkspace();
			await flowPlanSave(workspace, {
				goal: `Close ${kind} without completing`,
				plan: oneFeaturePlan(),
			});

			const close = await flowSessionClose(workspace, {
				kind,
				summary: `Archived as ${kind}.`,
			});
			expect(close.status).toBe("ok");
			expect(close.workflowData?.archive?.closure?.kind).toBe(kind);
			await expect(stat(sessionPath(workspace))).rejects.toThrow();
			expect(await loadSession(workspace)).toBeNull();

			const historyFiles = await readdir(join(workspace, ".flow", "history"));
			expect(historyFiles).toHaveLength(1);
			const archived = JSON.parse(
				await readFile(
					join(workspace, ".flow", "history", historyFiles[0] ?? ""),
					"utf8",
				),
			) as { closure: { kind: string; summary: string }; status: string };
			expect(archived.closure.kind).toBe(kind);
			expect(archived.closure.summary).toBe(`Archived as ${kind}.`);
			expect(archived.status).toBe("planning");
		}
	});

	test("replays an archived close from its durable 128-character retry handle", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Replay one archived close",
			plan: oneFeaturePlan(),
		});
		const active = await loadSession(workspace);
		if (!active) throw new Error("Expected an active session.");
		const operationId = "r".repeat(128);
		const request = {
			mode: "start" as const,
			operationId,
			expectedRevision: active.causal.revision,
			expectedSnapshotId: active.causal.snapshotId,
			kind: "deferred" as const,
		};
		const first = await executeFlowSessionClose(workspace, { request });
		expect(first.status).toBe("ok");
		const [filename] = await readdir(historyDir(workspace));
		if (!filename) throw new Error("Expected one canonical archive.");
		const archivePath = join(historyDir(workspace), filename);
		const beforeBytes = await readFile(archivePath, "utf8");
		const before = SessionSchema.parse(JSON.parse(beforeBytes));
		const replay = await executeFlowSessionClose(workspace, {
			request: { mode: "retry", operationId },
		});

		expect(replay).toEqual(first);
		expect(await readFile(archivePath, "utf8")).toBe(beforeBytes);
		expect(await readdir(historyDir(workspace))).toEqual([filename]);
		await expect(stat(sessionPath(workspace))).rejects.toThrow();
		const after = SessionSchema.parse(
			JSON.parse(await readFile(archivePath, "utf8")),
		);
		expect(after.causal.revision).toBe(before.causal.revision);

		const wrong = await executeFlowSessionClose(workspace, {
			request: { mode: "retry", operationId: "wrong-close-operation" },
		});
		expect(wrong.status).toBe("missing_session");
		expect(await readFile(archivePath, "utf8")).toBe(beforeBytes);
		const crossKindOperation = before.causal.mutations.find(
			(mutation) => mutation.operationKind === "plan_save",
		)?.operationId;
		if (!crossKindOperation) throw new Error("Expected a plan-save operation.");
		const crossKind = await executeFlowSessionClose(workspace, {
			request: { mode: "retry", operationId: crossKindOperation },
		});
		expect(crossKind.status).toBe("error");
		expect(crossKind.workflowData?.failure?.summary).toContain(
			"accepted session close",
		);
	});

	test("requires workspace-wide historical uniqueness for close operation ids", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Archive the first close identity",
			plan: oneFeaturePlan(),
		});
		const firstActive = await loadSession(workspace);
		if (!firstActive) throw new Error("Expected the first active session.");
		const reusedOperationId = "workspace-historical-close-identity";
		const firstClose = await executeFlowSessionClose(workspace, {
			request: {
				mode: "start",
				operationId: reusedOperationId,
				expectedRevision: firstActive.causal.revision,
				expectedSnapshotId: firstActive.causal.snapshotId,
				kind: "deferred",
			},
		});
		expect(firstClose.status).toBe("ok");
		const [firstArchiveFilename] = await readdir(historyDir(workspace));
		if (!firstArchiveFilename) throw new Error("Expected the first archive.");
		const firstArchive = SessionSchema.parse(
			JSON.parse(
				await readFile(
					join(historyDir(workspace), firstArchiveFilename),
					"utf8",
				),
			),
		);
		const archivedNonCloseOperationId = firstArchive.causal.mutations.find(
			(mutation) => mutation.operationKind === "plan_save",
		)?.operationId;
		if (!archivedNonCloseOperationId) {
			throw new Error("Expected an archived non-close operation.");
		}

		await flowPlanSave(workspace, {
			goal: "Keep the second close identity unique",
			plan: oneFeaturePlan(),
		});
		const secondActive = await loadSession(workspace);
		if (!secondActive) throw new Error("Expected the second active session.");
		const beforeRejectedClose = await readFile(sessionPath(workspace), "utf8");
		const collision = await executeFlowSessionClose(workspace, {
			request: {
				mode: "start",
				operationId: reusedOperationId,
				expectedRevision: secondActive.causal.revision,
				expectedSnapshotId: secondActive.causal.snapshotId,
				kind: "deferred",
			},
		});

		expect(collision.status).toBe("error");
		expect(collision.workflowData?.failure?.summary).toContain(
			"canonical archived history",
		);
		expect(collision.workflowData?.receipt).toMatchObject({
			operationAccepted: false,
			operationIdConsumed: false,
			operationId: reusedOperationId,
			revision: secondActive.causal.revision,
			snapshotId: secondActive.causal.snapshotId,
		});
		expect(await readFile(sessionPath(workspace), "utf8")).toBe(
			beforeRejectedClose,
		);
		expect((await loadSession(workspace))?.id).toBe(secondActive.id);
		const crossKindCollision = await executeFlowSessionClose(workspace, {
			request: {
				mode: "start",
				operationId: archivedNonCloseOperationId,
				expectedRevision: secondActive.causal.revision,
				expectedSnapshotId: secondActive.causal.snapshotId,
				kind: "deferred",
			},
		});
		expect(crossKindCollision.status).toBe("error");
		expect(crossKindCollision.workflowData?.receipt).toMatchObject({
			operationAccepted: false,
			operationIdConsumed: false,
			operationId: archivedNonCloseOperationId,
		});
		expect(await readFile(sessionPath(workspace), "utf8")).toBe(
			beforeRejectedClose,
		);
		expect((await flowPlanApprove(workspace)).status).toBe("ok");
		expect((await flowRunStart(workspace, {})).status).toBe("ok");
		const secondRunning = await loadSession(workspace);
		if (!secondRunning) throw new Error("Expected the second running session.");
		const laterNonCloseReuse = await executeFlowFeatureReset(workspace, {
			operationId: reusedOperationId,
			expectedRevision: secondRunning.causal.revision,
			expectedSnapshotId: secondRunning.causal.snapshotId,
			featureId: "only-feature",
		});
		expect(laterNonCloseReuse.status).toBe("ok");
		const secondReset = await loadSession(workspace);
		if (!secondReset) throw new Error("Expected the reset second session.");

		const uniqueOperationId = "workspace-unique-second-close";
		const accepted = await executeFlowSessionClose(workspace, {
			request: {
				mode: "start",
				operationId: uniqueOperationId,
				expectedRevision: secondReset.causal.revision,
				expectedSnapshotId: secondReset.causal.snapshotId,
				kind: "deferred",
			},
		});
		expect(accepted.status).toBe("ok");
		await expect(stat(sessionPath(workspace))).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect(await readdir(historyDir(workspace))).toHaveLength(2);

		const retry = await executeFlowSessionClose(workspace, {
			request: { mode: "retry", operationId: uniqueOperationId },
		});
		expect(retry).toEqual(accepted);
		await expect(
			findArchivedSessionByOperationId(workspace, reusedOperationId),
		).rejects.toThrow(/ambiguous/i);
		const originalRetry = await executeFlowSessionClose(workspace, {
			request: { mode: "retry", operationId: reusedOperationId },
		});
		expect(originalRetry).toEqual(firstClose);
	});

	test("never publishes or trusts canonical history without explicit closure", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Require explicit closure before publication",
			plan: oneFeaturePlan(),
		});
		const active = await loadSession(workspace);
		if (!active) throw new Error("Expected an active session.");
		const activeBytes = await readFile(sessionPath(workspace), "utf8");

		await expect(
			archiveAndClearSession(workspace, active),
		).rejects.toBeInstanceOf(UnclosedSessionArchiveError);
		expect(await readFile(sessionPath(workspace), "utf8")).toBe(activeBytes);
		await expect(stat(historyDir(workspace))).rejects.toMatchObject({
			code: "ENOENT",
		});

		await mkdir(historyDir(workspace), { recursive: true });
		await writeFile(archivedSessionPath(workspace, active.id), activeBytes);
		await expect(
			findArchivedSessionByOperationId(
				workspace,
				active.causal.mutations[0]?.operationId ?? "missing-operation",
			),
		).rejects.toBeInstanceOf(ArchivedSessionLookupError);

		const closeOperationId = "reject-unclosed-canonical-history";
		const beforeClose = await readFile(sessionPath(workspace), "utf8");
		const rejected = await executeFlowSessionClose(workspace, {
			request: {
				mode: "start",
				operationId: closeOperationId,
				expectedRevision: active.causal.revision,
				expectedSnapshotId: active.causal.snapshotId,
				kind: "deferred",
			},
		});
		expect(rejected.status).toBe("error");
		expect(rejected.workflowData?.failure?.summary).toContain(
			"explicitly closed canonical session history",
		);
		expect(rejected.workflowData?.receipt).toMatchObject({
			operationAccepted: false,
			operationIdConsumed: false,
			operationId: closeOperationId,
		});
		expect(await readFile(sessionPath(workspace), "utf8")).toBe(beforeClose);
	});

	test("fails closed when a new close cannot verify canonical history", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Create canonical history before corruption",
			plan: oneFeaturePlan(),
		});
		await flowSessionClose(workspace, { kind: "deferred" });
		await writeFile(join(historyDir(workspace), "corrupt.json"), "{bad\n");
		await flowPlanSave(workspace, {
			goal: "Preserve active state while history is corrupt",
			plan: oneFeaturePlan(),
		});
		const active = await loadSession(workspace);
		if (!active) throw new Error("Expected an active session.");
		const beforeBytes = await readFile(sessionPath(workspace), "utf8");
		const operationId = "close-with-unverifiable-history";

		const rejected = await executeFlowSessionClose(workspace, {
			request: {
				mode: "start",
				operationId,
				expectedRevision: active.causal.revision,
				expectedSnapshotId: active.causal.snapshotId,
				kind: "abandoned",
			},
		});

		expect(rejected.status).toBe("error");
		expect(rejected.summary).toContain("could not prove");
		expect(rejected.workflowData?.receipt).toMatchObject({
			operationAccepted: false,
			operationIdConsumed: false,
			operationId,
			revision: active.causal.revision,
			snapshotId: active.causal.snapshotId,
		});
		expect(await readFile(sessionPath(workspace), "utf8")).toBe(beforeBytes);
	});

	test("rejects hidden operation identities in unknown JSON history entries atomically", async () => {
		const hiddenOperationId = "hidden-history-operation";
		const sourceWorkspace = await tempWorkspace();
		await flowPlanSave(sourceWorkspace, {
			goal: "Create a valid archive whose operation identity is hidden",
			plan: oneFeaturePlan(),
		});
		await flowSessionClose(sourceWorkspace, {
			operationId: hiddenOperationId,
			kind: "deferred",
		});
		const [sourceArchiveName] = await readdir(historyDir(sourceWorkspace));
		if (!sourceArchiveName) throw new Error("Expected a source archive.");
		const hiddenArchiveBytes = await readFile(
			join(historyDir(sourceWorkspace), sourceArchiveName),
			"utf8",
		);

		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Refuse an unverifiable hidden operation identity",
			plan: oneFeaturePlan(),
		});
		const active = await loadSession(workspace);
		if (!active) throw new Error("Expected an active session.");
		const activeBytes = await readFile(sessionPath(workspace), "utf8");
		await mkdir(historyDir(workspace), { recursive: true });
		const hiddenName = "hidden-operation.JSON";
		await writeFile(
			join(historyDir(workspace), hiddenName),
			hiddenArchiveBytes,
			"utf8",
		);

		const rejected = await executeFlowSessionClose(workspace, {
			request: {
				mode: "start",
				operationId: hiddenOperationId,
				expectedRevision: active.causal.revision,
				expectedSnapshotId: active.causal.snapshotId,
				kind: "deferred",
			},
		});

		expect(rejected.status).toBe("error");
		expect(rejected.workflowData?.receipt).toMatchObject({
			operationAccepted: false,
			operationIdConsumed: false,
			operationId: hiddenOperationId,
		});
		expect(await readFile(sessionPath(workspace), "utf8")).toBe(activeBytes);
		expect(await readdir(historyDir(workspace))).toEqual([hiddenName]);
		expect(
			await readFile(join(historyDir(workspace), hiddenName), "utf8"),
		).toBe(hiddenArchiveBytes);
	});

	test("fails closed on corrupt, ambiguous, and filename-mismatched canonical archives", async () => {
		const corruptWorkspace = await tempWorkspace();
		await flowPlanSave(corruptWorkspace, {
			goal: "Reject corrupt archive history",
			plan: oneFeaturePlan(),
		});
		const corruptActive = await loadSession(corruptWorkspace);
		if (!corruptActive) throw new Error("Expected an active session.");
		const corruptRequest = {
			mode: "start" as const,
			operationId: "corrupt-archive-close",
			expectedRevision: corruptActive.causal.revision,
			expectedSnapshotId: corruptActive.causal.snapshotId,
			kind: "deferred" as const,
			summary: "Publish before corruption.",
		};
		await executeFlowSessionClose(corruptWorkspace, {
			request: corruptRequest,
		});
		await writeFile(
			join(historyDir(corruptWorkspace), "corrupt.json"),
			"{bad\n",
		);
		const corrupt = await executeFlowSessionClose(corruptWorkspace, {
			request: {
				mode: "retry",
				operationId: corruptRequest.operationId,
			},
		});
		expect(corrupt.status).toBe("error");
		expect(JSON.stringify(corrupt)).not.toContain(corruptWorkspace);

		const mismatchWorkspace = await tempWorkspace();
		await flowPlanSave(mismatchWorkspace, {
			goal: "Reject mismatched archive filename",
			plan: oneFeaturePlan(),
		});
		const mismatchActive = await loadSession(mismatchWorkspace);
		if (!mismatchActive) throw new Error("Expected an active session.");
		const mismatchRequest = {
			mode: "start" as const,
			operationId: "mismatch-archive-close",
			expectedRevision: mismatchActive.causal.revision,
			expectedSnapshotId: mismatchActive.causal.snapshotId,
			kind: "deferred" as const,
		};
		await executeFlowSessionClose(mismatchWorkspace, {
			request: mismatchRequest,
		});
		const [mismatchFilename] = await readdir(historyDir(mismatchWorkspace));
		if (!mismatchFilename) throw new Error("Expected a canonical archive.");
		await rename(
			join(historyDir(mismatchWorkspace), mismatchFilename),
			join(historyDir(mismatchWorkspace), "different-session.json"),
		);
		expect(
			(
				await executeFlowSessionClose(mismatchWorkspace, {
					request: {
						mode: "retry",
						operationId: mismatchRequest.operationId,
					},
				})
			).status,
		).toBe("error");

		const ambiguousWorkspace = await tempWorkspace();
		const secondWorkspace = await tempWorkspace();
		for (const workspace of [ambiguousWorkspace, secondWorkspace]) {
			await flowPlanSave(workspace, {
				goal: `Ambiguous archive ${workspace}`,
				plan: oneFeaturePlan(),
			});
			const active = await loadSession(workspace);
			if (!active) throw new Error("Expected an active session.");
			await executeFlowSessionClose(workspace, {
				request: {
					mode: "start",
					operationId: "ambiguous-archive-close",
					expectedRevision: active.causal.revision,
					expectedSnapshotId: active.causal.snapshotId,
					kind: "deferred",
				},
			});
		}
		const [secondFilename] = await readdir(historyDir(secondWorkspace));
		if (!secondFilename) throw new Error("Expected a second archive.");
		await writeFile(
			join(historyDir(ambiguousWorkspace), secondFilename),
			await readFile(join(historyDir(secondWorkspace), secondFilename), "utf8"),
		);
		const ambiguous = await executeFlowSessionClose(ambiguousWorkspace, {
			request: {
				mode: "retry",
				operationId: "ambiguous-archive-close",
			},
		});
		expect(ambiguous.status).toBe("error");
		expect(ambiguous.workflowData?.failure?.summary).toContain("ambiguous");
		expect(JSON.stringify(ambiguous)).not.toContain(ambiguousWorkspace);
	});

	test("fails closed on a canonical archive without an explicit schema version", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Reject an unversioned archive",
			plan: oneFeaturePlan(),
		});
		const active = await loadSession(workspace);
		if (!active) throw new Error("Expected an active session.");
		const request = {
			mode: "start" as const,
			operationId: "unversioned-archive-close",
			expectedRevision: active.causal.revision,
			expectedSnapshotId: active.causal.snapshotId,
			kind: "deferred" as const,
		};
		await executeFlowSessionClose(workspace, { request });
		await writeFile(
			join(historyDir(workspace), archivedSessionFilename("unversioned")),
			`${JSON.stringify({ id: "unversioned" })}\n`,
			"utf8",
		);

		const replay = await executeFlowSessionClose(workspace, {
			request: { mode: "retry", operationId: request.operationId },
		});

		expect(replay.status).toBe("error");
		expect(replay.workflowData?.failure?.summary).toContain(
			"verify canonical archived Session v4 history",
		);
	});

	test("never treats quarantine archives as replay sources", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Ignore quarantine replay data",
			plan: oneFeaturePlan(),
		});
		const active = await loadSession(workspace);
		if (!active) throw new Error("Expected an active session.");
		const request = {
			mode: "start" as const,
			operationId: "quarantined-close",
			expectedRevision: active.causal.revision,
			expectedSnapshotId: active.causal.snapshotId,
			kind: "deferred" as const,
		};
		await executeFlowSessionClose(workspace, { request });
		const [filename] = await readdir(historyDir(workspace));
		if (!filename) throw new Error("Expected a canonical archive.");
		await rename(
			join(historyDir(workspace), filename),
			join(historyDir(workspace), `quarantine-${filename}`),
		);

		const retry = await executeFlowSessionClose(workspace, {
			request: { mode: "retry", operationId: request.operationId },
		});

		expect(retry.status).toBe("missing_session");
	});

	test("deferred and abandoned close quiesce running work while preserving forensic status", async () => {
		for (const kind of ["deferred", "abandoned"] as const) {
			const runningWorkspace = await tempWorkspace();
			await flowPlanSave(runningWorkspace, {
				goal: `Close running as ${kind}`,
				plan: oneFeaturePlan(),
			});
			await flowPlanApprove(runningWorkspace);
			await flowRunStart(runningWorkspace, {});
			const pendingAssignment = await startReview(
				runningWorkspace,
				"only-feature",
				"feature",
			);
			expect(
				(
					await flowSessionClose(runningWorkspace, {
						kind,
						summary: `Archived running as ${kind}.`,
					})
				).status,
			).toBe("ok");
			const runningArchive = SessionSchema.parse(
				JSON.parse(
					await readFile(
						join(
							historyDir(runningWorkspace),
							(await readdir(historyDir(runningWorkspace)))[0] ?? "",
						),
						"utf8",
					),
				),
			);
			expect(runningArchive.status).toBe("running");
			expect(runningArchive.activeFeatureId).toBeNull();
			expect(runningArchive.activeFeatureRunId).toBeNull();
			expect(runningArchive.plan?.features[0]?.status).toBe("in_progress");
			const closedRun = runningArchive.featureRuns.find(
				(run) => run.id === pendingAssignment.featureRunId,
			);
			expect(closedRun).toMatchObject({
				status: kind,
				endedAt: runningArchive.closure?.recordedAt,
			});
			const invalidated = runningArchive.reviewAssignments.find(
				(assignment) => assignment.id === pendingAssignment.id,
			);
			expect(invalidated).toMatchObject({
				status: "invalidated",
				invalidatedAt: runningArchive.closure?.recordedAt,
				invalidationReason: `session_${kind}`,
			});

			const blockedWorkspace = await tempWorkspace();
			await flowPlanSave(blockedWorkspace, {
				goal: `Close blocked as ${kind}`,
				plan: oneFeaturePlan(),
			});
			await flowPlanApprove(blockedWorkspace);
			await flowRunStart(blockedWorkspace, {});
			await exhaustFeatureReviewRetryBudget(
				blockedWorkspace,
				"Need operator input.",
			);
			expect(
				(
					await flowSessionClose(blockedWorkspace, {
						kind,
						summary: `Archived blocked as ${kind}.`,
					})
				).status,
			).toBe("ok");
			const blockedArchive = SessionSchema.parse(
				JSON.parse(
					await readFile(
						join(
							historyDir(blockedWorkspace),
							(await readdir(historyDir(blockedWorkspace)))[0] ?? "",
						),
						"utf8",
					),
				),
			);
			expect(blockedArchive.status).toBe("blocked");
			expect(blockedArchive.activeFeatureId).toBeNull();
			expect(blockedArchive.activeFeatureRunId).toBeNull();
			expect(blockedArchive.plan?.features[0]?.status).toBe("blocked");
			expect(blockedArchive.history.at(-1)?.status).toBe("blocked");
			expect(
				blockedArchive.reviewAssignments.some(
					(assignment) => assignment.status === "pending",
				),
			).toBe(false);
		}
	});

	test("fails closed on an unsupported canonical archive version", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Reject unsupported archive input",
			plan: oneFeaturePlan(),
		});
		const active = await loadSession(workspace);
		if (!active) throw new Error("Expected an active session.");
		await mkdir(historyDir(workspace), { recursive: true });
		const archivePath = archivedSessionPath(workspace, active.id);
		const unsupported = {
			...active,
			version: 999,
		};
		const unsupportedBytes = `${JSON.stringify(unsupported)}\n`;
		await writeFile(archivePath, unsupportedBytes, "utf8");

		await expect(
			findArchivedSessionByOperationId(workspace, "archive-lookup"),
		).rejects.toBeInstanceOf(ArchivedSessionLookupError);
		expect(await readFile(archivePath, "utf8")).toBe(unsupportedBytes);
		expect(await loadSession(workspace)).toEqual(active);
	});

	test("mutation APIs reject unsafe roots before acquiring a session lock", async () => {
		const previousHome = process.env.HOME;
		const workspace = await tempWorkspace();
		process.env.HOME = workspace;
		try {
			await expect(
				flowPlanSave(workspace, { goal: "Reject unsafe HOME workspace" }),
			).rejects.toThrow(/HOME/);
			await expect(stat(flowDir(workspace))).rejects.toThrow();
		} finally {
			if (previousHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = previousHome;
			}
		}
	});

	test("recovers an interrupted close from compact status and a fresh service", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Keep active session when archive fails",
			plan: oneFeaturePlan(),
		});
		await flowPlanApprove(workspace);
		const operationId = "archive-recovery-with-omitted-summary";
		const active = await loadSession(workspace);
		if (!active) throw new Error("Expected an active session before close.");
		const repository = createFileSessionRepository(workspace);
		const failingService = createFlowService(
			{
				read: () => repository.read(),
				transact: (task) =>
					repository.transact((transaction) =>
						task({
							...transaction,
							archiveAndClear: async () => {
								throw new Error("before-archive-publication failpoint");
							},
						}),
					),
			},
			systemTransitionEnvironment,
		);
		await expect(
			failingService.sessionClose({
				request: {
					mode: "start",
					operationId,
					expectedRevision: active.causal.revision,
					expectedSnapshotId: active.causal.snapshotId,
					kind: "deferred",
				},
			}),
		).rejects.toThrow("before-archive-publication failpoint");
		const persisted = await loadSession(workspace);
		if (!persisted?.closure) throw new Error("Expected durable closure state.");
		const beforeRetryBytes = await readFile(sessionPath(workspace), "utf8");
		const wrong = await createWorkspaceFlowService(workspace).sessionClose({
			request: { mode: "retry", operationId: "wrong-archive-retry" },
		});
		expect(wrong.status).toBe("error");
		expect(await readFile(sessionPath(workspace), "utf8")).toBe(
			beforeRetryBytes,
		);

		const recoveryService = createWorkspaceFlowService(workspace);
		const status = await recoveryService.status({
			request: { view: "compact" },
		});
		const projection = status.workflowData?.projection as
			| { closure?: { retryOperationId?: string } | null }
			| undefined;
		const retryOperationId = projection?.closure?.retryOperationId;
		expect(retryOperationId).toBe(operationId);
		if (!retryOperationId) throw new Error("Expected close retry identity.");
		const retry = await createWorkspaceFlowService(workspace).sessionClose({
			request: {
				mode: "retry",
				operationId: retryOperationId,
			},
		});
		expect(retry.status).toBe("ok");
		expect(retry.workflowData?.archive?.closure).toMatchObject({
			kind: "deferred",
			summary: "Session closed as deferred.",
			retryOperationId: operationId,
		});
		await expect(stat(sessionPath(workspace))).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect(await readdir(historyDir(workspace))).toHaveLength(1);
		expect(persisted.causal.revision).toBe(
			SessionSchema.parse(
				JSON.parse(
					await readFile(
						join(
							historyDir(workspace),
							(await readdir(historyDir(workspace)))[0] ?? "",
						),
						"utf8",
					),
				),
			).causal.revision,
		);
	});

	test("rescans canonical history before publishing an active close retry", async () => {
		const operationId = "active-close-retry-history-scan";
		const pendingClose = async (goal: string) => {
			const workspace = await tempWorkspace();
			await flowPlanSave(workspace, { goal, plan: oneFeaturePlan() });
			const active = await loadSession(workspace);
			if (!active) throw new Error("Expected an active session.");
			const transitioned = closeSession(
				active,
				"deferred",
				{
					now: () => active.timestamps.updatedAt,
					newSessionId: () => active.id,
				},
				"Retry only after canonical history is verified.",
				{
					operationId,
					expectedRevision: active.causal.revision,
					expectedSnapshotId: active.causal.snapshotId,
				},
			);
			if (!transitioned.ok) throw new Error(transitioned.message);
			const closed = await saveSession(workspace, transitioned.value);
			return {
				workspace,
				closed,
				bytes: await readFile(sessionPath(workspace), "utf8"),
			};
		};
		const archivedClose = async (goal: string) => {
			const workspace = await tempWorkspace();
			await flowPlanSave(workspace, { goal, plan: oneFeaturePlan() });
			const response = await flowSessionClose(workspace, {
				operationId,
				kind: "deferred",
			});
			expect(response.status).toBe("ok");
			const [filename] = await readdir(historyDir(workspace));
			if (!filename) throw new Error("Expected a canonical archive.");
			return {
				filename,
				bytes: await readFile(join(historyDir(workspace), filename), "utf8"),
			};
		};

		const malformed = await pendingClose("Reject malformed retry history");
		await mkdir(historyDir(malformed.workspace), { recursive: true });
		await writeFile(
			join(historyDir(malformed.workspace), "malformed.json"),
			"{bad\n",
		);
		const malformedRetry = await createWorkspaceFlowService(
			malformed.workspace,
		).sessionClose({ request: { mode: "retry", operationId } });
		expect(malformedRetry.status).toBe("error");
		expect(malformedRetry.summary).toContain(
			"before publishing the pending close",
		);
		expect(await readFile(sessionPath(malformed.workspace), "utf8")).toBe(
			malformed.bytes,
		);
		expect(await readdir(historyDir(malformed.workspace))).toEqual([
			"malformed.json",
		]);

		const conflict = await pendingClose("Reject a conflicting retry identity");
		const conflictingArchive = await archivedClose(
			"Publish a different session with the retry identity",
		);
		await mkdir(historyDir(conflict.workspace), { recursive: true });
		await writeFile(
			join(historyDir(conflict.workspace), conflictingArchive.filename),
			conflictingArchive.bytes,
		);
		const conflictingRetry = await createWorkspaceFlowService(
			conflict.workspace,
		).sessionClose({ request: { mode: "retry", operationId } });
		expect(conflictingRetry.status).toBe("error");
		expect(conflictingRetry.workflowData?.failure?.summary).toContain(
			"conflicts with canonical archived history",
		);
		expect(await readFile(sessionPath(conflict.workspace), "utf8")).toBe(
			conflict.bytes,
		);
		expect(await readdir(historyDir(conflict.workspace))).toEqual([
			conflictingArchive.filename,
		]);

		const ambiguous = await pendingClose("Reject an ambiguous retry identity");
		const [firstArchive, secondArchive] = await Promise.all([
			archivedClose("Publish the first ambiguous retry identity"),
			archivedClose("Publish the second ambiguous retry identity"),
		]);
		await mkdir(historyDir(ambiguous.workspace), { recursive: true });
		await Promise.all(
			[firstArchive, secondArchive].map((archive) =>
				writeFile(
					join(historyDir(ambiguous.workspace), archive.filename),
					archive.bytes,
				),
			),
		);
		const ambiguousRetry = await createWorkspaceFlowService(
			ambiguous.workspace,
		).sessionClose({ request: { mode: "retry", operationId } });
		expect(ambiguousRetry.status).toBe("error");
		expect(ambiguousRetry.workflowData?.failure?.summary).toContain(
			"ambiguous",
		);
		expect(await readFile(sessionPath(ambiguous.workspace), "utf8")).toBe(
			ambiguous.bytes,
		);
		expect(await readdir(historyDir(ambiguous.workspace))).toHaveLength(2);
	});

	test("never overwrites an existing archive on session-id collision", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Preserve an older colliding archive",
			plan: oneFeaturePlan(),
		});
		await flowPlanApprove(workspace);
		await flowRunStart(workspace, {});
		const active = await loadSession(workspace);
		if (!active) throw new Error("Expected an active session.");
		await mkdir(historyDir(workspace), { recursive: true });
		const archivePath = archivedSessionPath(workspace, active.id);
		const competing = closeSession(
			active,
			"deferred",
			{
				now: () => active.timestamps.updatedAt,
				newSessionId: () => active.id,
			},
			"Preserve the already-published competing closure.",
			{
				operationId: "archive-collision-existing-close",
				expectedRevision: active.causal.revision,
				expectedSnapshotId: active.causal.snapshotId,
			},
		);
		if (!competing.ok) throw new Error(competing.message);
		const olderArchiveBytes = `${JSON.stringify(competing.value, null, 2)}\n`;
		await writeFile(archivePath, olderArchiveBytes, "utf8");
		const closeRequest = {
			operationId: "archive-collision-close",
			expectedRevision: active.causal.revision,
			expectedSnapshotId: active.causal.snapshotId,
			kind: "deferred" as const,
			summary: "New close must not replace old bytes.",
		};

		await expect(
			flowSessionClose(workspace, closeRequest),
		).rejects.toBeInstanceOf(ArchiveCollisionError);
		expect(await readFile(archivePath, "utf8")).toBe(olderArchiveBytes);
		expect((await loadSession(workspace))?.closure?.summary).toBe(
			"New close must not replace old bytes.",
		);
		expect(await readdir(historyDir(workspace))).toEqual([
			archivedSessionFilename(active.id),
		]);

		const status = await flowStatus(workspace);
		expect(String(status.statusSummary)).toContain("archival is pending");
		expect(String(status.nextAction)).toContain("flow_session_close");
		expect(
			(
				status.workflowData?.projection as
					| { closure?: { retryOperationId?: string } | null }
					| undefined
			)?.closure?.retryOperationId,
		).toBe(closeRequest.operationId);
		expect((await flowRunStart(workspace, {})).status).toBe("error");
		expect(
			(
				await flowFeatureReset(workspace, {
					featureId: "only-feature",
				})
			).status,
		).toBe("error");
		expect(
			(
				await flowPlanSave(workspace, {
					goal: "Preserve an older colliding archive",
				})
			).status,
		).toBe("error");
		const differentClose = await flowSessionClose(workspace, {
			kind: "deferred",
			summary: "A new operation must not adopt an existing closure.",
		});
		expect(differentClose.status).toBe("error");
		expect(differentClose.workflowData?.failure?.summary).toMatch(
			/closure|retry/i,
		);
		expect(differentClose.workflowData?.failure?.recovery).toContain(
			closeRequest.operationId,
		);

		await rm(archivePath);
		const retry = await createWorkspaceFlowService(workspace).sessionClose({
			request: {
				mode: "retry",
				operationId: closeRequest.operationId,
			},
		});
		expect(retry.status).toBe("ok");
		expect(retry.workflowData?.archive?.closure?.kind).toBe("deferred");
		expect(retry.workflowData?.archive?.closure?.summary).toBe(
			"New close must not replace old bytes.",
		);
		await expect(stat(sessionPath(workspace))).rejects.toThrow();
	});

	test("resumes cleanup when the same archive was already published", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Resume an interrupted close",
			plan: oneFeaturePlan(),
		});
		const active = await loadSession(workspace);
		if (!active) throw new Error("Expected an active session.");
		const operationId = "interrupted-close";
		const transitioned = closeSession(
			active,
			"deferred",
			{
				now: () => active.timestamps.updatedAt,
				newSessionId: () => active.id,
			},
			"Retry the same close.",
			{
				operationId,
				expectedRevision: active.causal.revision,
				expectedSnapshotId: active.causal.snapshotId,
			},
		);
		if (!transitioned.ok) throw new Error(transitioned.message);
		const closed = await saveSession(workspace, transitioned.value);
		await mkdir(historyDir(workspace), { recursive: true });
		const archivePath = archivedSessionPath(workspace, active.id);
		const publishedContents = await readFile(sessionPath(workspace), "utf8");
		await writeFile(archivePath, publishedContents, "utf8");

		const close = await createWorkspaceFlowService(workspace).sessionClose({
			request: { mode: "retry", operationId },
		});
		expect(close.status).toBe("ok");
		expect(close.workflowData?.archive?.closure?.recordedAt).toBe(
			closed.closure?.recordedAt,
		);
		expect(await readFile(archivePath, "utf8")).toBe(publishedContents);
		await expect(stat(sessionPath(workspace))).rejects.toThrow();
	});

	test("resumes cleanup from semantically identical differently formatted bytes", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Recover an equivalent compact archive",
			plan: oneFeaturePlan(),
		});
		const active = await loadSession(workspace);
		if (!active) throw new Error("Expected an active session.");
		const operationId = "equivalent-format-close-retry";
		const transitioned = closeSession(
			active,
			"deferred",
			{
				now: () => active.timestamps.updatedAt,
				newSessionId: () => active.id,
			},
			"Retry equivalent JSON bytes.",
			{
				operationId,
				expectedRevision: active.causal.revision,
				expectedSnapshotId: active.causal.snapshotId,
			},
		);
		if (!transitioned.ok) throw new Error(transitioned.message);
		const closed = await saveSession(workspace, transitioned.value);
		const compactJson = JSON.stringify(closed);
		const compactActiveBytes = compactJson;
		const compactArchiveBytes = `${compactJson}\n`;
		expect(compactActiveBytes).not.toBe(compactArchiveBytes);
		await writeFile(sessionPath(workspace), compactActiveBytes, "utf8");
		await mkdir(historyDir(workspace), { recursive: true });
		const archivePath = archivedSessionPath(workspace, closed.id);
		await writeFile(archivePath, compactArchiveBytes, "utf8");

		const retry = await createWorkspaceFlowService(workspace).sessionClose({
			request: { mode: "retry", operationId },
		});

		expect(retry.status).toBe("ok");
		expect(retry.workflowData?.archive?.closure?.retryOperationId).toBe(
			operationId,
		);
		expect(await readFile(archivePath, "utf8")).toBe(compactArchiveBytes);
		await expect(stat(sessionPath(workspace))).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect(
			(await findArchivedSessionByOperationId(workspace, operationId))?.id,
		).toBe(closed.id);
	});

	test("archiveAndClear rejects a session that differs from active state", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Reject stale archive input",
			plan: oneFeaturePlan(),
		});
		const active = await loadSession(workspace);
		if (!active) throw new Error("Expected an active session.");
		const different = createSession("A different snapshot", {
			now: () => active.timestamps.createdAt,
			newSessionId: () => active.id,
		});
		const closedDifferent = closeSession(
			different,
			"deferred",
			{
				now: () => different.timestamps.updatedAt,
				newSessionId: () => different.id,
			},
			"Reject this different closed snapshot.",
			{
				operationId: "different-snapshot-close",
				expectedRevision: different.causal.revision,
				expectedSnapshotId: different.causal.snapshotId,
			},
		);
		if (!closedDifferent.ok) throw new Error(closedDifferent.message);

		await expect(
			archiveAndClearSession(workspace, closedDifferent.value),
		).rejects.toBeInstanceOf(ArchiveCollisionError);
		expect((await loadSession(workspace))?.goal).toBe(
			"Reject stale archive input",
		);
	});

	test("archives and clears completed sessions", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Complete and archive one feature",
			plan: oneFeaturePlan(),
		});
		await flowPlanApprove(workspace);
		await flowRunStart(workspace, {});
		await completeOnlyFeature(workspace);
		const completed = await loadSession(workspace);
		if (!completed) throw new Error("Expected a completed active session.");
		expect(completed.status).toBe("completed");
		expect(completed.closure).toBeNull();
		expect(
			completed.causal.mutations.some(
				(mutation) => mutation.operationKind === "session_close",
			),
		).toBe(false);
		const completedBytes = await readFile(sessionPath(workspace), "utf8");
		for (const kind of ["deferred", "abandoned"] as const) {
			const operationId = `reject-completed-as-${kind}`;
			const rejected = await executeFlowSessionClose(workspace, {
				request: {
					mode: "start",
					operationId,
					expectedRevision: completed.causal.revision,
					expectedSnapshotId: completed.causal.snapshotId,
					kind,
				},
			});
			expect(rejected.status).toBe("error");
			expect(rejected.workflowData?.failure?.summary).toContain(
				"must close as completed",
			);
			expect(rejected.workflowData?.receipt).toMatchObject({
				operationAccepted: false,
				operationIdConsumed: false,
				operationId,
				revision: completed.causal.revision,
				snapshotId: completed.causal.snapshotId,
			});
			expect(await readFile(sessionPath(workspace), "utf8")).toBe(
				completedBytes,
			);
			expect((await loadSession(workspace))?.closure).toBeNull();
		}

		const closeRequest = {
			mode: "start",
			operationId: "completed-session-close",
			expectedRevision: completed.causal.revision,
			expectedSnapshotId: completed.causal.snapshotId,
			kind: "completed",
			summary: "Archived.",
		} as const;
		const close = await executeFlowSessionClose(workspace, {
			request: closeRequest,
		});
		expect(close.status).toBe("ok");
		expect(close.workflowData?.receipt).toMatchObject({
			operationAccepted: true,
			operationIdConsumed: true,
			operationId: closeRequest.operationId,
		});
		await expect(stat(sessionPath(workspace))).rejects.toThrow();
		expect(await loadSession(workspace)).toBeNull();

		const historyFiles = await readdir(join(workspace, ".flow", "history"));
		expect(historyFiles).toHaveLength(1);
		expect(historyFiles[0]?.endsWith(".json")).toBe(true);
		const archived = SessionSchema.parse(
			JSON.parse(
				await readFile(
					join(workspace, ".flow", "history", historyFiles[0] ?? ""),
					"utf8",
				),
			),
		);
		expect(archived.closure?.kind).toBe("completed");
		expect(archived.timestamps.completedAt).toBe(
			completed.timestamps.completedAt,
		);
		expect(
			archived.causal.mutations.find(
				(mutation) => mutation.operationKind === "session_close",
			),
		).toMatchObject({ operationId: closeRequest.operationId });
		expect(
			await executeFlowSessionClose(workspace, {
				request: {
					mode: "retry",
					operationId: closeRequest.operationId,
				},
			}),
		).toEqual(close);
		await expect(
			readFile(join(workspace, ".flow", ".gitignore"), "utf8"),
		).resolves.toBe(
			"session.json\nhistory/\nevidence/\nsession.lock/\n.gitignore\n",
		);
	});

	test("a completed session must be archived before starting a new goal", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Complete first goal",
			plan: oneFeaturePlan(),
		});
		await flowPlanApprove(workspace);
		await flowRunStart(workspace, {});
		await completeOnlyFeature(workspace);

		const pending = await flowPlanSave(workspace, {
			goal: "Start next goal",
			plan: {
				...oneFeaturePlan(),
				summary: "Deliver the next goal.",
			},
		});
		expect(pending.status).toBe("error");
		expect(String(pending.nextAction)).toContain("flow_session_close");

		expect(
			(await flowSessionClose(workspace, { kind: "completed" })).status,
		).toBe("ok");
		const next = await flowPlanSave(workspace, {
			goal: "Start next goal",
			plan: {
				...oneFeaturePlan(),
				summary: "Deliver the next goal.",
			},
		});

		expect(next.status).toBe("ok");
		expect((await loadSession(workspace))?.goal).toBe("Start next goal");
		expect(await readdir(join(workspace, ".flow", "history"))).toHaveLength(1);
	});
});

describe("session lock ownership", () => {
	test("serializes independent processes without stale-lock stealing", async () => {
		const workspace = await tempWorkspace();
		const firstEntered = join(workspace, "first-entered");
		const releaseFirst = join(workspace, "release-first");
		const secondEntered = join(workspace, "second-entered");
		const workspaceModule = pathToFileURL(
			join(process.cwd(), "src/infrastructure/fs/workspace.ts"),
		).href;
		const childEnv = {
			...process.env,
			FLOW_TEST_WORKSPACE: workspace,
			FLOW_TEST_FIRST_ENTERED: firstEntered,
			FLOW_TEST_RELEASE_FIRST: releaseFirst,
			FLOW_TEST_SECOND_ENTERED: secondEntered,
		};
		const first = spawn(
			process.execPath,
			[
				"--eval",
				`import { stat, writeFile } from "node:fs/promises";
import { withSessionLock } from ${JSON.stringify(workspaceModule)};
await withSessionLock(process.env.FLOW_TEST_WORKSPACE, async () => {
  await writeFile(process.env.FLOW_TEST_FIRST_ENTERED, "entered\\n");
  while (true) {
    try { await stat(process.env.FLOW_TEST_RELEASE_FIRST); break; }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
});`,
			],
			{
				cwd: process.cwd(),
				env: childEnv,
				stdio: ["ignore", "ignore", "pipe"],
			},
		);
		const firstDone = waitForChild(first);
		let firstResult: Awaited<ReturnType<typeof waitForChild>>;
		try {
			await waitForPath(firstEntered);

			const second = spawn(
				process.execPath,
				[
					"--eval",
					`import { writeFile } from "node:fs/promises";
import { withSessionLock } from ${JSON.stringify(workspaceModule)};
let timedOut = false;
try {
  await withSessionLock(process.env.FLOW_TEST_WORKSPACE, async () => {
    await writeFile(process.env.FLOW_TEST_SECOND_ENTERED, "entered\\n");
  }, { timeoutMs: 150 });
} catch (error) {
  if (String(error).includes("Timed out waiting for Flow session lock")) timedOut = true;
  else throw error;
}
if (!timedOut) process.exitCode = 2;`,
				],
				{
					cwd: process.cwd(),
					env: childEnv,
					stdio: ["ignore", "ignore", "pipe"],
				},
			);
			const secondResult = await waitForChild(second);
			expect(secondResult).toEqual({ code: 0, stderr: "" });
			await expect(stat(secondEntered)).rejects.toMatchObject({
				code: "ENOENT",
			});
		} finally {
			await writeFile(releaseFirst, "release\n");
			firstResult = await firstDone;
		}
		expect(firstResult).toEqual({ code: 0, stderr: "" });
	});

	test("never steals a lock based on its age or owner liveness", async () => {
		const workspace = await tempWorkspace();
		const lockDir = join(flowDir(workspace), "session.lock");
		await mkdir(lockDir, { recursive: true });
		await writeFile(
			join(lockDir, "owner.json"),
			JSON.stringify({
				token: crypto.randomUUID(),
				pid: 999_999,
				hostname: hostname(),
				createdAt: "2000-01-01T00:00:00.000Z",
			}),
			"utf8",
		);

		await expect(
			withSessionLock(workspace, async () => "unreachable", { timeoutMs: 100 }),
		).rejects.toThrow("inspect");
		expect(await stat(lockDir)).toBeDefined();
	});

	test("fails closed when owner metadata is invalid", async () => {
		const workspace = await tempWorkspace();
		const lockDir = join(flowDir(workspace), "session.lock");
		await mkdir(lockDir, { recursive: true });
		await writeFile(join(lockDir, "owner.json"), "not-json", "utf8");

		await expect(
			withSessionLock(workspace, async () => "unreachable", { timeoutMs: 100 }),
		).rejects.toThrow("metadata is missing or invalid");
		expect(await readFile(join(lockDir, "owner.json"), "utf8")).toBe(
			"not-json",
		);
	});

	test("an old owner cannot release a replacement lock", async () => {
		const workspace = await tempWorkspace();
		const lockDir = join(flowDir(workspace), "session.lock");
		const replacementToken = crypto.randomUUID();

		await withSessionLock(workspace, async () => {
			await rm(lockDir, { recursive: true });
			await mkdir(lockDir);
			await writeFile(
				join(lockDir, "owner.json"),
				JSON.stringify({
					token: replacementToken,
					pid: process.pid,
					hostname: hostname(),
					createdAt: new Date().toISOString(),
				}),
				"utf8",
			);
		});

		const owner = JSON.parse(
			await readFile(join(lockDir, "owner.json"), "utf8"),
		);
		expect(owner.token).toBe(replacementToken);
	});
});

describe("invalid session handling", () => {
	test("flow_status quarantines a corrupt session file and gives recovery guidance", async () => {
		const workspace = await tempWorkspace();
		await mkdir(flowDir(workspace), { recursive: true });
		await writeFile(sessionPath(workspace), "not json {", "utf8");

		const status = await flowStatus(workspace);
		expect(status.status).toBe("error");
		expect(String(status.summary)).toContain("preserved");
		expect(String(status.recovery)).toContain("/flow-plan");

		await expect(stat(sessionPath(workspace))).rejects.toMatchObject({
			code: "ENOENT",
		});
		const archived = await readdir(historyDir(workspace));
		expect(archived.some((name) => name.startsWith("quarantine-"))).toBe(true);
		await expect(
			readFile(join(flowDir(workspace), ".gitignore"), "utf8"),
		).resolves.toBe(
			"session.json\nhistory/\nevidence/\nsession.lock/\n.gitignore\n",
		);

		const next = await flowPlanSave(workspace, { goal: "Recover cleanly" });
		expect(next.status).toBe("ok");
	});

	test("a session file with an archive-unsafe id is quarantined instead of wedging archive", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, { goal: "Reject an archive-unsafe id" });
		const malformed = JSON.parse(
			await readFile(sessionPath(workspace), "utf8"),
		) as Record<string, unknown>;
		malformed.id = "session/1";
		await writeFile(
			sessionPath(workspace),
			`${JSON.stringify(malformed)}\n`,
			"utf8",
		);

		const status = await flowStatus(workspace);
		expect(status.status).toBe("error");
		expect(String(status.recovery)).toContain("/flow-plan");
		const archived = await readdir(historyDir(workspace));
		expect(archived.some((name) => name.startsWith("quarantine-"))).toBe(true);

		// Recovery works cleanly afterward.
		const next = await flowPlanSave(workspace, { goal: "Recover cleanly" });
		expect(next.status).toBe("ok");
	});

	test("status and mutation calls leave unsupported-version input untouched", async () => {
		for (const operation of ["status", "mutation"] as const) {
			const workspace = await tempWorkspace();
			await flowPlanSave(workspace, {
				goal: `Reject unsupported input during ${operation}`,
			});
			const unsupported = JSON.parse(
				await readFile(sessionPath(workspace), "utf8"),
			) as Record<string, unknown>;
			unsupported.version = 999;
			const unsupportedBytes = `${JSON.stringify(unsupported)}\n`;
			await writeFile(sessionPath(workspace), unsupportedBytes, "utf8");

			const result =
				operation === "status"
					? await executeFlowStatus(workspace, {
							request: { view: "compact" },
						})
					: await flowPlanApprove(workspace);
			expect(result.status).toBe("error");
			expect(String(result.summary)).toMatch(/unsupported|Session v4/i);
			expect(result.workflowData?.quarantine).toBeUndefined();
			expect(await readFile(sessionPath(workspace), "utf8")).toBe(
				unsupportedBytes,
			);
			await expect(stat(historyDir(workspace))).rejects.toMatchObject({
				code: "ENOENT",
			});
		}
	});
});

describe("plan save and completion state invariants", () => {
	test("plan save cannot bypass a completed session pending archival", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "First goal",
			plan: oneFeaturePlan(),
		});
		await flowPlanApprove(workspace);
		await flowRunStart(workspace, {});
		await completeOnlyFeature(workspace);
		expect((await loadSession(workspace))?.status).toBe("completed");

		const invalidPlan = {
			...oneFeaturePlan(),
			features: [
				{
					id: "next-feature",
					title: "Next feature",
					summary: "Depends on a feature that does not exist.",
					dependsOn: ["missing-feature"],
				},
			],
		};
		const result = await flowPlanSave(workspace, {
			goal: "Second goal",
			plan: invalidPlan,
		});
		expect(result.status).toBe("error");
		expect(String(result.summary)).toContain("must be closed and archived");
		expect((await loadSession(workspace))?.status).toBe("completed");
		expect((await loadSession(workspace))?.goal).toBe("First goal");
	});

	test("a different-goal plan save preserves an unclosed draft until explicit close", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Draft goal",
			plan: oneFeaturePlan(),
		});
		const beforeRejectedReplacement = await readFile(
			sessionPath(workspace),
			"utf8",
		);

		const replaced = await flowPlanSave(workspace, { goal: "New goal" });
		expect(replaced.status).toBe("error");
		expect(replaced.summary).toContain("different goal");
		expect(replaced.nextAction).toContain("deferred or abandoned");
		expect(await readFile(sessionPath(workspace), "utf8")).toBe(
			beforeRejectedReplacement,
		);
		expect((await loadSession(workspace))?.goal).toBe("Draft goal");
		await expect(stat(historyDir(workspace))).rejects.toMatchObject({
			code: "ENOENT",
		});

		const sameGoalUpdate = await flowPlanSave(workspace, {
			goal: "Draft goal",
			plan: {
				...oneFeaturePlan(),
				summary: "Update the same draft goal safely.",
			},
		});
		expect(sameGoalUpdate.status).toBe("ok");
		expect((await loadSession(workspace))?.plan?.summary).toBe(
			"Update the same draft goal safely.",
		);

		expect(
			(await flowSessionClose(workspace, { kind: "deferred" })).status,
		).toBe("ok");
		expect((await flowPlanSave(workspace, { goal: "New goal" })).status).toBe(
			"ok",
		);
		expect((await loadSession(workspace))?.goal).toBe("New goal");

		const files = await readdir(historyDir(workspace));
		expect(files).toHaveLength(1);
		const archived = JSON.parse(
			await readFile(join(historyDir(workspace), files[0] ?? ""), "utf8"),
		) as { goal: string };
		expect(archived.goal).toBe("Draft goal");
	});

	test("rejected completion stays atomic before an accepted blocker", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Clear stale errors",
			plan: oneFeaturePlan(),
		});
		await flowPlanApprove(workspace);
		await flowRunStart(workspace, {});

		const featureAssignment = await startReview(
			workspace,
			"only-feature",
			"feature",
		);
		const finalAssignment = await startReview(
			workspace,
			"only-feature",
			"final",
			passedReview(featureAssignment),
		);
		const gateFailed = await submitFeatureResult(workspace, {
			featureId: "only-feature",
			result: {
				kind: "completed",
				summary: "Completion with insufficient validation scope.",
				artifactsChanged: [],
				validationScope: "targeted",
				featureReview: passedReview(featureAssignment),
				finalReview: passedReview(finalAssignment),
			},
		});
		expect(gateFailed.status).toBe("error");
		expect((await loadSession(workspace))?.lastError).toBeNull();

		const firstBlocker = await submitFeatureResult(workspace, {
			featureId: "only-feature",
			result: {
				kind: "blocked",
				summary: "First final review blocker.",
				review: failedReview(finalAssignment),
			},
		});
		expect(firstBlocker.status).toBe("ok");
		const afterBlocker = await loadSession(workspace);
		expect(afterBlocker?.status).toBe("running");
		expect(afterBlocker?.lastError).toBeNull();
		expect(
			afterBlocker?.reviewAssignments.find(
				(assignment) => assignment.id === finalAssignment.id,
			)?.status,
		).toBe("submitted");
		expect(afterBlocker?.budget.failedReviewCount).toBe(1);
	});
});

describe("completion payload contract errors", () => {
	test("flow_feature_complete reports schema violations as curated errors", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Curated contract errors",
			plan: oneFeaturePlan(),
		});
		await flowPlanApprove(workspace);
		await flowRunStart(workspace, {});

		const session = await loadSession(workspace);
		if (!session) throw new Error("Expected running session.");
		const result = await executeFlowFeatureComplete(workspace, {
			operationId: "invalid-completion-contract",
			expectedRevision: session.causal.revision,
			expectedSnapshotId: session.causal.snapshotId,
			status: "ok",
			featureId: "only-feature",
			summary: "claim done without evidence fields",
		});
		expect(result.status).toBe("error");
		expect(String(result.summary)).toContain(
			"flow_feature_complete payload is invalid",
		);
		expect(String(result.recovery)).toContain("nested completed or blocked");
	});
});
