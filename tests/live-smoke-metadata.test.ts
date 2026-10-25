import { expect, test } from "bun:test";
import {
	buildHostEvidenceCapabilities,
	collectFieldObservations,
	type EndpointAttempt,
	type EndpointName,
	HOST_METADATA_CONTRACT,
} from "../scripts/probe-opencode-eval-metadata.js";

const endpoints = HOST_METADATA_CONTRACT.endpoints;
const observed = (
	endpoint: EndpointName,
	response: unknown,
): EndpointAttempt => ({ kind: "observed", endpoint, response });
const manager = [
	{
		type: "assistant",
		id: "msg_manager",
		agent: "build",
		model: { providerID: "provider", id: "alias" },
		time: { created: 1, completed: 2 },
		content: [{ type: "text", text: "never retain private output" }],
	},
];
const reviewer = [
	{ ...manager[0], id: "msg_reviewer", agent: "flow-reviewer" },
];
function input() {
	return {
		opencodeVersion: "2.1.4",
		generatedAt: "2026-10-24T00:00:00Z",
		parentSessionId: "root",
		endpointResponses: [
			observed(endpoints.serverInfo, { version: "2.1.4" }),
			observed(endpoints.agents, {
				location: { directory: "/fixture" },
				data: [],
			}),
			observed(endpoints.createSession, {
				id: "root",
				location: { directory: "/fixture" },
			}),
			observed(endpoints.dispatchReview, null),
		],
		childSessions: observed(endpoints.childSessions, [
			{ id: "child", parentID: "root", agent: "flow-reviewer" },
		]),
		parentMessages: observed(endpoints.parentMessages, manager),
		childMessages: [
			{
				sessionId: "child",
				messages: observed(endpoints.childMessages, reviewer),
			},
		],
	};
}

test("metadata proof joins the public server version and completed native model refs", () => {
	const proof = buildHostEvidenceCapabilities(input());
	expect(proof.result).toEqual({ kind: "complete" });
	expect(proof.capabilities.hostVersion).toEqual({
		kind: "observed",
		matchesRequested: true,
		fieldPath: "version",
	});
	expect(proof.capabilities.parentManagerModelIdentity).toEqual({
		kind: "observed",
		actors: [
			{ actor: "parent-1", fieldPaths: ["[].model.id", "[].model.providerID"] },
		],
	});
	expect(proof.capabilities.childLineage).toEqual({
		kind: "observed",
		links: [
			{
				parent: "parent-1",
				child: "child-1",
				fieldPaths: ["[].id", "[].parentID"],
			},
		],
	});
	expect(proof.capabilities.childReviewerModelIdentity).toEqual({
		kind: "observed",
		actors: [
			{ actor: "child-1", fieldPaths: ["[].model.id", "[].model.providerID"] },
		],
	});
	expect(JSON.stringify(proof).includes("never retain private output")).toBe(
		false,
	);
	expect(JSON.stringify(proof).includes("msg_manager")).toBe(false);
});

for (const mode of [
	"host-version",
	"missing-version",
	"failed-review",
	"wrong-parent",
	"missing-child-message",
	"errored-assistant",
	"incomplete-assistant",
] as const) {
	test(`metadata proof refuses ${mode}`, () => {
		const fixture = input();
		if (mode === "host-version")
			fixture.endpointResponses[0] = observed(endpoints.serverInfo, {
				version: "2.2.0",
			});
		if (mode === "missing-version")
			fixture.endpointResponses[0] = observed(endpoints.serverInfo, {});
		if (mode === "failed-review")
			fixture.endpointResponses[3] = {
				kind: "endpoint-failure",
				endpoint: endpoints.dispatchReview,
			};
		if (mode === "wrong-parent")
			fixture.childSessions = observed(endpoints.childSessions, [
				{ id: "child", parentID: "foreign", agent: "flow-reviewer" },
			]);
		if (mode === "missing-child-message") fixture.childMessages = [];
		if (mode === "errored-assistant")
			fixture.parentMessages = observed(endpoints.parentMessages, [
				{ ...manager[0], error: { type: "api", message: "denied" } },
			]);
		if (mode === "incomplete-assistant")
			fixture.parentMessages = observed(endpoints.parentMessages, [
				{ ...manager[0], time: { created: 1 } },
			]);
		expect(buildHostEvidenceCapabilities(fixture).result).toEqual({
			kind: "inconclusive",
			reason:
				mode === "host-version"
					? "host-version-mismatch"
					: mode === "failed-review"
						? "endpoint-failure"
						: mode === "wrong-parent"
							? "reviewer-child-not-observed"
							: ["errored-assistant", "incomplete-assistant"].includes(mode)
								? "model-did-not-answer"
								: "required-capability-unavailable",
		});
	});
}

test("metadata maps field shapes without descending into secrets, bodies or tokens", () => {
	expect(
		collectFieldObservations({
			model: { providerID: "private-provider", id: "private-model" },
			authorization: "private",
			content: [{ text: "private" }],
			accessToken: "private",
			password: "private",
			tokens: { input: 2 },
		}),
	).toEqual([
		{ path: "model", kind: "object" },
		{ path: "model.id", kind: "string" },
		{ path: "model.providerID", kind: "string" },
	]);
});
