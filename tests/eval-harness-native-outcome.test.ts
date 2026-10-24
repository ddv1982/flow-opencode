import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCode, type SessionMessageInfo } from "@opencode/client";
import {
	EvalHost,
	isSelfAbortError,
	runSessionRequest,
} from "../evals/harness.js";

const usage = {
	input: 7,
	output: 3,
	reasoning: 2,
	cache: { read: 1, write: 4 },
};

test("native outcome retains grader inputs, compaction usage, and provider failure evidence", async () => {
	const project = await mkdtemp(join(tmpdir(), "flow-v2-outcome-"));
	const messages: SessionMessageInfo[] = [
		{ id: "user", type: "user", text: "work", time: { created: 1 } },
		{
			id: "assistant",
			type: "assistant",
			agent: "build",
			model: { providerID: "fixture", id: "catalog-id" },
			time: { created: 2, completed: 3 },
			tokens: usage,
			cost: 0.01,
			content: [
				{ type: "text", text: "Done" },
				{
					type: "tool",
					id: "call",
					name: "flow_status",
					time: { created: 2, completed: 3 },
					state: {
						status: "completed",
						input: { request: { view: "compact" } },
						content: [
							{
								type: "text",
								text: '{"status":"ok","summary":"Ready","workflowData":{}}',
							},
						],
						metadata: { native: "retained" },
					},
				},
			],
		},
		{
			id: "compaction",
			type: "compaction",
			status: "completed",
			reason: "auto",
			summary: "Saved",
			time: { created: 4 },
			tokens: usage,
			cost: 0.02,
		},
		{
			id: "failed",
			type: "assistant",
			agent: "build",
			model: { providerID: "fixture", id: "catalog-id" },
			time: { created: 5, completed: 6 },
			content: [],
			error: { type: "api", message: "Local provider refused" },
		},
	];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			if (url.pathname === "/api/session")
				return Response.json({ data: [], cursor: {} });
			if (url.pathname.endsWith("/message"))
				return Response.json({ data: messages, cursor: {} });
			return Response.json({
				id: "root",
				agent: "build",
				location: { directory: project },
			});
		},
	});
	try {
		const host: unknown = Reflect.construct(EvalHost, [project, project]);
		if (!(host instanceof EvalHost))
			throw new Error("Could not construct isolated outcome reader");
		Reflect.set(
			host,
			"nativeClient",
			OpenCode.make({ baseUrl: server.url.href }),
		);
		const outcome = await host.outcome(["root"], 12);
		expect(outcome.flowCalls).toEqual([
			{
				tool: "flow_status",
				status: "completed",
				sessionIndex: 0,
				agent: "build",
				input: { request: { view: "compact" } },
				output: { status: "ok", summary: "Ready", workflowData: {} },
				rawOutput: '{"status":"ok","summary":"Ready","workflowData":{}}',
				metadata: { native: "retained" },
			},
		]);
		expect(outcome.tokens).toEqual({
			input: 14,
			output: 6,
			reasoning: 4,
			cacheRead: 2,
			cacheWrite: 8,
		});
		expect(outcome.costUsd).toBeNull();
		expect(outcome.usageAvailability).toBe("incomplete");
		expect(outcome.providerError).toEqual({
			origin: "provider",
			code: "provider-rejected-turn",
			detail: '{"type":"api","message":"Local provider refused"}',
			retryable: true,
		});
		expect(outcome.providerErrorObservation).toEqual({
			sessionId: "root",
			name: "api",
			message: "Local provider refused",
		});
		expect(outcome.finalText).toBe("Done");
		expect(outcome.actors?.[0]?.actualModel).toEqual({
			kind: "observed",
			value: { providerID: "fixture", modelID: "catalog-id" },
		});
	} finally {
		await server.stop(true);
		await rm(project, { recursive: true, force: true });
	}
});

test("native self interruption does not swallow an unrelated provider error", () => {
	expect(
		isSelfAbortError({ type: "aborted", message: "Step interrupted" }, true),
	).toBe(true);
	expect(
		isSelfAbortError({ type: "aborted", message: "Step interrupted" }, false),
	).toBe(false);
	expect(
		isSelfAbortError({ type: "api", message: "provider failure" }, true),
	).toBe(false);
});

test("cancelled session admission settles and preserves the original cancellation", async () => {
	const controller = new AbortController();
	const reason = new Error("Stop the native wait");
	let cancelled = 0;
	let rejected = 0;
	let admitted = false;
	const pending = runSessionRequest({
		signal: controller.signal,
		post: async (_url, _body, options) =>
			new Promise((resolve, reject) => {
				admitted = true;
				options.signal.addEventListener(
					"abort",
					() => reject(options.signal.reason),
					{ once: true },
				);
				void resolve;
			}),
		url: "local",
		body: null,
		onRejected: () => {
			rejected += 1;
		},
		wait: async () => new Promise(() => {}),
		onCancelled: async () => {
			cancelled += 1;
		},
	});
	expect(admitted).toBe(true);
	controller.abort(reason);
	await expect(pending).rejects.toBe(reason);
	expect(cancelled).toBe(1);
	expect(rejected).toBe(0);
});
