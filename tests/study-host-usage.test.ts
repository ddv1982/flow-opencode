import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	SessionMessageAssistant,
	SessionMessageInfo,
} from "@opencode/client";
import type { StudyUsage } from "../evals/study-usage.js";
import {
	messagePage,
	type NativeTokens,
	nativeAssistant,
	nativeClient,
	nativeHost,
	nativeSession,
	nativeTool,
	sessionPage,
	sessionReply,
	useNativeFixtureBudget,
} from "./fixtures/native-eval-client.js";

useNativeFixtureBudget();
type HostTokens = NativeTokens;

test("entitlement probes distinguish session setup from a provider request attempt", async () => {
	const project = await mkdtemp(join(tmpdir(), "native-probe-"));
	let dispatches = 0;
	let usage: StudyUsage | undefined;
	let setupFails = true;
	const host = nativeHost(
		project,
		nativeClient(({ url }) => {
			if (url.pathname === "/api/session") {
				if (setupFails) throw new Error("Session setup failed.");
				return Response.json({ data: nativeSession("probe-session", project) });
			}
			if (url.pathname === "/api/session/probe-session/model")
				throw new Error("Request failed.");
			if (url.pathname === "/api/session/probe-session")
				return new Response(null, { status: 204 });
			throw new Error(`Unexpected probe endpoint ${url.pathname}`);
		}),
	);
	const settings = {
		onDispatch: () => {
			dispatches++;
		},
		observeUsage: (value: StudyUsage) => {
			usage = value;
		},
	};
	try {
		await expect(host.probeModel("fixture/manager", settings)).rejects.toThrow(
			"Session setup failed.",
		);
		expect(dispatches).toBe(0);
		expect(usage).toBeUndefined();
		setupFails = false;
		expect(await host.probeModel("fixture/manager", settings)).toBe(
			"Transport: Request failed.",
		);
		expect(dispatches).toBe(1);
		expect(usage).toMatchObject({ availability: "unobserved", costUsd: null });
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("entitlement probes retain missing cache counters as incomplete usage", async () => {
	const project = await mkdtemp(join(tmpdir(), "native-probe-"));
	const reply = nativeAssistant("message-probe", {
		time: { created: 1, completed: 2 },
		cost: 0.01,
	});
	Reflect.set(reply, "tokens", { input: 2, output: 1, reasoning: 0 });
	const host = nativeHost(
		project,
		nativeClient(({ url }) => {
			if (url.pathname === "/api/session")
				return Response.json({ data: nativeSession("probe-session", project) });
			if (url.pathname === "/api/session/probe-session/message")
				return messagePage([reply]);
			if (
				url.pathname === "/api/session/probe-session/model" ||
				url.pathname === "/api/session/probe-session" ||
				url.pathname === "/api/experimental/session/probe-session/wait"
			)
				return new Response(null, { status: 204 });
			if (url.pathname === "/api/session/probe-session/prompt")
				return Response.json({
					data: {
						id: "inbox-probe",
						sessionID: "probe-session",
						type: "user",
						time: { created: 1 },
						payload: { text: "OK" },
						delivery: "queue",
					},
				});
			throw new Error(`Unexpected probe endpoint ${url.pathname}`);
		}),
	);
	let usage: StudyUsage | undefined;
	try {
		expect(
			await host.probeModel("fixture/manager", {
				observeUsage: (value) => {
					usage = value;
				},
			}),
		).toBeNull();
		expect(usage).toMatchObject({
			availability: "incomplete",
			upstreamBreakdown: "unobserved",
			costUsd: 0.01,
		});
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

type SessionFixture = {
	agent: string;
	parentID: string | null;
	children?: readonly string[];
	messages: readonly SessionMessageInfo[];
};

function assistantMessage(
	sessionId: string,
	agent: string,
	tokens: HostTokens | undefined,
	cost: number | undefined,
): SessionMessageAssistant {
	return nativeAssistant(`message-${sessionId}`, {
		agent,
		model: { providerID: "fixture-provider", id: `${agent}-model` },
		time: { created: 1, completed: 2 },
		...(tokens === undefined ? {} : { tokens }),
		...(cost === undefined ? {} : { cost }),
	});
}

async function collectOutcome(
	fixtures: Readonly<Record<string, SessionFixture>>,
) {
	const project = await mkdtemp(join(tmpdir(), "study-host-usage-"));
	const requests: string[] = [];
	const unexpected: string[] = [];
	const metadata = (id: string) => {
		const fixture = fixtures[id];
		if (!fixture) throw new Error(`Missing session fixture ${id}`);
		return nativeSession(id, project, {
			agent: fixture.agent,
			...(fixture.parentID ? { parentID: fixture.parentID } : {}),
		});
	};
	const host = nativeHost(
		project,
		nativeClient(({ url, method }) => {
			requests.push(url.pathname);
			if (method !== "GET") throw new Error(`Unexpected method ${method}`);
			if (url.pathname === "/api/session") {
				const listed = Object.keys(fixtures).map(metadata);
				for (const [parentID, fixture] of Object.entries(fixtures))
					for (const child of fixture.children ?? [])
						listed.push({ ...metadata(child), parentID });
				return sessionPage(listed);
			}
			if (url.pathname === "/api/session/root")
				return sessionReply(metadata("root"));
			const id = url.pathname.match(/^\/api\/session\/([^/]+)\/message$/)?.[1];
			if (id && fixtures[id]) return messagePage([...fixtures[id].messages]);
			unexpected.push(`${method} ${url}`);
			return Response.json({ error: "Unexpected request." }, { status: 404 });
		}),
	);
	try {
		const outcome = await host.outcome(["root"], 123);
		expect(unexpected).toEqual([]);
		return { outcome, requests };
	} finally {
		await rm(project, { recursive: true, force: true });
	}
}

const zeroHostTokens: HostTokens = {
	input: 0,
	output: 0,
	reasoning: 0,
	cache: { read: 0, write: 0 },
};
const zeroOutcomeTokens = {
	input: 0,
	output: 0,
	reasoning: 0,
	cacheRead: 0,
	cacheWrite: 0,
};
const rootMessage = assistantMessage(
	"root",
	"flow",
	{ input: 2, output: 3, reasoning: 5, cache: { read: 7, write: 11 } },
	0.125,
);
const family = {
	root: {
		agent: "flow",
		parentID: null,
		children: ["worker", "reviewer"],
		messages: [
			{
				type: "user",
				id: "user-root",
				time: { created: 1 },
				text: "Inspect the fixture.",
				metadata: { cost: 999 },
			},
			rootMessage,
		],
	},
	worker: {
		agent: "flow-worker",
		parentID: "root",
		messages: [
			assistantMessage(
				"worker",
				"flow-worker",
				{
					input: 13,
					output: 17,
					reasoning: 19,
					cache: { read: 23, write: 29 },
				},
				0.25,
			),
		],
	},
	reviewer: {
		agent: "flow-reviewer",
		parentID: "root",
		messages: [
			assistantMessage(
				"reviewer",
				"flow-reviewer",
				{
					input: 31,
					output: 37,
					reasoning: 41,
					cache: { read: 43, write: 47 },
				},
				0.5,
			),
		],
	},
} satisfies Readonly<Record<string, SessionFixture>>;
const familyTotals = {
	input: 46,
	output: 57,
	reasoning: 65,
	cacheRead: 73,
	cacheWrite: 87,
};

describe("EvalHost outcome usage collection", () => {
	test("collects root, worker, and reviewer usage while excluding user metadata", async () => {
		const { outcome } = await collectOutcome(family);
		expect(outcome.tokens).toEqual(familyTotals);
		expect(outcome.costUsd).toBe(0.875);
		expect(outcome.assistantMessages).toBe(3);
		expect(outcome.usageAvailability).toBe("observed");
		expect(
			outcome.actors?.map(({ role, sessionIds }) => ({ role, sessionIds })),
		).toEqual([
			{ role: "manager", sessionIds: ["root"] },
			{ role: "reviewer", sessionIds: ["reviewer"] },
		]);
		expect(
			outcome.actors?.map(({ role, actualModel }) => ({ role, actualModel })),
		).toEqual([
			{
				role: "manager",
				actualModel: {
					kind: "observed",
					value: { providerID: "fixture-provider", modelID: "flow-model" },
				},
			},
			{
				role: "reviewer",
				actualModel: {
					kind: "observed",
					value: {
						providerID: "fixture-provider",
						modelID: "flow-reviewer-model",
					},
				},
			},
		]);
	});

	test("fetches repeated descendants once across duplicate edges and cycles", async () => {
		const { outcome, requests } = await collectOutcome({
			...family,
			root: {
				...family.root,
				children: ["worker", "worker", "reviewer", "root"],
			},
			worker: { ...family.worker, children: ["reviewer", "root"] },
			reviewer: { ...family.reviewer, children: ["worker", "reviewer"] },
		});
		expect(outcome.tokens).toEqual(familyTotals);
		expect(outcome.costUsd).toBe(0.875);
		expect(outcome.assistantMessages).toBe(3);
		expect([...requests].sort()).toEqual([
			"/api/session",
			"/api/session/reviewer/message",
			"/api/session/root",
			"/api/session/root/message",
			"/api/session/worker/message",
		]);
	});

	test("counts assistant metadata once when step-finish parts repeat its usage", async () => {
		const { outcome } = await collectOutcome({
			root: {
				agent: "flow",
				parentID: null,
				messages: [
					{
						...rootMessage,
						content: [
							nativeTool(
								"call-usage",
								"read",
								{
									status: "completed",
									input: {},
									content: [{ type: "text", text: "fixture" }],
									metadata: { cost: 0.125, tokens: rootMessage.tokens ?? {} },
								},
								{ created: 1, completed: 2 },
							),
						],
					},
				],
			},
		});
		expect(outcome.tokens).toEqual({
			input: 2,
			output: 3,
			reasoning: 5,
			cacheRead: 7,
			cacheWrite: 11,
		});
		expect(outcome.costUsd).toBe(0.125);
		expect(outcome.assistantMessages).toBe(1);
	});

	test("a positive cost cannot establish missing assistant token counts", async () => {
		const { outcome } = await collectOutcome({
			root: {
				agent: "flow",
				parentID: null,
				messages: [assistantMessage("root", "flow", undefined, 0.5)],
			},
		});
		expect(outcome.tokens).toEqual(zeroOutcomeTokens);
		expect(outcome.costUsd).toBe(0.5);
		expect(outcome.assistantMessages).toBe(1);
		expect(outcome.usageAvailability).toBe("unobserved");
	});

	test.each(["root", "worker"])(
		"complete counts cannot mask missing %s message counts",
		async (missingSession) => {
			const reported = {
				input: 2,
				output: 3,
				reasoning: 5,
				cache: { read: 7, write: 11 },
			};
			const { outcome } = await collectOutcome({
				root: {
					agent: "flow",
					parentID: null,
					children: ["worker"],
					messages: [
						assistantMessage(
							"root",
							"flow",
							missingSession === "root" ? undefined : reported,
							0.125,
						),
					],
				},
				worker: {
					agent: "flow-worker",
					parentID: "root",
					messages: [
						assistantMessage(
							"worker",
							"flow-worker",
							missingSession === "worker" ? undefined : reported,
							0.5,
						),
					],
				},
			});
			expect(outcome.tokens).toEqual({
				input: 2,
				output: 3,
				reasoning: 5,
				cacheRead: 7,
				cacheWrite: 11,
			});
			expect(outcome.costUsd).toBe(0.625);
			expect(outcome.assistantMessages).toBe(2);
			expect(outcome.usageAvailability).toBe("incomplete");
		},
	);

	test.each([
		{
			category: "reasoning",
			tokens: { ...zeroHostTokens, reasoning: 9 },
			expected: { ...zeroOutcomeTokens, reasoning: 9 },
		},
		{
			category: "input",
			tokens: { ...zeroHostTokens, input: 9 },
			expected: { ...zeroOutcomeTokens, input: 9 },
		},
		{
			category: "cache read",
			tokens: { ...zeroHostTokens, cache: { read: 9, write: 0 } },
			expected: { ...zeroOutcomeTokens, cacheRead: 9 },
		},
		{
			category: "cache write",
			tokens: { ...zeroHostTokens, cache: { read: 0, write: 9 } },
			expected: { ...zeroOutcomeTokens, cacheWrite: 9 },
		},
	])(
		"zero cost is unknown for $category-only assistant metadata",
		async ({ tokens, expected }) => {
			const { outcome } = await collectOutcome({
				root: {
					agent: "flow",
					parentID: null,
					messages: [assistantMessage("root", "flow", tokens, 0)],
				},
			});
			expect(outcome.tokens).toEqual(expected);
			expect(outcome.costUsd).toBeNull();
			expect(outcome.assistantMessages).toBe(1);
		},
	);

	test.each([
		{ label: "zero", cost: 0, unknownSession: "root" },
		{ label: "zero", cost: 0, unknownSession: "worker" },
		{ label: "absent", cost: undefined, unknownSession: "root" },
		{ label: "absent", cost: undefined, unknownSession: "worker" },
	])(
		"a known estimate cannot mask $label cost reported by the $unknownSession",
		async ({ cost, unknownSession }) => {
			const knownTokens = { ...zeroHostTokens, output: 3 };
			const unknownTokens = { ...zeroHostTokens, reasoning: 7 };
			const { outcome } = await collectOutcome({
				root: {
					agent: "flow",
					parentID: null,
					children: ["worker"],
					messages: [
						assistantMessage(
							"root",
							"flow",
							unknownSession === "root" ? unknownTokens : knownTokens,
							unknownSession === "root" ? cost : 0.5,
						),
					],
				},
				worker: {
					agent: "flow-worker",
					parentID: "root",
					messages: [
						assistantMessage(
							"worker",
							"flow-worker",
							unknownSession === "worker" ? unknownTokens : knownTokens,
							unknownSession === "worker" ? cost : 0.5,
						),
					],
				},
			});
			expect(outcome.tokens).toEqual({
				...zeroOutcomeTokens,
				output: 3,
				reasoning: 7,
			});
			expect(outcome.assistantMessages).toBe(2);
			expect(outcome.costUsd).toBeNull();
			expect(outcome.usageAvailability).toBe("observed");
		},
	);
});
