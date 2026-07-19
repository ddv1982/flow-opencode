import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileSessionRepository } from "../src/infrastructure/fs/session-repository.js";
import {
	flowPlanApprove,
	flowPlanSave,
	flowRunStart,
} from "../src/infrastructure/fs/workspace-flow-service.js";
import { prepareWorkspaceValidation } from "../src/infrastructure/fs/workspace-validation.js";

const workspaces: string[] = [];

afterEach(async () => {
	await Promise.all(
		workspaces
			.splice(0)
			.map((workspace) => rm(workspace, { recursive: true, force: true })),
	);
});

async function activeWorkspace() {
	const workspace = await mkdtemp(join(tmpdir(), "flow-validation-prepare-"));
	workspaces.push(workspace);
	await flowPlanSave(workspace, {
		goal: "Prepare runtime validation",
		plan: {
			summary: "Prepare validation",
			overview: "Exercise the capture guard.",
			requirements: [],
			decisions: [],
			features: [
				{
					id: "capture-validation",
					title: "Capture validation",
					summary: "Capture one check.",
				},
			],
		},
	});
	await flowPlanApprove(workspace);
	await flowRunStart(workspace, {});
	const session = await createFileSessionRepository(workspace).read();
	if (!session?.activeFeatureId || !session.activeFeatureRunId) {
		throw new Error("Expected active feature run.");
	}
	return {
		workspace,
		session,
		activeFeatureId: session.activeFeatureId,
		activeFeatureRunId: session.activeFeatureRunId,
	};
}

describe("validation preparation", () => {
	test("binds capture to the active run and authoritative source", async () => {
		const { workspace, session, activeFeatureId, activeFeatureRunId } =
			await activeWorkspace();
		const prepared = await prepareWorkspaceValidation(workspace, {
			expectedRevision: session.causal.revision,
			expectedSnapshotId: session.causal.snapshotId,
			featureId: activeFeatureId,
		});
		expect(prepared).toEqual({
			featureRunId: activeFeatureRunId,
			featureId: activeFeatureId,
			sourceDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
		});
	});

	test("rejects stale guards and a different feature", async () => {
		const { workspace, session, activeFeatureId } = await activeWorkspace();
		await expect(
			prepareWorkspaceValidation(workspace, {
				expectedRevision: session.causal.revision + 1,
				expectedSnapshotId: session.causal.snapshotId,
				featureId: activeFeatureId,
			}),
		).rejects.toThrow("stale causal guards");
		await expect(
			prepareWorkspaceValidation(workspace, {
				expectedRevision: session.causal.revision,
				expectedSnapshotId: session.causal.snapshotId,
				featureId: "other-feature",
			}),
		).rejects.toThrow("active native feature run");
	});
});
