import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ToolContext } from "@opencode-ai/plugin";
import type { FlowService } from "../src/application/flow-service.js";
import type { SourceDigest } from "../src/domain/session.js";
import {
	archivedSessionPath,
	loadArchivedSession,
	loadSession,
	sessionPath,
} from "../src/infrastructure/fs/workspace.js";
import { createWorkspaceFlowService } from "../src/infrastructure/fs/workspace-flow-service.js";
import {
	persistWorkspaceValidation,
	prepareWorkspaceValidation,
} from "../src/infrastructure/fs/workspace-validation.js";
import { createTools } from "../src/platform/opencode/tools.js";

const execFileAsync = promisify(execFile);
const FEATURE_ID = "lifecycle";
const OUTPUT_DIGEST = `sha256:${"b".repeat(64)}` as SourceDigest;
type FeatureCompleteResponse = Awaited<
	ReturnType<FlowService["featureComplete"]>
>;

function assertOk<
	T extends Readonly<{ status: "ok" | "error"; summary: string }>,
>(response: T): asserts response is Extract<T, { status: "ok" }> {
	expect(response.status).toBe("ok");
	if (response.status !== "ok") throw new Error(response.summary);
}

function ok<T extends Readonly<{ status: "ok" | "error"; summary: string }>>(
	response: T,
): Extract<T, { status: "ok" }> {
	assertOk(response);
	return response;
}

function parseFeatureCompleteResponse(value: unknown): FeatureCompleteResponse {
	return JSON.parse(String(value)) as FeatureCompleteResponse;
}

function toolContext(workspace: string, agent: string): ToolContext {
	return {
		sessionID: `lifecycle-${agent}`,
		messageID: `message-${agent}`,
		agent,
		directory: workspace,
		worktree: workspace,
		abort: new AbortController().signal,
		metadata() {},
		async ask() {},
	};
}

test("persists one complete workspace lifecycle and replays its exact close", async () => {
	const workspace = await mkdtemp(join(tmpdir(), "flow-lifecycle-"));
	const flow = createWorkspaceFlowService(workspace);
	try {
		await execFileAsync("git", ["-C", workspace, "init", "--quiet"]);
		await writeFile(
			join(workspace, "source.ts"),
			"export const ready = true;\n",
		);

		const saved = ok(
			await flow.planSave({
				request: {
					operationId: "save-lifecycle",
					expectedRevision: 0,
					goal: "Ship one file-backed lifecycle",
					plan: {
						summary: "Exercise the workspace service.",
						overview: "Persist every lifecycle transition through .flow.",
						requirements: ["Archive completed work."],
						decisions: ["Use one final review."],
						evidence: [
							{
								scope: "gate",
								requirement: "Repository suite",
								environment: "this host",
								command: "bun test",
								platform: "other",
								assertions: [],
							},
						],
						features: [
							{
								id: FEATURE_ID,
								title: "Lifecycle",
								summary: "Complete the file-backed lifecycle.",
								targets: ["source.ts"],
								validation: ["bun test"],
								dependsOn: [],
							},
						],
					},
				},
			}),
		);
		const savedProjection = saved.workflowData.projection;
		expect(savedProjection.revision).toBe(1);

		const approved = ok(
			await flow.planApprove({
				request: {
					operationId: "approve-lifecycle",
					expectedRevision: savedProjection.revision,
				},
			}),
		);
		const approvedRevision = approved.workflowData.projection.revision;
		const started = ok(
			await flow.runStart({
				request: {
					operationId: "start-lifecycle",
					expectedRevision: approvedRevision,
					featureId: FEATURE_ID,
				},
			}),
		);
		const startedRevision = started.workflowData.projection.revision;
		expect(
			JSON.parse(await readFile(sessionPath(workspace), "utf8")),
		).toMatchObject({
			id: savedProjection.sessionId,
			revision: startedRevision,
			runs: [{ featureId: FEATURE_ID, state: "active" }],
		});

		const prepared = await prepareWorkspaceValidation(workspace, {
			expectedRevision: startedRevision,
			featureId: FEATURE_ID,
			command: "bun test",
			scope: "broad",
		});
		const validation = await persistWorkspaceValidation(workspace, {
			...prepared,
			captureId: "capture-lifecycle",
			exitCode: 0,
			outputDigest: OUTPUT_DIGEST,
			outputComplete: true,
		});

		const review = ok(
			await flow.reviewStart({
				request: {
					operationId: "review-lifecycle",
					expectedRevision: validation.recordedRevision,
					featureId: FEATURE_ID,
					artifactsChanged: [{ path: "source.ts" }],
					packet: {
						summary: "Review the completed lifecycle feature.",
						riskLenses: ["persistence"],
					},
				},
			}),
		);
		const reviewProjection = review.workflowData.projection;
		if (reviewProjection.view !== "reviewer") {
			throw new Error("Expected an actionable review projection.");
		}
		expect(reviewProjection.assignment.validationIds).toEqual([
			"capture-lifecycle",
		]);

		const completionInput = {
			request: {
				operationId: "complete-lifecycle",
				expectedRevision: reviewProjection.revision,
				featureId: FEATURE_ID,
				assignmentId: reviewProjection.assignment.id,
				summary: "Lifecycle completed.",
				result: {
					verdict: "passed" as const,
					findings: [
						{
							severity: "advisory" as const,
							summary: "Lifecycle evidence remains concise.",
							evidence: "source.ts:1",
						},
					],
					terminalDisposition: "submitted" as const,
				},
			},
		};
		let completionCancellations = 0;
		const completionTool = createTools(
			{},
			{
				validation: {
					cancel() {
						completionCancellations += 1;
						return true;
					},
				} as never,
				prepareValidation: async () => {
					throw new Error("Validation preparation is not used here.");
				},
			},
		).flow_feature_complete;
		if (!completionTool) throw new Error("Missing completion tool.");

		const completionCancellationsBeforeManager = completionCancellations;
		const stateBeforeManagerAttempt = await readFile(
			sessionPath(workspace),
			"utf8",
		);
		const managerAttempt = parseFeatureCompleteResponse(
			await completionTool.execute(
				completionInput,
				toolContext(workspace, "build"),
			),
		);
		expect(managerAttempt.status).toBe("error");
		expect(managerAttempt.summary).toContain(
			"Only the Flow reviewer may submit a new feature completion",
		);
		expect(completionCancellations).toBe(completionCancellationsBeforeManager);
		expect(await readFile(sessionPath(workspace), "utf8")).toBe(
			stateBeforeManagerAttempt,
		);
		expect((await loadSession(workspace))?.runs[0]?.state).toBe("active");

		const completed = ok(
			parseFeatureCompleteResponse(
				await completionTool.execute(
					completionInput,
					toolContext(workspace, "flow-reviewer"),
				),
			),
		);
		const completedProjection = completed.workflowData.projection;
		expect(completedProjection.status).toBe("completed");
		expect(completionCancellations).toBe(completionCancellationsBeforeManager);

		const stateBeforeReplay = await readFile(sessionPath(workspace), "utf8");
		const reviewerReplay = ok(
			parseFeatureCompleteResponse(
				await completionTool.execute(
					completionInput,
					toolContext(workspace, "flow-reviewer"),
				),
			),
		);
		expect(reviewerReplay.workflowData.operation).toMatchObject({
			operationId: "complete-lifecycle",
			revision: completedProjection.revision,
			replayed: true,
		});
		expect(completionCancellations).toBe(completionCancellationsBeforeManager);
		expect(await readFile(sessionPath(workspace), "utf8")).toBe(
			stateBeforeReplay,
		);

		const managerReplay = ok(
			parseFeatureCompleteResponse(
				await completionTool.execute(
					completionInput,
					toolContext(workspace, "build"),
				),
			),
		);
		expect(managerReplay.workflowData.operation).toMatchObject({
			operationId: "complete-lifecycle",
			revision: completedProjection.revision,
			replayed: true,
		});
		expect(completionCancellations).toBe(completionCancellationsBeforeManager);
		expect(await readFile(sessionPath(workspace), "utf8")).toBe(
			stateBeforeReplay,
		);

		const alteredReplay = parseFeatureCompleteResponse(
			await completionTool.execute(
				{
					request: {
						...completionInput.request,
						summary: "Different completion payload.",
					},
				},
				toolContext(workspace, "build"),
			),
		);
		expect(alteredReplay.status).toBe("error");
		expect(alteredReplay.summary).toContain(
			"may replay only an exact previously accepted request",
		);
		expect(completionCancellations).toBe(completionCancellationsBeforeManager);
		expect(await readFile(sessionPath(workspace), "utf8")).toBe(
			stateBeforeReplay,
		);

		const closeInput = {
			request: {
				operationId: "close-lifecycle",
				expectedRevision: completedProjection.revision,
				sessionId: savedProjection.sessionId,
				kind: "completed" as const,
				summary: "Lifecycle archived.",
			},
		};
		const closed = ok(await flow.sessionClose(closeInput));
		expect(closed.workflowData.delivery).toEqual({
			goal: "Ship one file-backed lifecycle",
			closure: {
				kind: "completed",
				summary: "Lifecycle archived.",
			},
			progress: { completed: 1, total: 1 },
			features: [
				{
					id: FEATURE_ID,
					title: "Lifecycle",
					attempts: 1,
					latestState: "completed",
					outcomeSummary: "Lifecycle completed.",
					terminalFindings: [
						{
							severity: "advisory",
							summary: "Lifecycle evidence remains concise.",
						},
					],
				},
			],
			reportedArtifacts: {
				latestAttempts: ["source.ts"],
				supersededAttemptsOnly: [],
			},
			assurance: expect.objectContaining({
				conclusion: "completion-supported",
			}),
			findingsDigest: expect.any(Array),
			report: expect.any(Array),
		});
		expect(await loadSession(workspace)).toBeNull();
		const archived = await loadArchivedSession(
			workspace,
			savedProjection.sessionId,
		);
		expect(archived).toMatchObject({
			closure: { operationId: "close-lifecycle", kind: "completed" },
			runs: [
				{
					state: "completed",
					validations: [{ id: "capture-lifecycle" }],
				},
			],
		});
		expect(archived).not.toHaveProperty("delivery");

		const archivePath = archivedSessionPath(
			workspace,
			savedProjection.sessionId,
		);
		const archiveBeforeReplay = await readFile(archivePath, "utf8");
		expect(JSON.parse(archiveBeforeReplay)).not.toHaveProperty("delivery");
		const replay = ok(await flow.sessionClose(closeInput));
		expect(replay.workflowData.operation).toMatchObject({
			operationId: "close-lifecycle",
			replayed: true,
		});
		expect(replay.workflowData.delivery).toEqual(closed.workflowData.delivery);
		expect(await readFile(archivePath, "utf8")).toBe(archiveBeforeReplay);
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
});
