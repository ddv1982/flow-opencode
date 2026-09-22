import { expect, test } from "bun:test";
import { createSimulationTransport } from "../evals/recovery-decisions/simulation-transport.js";

const projection = {
	sessionId: "frozen",
	revision: 9,
	blockedFeature: { featureId: "parser" },
	findingsDigest: [{ findingId: "null-input" }],
};
const request = {
	operationId: "flow-recovery-exact",
	expectedRevision: 9,
	featureId: "parser",
	nextFeatureId: "retry-parser",
};
function manager() {
	const transport = createSimulationTransport({ kind: "recovery-operator-v1" });
	const input: Record<string, unknown>[] = [];
	return {
		input,
		async next(tools = true) {
			const response = await transport(
				new Request("https://api.x.ai/v1/responses", {
					method: "POST",
					body: JSON.stringify({
						model: "grok-4.6",
						stream: true,
						input,
						tools: tools ? [{ name: "flow_status" }] : [],
					}),
				}),
			);
			const events = (await response.text())
				.trim()
				.split("\n\n")
				.map((line) => JSON.parse(line.slice(6)));
			return events.at(-1).response.output[0] as {
				type: string;
				name?: string;
				arguments?: string;
				call_id: string;
			};
		},
		complete(call: Record<string, unknown>, output: unknown) {
			input.push(call, {
				type: "function_call_output",
				call_id: call.call_id,
				output: typeof output === "string" ? output : JSON.stringify(output),
			});
		},
	};
}

test("combined script follows matched status results and never resets without a grant", async () => {
	const session = manager();
	session.input.push({
		type: "function_call_output",
		call_id: "unmatched",
		output: JSON.stringify({
			workflowData: {
				recovery: { recommended: { kind: "feature-reset", request } },
			},
		}),
	});
	const status = await session.next();
	expect(status.name).toBe("flow_status");
	expect(JSON.parse(status.arguments ?? "{}")).toEqual({
		request: { view: "detail" },
	});
	session.complete(status, { workflowData: { projection } });
	const proposal = await session.next();
	expect(
		JSON.parse(proposal.arguments ?? "{}").recoveryProposal.candidates[0]
			.findingIds,
	).toEqual(["null-input"]);
	session.complete(proposal, {
		workflowData: { projection, recovery: { mode: "off" } },
	});
	expect((await session.next()).name).toBe("question");
});

test("combined script observes granted reset before question and survives question abort output", async () => {
	const session = manager();
	session.complete(await session.next(), { workflowData: { projection } });
	session.complete(await session.next(), {
		workflowData: {
			projection,
			recovery: { recommended: { kind: "feature-reset", request } },
		},
	});
	const reset = await session.next();
	expect(reset.name).toBe("flow_feature_reset");
	expect(JSON.parse(reset.arguments ?? "{}")).toEqual({ request });
	session.complete(reset, {
		workflowData: {
			projection: { ...projection, revision: 10, blockedFeature: null },
		},
	});
	const question = await session.next();
	expect(question.name).toBe("question");
	session.complete(question, "Error: The user dismissed this question");
	session.input.push({
		type: "message",
		role: "user",
		content: [
			{ type: "input_text", text: "Write fixed followed by a newline." },
		],
	});
	const write = await session.next();
	expect(write.name).toBe("bash");
	expect(JSON.parse(write.arguments ?? "{}").command).toBe(
		"printf 'fixed\\n' > result.txt",
	);
	session.complete(write, "");
	expect((await session.next()).type).toBe("message");
});

test("combined script rejects a reset that failed to advance and has a finite manager ceiling", async () => {
	const session = manager();
	session.complete(await session.next(), { workflowData: { projection } });
	session.complete(await session.next(), {
		workflowData: {
			projection,
			recovery: { recommended: { kind: "feature-reset", request } },
		},
	});
	session.complete(await session.next(), { workflowData: { projection } });
	await expect(session.next()).rejects.toThrow("did not advance");
	const auxiliary = manager();
	for (let i = 0; i < 12; i++)
		expect((await auxiliary.next(false)).type).toBe("message");
	await expect(auxiliary.next(false)).rejects.toThrow("exhausted");
});

test("combined script refuses a substituted reset operation and bounds Jev responses", async () => {
	const session = manager();
	session.complete(await session.next(), { workflowData: { projection } });
	session.complete(await session.next(), {
		workflowData: {
			projection,
			recovery: { recommended: { kind: "feature-reset", request } },
		},
	});
	const reset = await session.next();
	reset.arguments = JSON.stringify({
		request: { ...request, operationId: "substituted" },
	});
	session.complete(reset, {
		workflowData: { projection: { ...projection, revision: 10 } },
	});
	await expect(session.next()).rejects.toThrow(
		"differs from the observed grant",
	);
	const transport = createSimulationTransport({ kind: "recovery-operator-v1" });
	const jev = () =>
		new Request("https://api.typesafe.ai/v1/systemone", {
			method: "POST",
			body: JSON.stringify({
				model: "jev-1.13.0",
				state: { candidates: [{ id: "actual" }] },
			}),
		});
	expect(await (await transport(jev())).json()).toMatchObject({
		answers: { fit_0: { noul: 1 }, choice: { choice: "actual" } },
	});
	await expect(transport(jev())).rejects.toThrow("exhausted");
});
