import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	pseudonymizeEvalIds,
	RetainedScenarioEvidenceSchema,
	ScenarioGradeInputSchema,
	scenarioGradeInput,
} from "../evals/grader-input.js";
import { EvalHost } from "../evals/harness.js";
import { collectHostTrace } from "../evals/host-trace.js";

const fixture = () => ({
	runnerRootSessionIds: ["ses_root"],
	directory: "/workspace",
	childrenComplete: true,
	sessionMetadata: [{ id: "ses_root", directory: "/workspace" }],
	sessionMessages: [
		{
			sessionId: "ses_root",
			messages: [
				{
					info: {
						id: "msg_user",
						sessionID: "ses_root",
						role: "user",
						time: { created: 1 },
					},
					parts: [
						{
							id: "prt_ordinary",
							messageID: "msg_user",
							sessionID: "ses_root",
							type: "text",
							text: "Implement the approved task.",
						},
						{
							id: "prt_flow",
							messageID: "msg_user",
							sessionID: "ses_root",
							type: "text",
							text: "Flow continuation",
							synthetic: true,
							metadata: { "opencode-plugin-flow/auto": "fixture-token" },
						},
					],
				},
				{
					info: {
						id: "msg_assistant",
						sessionID: "ses_root",
						role: "assistant",
						parentID: "msg_user",
						agent: "build",
						time: { created: 2 },
					},
					parts: [
						{
							id: "prt_tool",
							messageID: "msg_assistant",
							sessionID: "ses_root",
							callID: "call_one",
							type: "tool",
							tool: "flow_status",
							state: { status: "completed", time: { start: 2, end: 3 } },
						},
					],
				},
			],
		},
	],
});

test("retained native call references bind to their observed tool parts", () => {
	const trace = collectHostTrace(fixture());
	if (trace.kind !== "observed") throw new Error("Expected native facts");
	const call = {
		native: {
			sessionId: "ses_root",
			messageId: "msg_assistant",
			partId: "prt_tool",
			partIndex: 0,
			callId: "call_one",
			startedAt: 2,
			completedAt: 3,
		},
		tool: "flow_status",
		status: "completed",
		sessionIndex: 0,
		agent: "build",
		input: {},
		output: {},
		rawOutput: "",
		metadata: {},
	};
	const gradeInput = {
		schemaVersion: 1,
		hostTrace: trace,
		flowCalls: [call],
		allCalls: [call],
		session: null,
		archives: [],
		finalText: "",
	};
	expect(ScenarioGradeInputSchema.safeParse(gradeInput).success).toBe(true);
	expect(
		ScenarioGradeInputSchema.safeParse(pseudonymizeEvalIds(gradeInput)).success,
	).toBe(true);
	for (const field of ["allCalls", "flowCalls"] as const) {
		for (const [label, mutate] of [
			[
				"unknown part",
				(value: Record<string, unknown>) => {
					record(value.native).partId = "prt_unknown";
				},
			],
			[
				"wrong message",
				(value: Record<string, unknown>) => {
					record(value.native).messageId = "msg_unknown";
				},
			],
			[
				"wrong session",
				(value: Record<string, unknown>) => {
					record(value.native).sessionId = "ses_unknown";
				},
			],
			[
				"wrong tool",
				(value: Record<string, unknown>) => {
					value.tool = "flow_plan_save";
				},
			],
			[
				"wrong status",
				(value: Record<string, unknown>) => {
					value.status = "error";
				},
			],
			[
				"wrong agent",
				(value: Record<string, unknown>) => {
					value.agent = "flow-reviewer";
				},
			],
			[
				"wrong timing",
				(value: Record<string, unknown>) => {
					record(value.native).completedAt = 9;
				},
			],
		] as const) {
			const changed = structuredClone(gradeInput);
			mutate(record(changed[field][0]));
			expect(
				ScenarioGradeInputSchema.safeParse(changed).success,
				`${field}: ${label}`,
			).toBe(false);
		}
	}
	const duplicate = structuredClone(gradeInput);
	duplicate.allCalls.push(structuredClone(call));
	expect(ScenarioGradeInputSchema.safeParse(duplicate).success).toBe(false);
	const oldInput = { ...gradeInput, hostTrace: undefined };
	expect(ScenarioGradeInputSchema.safeParse(oldInput).success).toBe(true);
});

test("collects mixed initial user parts without retaining text or raw token", () => {
	const trace = collectHostTrace(fixture());
	expect(trace.kind).toBe("observed");
	if (trace.kind !== "observed") throw new Error("Expected native facts");
	expect(trace.sessions).toEqual([
		{ id: "ses_root", parentId: null, agent: null, projectMatched: true },
	]);
	expect(trace.messages.map((message) => [message.role, message.id])).toEqual([
		["user", "msg_user"],
		["assistant", "msg_assistant"],
	]);
	const first = trace.messages[0];
	if (first?.role !== "user") throw new Error("Expected user message");
	expect(
		first.parts.map((part) => [part.id, part.synthetic, part.flowTokenSha256]),
	).toEqual([
		["prt_ordinary", null, null],
		[
			"prt_flow",
			true,
			"sha256:d07f963c2bb7a3cc74a910e51ca0075b194da412a93737881f105a55156a988f",
		],
	]);
	expect(JSON.stringify(trace)).not.toContain("fixture-token");
	expect(JSON.stringify(trace)).not.toContain("Implement the approved task.");
});

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Missing fixture item");
	return value;
}
function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("Expected object");
	return value as Record<string, unknown>;
}
test.each([
	{
		reason: "endpoint-failure",
		mutate: (input: ReturnType<typeof fixture>) => {
			input.childrenComplete = false;
		},
	},
	{
		reason: "unknown-root",
		mutate: (input: ReturnType<typeof fixture>) => {
			input.runnerRootSessionIds = ["unknown-root"];
		},
	},
	{
		reason: "duplicate-native-id",
		mutate: (input: ReturnType<typeof fixture>) => {
			input.sessionMetadata.push(required(input.sessionMetadata[0]));
		},
	},
	{
		reason: "root-is-child",
		mutate: (input: ReturnType<typeof fixture>) => {
			record(required(input.sessionMetadata[0])).parentID = "other-session";
		},
	},
	{
		reason: "directory-mismatch",
		mutate: (input: ReturnType<typeof fixture>) => {
			required(input.sessionMetadata[0]).directory = "/another-project";
		},
	},
	{
		reason: "unknown-assistant-parent",
		mutate: (input: ReturnType<typeof fixture>) => {
			record(
				required(required(input.sessionMessages[0]).messages[1]).info,
			).parentID = "unknown-user";
		},
	},
	{
		reason: "duplicate-native-id",
		mutate: (input: ReturnType<typeof fixture>) => {
			required(input.sessionMessages[0]).messages.push(
				required(required(input.sessionMessages[0]).messages[0]),
			);
		},
	},
	{
		reason: "malformed-native-part",
		mutate: (input: ReturnType<typeof fixture>) => {
			delete record(
				required(
					required(required(input.sessionMessages[0]).messages[0]).parts[0],
				),
			).text;
		},
	},
	{
		reason: "part-binding-mismatch",
		mutate: (input: ReturnType<typeof fixture>) => {
			required(
				required(required(input.sessionMessages[0]).messages[0]).parts[0],
			).messageID = "wrong-message";
		},
	},
])(
	"unavailable native facts retain literal reason $reason",
	({ reason, mutate }) => {
		const input = fixture();
		mutate(input);
		expect(collectHostTrace(input)).toEqual({
			version: 1,
			kind: "unavailable",
			reason,
		});
	},
);

test("child task user prompts remain outside runner roots", () => {
	const input = fixture();
	const childMetadata = {
		id: "ses_child",
		parentID: "ses_root",
		agent: "general",
		directory: "/workspace",
	};
	const childMessages = [
		{
			info: {
				id: "msg_child",
				sessionID: "ses_child",
				role: "user",
				time: { created: 3 },
			},
			parts: [
				{
					id: "prt_child",
					messageID: "msg_child",
					sessionID: "ses_child",
					type: "text",
					text: "A child task prompt",
				},
			],
		},
	];
	const trace = collectHostTrace({
		...input,
		sessionMetadata: [...input.sessionMetadata, childMetadata],
		sessionMessages: [
			...input.sessionMessages,
			{ sessionId: "ses_child", messages: childMessages },
		],
	});
	expect(trace.kind).toBe("observed");
	if (trace.kind !== "observed") throw new Error("Expected native facts");
	expect(trace.runnerRootSessionIds).toEqual(["ses_root"]);
	expect(
		trace.messages
			.filter(
				(message) =>
					message.role === "user" &&
					trace.runnerRootSessionIds.includes(message.sessionId),
			)
			.map((message) => message.id),
	).toEqual(["msg_user"]);
	expect(
		trace.messages
			.filter((message) => message.role === "user")
			.map((message) => message.id),
	).toEqual(["msg_user", "msg_child"]);
});

test("second real root input remains visible despite a supplied count", () => {
	const input = fixture();
	const second = {
		info: {
			id: "msg_second",
			sessionID: "ses_root",
			role: "user",
			time: { created: 3 },
		},
		parts: [
			{
				id: "prt_second",
				messageID: "msg_second",
				sessionID: "ses_root",
				type: "text",
				text: "Continue again",
			},
		],
	};
	const withCount = {
		...input,
		originalRequestCount: 1,
		sessionMessages: [
			{
				sessionId: "ses_root",
				messages: [...required(input.sessionMessages[0]).messages, second],
			},
		],
	};
	const trace = collectHostTrace(withCount);
	expect(trace.kind).toBe("observed");
	if (trace.kind !== "observed") throw new Error("Expected native facts");
	expect(
		trace.messages
			.filter((message) => message.role === "user")
			.map((message) => message.id),
	).toEqual(["msg_user", "msg_second"]);
	expect(trace).not.toHaveProperty("originalRequestCount");
});

test("missing initial marker is absence, not inferred authority", () => {
	const input = fixture();
	required(required(input.sessionMessages[0]).messages[0]).parts.splice(1, 1);
	const trace = collectHostTrace(input);
	expect(trace.kind).toBe("observed");
	if (trace.kind !== "observed" || trace.messages[0]?.role !== "user")
		throw new Error("Expected native user facts");
	expect(trace.messages[0].parts.map((part) => part.flowTokenSha256)).toEqual([
		null,
	]);
});

test("unknown child ancestry and a child session cycle are unavailable", () => {
	for (const [parentID, reason] of [
		["unknown", "unknown-session-parent"],
		["ses_child", "session-cycle"],
	] as const) {
		const input = fixture();
		const child = { id: "ses_child", directory: "/workspace", parentID };
		expect(
			collectHostTrace({
				...input,
				sessionMetadata: [...input.sessionMetadata, child],
			}),
		).toEqual({ version: 1, kind: "unavailable", reason });
	}
});

test("a changed token is retained as distinct native facts without claiming authority", () => {
	const input = fixture();
	const next = {
		info: {
			id: "msg_next",
			sessionID: "ses_root",
			role: "user",
			time: { created: 3 },
		},
		parts: [
			{
				id: "prt_next",
				messageID: "msg_next",
				sessionID: "ses_root",
				type: "text",
				text: "Continue",
				synthetic: true,
				metadata: { "opencode-plugin-flow/auto": "different-token" },
			},
		],
	};
	const trace = collectHostTrace({
		...input,
		sessionMessages: [
			{
				sessionId: "ses_root",
				messages: [...required(input.sessionMessages[0]).messages, next],
			},
		],
	});
	if (trace.kind !== "observed") throw new Error("Expected native facts");
	const initial = trace.messages[0],
		later = trace.messages[2];
	if (initial?.role !== "user" || later?.role !== "user")
		throw new Error("Expected native user facts");
	expect(later.parts[0]?.flowTokenSha256).toBe(
		"sha256:fdfdca21b14f5f4a371cfb5e069ddeb94e8d23c6739bc9a26adb0c4c6226dfc3",
	);
	expect(later.parts[0]?.flowTokenSha256).not.toBe(
		initial.parts[1]?.flowTokenSha256,
	);
});

test("compaction facts cannot attest native event delivery from final messages", () => {
	const input = fixture();
	const compaction = {
		info: {
			id: "msg_compaction",
			sessionID: "ses_root",
			role: "user",
			time: { created: 3 },
		},
		parts: [
			{
				id: "prt_compaction",
				messageID: "msg_compaction",
				sessionID: "ses_root",
				type: "compaction",
				auto: true,
			},
		],
	};
	const trace = collectHostTrace({
		...input,
		sessionMessages: [
			{
				sessionId: "ses_root",
				messages: [...required(input.sessionMessages[0]).messages, compaction],
			},
		],
	});
	if (trace.kind !== "observed") throw new Error("Expected native facts");
	expect(trace.compactionDelivery).toBe("unavailable-from-message-export");
	const message = trace.messages[2];
	if (message?.role !== "user") throw new Error("Expected compaction user");
	expect(message.parts[0]?.automaticCompaction).toBe(true);
});

test.each([false, true])(
	"EvalHost reads actual primary metadata and retains trace through grade input: GET fails $0",
	async (metadataFails) => {
		const scratch = await mkdtemp(join(tmpdir(), "flow-trace-wire-"));
		const input = fixture();
		const requests: string[] = [];
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request) {
				const path = new URL(request.url).pathname;
				requests.push(path);
				if (path === "/session/ses_root/children") return Response.json([]);
				if (path === "/session/ses_root")
					return metadataFails
						? new Response("Unavailable", { status: 503 })
						: Response.json({ id: "ses_root", directory: scratch });
				if (path === "/session/ses_root/message")
					return Response.json(required(input.sessionMessages[0]).messages);
				return new Response("Unknown", { status: 404 });
			},
		});
		try {
			const host = Reflect.construct(EvalHost, [scratch, scratch]) as EvalHost;
			Object.assign(host, { baseUrl: `http://127.0.0.1:${server.port}` });
			const outcome = await host.outcome(["ses_root"], 10);
			expect(requests).toEqual([
				"/session/ses_root/children",
				"/session/ses_root",
				"/session/ses_root/message",
			]);
			expect(outcome.hostTrace?.kind).toBe(
				metadataFails ? "unavailable" : "observed",
			);
			const gradeInput = scenarioGradeInput(outcome);
			expect(gradeInput.hostTrace).toEqual(outcome.hostTrace);
			expect(gradeInput.allCalls[0]?.native).toEqual({
				sessionId: "ses_root",
				messageId: "msg_assistant",
				partId: "prt_tool",
				partIndex: 0,
				callId: "call_one",
				startedAt: 2,
				completedAt: 3,
			});
			const evidence = RetainedScenarioEvidenceSchema.parse({
				schemaVersion: 1,
				attempt: {
					attemptId: "attempt",
					cellId: "cell",
					caseId: "case",
					repetition: 0,
					model: {
						routeProvider: "fixture",
						gateway: null,
						family: "fixture",
						model: "scripted",
						revision: null,
					},
				},
				actors: [],
				guidanceLoads: [],
				gradeInput,
				usage: { durationMs: 10, outputTokens: 0, costUsd: null },
			});
			const retained = RetainedScenarioEvidenceSchema.parse(
				JSON.parse(JSON.stringify(evidence)),
			);
			expect(retained.gradeInput.hostTrace).toEqual(outcome.hostTrace);
			const privateEvidence = RetainedScenarioEvidenceSchema.parse(
				pseudonymizeEvalIds(evidence),
			);
			if (privateEvidence.gradeInput.hostTrace?.kind === "observed") {
				expect(privateEvidence.gradeInput.hostTrace.sessions[0]?.id).toBe(
					privateEvidence.gradeInput.hostTrace.runnerRootSessionIds[0],
				);
				expect(privateEvidence.gradeInput.allCalls[0]?.native?.sessionId).toBe(
					privateEvidence.gradeInput.hostTrace.runnerRootSessionIds[0],
				);
			}
			const oldInput = { ...gradeInput };
			delete oldInput.hostTrace;
			expect(ScenarioGradeInputSchema.parse(oldInput)).not.toHaveProperty(
				"hostTrace",
			);
		} finally {
			server.stop(true);
			await rm(scratch, { recursive: true, force: true });
		}
	},
);

test("retained schema rejects resealed unknown-parent and cyclic child facts", () => {
	const trace = collectHostTrace(fixture());
	if (trace.kind !== "observed") throw new Error("Expected native facts");
	for (const parentId of ["unknown-parent", "ses_child"]) {
		const mutated = {
			...trace,
			sessions: [
				...trace.sessions,
				{ id: "ses_child", parentId, agent: "general", projectMatched: true },
			],
		};
		const gradeInput = {
			schemaVersion: 1,
			hostTrace: mutated,
			flowCalls: [],
			allCalls: [],
			session: null,
			archives: [],
			finalText: "",
		};
		expect(ScenarioGradeInputSchema.safeParse(gradeInput).success).toBe(false);
		const evidence = {
			schemaVersion: 1,
			attempt: {
				attemptId: "attempt",
				cellId: "cell",
				caseId: "case",
				repetition: 0,
				model: {
					routeProvider: "fixture",
					gateway: null,
					family: "fixture",
					model: "scripted",
					revision: null,
				},
			},
			actors: [],
			guidanceLoads: [],
			gradeInput,
			usage: { durationMs: 10, outputTokens: 0, costUsd: null },
		};
		expect(
			RetainedScenarioEvidenceSchema.safeParse(
				JSON.parse(JSON.stringify(evidence)),
			).success,
		).toBe(false);
	}
});

test("retained schema rejects impossible user part fields and missing first-part order", () => {
	const trace = collectHostTrace(fixture());
	if (trace.kind !== "observed") throw new Error("Expected native facts");
	const initial = trace.messages[0];
	if (initial?.role !== "user") throw new Error("Expected native user");
	const first = required(initial.parts[0]);
	for (const changed of [
		{ ...first, partIndex: 3 },
		{
			...first,
			type: "file",
			flowTokenSha256: `sha256:${"a".repeat(64)}`,
			compactionContinue: true,
			automaticCompaction: true,
		},
		{ ...first, textBytes: null },
		{ ...first, automaticCompaction: false },
	]) {
		const mutated = {
			...trace,
			messages: [
				{ ...initial, parts: [changed, ...initial.parts.slice(1)] },
				...trace.messages.slice(1),
			],
		};
		const gradeInput = {
			schemaVersion: 1,
			hostTrace: mutated,
			flowCalls: [],
			allCalls: [],
			session: null,
			archives: [],
			finalText: "",
		};
		expect(ScenarioGradeInputSchema.safeParse(gradeInput).success).toBe(false);
		const evidence = {
			schemaVersion: 1,
			attempt: {
				attemptId: "attempt",
				cellId: "cell",
				caseId: "case",
				repetition: 0,
				model: {
					routeProvider: "fixture",
					gateway: null,
					family: "fixture",
					model: "scripted",
					revision: null,
				},
			},
			actors: [],
			guidanceLoads: [],
			gradeInput,
			usage: { durationMs: 10, outputTokens: 0, costUsd: null },
		};
		expect(
			RetainedScenarioEvidenceSchema.safeParse(
				JSON.parse(JSON.stringify(evidence)),
			).success,
		).toBe(false);
	}
	const input = fixture();
	const part = required(
		required(required(input.sessionMessages[0]).messages[0]).parts[1],
	);
	part.type = "file";
	expect(collectHostTrace(input)).toEqual({
		version: 1,
		kind: "unavailable",
		reason: "malformed-native-part",
	});
});
