import { expect, test } from "bun:test";
import type {
	SessionMessageAssistant,
	SessionMessageAssistantTool,
} from "@opencode/client";
import {
	deriveRetainedFailure,
	pseudonymizeEvalIds,
	RetainedScenarioEvidenceSchema,
	retainedFailureObservation,
	ScenarioGradeInputSchema,
} from "../evals/grader-input.js";
import type { ObservedToolCall } from "../evals/harness.js";
import {
	collectHostTrace,
	HostAbortObservationSchema,
	type HostTrace,
	type HostTraceCollection,
	HostTraceSchema,
	NativeToolProvenanceSchema,
	nativeToolKey,
	nativeToolProvenance,
} from "../evals/host-trace.js";
import { nativeActorBindingIssues } from "../evals/native-actors.js";
import { projectEvalMessage } from "../evals/opencode-host.js";
import {
	checkAutonomousLineage,
	checkReviewerEvidenceAccess,
	nativeToolWitness,
} from "../evals/reviewer-access.js";
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";

function session(id = "ses_root", parentID?: string) {
	return {
		id,
		...(parentID ? { parentID } : {}),
		location: { directory: "/workspace" },
		projectID: "fixture",
		agent: parentID ? "flow-reviewer" : "build",
		cost: 0,
		tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
		time: { created: 1, updated: 20 },
	};
}
function tool(
	id = "call_repeat",
	status: "completed" | "running" = "completed",
	created = 3,
): SessionMessageAssistantTool {
	return {
		type: "tool",
		id,
		name: "flow_status",
		time: {
			created,
			...(status === "completed" ? { completed: created + 1 } : {}),
		},
		state:
			status === "running"
				? { status, input: {}, metadata: {} }
				: { status, input: {}, content: [{ type: "text", text: "{}" }] },
	};
}
function assistant(id = "msg_assistant", created = 2): SessionMessageAssistant {
	return {
		id,
		type: "assistant",
		agent: "build",
		model: { id: "fixture", providerID: "fake" },
		time: { created },
		content: [
			{ type: "text", text: "tool preface" },
			tool("call_repeat", "completed", created + 1),
		],
	};
}
function fixture(): HostTraceCollection {
	return {
		runnerRootSessionIds: ["ses_root"],
		directory: "/workspace",
		childrenComplete: true,
		sessionMetadata: [session(), session("ses_child", "ses_root")],
		sessionMessages: [
			{
				sessionId: "ses_root",
				messages: [
					{
						id: "msg_user",
						type: "user",
						text: "Implement task",
						time: { created: 1 },
						metadata: { "opencode-plugin-flow/auto": "fixture-token" },
					},
					assistant(),
					{
						id: "msg_synthetic",
						type: "synthetic",
						text: "Continue",
						time: { created: 5 },
						metadata: { "opencode-plugin-flow/auto": "fixture-token" },
					},
					assistant("msg_second", 6),
					{
						id: "msg_idle",
						type: "idle",
						outcome: "succeeded",
						time: { created: 9 },
					},
				],
			},
			{
				sessionId: "ses_child",
				messages: [
					{
						id: "msg_child_user",
						type: "user",
						text: "Review",
						time: { created: 1 },
					},
					{ ...assistant("msg_child", 2), agent: "flow-reviewer" },
				],
			},
		],
	};
}
function object(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("Expected object");
	return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new Error("Expected array");
	return value;
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Missing fixture item");
	return value;
}
function rootMessages(input: HostTraceCollection): unknown[] {
	return array(input.sessionMessages[0]?.messages);
}
function observed(
	input = fixture(),
): Extract<HostTrace, { version: 2; kind: "observed" }> {
	const trace = collectHostTrace(input);
	if (trace.version !== 2 || trace.kind !== "observed")
		throw new Error(JSON.stringify(trace));
	return trace;
}
function callFor(messageId = "msg_assistant"): ObservedToolCall {
	const native = nativeToolProvenance(
		"ses_root",
		assistant(messageId, messageId === "msg_second" ? 6 : 2),
		1,
	);
	if (!native) throw new Error("Missing provenance");
	return {
		native,
		tool: "flow_status",
		status: "completed",
		sessionIndex: 0,
		agent: "build",
		input: {},
		output: {},
		rawOutput: "",
		metadata: {},
	};
}
function gradeInput(trace: HostTrace, calls = [callFor()]) {
	return {
		schemaVersion: 1 as const,
		hostTrace: trace,
		allCalls: calls,
		flowCalls: calls,
		session: null,
		archives: [],
		finalText: "",
	};
}

test("V2 preserves native message kinds, endpoint ownership and timestamps without fabricating IDs or parents", () => {
	const trace = observed();
	expect(trace.sessions).toEqual([
		{ id: "ses_root", parentId: null, agent: "build", projectMatched: true },
		{
			id: "ses_child",
			parentId: "ses_root",
			agent: "flow-reviewer",
			projectMatched: true,
		},
	]);
	expect(trace.messages.map((m) => [m.role, m.type, m.sessionId])).toEqual([
		["user", "user", "ses_root"],
		["assistant", "assistant", "ses_root"],
		["user", "synthetic", "ses_root"],
		["assistant", "assistant", "ses_root"],
		["event", "idle", "ses_root"],
		["user", "user", "ses_child"],
		["assistant", "assistant", "ses_child"],
	]);
	expect(trace.messages[1]).toEqual({
		id: "msg_assistant",
		sessionId: "ses_root",
		order: 1,
		created: 2,
		role: "assistant",
		type: "assistant",
		agent: "build",
		contentCount: 2,
		terminal: {
			finish: { kind: "absent" },
			error: { kind: "absent" },
			streamed: { kind: "absent" },
			completed: { kind: "absent" },
		},
		tools: [
			{
				version: 2,
				sessionId: "ses_root",
				messageId: "msg_assistant",
				partIndex: 1,
				callId: "call_repeat",
				startedAt: 3,
				completedAt: 4,
				tool: "flow_status",
				status: "completed",
			},
		],
	});
	expect(JSON.stringify(trace)).not.toContain("partId");
	expect(JSON.stringify(trace)).not.toContain("Implement task");
	expect(JSON.stringify(trace)).not.toContain("fixture-token");
	expect(checkAutonomousLineage({ hostTrace: trace })).toEqual([]);
	expect(HostTraceSchema.parse(pseudonymizeEvalIds(trace)).version).toBe(2);
});

test("raw and projected V2 extraction agree and never accept a mismatched projection", () => {
	const raw = assistant();
	const projection = projectEvalMessage(raw, "ses_root");
	const expected = {
		version: 2 as const,
		sessionId: "ses_root",
		messageId: "msg_assistant",
		partIndex: 1,
		callId: "call_repeat",
		startedAt: 3,
		completedAt: 4,
	};
	expect(nativeToolProvenance("ses_root", raw, 1)).toEqual(expected);
	expect(
		nativeToolProvenance(
			"ses_root",
			projection.info,
			projection.parts[1],
			1,
			raw,
		),
	).toEqual(expected);
	expect(nativeToolProvenance("ses_root", raw, 0)).toBeUndefined();
	expect(nativeToolProvenance("ses_root", raw, 256)).toBeUndefined();
	expect(
		nativeToolProvenance(
			"ses_root",
			projection.info,
			{ ...projection.parts[1], callID: "other" },
			1,
			raw,
		),
	).toBeUndefined();
	expect(
		nativeToolProvenance(
			"ses_root",
			{ ...projection.info, id: "msg_other" },
			projection.parts[1],
			1,
			raw,
		),
	).toBeUndefined();
	expect(
		nativeToolProvenance("ses_root", { ...raw, sessionID: "ses_other" }, 1),
	).toBeUndefined();
	expect(
		nativeToolProvenance("ses_root", projection.info, projection.parts[1], 1),
	).toBeUndefined();
});

const mutations: readonly [
	string,
	(input: HostTraceCollection) => void,
	Extract<HostTrace, { kind: "unavailable" }>["reason"],
][] = [
	[
		"wrong workspace",
		(input) => {
			object(object(input.sessionMetadata[0]).location).directory =
				"/elsewhere";
		},
		"directory-mismatch",
	],
	[
		"unknown parent",
		(input) => {
			object(input.sessionMetadata[1]).parentID = "ses_unknown";
		},
		"unknown-session-parent",
	],
	[
		"cycle",
		(input) => {
			object(input.sessionMetadata[1]).parentID = "ses_child";
		},
		"session-cycle",
	],
	[
		"root child",
		(input) => {
			object(input.sessionMetadata[0]).parentID = "ses_child";
		},
		"root-is-child",
	],
	[
		"duplicate session",
		(input) => {
			object(input.sessionMetadata[1]).id = "ses_root";
		},
		"duplicate-native-id",
	],
	[
		"duplicate message",
		(input) => {
			object(rootMessages(input)[3]).id = "msg_assistant";
		},
		"duplicate-native-id",
	],
	[
		"session/message collision",
		(input) => {
			object(rootMessages(input)[3]).id = "ses_root";
		},
		"malformed-native-message",
	],
	[
		"wrong explicit session",
		(input) => {
			object(rootMessages(input)[0]).sessionID = "ses_child";
		},
		"message-session-mismatch",
	],
	[
		"fabricated assistant parent",
		(input) => {
			object(rootMessages(input)[1]).parentID = "msg_user";
		},
		"malformed-native-message",
	],
	[
		"missing native text",
		(input) => {
			delete object(rootMessages(input)[0]).text;
		},
		"malformed-native-message",
	],
	[
		"unknown native type",
		(input) => {
			object(rootMessages(input)[0]).type = "invented";
		},
		"malformed-native-message",
	],
	[
		"wrong token type",
		(input) => {
			object(object(rootMessages(input)[0]).metadata)[
				"opencode-plugin-flow/auto"
			] = false;
		},
		"malformed-native-message",
	],
	[
		"message chronology",
		(input) => {
			object(object(rootMessages(input)[3]).time).created = 0;
		},
		"chronology-conflict",
	],
	[
		"tool chronology",
		(input) => {
			object(
				object(array(object(rootMessages(input)[1]).content)[1]).time,
			).completed = 1;
		},
		"chronology-conflict",
	],
	[
		"tool before message",
		(input) => {
			object(
				object(array(object(rootMessages(input)[1]).content)[1]).time,
			).created = 1;
		},
		"chronology-conflict",
	],
	[
		"missing tool state",
		(input) => {
			delete object(array(object(rootMessages(input)[1]).content)[1]).state;
		},
		"malformed-native-message",
	],
	[
		"content limit",
		(input) => {
			object(rootMessages(input)[1]).content = Array.from(
				{ length: 257 },
				() => ({ type: "text", text: "x" }),
			);
		},
		"limits-exceeded",
	],
];
for (const [name, mutate, reason] of mutations)
	test(`V2 collection fails closed for ${name}`, () => {
		const input = fixture();
		mutate(input);
		expect(collectHostTrace(input)).toEqual({
			version: 2,
			kind: "unavailable",
			reason,
		});
	});

test("V2 checks transcript coverage, duplicate bindings and endpoint failures", () => {
	const input = fixture();
	expect(
		collectHostTrace({
			...input,
			sessionMessages: input.sessionMessages.slice(0, 1),
		}),
	).toEqual({
		version: 2,
		kind: "unavailable",
		reason: "incomplete-transcript",
	});
	expect(
		collectHostTrace({
			...input,
			sessionMessages: [
				...input.sessionMessages,
				required(input.sessionMessages[0]),
			],
		}),
	).toEqual({ version: 2, kind: "unavailable", reason: "duplicate-native-id" });
	expect(
		collectHostTrace({
			...input,
			sessionMessages: [{ sessionId: "ses_unknown", messages: [] }],
		}),
	).toEqual({
		version: 2,
		kind: "unavailable",
		reason: "message-session-mismatch",
	});
	expect(collectHostTrace({ ...input, childrenComplete: false })).toEqual({
		version: 2,
		kind: "unavailable",
		reason: "endpoint-failure",
	});
	expect(
		collectHostTrace({
			...input,
			runnerRootSessionIds: ["ses_root", "ses_root"],
		}),
	).toEqual({ version: 2, kind: "unavailable", reason: "duplicate-native-id" });
});

test("V2 composite identity accepts repeating call IDs across messages and rejects all mismatched joins", () => {
	const trace = observed();
	const first = callFor(),
		second = callFor("msg_second");
	expect(first.native?.callId).toBe("call_repeat");
	expect(second.native?.callId).toBe("call_repeat");
	expect(nativeToolKey(required(first.native))).not.toBe(
		nativeToolKey(required(second.native)),
	);
	expect(
		ScenarioGradeInputSchema.parse(gradeInput(trace, [first, second])).allCalls
			.length,
	).toBe(2);
	expect(nativeToolWitness(first, trace)?.message.id).toBe("msg_assistant");
	for (const [field, value] of [
		["sessionId", "ses_child"],
		["messageId", "msg_second"],
		["partIndex", 0],
		["callId", "other"],
		["startedAt", 2],
		["completedAt", 5],
	] as const) {
		const mutated = structuredClone(first);
		object(mutated.native)[field] = value;
		expect(
			ScenarioGradeInputSchema.safeParse(gradeInput(trace, [mutated])).success,
		).toBe(false);
		expect(nativeToolWitness(mutated, trace)).toBeNull();
	}
	expect(
		ScenarioGradeInputSchema.safeParse(gradeInput(trace, [first, first]))
			.success,
	).toBe(false);
});

test("V2 serialized validation rejects mixed versions, duplicate indexes, bad topology and impossible bindings", () => {
	for (const mutate of [
		(t: ReturnType<typeof observed>) => {
			required(t.sessions[1]).parentId = "ses_unknown";
		},
		(t: ReturnType<typeof observed>) => {
			object(t.messages[1]).parentId = "msg_user";
		},
		(t: ReturnType<typeof observed>) => {
			object(t.messages[1]).tools = [
				{
					sessionId: "ses_root",
					messageId: "msg_assistant",
					partId: "prt_fake",
					partIndex: 1,
					callId: "call_repeat",
					startedAt: 3,
					completedAt: 4,
					tool: "flow_status",
					status: "completed",
				},
			];
		},
		(t: ReturnType<typeof observed>) => {
			object(t.messages[1]).tools = [
				...array(object(t.messages[1]).tools),
				...array(object(t.messages[1]).tools),
			];
		},
		(t: ReturnType<typeof observed>) => {
			object(array(object(t.messages[1]).tools)[0]).sessionId = "ses_child";
		},
		(t: ReturnType<typeof observed>) => {
			object(array(object(t.messages[1]).tools)[0]).partIndex = 2;
		},
		(t: ReturnType<typeof observed>) => {
			object(t.messages[3]).created = 0;
		},
	]) {
		const trace = observed();
		mutate(trace);
		expect(HostTraceSchema.safeParse(trace).success).toBe(false);
	}
	expect(
		NativeToolProvenanceSchema.safeParse({
			...callFor().native,
			partId: "prt_fake",
		}).success,
	).toBe(false);
});

test("V2 lineage uses native metadata and message types and leaves compaction unproved", () => {
	const input = fixture();
	delete object(rootMessages(input)[0]).metadata;
	expect(checkAutonomousLineage({ hostTrace: observed(input) })).toEqual([
		"The initial original Flow request marker is missing.",
		"Unknown or mismatched synthetic Flow continuation.",
	]);
	const second = fixture();
	object(object(rootMessages(second)[2]).metadata)[
		"opencode-plugin-flow/auto"
	] = "other-token";
	expect(checkAutonomousLineage({ hostTrace: observed(second) })).toEqual([
		"Unknown or mismatched synthetic Flow continuation.",
	]);
	const extra = fixture();
	rootMessages(extra).push({
		id: "msg_another",
		type: "user",
		text: "Continue",
		time: { created: 10 },
		metadata: { "opencode-plugin-flow/auto": "fixture-token" },
	});
	expect(checkAutonomousLineage({ hostTrace: observed(extra) })).toEqual([
		"Expected exactly one original root request.",
	]);
	const compacted = fixture();
	rootMessages(compacted).push({
		id: "msg_compaction",
		type: "compaction",
		status: "completed",
		reason: "auto",
		summary: "Summary",
		time: { created: 10 },
	});
	const trace = observed(compacted);
	expect(trace.messages.at(5)).toMatchObject({
		role: "event",
		type: "compaction",
	});
	expect(trace.compactionDelivery).toBe("unavailable-from-message-export");
	expect(checkAutonomousLineage({ hostTrace: trace })).toEqual([
		"Native compaction or unknown user-part delivery is unproven.",
	]);
});

function qualifiedV2() {
	const input = autoQualifiedOutcome("single");
	const legacy = input.hostTrace;
	if (legacy?.kind !== "observed" || legacy.version !== 1)
		throw new Error("Expected V1 fixture");
	const sessionMetadata = legacy.sessions.map((s) =>
		session(s.id, s.parentId ?? undefined),
	);
	const sessionMessages = legacy.sessions.map((s) => ({
		sessionId: s.id,
		messages: legacy.messages
			.filter((m) => m.sessionId === s.id)
			.map((m) =>
				m.role === "user"
					? {
							id: m.id,
							type: "user",
							text: "Task",
							time: { created: m.created },
							...(legacy.runnerRootSessionIds.includes(s.id)
								? { metadata: { "opencode-plugin-flow/auto": "fixture-token" } }
								: {}),
						}
					: {
							id: m.id,
							type: "assistant",
							agent: m.agent,
							model: { id: "fixture", providerID: "fake" },
							time: { created: m.created },
							content: m.tools.map((t) => ({
								type: "tool",
								id: "call_repeated",
								name: t.tool,
								time: { created: t.startedAt, completed: t.completedAt },
								state: {
									status: t.status,
									input: {},
									content: [{ type: "text", text: "{}" }],
								},
							})),
						},
			),
	}));
	const trace = observed({
		runnerRootSessionIds: legacy.runnerRootSessionIds,
		directory: "/workspace",
		childrenComplete: true,
		sessionMetadata,
		sessionMessages,
	});
	const calls = input.allCalls.map((call) => {
		const message = trace.messages.find(
			(m) => m.role === "assistant" && m.id === call.native?.messageId,
		);
		if (message?.role !== "assistant" || !message.tools[0])
			throw new Error("Missing native fixture tool");
		const { tool: _tool, status: _status, ...native } = message.tools[0];
		return { ...call, native };
	});
	return { ...input, hostTrace: trace, allCalls: calls, flowCalls: calls };
}

test("V2 reviewer reads, submitted child role and original packet evidence survive retained regrading", () => {
	const input = qualifiedV2();
	expect(checkAutonomousLineage(input)).toEqual([]);
	expect(checkReviewerEvidenceAccess(input, input.archives[0])).toEqual([]);
	const retained = RetainedScenarioEvidenceSchema.parse({
		schemaVersion: 1,
		attempt: {
			attemptId: "v2",
			cellId: "v2",
			caseId: "v2",
			repetition: 0,
			model: {
				routeProvider: "fake",
				gateway: null,
				family: "fixture",
				model: "fixture",
				revision: null,
			},
		},
		actors: [
			{
				role: "manager",
				sessionIds: ["ses_root"],
				actualModel: {
					kind: "observed",
					value: { providerID: "fake", modelID: "fixture" },
				},
				requestedModelId: "fake/fixture",
				requestedModel: {
					routeProvider: "fake",
					gateway: null,
					family: "fixture",
					model: "fixture",
					revision: null,
				},
			},
			{
				role: "reviewer",
				sessionIds: ["ses_reviewer0"],
				actualModel: {
					kind: "observed",
					value: { providerID: "fake", modelID: "fixture" },
				},
				requestedModelId: "fake/fixture",
				requestedModel: {
					routeProvider: "fake",
					gateway: null,
					family: "fixture",
					model: "fixture",
					revision: null,
				},
			},
		],
		guidanceLoads: [],
		gradeInput: { schemaVersion: 1, ...input },
		usage: { durationMs: 100, outputTokens: 1, costUsd: null },
	});
	expect(nativeActorBindingIssues(retained)).toEqual([]);
	const replay = RetainedScenarioEvidenceSchema.parse(
		pseudonymizeEvalIds(JSON.parse(JSON.stringify(retained))),
	);
	expect(checkAutonomousLineage(replay.gradeInput)).toEqual([]);
	expect(
		checkReviewerEvidenceAccess(
			replay.gradeInput,
			replay.gradeInput.archives[0],
		),
	).toEqual([]);
	const bad = qualifiedV2();
	const trace = bad.hostTrace;
	if (trace?.kind !== "observed" || trace.version !== 2)
		throw new Error("Expected V2");
	required(trace.sessions.find((s) => s.parentId !== null)).agent = "build";
	expect(checkReviewerEvidenceAccess(bad, bad.archives[0])).toEqual([
		"parser: One accepted native reviewer-child submission is required.",
	]);
});

test("V2 abort observation retains historical wrapper shape and proves exact native composite on regrade", () => {
	const raw = assistant();
	raw.content = [tool("call_repeat", "running", 3)];
	const trace = observed({
		...fixture(),
		sessionMessages: [
			{
				sessionId: "ses_root",
				messages: [
					{ id: "msg_user", type: "user", text: "Task", time: { created: 1 } },
					raw,
				],
			},
			{ sessionId: "ses_child", messages: [] },
		],
	});
	const native = nativeToolProvenance("ses_root", raw, 0);
	if (!native) throw new Error("Missing pending");
	const call: ObservedToolCall = {
		...callFor(),
		native,
		status: "running",
		tool: "task",
		input: { description: "Review" },
	};
	const message = trace.messages[1];
	if (message?.role !== "assistant") throw new Error("Missing assistant");
	required(message.tools[0]).tool = "task";
	const proof = {
		rootSessionId: "ses_root",
		observedAt: 180004,
		abortRequestedAt: 180004,
		startedAt: 1,
		excludedMs: 0,
		trigger: {
			kind: "stall" as const,
			unchangedMs: 180000,
			lastActivityAt: 4,
			thresholdMs: 180000 as const,
		},
		pending: [
			{ native, tool: "task", status: "running" as const, input: call.input },
		],
	};
	expect(HostAbortObservationSchema.parse(proof)).toEqual(proof);
	const input = ScenarioGradeInputSchema.parse(gradeInput(trace, [call]));
	const observation = retainedFailureObservation({
		origin: "host",
		code: "command-aborted",
		retryable: true,
		detail: "Actual watchdog abort",
		gradeInput: input,
		abortObservation: proof,
	});
	const retained = RetainedScenarioEvidenceSchema.parse({
		schemaVersion: 1,
		attempt: {
			attemptId: "v2",
			cellId: "v2",
			caseId: "v2",
			repetition: 0,
			model: {
				routeProvider: "fake",
				gateway: null,
				family: "fixture",
				model: "fixture",
				revision: null,
			},
		},
		actors: [
			{
				role: "manager",
				sessionIds: ["ses_root"],
				actualModel: {
					kind: "observed",
					value: { providerID: "fake", modelID: "fixture" },
				},
				requestedModelId: "fake/fixture",
				requestedModel: {
					routeProvider: "fake",
					gateway: null,
					family: "fixture",
					model: "fixture",
					revision: null,
				},
			},
		],
		guidanceLoads: [],
		gradeInput: input,
		failureObservation: observation,
		usage: { durationMs: 180003, outputTokens: 1, costUsd: null },
	});
	expect(deriveRetainedFailure(retained)).toEqual({
		origin: "host",
		code: "command-aborted",
		retryable: true,
	});
	const replay = RetainedScenarioEvidenceSchema.parse(
		pseudonymizeEvalIds(JSON.parse(JSON.stringify(retained))),
	);
	expect(deriveRetainedFailure(replay)).toEqual({
		origin: "host",
		code: "command-aborted",
		retryable: true,
	});
	const pending = retained.failureObservation;
	if (pending?.kind !== "host-phase" || !pending.abortObservation)
		throw new Error("Missing proof");
	required(pending.abortObservation.pending[0]).native.messageId = "msg_other";
	expect(deriveRetainedFailure(retained)).toBeNull();
});
