import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileSessionRepository } from "../src/infrastructure/fs/session-repository.js";
import {
	flowPlanApprove,
	flowPlanSave,
	flowReviewStart,
	flowRunStart,
} from "../src/infrastructure/fs/workspace-flow-service.js";
import { publishValidationReceiptForWorkspace } from "./support/validation-receipt.js";

const workspaces: string[] = [];

afterEach(async () => {
	await Promise.all(
		workspaces
			.splice(0)
			.map((workspace) => rm(workspace, { recursive: true, force: true })),
	);
});

async function activeWorkspace() {
	const workspace = await mkdtemp(join(tmpdir(), "flow-receipt-review-"));
	workspaces.push(workspace);
	await flowPlanSave(workspace, {
		goal: "Verify receipt review admission",
		plan: {
			summary: "Exercise immutable validation receipts.",
			overview: "Keep Session v4 evidence while removing caller attestation.",
			requirements: [],
			decisions: [],
			features: [
				{
					id: "receipt-review",
					title: "Receipt review",
					summary: "Bind one runtime receipt.",
				},
			],
		},
	});
	await flowPlanApprove(workspace);
	await flowRunStart(workspace, {});
	const session = await createFileSessionRepository(workspace).read();
	if (!session?.activeFeatureId || !session.activeFeatureRunId) {
		throw new Error("Expected an active feature run.");
	}
	const run = session.featureRuns.find(
		(candidate) => candidate.id === session.activeFeatureRunId,
	);
	if (!run) throw new Error("Expected the active run record.");
	return { workspace, session, run };
}

function reviewRequest(
	session: Awaited<ReturnType<typeof activeWorkspace>>["session"],
	validationRefs: Array<{
		kind: "validation_receipt_ref_v1";
		digest: `sha256:${string}`;
		byteLength: number;
	}>,
) {
	return {
		request: {
			operationId: `receipt-review-${crypto.randomUUID()}`,
			expectedRevision: session.causal.revision,
			expectedSnapshotId: session.causal.snapshotId,
			featureId: session.activeFeatureId as string,
			reviewKind: "feature" as const,
			validationScope: "targeted" as const,
			packet: { summary: "Review runtime receipt binding.", riskLenses: [] },
			validationRefs,
		},
	};
}

describe("validation receipt review admission", () => {
	test("materializes a complete host-shaped receipt into Session v4 evidence", async () => {
		const { workspace, session, run } = await activeWorkspace();
		const ref = await publishValidationReceiptForWorkspace(workspace, {
			startedAt: run.startedAt,
		});
		const response = await flowReviewStart(
			workspace,
			reviewRequest(session, [ref]),
		);
		expect(response.status).toBe("ok");
		const persisted = await createFileSessionRepository(workspace).read();
		expect(persisted?.causal.evidence).toHaveLength(1);
		expect(persisted?.causal.evidence[0]).toMatchObject({
			kind: "validation",
			featureRunId: session.activeFeatureRunId,
			sourceDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
			exitCode: 0,
		});
	});

	test("rejects stale-source and incomplete receipts without consuming the operation", async () => {
		const first = await activeWorkspace();
		const staleRef = await publishValidationReceiptForWorkspace(
			first.workspace,
			{
				startedAt: first.run.startedAt,
			},
		);
		await writeFile(join(first.workspace, "changed.txt"), "changed\n", "utf8");
		const stale = await flowReviewStart(
			first.workspace,
			reviewRequest(first.session, [staleRef]),
		);
		expect(stale.status).toBe("error");
		expect(stale.workflowData?.receipt).toMatchObject({
			operationAccepted: false,
			operationIdConsumed: false,
		});

		const second = await activeWorkspace();
		const incompleteRef = await publishValidationReceiptForWorkspace(
			second.workspace,
			{
				startedAt: second.run.startedAt,
				outputCompleteness: "truncated",
			},
		);
		const incomplete = await flowReviewStart(
			second.workspace,
			reviewRequest(second.session, [incompleteRef]),
		);
		expect(incomplete.status).toBe("error");
		expect(incomplete.summary).toContain("rejected");
	});

	test("rejects missing and duplicate receipt references at the boundary", async () => {
		const { workspace, session } = await activeWorkspace();
		const missing = {
			kind: "validation_receipt_ref_v1" as const,
			digest: `sha256:${"f".repeat(64)}` as const,
			byteLength: 128,
		};
		const missingResponse = await flowReviewStart(
			workspace,
			reviewRequest(session, [missing]),
		);
		expect(missingResponse.status).toBe("error");

		const duplicateResponse = await flowReviewStart(
			workspace,
			reviewRequest(session, [missing, missing]),
		);
		expect(duplicateResponse.status).toBe("error");
		expect(duplicateResponse.summary).toContain("payload is invalid");
	});

	test("does not accept the removed caller-attested validations payload", async () => {
		const { workspace, session, run } = await activeWorkspace();
		const response = await flowReviewStart(workspace, {
			request: {
				...reviewRequest(session, []).request,
				validationRefs: undefined,
				validations: [
					{
						command: "bun test",
						summary: "claimed",
						startedAt: run.startedAt,
						completedAt: run.startedAt,
						exitCode: 0,
						outputDigest: `sha256:${"a".repeat(64)}`,
						environmentKeys: [],
					},
				],
			},
		});
		expect(response.status).toBe("error");
		expect(response.summary).toContain("payload is invalid");
	});
});
