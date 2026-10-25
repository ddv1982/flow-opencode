import { expect, test } from "bun:test";
import {
	OpenCode,
	type SessionMessageAssistant,
	type SessionMessageInfo,
} from "@opencode/client";
import {
	extractObservedActor,
	extractObservedModelIdentity,
	extractObservedVariant,
	selectLineageValidatedReviewers,
} from "../evals/host-observation.js";
import {
	listNativeMessages,
	listNativeSessions,
	nativeModel,
	OpenCodeStartup,
	openCodeInvocation,
	projectEvalMessage,
} from "../evals/opencode-host.js";

function assistant(
	overrides: Partial<SessionMessageAssistant> = {},
): SessionMessageAssistant {
	return {
		id: "msg_one",
		type: "assistant",
		agent: "build",
		model: { providerID: "fixture", id: "catalog-alias", variant: "high" },
		time: { created: 1, completed: 2 },
		content: [],
		...overrides,
	};
}

test("native selection uses the catalog identity and exact host invocation", () => {
	expect(nativeModel("fixture/vendor/model", "high")).toEqual({
		providerID: "fixture",
		id: "vendor/model",
		variant: "high",
	});
	expect(
		openCodeInvocation(["serve", "--hostname", "127.0.0.1", "--port", "43210"]),
	).toEqual({
		command: "npm",
		args: [
			"exec",
			"--yes",
			"--package=@opencode/cli@2.1.4",
			"--",
			"opencode",
			"serve",
			"--hostname",
			"127.0.0.1",
			"--port",
			"43210",
		],
	});
	for (const version of [
		"1.18.31",
		"2.0.9",
		"2.1.3",
		"latest",
		"^2.1.4",
		"3.0.0",
		"2.1.4 --help",
	])
		expect(() => openCodeInvocation([], version)).toThrow(
			"exact tested 2.x version",
		);
	expect(openCodeInvocation([], "2.2.0").args[2]).toBe(
		"--package=@opencode/cli@2.2.0",
	);
});

test("startup authenticates through the public client without exposing split password lines", async () => {
	const startup = new OpenCodeStartup();
	const requests: {
		path: string;
		authorized: boolean;
		directory: string | null;
	}[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			requests.push({
				path: new URL(request.url).pathname,
				authorized:
					request.headers.get("authorization") ===
					`Basic ${Buffer.from("opencode:fixture-private").toString("base64")}`,
				directory: request.headers.get("x-opencode-directory"),
			});
			return Response.json({
				version: "2.1.4",
				pid: 123,
				urls: [],
				paths: { tmp: "/fixture/tmp" },
			});
		},
	});
	try {
		startup.consume("starting\nserver pass");
		expect(startup.client(server.url.href, "/fixture")).toBeNull();
		startup.consume("separate diagnostic\n", "stderr");
		startup.consume("word fixture-");
		startup.consume("private\nready\n");
		const client = startup.client(server.url.href, "/fixture");
		if (!client) throw new Error("Missing authenticated client");
		expect(await client.server.info()).toEqual({
			version: "2.1.4",
			pid: 123,
			urls: [],
			paths: { tmp: "/fixture/tmp" },
		});
		expect(startup.log).toBe("starting\nseparate diagnostic\nready\n");
		expect(requests).toEqual([
			{ path: "/api/info", authorized: true, directory: "/fixture" },
		]);
		startup.clear();
		expect(startup.client(server.url.href, "/fixture")).toBeNull();
	} finally {
		await server.stop(true);
	}
});

test("native observation requires completed assistant identities and rejects mixed aliases", () => {
	expect(extractObservedModelIdentity([assistant()])).toEqual({
		kind: "observed",
		value: { providerID: "fixture", modelID: "catalog-alias" },
	});
	expect(extractObservedVariant([assistant()])).toEqual({
		kind: "observed",
		value: "high",
	});
	expect(
		extractObservedModelIdentity([assistant({ time: { created: 1 } })]),
	).toEqual({ kind: "unobserved", reason: "no-completed-assistant" });
	expect(
		extractObservedModelIdentity([
			assistant(),
			assistant({ model: { providerID: "fixture", id: "wire-model" } }),
		]),
	).toEqual({ kind: "unobserved", reason: "conflicting-observations" });
	expect(
		extractObservedModelIdentity([
			assistant({ error: { type: "api", message: "provider refused" } }),
		]),
	).toEqual({ kind: "unobserved", reason: "no-completed-assistant" });
	expect(
		extractObservedModelIdentity([assistant(), { ...assistant(), model: {} }]),
	).toEqual({ kind: "unobserved", reason: "field-unavailable" });
	expect(extractObservedActor({ role: "reviewer", sessions: [] })).toEqual({
		role: "reviewer",
		sessionIds: [],
		actualModel: { kind: "unobserved", reason: "reviewer-child-not-observed" },
	});
	expect(
		selectLineageValidatedReviewers(
			["root"],
			[
				{ id: "child", parentID: "root", agent: "flow-reviewer" },
				{ id: "stranger", parentID: "other", agent: "flow-reviewer" },
			],
		),
	).toEqual([{ id: "child", parentID: "root", agent: "flow-reviewer" }]);
});

test("native tool content projects into existing grader inputs without invented native parent or part IDs", () => {
	const native = assistant({
		content: [
			{
				type: "tool",
				id: "call_one",
				name: "flow_status",
				time: { created: 2, completed: 3 },
				state: {
					status: "completed",
					input: { view: "compact" },
					content: [{ type: "text", text: '{"status":"ok"}' }],
					metadata: { exit: 0 },
				},
			},
		],
	});
	const projected = projectEvalMessage(native, "root");
	expect(projected.native).toEqual(native);
	expect(projected.info.parentID).toBeUndefined();
	expect(projected.parts).toEqual([
		{
			type: "tool",
			tool: "flow_status",
			callID: "call_one",
			sessionID: "root",
			messageID: "msg_one",
			time: { start: 2, end: 3 },
			state: {
				status: "completed",
				input: { view: "compact" },
				output: '{"status":"ok"}',
				metadata: { exit: 0 },
			},
		},
	]);
});

test("native streaming arguments, tool errors and compaction retain their distinct facts", () => {
	const projected = projectEvalMessage(
		assistant({
			content: [
				{
					type: "tool",
					id: "stream",
					name: "shell",
					time: { created: 2 },
					state: { status: "streaming", input: '{"command":' },
				},
				{
					type: "tool",
					id: "failed",
					name: "shell",
					time: { created: 3, completed: 4 },
					state: {
						status: "error",
						input: { command: "x" },
						error: { type: "execution", message: "cwd missing" },
					},
				},
			],
		}),
		"root",
	);
	expect(projected.parts.map((part) => part.state)).toEqual([
		{ status: "pending", input: {}, raw: '{"command":' },
		{
			status: "error",
			input: { command: "x" },
			output: "",
			error: "cwd missing",
		},
	]);
	const compact = projectEvalMessage(
		{
			id: "compact",
			type: "compaction",
			reason: "auto",
			status: "completed",
			time: { created: 4 },
			summary: "saved",
			tokens: {
				input: 1,
				output: 2,
				reasoning: 3,
				cache: { read: 4, write: 5 },
			},
			cost: 0.01,
		},
		"root",
	);
	expect(compact.info.tokens).toEqual({
		input: 1,
		output: 2,
		reasoning: 3,
		cache: { read: 4, write: 5 },
	});
	expect(compact.parts).toEqual([
		{
			type: "compaction",
			auto: true,
			text: "saved",
			sessionID: "root",
			messageID: "compact",
		},
	]);
});

test("public list calls drain native cursors and retain session parentage and location", async () => {
	const messages: SessionMessageInfo[] = [
		{ id: "user", type: "user", text: "hello", time: { created: 0 } },
		assistant(),
	];
	const seen: string[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			seen.push(url.pathname);
			const index = url.searchParams.has("cursor") ? 1 : 0;
			return Response.json({
				data: url.pathname.endsWith("/message")
					? [messages[index]]
					: [
							{
								id: index ? "child" : "root",
								...(index ? { parentID: "root" } : {}),
								agent: index ? "flow-reviewer" : "build",
								location: { directory: "/fixture" },
							},
						],
				cursor: index ? {} : { next: "second" },
			});
		},
	});
	try {
		const client = OpenCode.make({ baseUrl: server.url.href });
		expect(await listNativeMessages(client, "root")).toEqual(messages);
		expect(
			(await listNativeSessions(client, "/fixture")).map(
				({ id, parentID, location }) => ({
					id,
					parentID: parentID ?? null,
					location,
				}),
			),
		).toEqual([
			{ id: "root", parentID: null, location: { directory: "/fixture" } },
			{ id: "child", parentID: "root", location: { directory: "/fixture" } },
		]);
		expect(seen).toEqual([
			"/api/session/root/message",
			"/api/session/root/message",
			"/api/session",
			"/api/session",
		]);
	} finally {
		await server.stop(true);
	}
});
