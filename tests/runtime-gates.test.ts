import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	flowFeatureComplete,
	flowFeatureReset,
	flowPlanApprove,
	flowPlanSave,
	flowRunStart,
	flowSessionClose,
	flowStatus,
} from "../src/runtime/api";
import { WorkerResultSchema } from "../src/runtime/schema";

async function tempWorkspace(): Promise<string> {
	return mkdtemp(join(tmpdir(), "flow-runtime-"));
}

function twoFeaturePlan() {
	return {
		summary: "Deliver the requested change.",
		overview: "Implement the first feature, then the dependent final feature.",
		requirements: ["Keep scope explicit."],
		decisions: ["Use the minimal Flow v4 runtime."],
		finalReviewPolicy: "detailed" as const,
		features: [
			{
				id: "first-feature",
				title: "First feature",
				summary: "Deliver the first part.",
				targets: ["src/first.ts"],
				validation: ["targeted test"],
				dependsOn: [],
			},
			{
				id: "final-feature",
				title: "Final feature",
				summary: "Finish the delivery.",
				targets: ["src/final.ts"],
				validation: ["broad check"],
				dependsOn: ["first-feature"],
			},
		],
	};
}

function completePayload(featureId: string, scope: "targeted" | "broad") {
	return {
		status: "ok" as const,
		featureId,
		summary: `Completed ${featureId}.`,
		artifactsChanged: [{ path: `src/${featureId}.ts` }],
		validationRun: [
			{
				command: `bun test ${featureId}`,
				status: "passed" as const,
				summary: "Focused check passed.",
			},
		],
		validationScope: scope,
		featureReview: {
			status: "passed" as const,
			summary: "Reviewed changed files and validation.",
			blockingFindings: [],
		},
	};
}

function finalReview() {
	return {
		status: "passed" as const,
		summary: "Reviewed full session scope and broad validation.",
		blockingFindings: [],
		reviewDepth: "detailed" as const,
	};
}

async function approvedTwoFeatureSession(workspace: string): Promise<void> {
	expect(
		(
			await flowPlanSave(workspace, {
				goal: "Deliver a two-feature change",
				plan: twoFeaturePlan(),
			})
		).status,
	).toBe("ok");
	expect((await flowPlanApprove(workspace)).status).toBe("ok");
}

describe("Flow runtime gates", () => {
	test("rejects invalid feature dependency graphs", async () => {
		const workspace = await tempWorkspace();
		const cyclic = {
			...twoFeaturePlan(),
			features: [
				{ ...twoFeaturePlan().features[0], dependsOn: ["final-feature"] },
				{ ...twoFeaturePlan().features[1], dependsOn: ["first-feature"] },
			],
		};

		const result = await flowPlanSave(workspace, {
			goal: "Reject invalid graph",
			plan: cyclic,
		});
		expect(result.status).toBe("error");
		expect(String(result.summary)).toContain("cycle");
	});

	test("approved plans are immutable and only one feature can run", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);

		expect(
			(
				await flowPlanSave(workspace, {
					goal: "Deliver a two-feature change",
					plan: { ...twoFeaturePlan(), summary: "Changed after approval." },
				})
			).status,
		).toBe("error");

		expect((await flowRunStart(workspace, {})).status).toBe("ok");
		const secondStart = await flowRunStart(workspace, {
			featureId: "final-feature",
		});
		expect(secondStart.status).toBe("error");
		expect(String(secondStart.summary)).toContain("already in progress");
	});

	test("completion requires validation and review evidence", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});

		const missingValidation = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			validationRun: [],
		});
		expect(missingValidation.status).toBe("error");
		expect(String(missingValidation.summary)).toContain("validation evidence");

		const failedReview = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			featureReview: {
				status: "failed",
				summary: "A blocker remains.",
				blockingFindings: [{ summary: "Missing behavior test." }],
			},
		});
		expect(failedReview.status).toBe("error");
		expect(String(failedReview.summary)).toContain("featureReview");

		const status = await flowStatus(workspace);
		expect(status.status).toBe("running");
	});

	test("final feature requires broad validation and final review", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});
		expect(
			(
				await flowFeatureComplete(
					workspace,
					completePayload("first-feature", "targeted"),
				)
			).status,
		).toBe("ok");

		expect((await flowRunStart(workspace, {})).status).toBe("ok");
		const targetedFinal = await flowFeatureComplete(
			workspace,
			completePayload("final-feature", "targeted"),
		);
		expect(targetedFinal.status).toBe("error");
		expect(String(targetedFinal.summary)).toContain("broad validation");

		const withoutFinalReview = await flowFeatureComplete(
			workspace,
			completePayload("final-feature", "broad"),
		);
		expect(withoutFinalReview.status).toBe("error");
		expect(String(withoutFinalReview.summary)).toContain("finalReview");

		const completed = await flowFeatureComplete(workspace, {
			...completePayload("final-feature", "broad"),
			finalReview: finalReview(),
		});
		expect(completed.status).toBe("ok");
		expect((await flowStatus(workspace)).status).toBe("completed");
	});

	test("completed close refuses unfinished features", async () => {
		const planlessWorkspace = await tempWorkspace();
		await flowPlanSave(planlessWorkspace, {
			goal: "Close without a plan",
		});
		const planlessClose = await flowSessionClose(planlessWorkspace, {
			kind: "completed",
			summary: "Done.",
		});
		expect(planlessClose.status).toBe("error");
		expect(String(planlessClose.summary)).toContain("approved plan");

		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);

		const close = await flowSessionClose(workspace, {
			kind: "completed",
			summary: "Done.",
		});
		expect(close.status).toBe("error");
		expect(String(close.summary)).toContain("unfinished features");
	});

	test("needs_input outcomes cannot default to completed", () => {
		expect(
			WorkerResultSchema.safeParse({
				status: "needs_input",
				featureId: "first-feature",
				summary: "Need operator input.",
				outcome: {},
			}).success,
		).toBe(false);

		const parsed = WorkerResultSchema.parse({
			status: "needs_input",
			featureId: "first-feature",
			summary: "Need operator input.",
			outcome: {
				summary: "Missing API token for manual verification.",
			},
		});
		if (parsed.status !== "needs_input") {
			throw new Error("Expected a needs_input worker result.");
		}
		expect(parsed.outcome.kind).toBe("needs_input");
	});

	test("blocked sessions expose blocker details and require reset before rerun", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});

		const blocked = await flowFeatureComplete(workspace, {
			status: "needs_input",
			featureId: "first-feature",
			summary: "Need operator credentials.",
			outcome: {
				kind: "needs_input",
				summary: "Missing API token for manual verification.",
				resolutionHint: "Provide API_TOKEN or reset with a mocked check.",
			},
		});
		expect(blocked.status).toBe("ok");

		const status = await flowStatus(workspace);
		expect(status.status).toBe("blocked");
		expect(status.summary).toBe("Need operator credentials.");
		expect(
			(
				status.session as {
					latestHistoryEntry: { outcome?: { resolutionHint?: string } };
				}
			).latestHistoryEntry.outcome?.resolutionHint,
		).toContain("API_TOKEN");

		const rerun = await flowRunStart(workspace, {});
		expect(rerun.status).toBe("error");
		expect(String(rerun.summary)).toContain("reset");

		const unrelatedReset = await flowFeatureReset(workspace, {
			featureId: "final-feature",
		});
		expect(unrelatedReset.status).toBe("ok");

		const stillBlocked = await flowStatus(workspace);
		expect(stillBlocked.status).toBe("blocked");
		expect(
			(
				stillBlocked.session as {
					features: Array<{ id: string; status: string }>;
				}
			).features.find((feature) => feature.id === "first-feature")?.status,
		).toBe("blocked");

		const requestedBlocked = await flowRunStart(workspace, {
			featureId: "first-feature",
		});
		expect(requestedBlocked.status).toBe("error");
		expect(String(requestedBlocked.summary)).toContain("reset");

		const resetBlocked = await flowFeatureReset(workspace, {
			featureId: "first-feature",
		});
		expect(resetBlocked.status).toBe("ok");
		expect(
			(await flowRunStart(workspace, { featureId: "first-feature" })).status,
		).toBe("ok");
	});

	test("reset clears a feature and its dependents", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});
		await flowFeatureComplete(
			workspace,
			completePayload("first-feature", "targeted"),
		);

		const reset = await flowFeatureReset(workspace, {
			featureId: "first-feature",
		});
		expect(reset.status).toBe("ok");

		const status = await flowStatus(workspace);
		const features = (
			status.session as { features: Array<{ id: string; status: string }> }
		).features;
		expect(
			features.find((feature) => feature.id === "first-feature")?.status,
		).toBe("pending");
		expect(
			features.find((feature) => feature.id === "final-feature")?.status,
		).toBe("pending");
	});
});
