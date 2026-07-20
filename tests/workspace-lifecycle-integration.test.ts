import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { FlowResponse } from "../src/application/flow-service.js";
import type { SourceDigest } from "../src/domain/session.js";
import {
	archivedSessionPath,
	loadArchivedSession,
	loadSession,
	sessionPath,
} from "../src/infrastructure/fs/workspace.js";
import {
	flowFeatureComplete,
	flowPlanApprove,
	flowPlanSave,
	flowReviewStart,
	flowRunStart,
	flowSessionClose,
} from "../src/infrastructure/fs/workspace-flow-service.js";
import {
	persistWorkspaceValidation,
	prepareWorkspaceValidation,
} from "../src/infrastructure/fs/workspace-validation.js";

const execFileAsync = promisify(execFile);
const FEATURE_ID = "lifecycle";
const OUTPUT_DIGEST = `sha256:${"b".repeat(64)}` as SourceDigest;

function ok(response: FlowResponse): FlowResponse {
	expect(response.status).toBe("ok");
	if (response.status !== "ok") throw new Error(response.summary);
	return response;
}

test("persists one complete workspace lifecycle and replays its exact close", async () => {
	const workspace = await mkdtemp(join(tmpdir(), "flow-lifecycle-"));
	try {
		await execFileAsync("git", ["-C", workspace, "init", "--quiet"]);
		await writeFile(
			join(workspace, "source.ts"),
			"export const ready = true;\n",
		);

		const saved = ok(
			await flowPlanSave(workspace, {
				request: {
					operationId: "save-lifecycle",
					expectedRevision: 0,
					goal: "Ship one file-backed lifecycle",
					plan: {
						summary: "Exercise the workspace service.",
						overview: "Persist every lifecycle transition through .flow.",
						requirements: ["Archive completed work."],
						decisions: ["Use one final review."],
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
		const savedProjection = saved.workflowData.projection as {
			sessionId: string;
			revision: number;
		};
		expect(savedProjection.revision).toBe(1);

		const approved = ok(
			await flowPlanApprove(workspace, {
				request: {
					operationId: "approve-lifecycle",
					expectedRevision: savedProjection.revision,
				},
			}),
		);
		const approvedRevision = (
			approved.workflowData.projection as { revision: number }
		).revision;
		const started = ok(
			await flowRunStart(workspace, {
				request: {
					operationId: "start-lifecycle",
					expectedRevision: approvedRevision,
					featureId: FEATURE_ID,
				},
			}),
		);
		const startedRevision = (
			started.workflowData.projection as { revision: number }
		).revision;
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
			await flowReviewStart(workspace, {
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
		const reviewProjection = review.workflowData.projection as {
			revision: number;
			assignment: { id: string; validationIds: string[] };
		};
		expect(reviewProjection.assignment.validationIds).toEqual([
			"capture-lifecycle",
		]);

		const completed = ok(
			await flowFeatureComplete(workspace, {
				request: {
					operationId: "complete-lifecycle",
					expectedRevision: reviewProjection.revision,
					featureId: FEATURE_ID,
					assignmentId: reviewProjection.assignment.id,
					summary: "Lifecycle completed.",
					result: {
						verdict: "passed",
						findings: [],
						terminalDisposition: "submitted",
					},
				},
			}),
		);
		const completedProjection = completed.workflowData.projection as {
			revision: number;
			status: string;
		};
		expect(completedProjection.status).toBe("completed");

		const closeInput = {
			request: {
				operationId: "close-lifecycle",
				expectedRevision: completedProjection.revision,
				sessionId: savedProjection.sessionId,
				kind: "completed" as const,
				summary: "Lifecycle archived.",
			},
		};
		ok(await flowSessionClose(workspace, closeInput));
		expect(await loadSession(workspace)).toBeNull();
		expect(
			await loadArchivedSession(workspace, savedProjection.sessionId),
		).toMatchObject({
			closure: { operationId: "close-lifecycle", kind: "completed" },
			runs: [
				{
					state: "completed",
					validations: [{ id: "capture-lifecycle" }],
				},
			],
		});

		const archivePath = archivedSessionPath(
			workspace,
			savedProjection.sessionId,
		);
		const archiveBeforeReplay = await readFile(archivePath, "utf8");
		const replay = ok(await flowSessionClose(workspace, closeInput));
		expect(replay.workflowData.operation).toMatchObject({
			operationId: "close-lifecycle",
			replayed: true,
		});
		expect(await readFile(archivePath, "utf8")).toBe(archiveBeforeReplay);
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
});
