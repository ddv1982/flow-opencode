import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvalHost } from "../evals/harness.js";
import type { StudyUsage } from "../evals/study-usage.js";
import { authorizePaidRun } from "../scripts/paid-budget.js";

type HostTokens = {
	input: number;
	output: number;
	reasoning: number;
	cache: { read: number; write: number };
};

test("entitlement probes distinguish session setup from a provider request attempt", async () => {
	const host = Reflect.construct(EvalHost, [
		"/unused-project",
		"/unused-scratch",
	]) as EvalHost;
	let dispatches = 0;
	let usage: StudyUsage | undefined;
	const settings = {
		onDispatch: () => {
			dispatches++;
		},
		observeUsage: (value: StudyUsage) => {
			usage = value;
		},
	};
	Reflect.set(host, "createSession", async () => {
		throw new Error("Session setup failed.");
	});
	await expect(host.probeModel("fixture/manager", settings)).rejects.toThrow(
		"Session setup failed.",
	);
	expect(dispatches).toBe(0);
	expect(usage).toBeUndefined();
	Reflect.set(host, "createSession", async () => "probe-session");
	Reflect.set(host, "deleteSession", async () => {});
	Reflect.set(host, "post", async () => {
		throw new Error("Request failed.");
	});
	expect(await host.probeModel("fixture/manager", settings)).toBe(
		"Request failed.",
	);
	expect(dispatches).toBe(1);
	expect(usage).toMatchObject({ availability: "unobserved", costUsd: null });
});

test("entitlement probes retain missing cache counters as incomplete usage", async () => {
	const host = Reflect.construct(EvalHost, [
		"/unused-project",
		"/unused-scratch",
	]) as EvalHost;
	Reflect.set(host, "createSession", async () => "probe-session");
	Reflect.set(host, "deleteSession", async () => {});
	Reflect.set(host, "post", async () => ({
		info: { cost: 0.01, tokens: { input: 2, output: 1, reasoning: 0 } },
	}));
	let usage: StudyUsage | undefined;
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
});

type SessionFixture = {
	agent: string;
	parentID: string | null;
	children?: readonly string[];
	messages: readonly unknown[];
};

function assistantMessage(
	sessionId: string,
	agent: string,
	tokens: HostTokens | undefined,
	cost: number | undefined,
) {
	return {
		info: {
			id: `message-${sessionId}`,
			sessionID: sessionId,
			role: "assistant",
			agent,
			providerID: "fixture-provider",
			modelID: `${agent}-model`,
			time: { created: 1, completed: 2 },
			...(tokens === undefined ? {} : { tokens }),
			...(cost === undefined ? {} : { cost }),
		},
		parts: [],
	};
}

async function collectOutcome(
	fixtures: Readonly<Record<string, SessionFixture>>,
) {
	const host: unknown = Reflect.construct(EvalHost, [
		"unused-study-host-project",
		"unused-study-host-scratch",
	]);
	if (!(host instanceof EvalHost)) throw new Error("Expected an EvalHost.");
	const origin = "https://study-host.invalid";
	Object.assign(host, {
		baseUrl: origin,
		readJson: async () => null,
		readArchives: async () => [],
	});
	const responses = new Map<string, unknown>();
	for (const [id, fixture] of Object.entries(fixtures)) {
		responses.set(`/session/${id}/message`, fixture.messages);
		responses.set(
			`/session/${id}/children`,
			(fixture.children ?? []).map((childId) => {
				const child = fixtures[childId];
				if (!child) throw new Error(`Missing child fixture ${childId}.`);
				return { id: childId, agent: child.agent, parentID: child.parentID };
			}),
		);
	}
	const requests: string[] = [];
	const unexpected: string[] = [];
	const transport = Object.assign(
		async (...[input, init]: Parameters<typeof fetch>) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			requests.push(url.pathname);
			if (
				url.origin !== origin ||
				(init?.method ?? "GET") !== "GET" ||
				!responses.has(url.pathname)
			) {
				unexpected.push(`${init?.method ?? "GET"} ${url}`);
				return Response.json({ error: "Unexpected request." }, { status: 404 });
			}
			return Response.json(responses.get(url.pathname));
		},
		{ preconnect: fetch.preconnect },
	);
	const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(transport);
	try {
		const outcome = await host.outcome(["root"], 123);
		expect(unexpected).toEqual([]);
		return { outcome, requests };
	} finally {
		fetchSpy.mockRestore();
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
				info: {
					...rootMessage.info,
					id: "user-root",
					role: "user",
					cost: 999,
				},
				parts: [],
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
			"/session/reviewer/children",
			"/session/reviewer/message",
			"/session/root/children",
			"/session/root/message",
			"/session/worker/children",
			"/session/worker/message",
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
						parts: [
							{ type: "step-start" },
							{
								type: "step-finish",
								sessionID: "root",
								messageID: rootMessage.info.id,
								reason: "stop",
								cost: 0.125,
								tokens: rootMessage.info.tokens,
							},
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

let authorizationDirectory: string;
let previousAuthorization: string | undefined;
beforeAll(async () => {
	previousAuthorization = process.env.FLOW_EVAL_AUTHORIZATION;
	authorizationDirectory = await mkdtemp(join(tmpdir(), "flow-fake-budget-"));
	await authorizePaidRun(authorizationDirectory, {
		schemaVersion: 1,
		purpose: "Fake transport tests only",
		models: ["fixture/model", "fixture/manager"],
		maxDispatches: 100,
		expiresAt: new Date(Date.now() + 3600000).toISOString(),
	});
	process.env.FLOW_EVAL_AUTHORIZATION = authorizationDirectory;
});
afterAll(async () => {
	if (previousAuthorization === undefined)
		delete process.env.FLOW_EVAL_AUTHORIZATION;
	else process.env.FLOW_EVAL_AUTHORIZATION = previousAuthorization;
	await rm(authorizationDirectory, { recursive: true, force: true });
});
