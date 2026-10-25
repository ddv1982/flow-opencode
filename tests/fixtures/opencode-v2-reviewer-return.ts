import { expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	OpenCodeClient,
	SessionInfo,
	SessionMessageAssistantTool,
} from "@opencode/client";
import { isRecord } from "../../evals/host-observation.js";
import { listNativeMessages } from "../../evals/opencode-host.js";
import {
	FeatureCompleteInputSchema,
	ReviewStartInputSchema,
	SessionSchema,
} from "../../src/application/schema.js";
import { validationCommands } from "./opencode-v2-validation-cases.js";

type Dispatch = (
	agent: string,
	actions: { tool: string; input: Record<string, unknown> }[],
) => Promise<{ session: SessionInfo; calls: SessionMessageAssistantTool[] }>;

function response(calls: SessionMessageAssistantTool[], name: string) {
	const call = calls.findLast((entry) => entry.name === name);
	if (call?.state.status !== "completed")
		throw new Error(`Native ${name} did not complete`);
	const value: unknown = JSON.parse(
		call.state.content
			.filter((item) => item.type === "text")
			.map((item) => item.text)
			.join("\n"),
	);
	if (!isRecord(value)) throw new Error(`Invalid native ${name} response`);
	return value;
}

export async function runPackedReviewerReturn(
	project: string,
	client: OpenCodeClient,
	rootID: string,
	dispatch: Dispatch,
	evidence: unknown[],
) {
	const session = async () =>
		SessionSchema.parse(
			JSON.parse(await readFile(join(project, ".flow/session.json"), "utf8")),
		);
	const manager = async (tool: string, request: Record<string, unknown>) => {
		const result = response(
			(await dispatch("build", [{ tool, input: { request } }])).calls,
			tool,
		);
		expect(result).toMatchObject({ status: "ok" });
		return result;
	};
	await manager("flow_feature_reset", {
		operationId: "smoke-review-reset",
		expectedRevision: (await session()).revision,
		featureId: "native-check",
		nextFeatureId: "native-return",
	});
	const validated = await dispatch("build", [
		{
			tool: "flow_validation_start",
			input: {
				request: {
					expectedRevision: (await session()).revision,
					featureId: "native-return",
					command: validationCommands.pass,
					scope: "broad",
				},
			},
		},
		{
			tool: "shell",
			input: {
				command: validationCommands.pass,
				description: "Validate reviewer return fixture",
			},
		},
	]);
	expect(response(validated.calls, "flow_validation_start")).toMatchObject({
		status: "ok",
	});
	evidence.push({
		kind: "reviewer-validation",
		session: await session(),
		calls: validated.calls,
	});
	await manager(
		"flow_review_start",
		ReviewStartInputSchema.parse({
			request: {
				operationId: "smoke-review-start",
				expectedRevision: (await session()).revision,
				featureId: "native-return",
				artifactsChanged: [],
				packet: {
					summary:
						"Review the source-bound native gate and return a terminal result.",
					riskLenses: [],
				},
			},
		}).request,
	);
	const pending = await session();
	const run = pending.runs.at(-1);
	const assignment = run?.reviews.at(-1);
	if (!run || !assignment)
		throw new Error("Native review did not create an assignment");
	const completion = FeatureCompleteInputSchema.parse({
		request: {
			operationId: "smoke-review-complete",
			expectedRevision: pending.revision,
			featureId: "native-return",
			assignmentId: assignment.id,
			summary: "Local scripted reviewer submitted the native gate result.",
			result: {
				verdict: "passed",
				terminalDisposition: "submitted",
				findings: [],
			},
		},
	});
	const denied = await dispatch("build", [
		{ tool: "flow_feature_complete", input: completion },
	]);
	expect(response(denied.calls, "flow_feature_complete")).toMatchObject({
		status: "error",
	});
	expect((await session()).revision).toBe(pending.revision);
	const reviewer = await dispatch("flow-reviewer", [
		{
			tool: "flow_status",
			input: { request: { view: "reviewer", assignmentId: assignment.id } },
		},
		{
			tool: "flow_status",
			input: {
				request: {
					view: "reviewer-evidence",
					assignmentId: assignment.id,
					part: "diff",
					page: 0,
				},
			},
		},
		{ tool: "flow_feature_complete", input: completion },
	]);
	const nativeChild = await client.session.get(
		{ sessionID: reviewer.session.id },
		{ signal: AbortSignal.timeout(30000) },
	);
	expect(nativeChild).toMatchObject({
		parentID: rootID,
		agent: "flow-reviewer",
	});
	for (const call of reviewer.calls)
		expect(call.state.status).toBe("completed");
	const packet = response(reviewer.calls.slice(0, 1), "flow_status");
	const diff = response(reviewer.calls.slice(1, 2), "flow_status");
	expect(packet).toMatchObject({
		status: "ok",
		workflowData: {
			reviewerPager: { assurance: "host-evidence", diffPages: 1 },
			projection: {
				assignment: {
					id: assignment.id,
					sourceDigest: assignment.sourceDigest,
				},
			},
		},
	});
	expect(diff).toMatchObject({
		status: "ok",
		workflowData: {
			projection: {
				assignmentId: assignment.id,
				part: "diff",
				page: 0,
				totalPages: 1,
				complete: true,
				assurance: "host-evidence",
			},
		},
	});
	if (
		!isRecord(diff.workflowData) ||
		!isRecord(diff.workflowData.projection) ||
		typeof diff.workflowData.projection.text !== "string"
	)
		throw new Error("Missing native reviewer evidence packet");
	expect(JSON.parse(diff.workflowData.projection.text)).toMatchObject({
		version: 1,
		sessionId: pending.id,
		featureId: "native-return",
		runId: run.id,
		sourceDigest: assignment.sourceDigest,
		complete: true,
	});
	expect(response(reviewer.calls, "flow_feature_complete")).toMatchObject({
		status: "ok",
	});
	const completed = (await session()).runs.find((entry) => entry.id === run.id);
	expect(completed).toMatchObject({
		state: "completed",
		reviews: [
			{
				id: assignment.id,
				result: {
					verdict: "passed",
					terminalDisposition: "submitted",
					findings: [],
				},
			},
		],
	});
	const observed = await manager("flow_status", { view: "detail" });
	expect(observed).toMatchObject({
		workflowData: {
			projection: {
				view: "detail",
				activeRunId: null,
				progress: { completed: 1 },
				runs: [
					{ featureId: "native-check", state: "superseded" },
					{ id: run.id, featureId: "native-return", state: "completed" },
				],
			},
		},
	});
	evidence.push({
		kind: "reviewer-return",
		rootID,
		child: {
			id: nativeChild.id,
			parentID: nativeChild.parentID,
			agent: nativeChild.agent,
		},
		assignmentId: assignment.id,
		sourceDigest: assignment.sourceDigest,
		managerDenied: true,
		packet,
		diff,
		childTranscript: await listNativeMessages(client, nativeChild.id),
		completed,
		manager: observed,
	});
}
