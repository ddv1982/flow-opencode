import { describe, expect, test } from "bun:test";
import {
	createFlowHostObservationHooks,
	FlowHostObservationRegistry,
} from "../src/platform/opencode/observation.js";

function assistantEvent(
	id: string,
	sessionID: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		type: "message.updated",
		properties: {
			info: {
				id,
				sessionID,
				role: "assistant",
				providerID: "provider",
				modelID: "model",
				cost: 0,
				tokens: {
					input: 0,
					output: 0,
					reasoning: 0,
					cache: { read: 0, write: 0 },
				},
				...overrides,
			},
		},
	};
}

describe("Flow host observation", () => {
	test("reports unavailable metrics distinctly from observed zero", () => {
		const registry = new FlowHostObservationRegistry({ signatureSalt: "test" });
		registry.observeChatMessage({ sessionID: "root", agent: "manager" });
		expect(registry.snapshot("root")?.tokens.input).toEqual({
			value: null,
			provenance: "unavailable",
		});

		registry.observeEvent(assistantEvent("message-1", "root"));
		expect(registry.snapshot("root")?.tokens.input).toEqual({
			value: 0,
			provenance: "host_observed",
		});
	});

	test("deduplicates message and tool events while updating token totals", () => {
		let now = 100;
		const registry = new FlowHostObservationRegistry({
			now: () => now,
			signatureSalt: "test",
		});
		const initial = assistantEvent("message-1", "root", {
			cost: 1,
			tokens: {
				input: 10,
				output: 2,
				reasoning: 1,
				cache: { read: 3, write: 4 },
			},
		});
		registry.observeEvent(initial);
		registry.observeEvent(initial);
		registry.observeEvent(
			assistantEvent("message-1", "root", {
				cost: 2,
				tokens: {
					input: 12,
					output: 4,
					reasoning: 2,
					cache: { read: 5, write: 6 },
				},
			}),
		);

		const input = { tool: "read", sessionID: "root", callID: "call-1" };
		registry.observeToolBefore(input, { args: { filePath: "/secret/file" } });
		registry.observeToolBefore(input, { args: { filePath: "/secret/file" } });
		now = 125;
		registry.observeToolAfter(
			{ ...input, args: { filePath: "/secret/file" } },
			{ title: "read", output: "secret output", metadata: {} },
		);
		registry.observeToolAfter(
			{ ...input, args: { filePath: "/secret/file" } },
			{ title: "read", output: "secret output", metadata: {} },
		);

		const report = registry.snapshot("root");
		expect(report?.tokens.input.value).toBe(12);
		expect(report?.models.actualObservations).toBe(1);
		expect(report?.tools).toMatchObject({ calls: 1, completed: 1 });
		expect(report?.tools.durationMs.value).toBe(25);
	});

	test("classifies the pinned OpenCode Bash exit metadata", () => {
		const registry = new FlowHostObservationRegistry({ signatureSalt: "test" });
		for (const [callID, exit] of [
			["passed", 0],
			["failed", 2],
		] as const) {
			registry.observeToolBefore(
				{ tool: "bash", sessionID: "root", callID },
				{ args: { command: `exit ${exit}` } },
			);
			registry.observeToolAfter(
				{
					tool: "bash",
					sessionID: "root",
					callID,
					args: { command: `exit ${exit}` },
				},
				{ title: "bash", output: "", metadata: { exit, truncated: false } },
			);
		}
		expect(registry.snapshot("root")?.tools).toMatchObject({
			calls: 2,
			completed: 2,
			errors: 1,
		});
	});

	test("separates same-wave duplicate reads from verifier rereads", () => {
		const registry = new FlowHostObservationRegistry({ signatureSalt: "test" });
		registry.observeEvent({
			type: "session.created",
			properties: { info: { id: "worker", parentID: "root" } },
		});
		registry.observeChatMessage({
			sessionID: "worker",
			agent: "flow-evidence-worker",
		});
		registry.observeToolBefore(
			{ tool: "read", sessionID: "worker", callID: "read-1" },
			{ args: { filePath: "/private/a.ts" } },
		);
		registry.observeToolBefore(
			{ tool: "read", sessionID: "worker", callID: "read-2" },
			{ args: { filePath: "/private/a.ts" } },
		);

		registry.observeEvent({
			type: "session.created",
			properties: { info: { id: "verifier", parentID: "root" } },
		});
		registry.observeChatMessage({
			sessionID: "verifier",
			agent: "flow-verifier",
		});
		registry.observeToolBefore(
			{ tool: "read", sessionID: "verifier", callID: "read-3" },
			{ args: { filePath: "/private/a.ts" } },
		);

		expect(registry.snapshot("root")?.reads).toEqual({
			total: 3,
			unique: 1,
			exactDuplicates: 2,
			sameWaveDuplicates: 1,
			verificationRereads: 1,
		});
	});

	test("resets per-epoch read and guidance duplicate detection on compaction", () => {
		const registry = new FlowHostObservationRegistry({ signatureSalt: "test" });
		registry.observeToolBefore(
			{ tool: "flow_guidance", sessionID: "root", callID: "guide-1" },
			{ args: { id: "flow-test" } },
		);
		registry.observeToolBefore(
			{ tool: "flow_guidance", sessionID: "root", callID: "guide-2" },
			{ args: { id: "flow-test" } },
		);
		registry.compact("root");
		registry.observeToolBefore(
			{ tool: "flow_guidance", sessionID: "root", callID: "guide-3" },
			{ args: { id: "flow-test" } },
		);

		const report = registry.snapshot("root");
		expect(report?.epoch).toBe(1);
		expect(report?.guidance).toMatchObject({
			calls: 3,
			uniqueIds: 1,
			duplicateCalls: 1,
		});
	});

	test("never serializes raw prompts, paths, arguments, outputs, or session ids", () => {
		const registry = new FlowHostObservationRegistry({ signatureSalt: "test" });
		registry.observeToolBefore(
			{ tool: "read", sessionID: "raw-session-secret", callID: "call" },
			{ args: { filePath: "/Users/person/private/passwords.txt" } },
		);
		registry.observeToolAfter(
			{
				tool: "read",
				sessionID: "raw-session-secret",
				callID: "call",
				args: { filePath: "/Users/person/private/passwords.txt" },
			},
			{ title: "private", output: "token=super-secret", metadata: {} },
		);
		const serialized = JSON.stringify(registry.snapshot("raw-session-secret"));
		expect(serialized).not.toContain("raw-session-secret");
		expect(serialized).not.toContain("passwords.txt");
		expect(serialized).not.toContain("super-secret");
		expect(serialized).not.toContain("/Users/");
	});

	test("bounds roots and isolates malformed hook payloads", async () => {
		const registry = new FlowHostObservationRegistry({
			maxRoots: 1,
			signatureSalt: "test",
		});
		const hooks = createFlowHostObservationHooks(registry);
		await hooks.event?.({ event: null as never });
		registry.observeChatMessage({ sessionID: "old" });
		registry.observeChatMessage({ sessionID: "new" });
		expect(registry.snapshot("old")).toBeNull();
		expect(registry.snapshot("new")).not.toBeNull();
	});

	test("bounds per-root state and reports deterministic overflow", () => {
		const registry = new FlowHostObservationRegistry({
			maxCallsPerRoot: 2,
			maxMessagesPerRoot: 2,
			maxDistinctValuesPerRoot: 2,
			signatureSalt: "test",
		});
		for (let index = 1; index <= 3; index += 1) {
			registry.observeChatMessage({
				sessionID: "root",
				agent: `role-${index}`,
				model: { providerID: "provider", modelID: `model-${index}` },
			});
			registry.observeEvent(
				assistantEvent(`message-${index}`, "root", {
					providerID: "provider",
					modelID: `model-${index}`,
					tokens: {
						input: index === 1 ? Number.MAX_SAFE_INTEGER : 1,
						output: 0,
						reasoning: 0,
						cache: { read: 0, write: 0 },
					},
				}),
			);
			registry.observeToolBefore(
				{ tool: "read", sessionID: "root", callID: `call-${index}` },
				{ args: { query: `${index}${"x".repeat(80_000)}` } },
			);
			registry.observeToolAfter(
				{
					tool: "read",
					sessionID: "root",
					callID: `call-${index}`,
					args: {},
				},
				{
					title: "read",
					output: `${index}${"y".repeat(80_000)}`,
					metadata: {},
				},
			);
			registry.observeToolBefore(
				{
					tool: "flow_guidance",
					sessionID: "root",
					callID: `guidance-${index}`,
				},
				{ args: { id: `guidance-${index}` } },
			);
		}
		for (let index = 1; index <= 3; index += 1) {
			registry.observeEvent({
				type: "session.created",
				properties: { info: { id: `child-${index}`, parentID: "root" } },
			});
		}

		const report = registry.snapshot("root");
		expect(report?.children.count).toBe(2);
		expect(report?.models.uniqueRequestedRoutes).toBe(2);
		expect(report?.reads.unique).toBe(2);
		expect(report?.tools.resultBytes).toBeLessThanOrEqual(3 * 16_384);
		expect(report?.overflow).toMatchObject({
			childSessions: 1,
			workerRoles: 1,
			requestedRoutes: 1,
			messages: 1,
			readSignatures: 1,
			guidanceSignatures: 1,
		});
		expect(report?.overflow.counterSaturations).toBeGreaterThan(0);
		expect(report?.overflow.calls).toBeGreaterThan(0);
		expect(report?.overflow.resultSignatures).toBe(1);
		expect(report?.overflow.signatureInputs).toBeGreaterThan(0);
	});
});
