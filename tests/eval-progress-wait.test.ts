import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CampaignCancelled } from "../evals/campaign-stop.js";
import {
	EvalHost,
	postSessionJson,
	runSessionRequest,
} from "../evals/harness.js";

type Mode =
	| "owned-progress"
	| "wedged"
	| "in-place-progress"
	| "wrong-parent"
	| "wrong-directory"
	| "deadline"
	| "cancel-child"
	| "tree-limit"
	| "duplicate-children"
	| "cyclic-children"
	| "malformed-children"
	| "foreign-message"
	| "malformed-endpoint"
	| "async-deadline"
	| "child-suspend"
	| "root-suspend"
	| "deadline-suspend"
	| "cancel-suspend"
	| "request-timeout"
	| "combined-credit"
	| "clock-boundary"
	| "credit-cap";

async function observeWait(mode: Mode) {
	const project = await mkdtemp(join(tmpdir(), "flow-progress-wait-"));
	const controller = new AbortController();
	const cancelled = new CampaignCancelled(143);
	const requestTimeout = new DOMException(
		"Child HTTP request timed out",
		"TimeoutError",
	);
	const host = Reflect.construct(EvalHost, [
		project,
		project,
		controller.signal,
	]) as EvalHost;
	Object.assign(host, { baseUrl: "http://progress-fixture" });
	let now = 0;
	let aborts = 0;
	let childReads = 0;
	let slept = false;
	const timing = [
		"async-deadline",
		"child-suspend",
		"root-suspend",
		"deadline-suspend",
		"cancel-suspend",
		"combined-credit",
		"clock-boundary",
		"credit-cap",
	].includes(mode);
	const finishesAt = timing ? 70_000 : 210_000;
	const finishes = [
		"owned-progress",
		"duplicate-children",
		"cyclic-children",
		"child-suspend",
		"root-suspend",
		"deadline-suspend",
	].includes(mode);
	const visits: string[] = [];
	let clockBoundary = false;
	const clock = spyOn(Date, "now").mockImplementation(() =>
		clockBoundary ? now++ : now,
	);
	let observerDeadline: AbortController | undefined;
	const realTimeout = AbortSignal.timeout.bind(AbortSignal);
	const timeouts = spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
		if (
			(mode === "deadline-suspend" || mode === "cancel-suspend") &&
			ms < 60_000
		) {
			observerDeadline = new AbortController();
			return observerDeadline.signal;
		}
		return realTimeout(ms);
	});
	const sleep = spyOn(Bun, "sleep").mockImplementation(async () => {
		now += 2_000;
		if ((mode === "root-suspend" || mode === "combined-credit") && !slept)
			now += 40_000;
		slept = true;
	});
	const childMetadata = {
		id: "ses_child",
		parentID: mode === "wrong-parent" ? "ses_unrelated" : "ses_root",
		directory: mode === "wrong-directory" ? `${project}-unrelated` : project,
		agent: "flow-reviewer",
	};
	const rootMessages = () => [
		{
			info: {
				id: "msg_root",
				sessionID: "ses_root",
				role: "assistant",
				agent: "build",
				time: {
					created: 1,
					...(finishes && now >= finishesAt ? { completed: finishesAt } : {}),
				},
			},
			parts: [
				{
					id: "prt_task",
					messageID: "msg_root",
					sessionID: "ses_root",
					type: "tool",
					tool: "task",
					callID: "call_task",
					state: {
						status: finishes && now >= finishesAt ? "completed" : "running",
						input: { subagent_type: "flow-reviewer" },
						time: { start: 1 },
					},
				},
			],
		},
	];
	const childMessages = () =>
		Array.from(
			{
				length:
					mode === "wedged" || mode === "in-place-progress"
						? 1
						: Math.floor(Math.min(now, finishes ? finishesAt : now) / 16_000) +
							1,
			},
			(_, index) => ({
				info: {
					id: `msg_child_${index}`,
					sessionID: "ses_child",
					role: "assistant",
					agent: "flow-reviewer",
					time: { created: index * 16_000, completed: index * 16_000 + 1 },
				},
				parts: [
					{
						id: `prt_read_${index}`,
						messageID: `msg_child_${index}`,
						sessionID: "ses_child",
						type: "tool",
						tool: "read",
						callID: `call_read_${index}`,
						state: {
							status: "completed",
							input: { filePath: "src/index.ts" },
							output:
								mode === "in-place-progress"
									? `source page updated at ${now}`
									: `source page ${index}`,
						},
					},
				],
			}),
		);
	const transport = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
				const path = new URL(String(input)).pathname;
				visits.push(path);
				if (path.endsWith("/abort")) {
					aborts++;
					return Response.json(true);
				}
				if (path === "/session/ses_root/command") return Response.json({});
				if (path === "/session/ses_root/message") {
					if (mode === "clock-boundary" && now >= 60_000 && !clockBoundary) {
						now = 59_999;
						clockBoundary = true;
					}
					return Response.json(rootMessages());
				}
				if (path === "/session/ses_root")
					return Response.json({ id: "ses_root", directory: project });
				if (
					path === "/session/ses_root/children" &&
					mode === "async-deadline" &&
					now >= 60_000
				) {
					const signal = init?.signal;
					if (!signal) throw new Error("Missing observer cancellation signal");
					return new Promise<Response>((_, reject) => {
						if (signal.aborted) reject(signal.reason);
						else
							signal.addEventListener("abort", () => reject(signal.reason), {
								once: true,
							});
					});
				}
				if (
					path === "/session/ses_root/children" &&
					mode === "malformed-endpoint"
				)
					return Response.json({ unavailable: true });
				if (path === "/session/ses_root/children")
					return Response.json(
						mode === "tree-limit"
							? Array.from({ length: 128 }, (_, index) => ({
									...childMetadata,
									id: `ses_child_${index}`,
								}))
							: mode === "duplicate-children"
								? [childMetadata, childMetadata]
								: mode === "malformed-children"
									? [null, {}, { ...childMetadata, id: 42 }]
									: [childMetadata],
					);
				if (path === "/session/ses_child") return Response.json(childMetadata);
				if (
					path === "/session/ses_child/children" &&
					mode === "cyclic-children"
				)
					return Response.json([
						{ id: "ses_root", parentID: "ses_child", directory: project },
					]);
				if (
					path === "/session/ses_child/children" ||
					/\/session\/ses_child_\d+\/children/.test(path)
				)
					return Response.json([]);
				if (path === "/session/ses_child/message") {
					childReads++;
					if (mode === "request-timeout") throw requestTimeout;
					if (
						(mode === "deadline-suspend" || mode === "cancel-suspend") &&
						childReads === 1
					) {
						now += 80_000;
						if (mode === "cancel-suspend") controller.abort(cancelled);
						else
							observerDeadline?.abort(
								new DOMException(
									"Observer elapsed during suspension",
									"TimeoutError",
								),
							);
						if (!init?.signal?.aborted)
							throw new Error("Fixture observer signal did not abort");
						throw init.signal.reason;
					}
					if (
						(mode === "child-suspend" || mode === "combined-credit") &&
						childReads === 1
					)
						now += 40_000;
					if (mode === "credit-cap" && childReads <= 3) now += 40_000;
					if (mode === "cancel-child") controller.abort(cancelled);
					if (mode === "foreign-message")
						return Response.json([
							{
								info: { sessionID: "ses_unrelated", role: "assistant" },
								parts: [],
							},
						]);
					return Response.json(childMessages());
				}
				if (/\/session\/ses_child_\d+\/message/.test(path))
					return Response.json([]);
				throw new Error(`Unexpected progress endpoint ${path}`);
			},
			{ preconnect: fetch.preconnect },
		),
	);
	try {
		const result = await runSessionRequest({
			url: "http://progress-fixture/session/ses_root/command",
			body: {},
			post: postSessionJson,
			signal: controller.signal,
			waitOwnsCancellation: true,
			onRejected: () => {},
			onCancelled: () =>
				Reflect.apply(Reflect.get(host, "abortSession"), host, ["ses_root"]),
			wait: (request) =>
				Reflect.apply(Reflect.get(host, "waitForQuiet"), host, [
					"ses_root",
					{
						request,
						...(timing
							? { timeoutMs: mode === "combined-credit" ? 120_000 : 60_000 }
							: {}),
					},
				]),
		}).catch((error: unknown) => error);
		return {
			result,
			now,
			aborts,
			visits,
			cancelled,
			childReads,
			requestTimeout,
		};
	} finally {
		timeouts.mockRestore();
		transport.mockRestore();
		sleep.mockRestore();
		clock.mockRestore();
		await host.stop();
		await rm(project, { recursive: true, force: true });
	}
}

test("owned reviewer progress prevents a false root-task wedge beyond three minutes", async () => {
	const observed = await observeWait("owned-progress");
	expect(observed.result).toBe("quiet");
	expect(observed.now).toBeGreaterThanOrEqual(210_000);
	expect(observed.now).toBeLessThanOrEqual(240_000);
	expect(observed.aborts).toBe(0);
	expect(observed.visits).toContain("/session/ses_child/message");
});

for (const mode of [
	"wedged",
	"wrong-parent",
	"wrong-directory",
	"malformed-children",
] as const) {
	test(`${mode} child activity cannot extend a silent root task`, async () => {
		const observed = await observeWait(mode);
		expect(observed.result).toBeInstanceOf(Error);
		expect(String(observed.result)).toContain(
			"Scenario had no observed activity for 180000ms",
		);
		expect(observed.now).toBe(182_000);
		expect(observed.aborts).toBe(1);
		if (mode !== "wedged")
			expect(observed.visits).not.toContain("/session/ses_child/message");
	});
}

test("continuous owned reviewer progress retains the twenty-minute hard deadline", async () => {
	const observed = await observeWait("deadline");
	expect(String(observed.result)).toContain(
		"Observed activity continued near the deadline",
	);
	expect(observed.now).toBe(1_202_000);
	expect(observed.aborts).toBe(1);
});

test("completed historical output updates do not count as active observation", async () => {
	const observed = await observeWait("in-place-progress");
	expect(String(observed.result)).toContain(
		"Scenario had no observed activity for 180000ms",
	);
	expect(String(observed.result)).toContain(
		"Activity does not establish useful progress.",
	);
	expect(observed.now).toBe(182_000);
	expect(observed.aborts).toBe(1);
	expect(observed.childReads).toBeGreaterThan(80);
});

for (const mode of ["duplicate-children", "cyclic-children"] as const) {
	test(`${mode} remain one bounded owned progress path`, async () => {
		const observed = await observeWait(mode);
		expect(observed.result).toBe("quiet");
		expect(observed.aborts).toBe(0);
		expect(
			observed.visits.filter((path) => path === "/session/ses_child/message")
				.length,
		).toBe(
			observed.visits.filter((path) => path === "/session/ses_root/message")
				.length,
		);
	});
}

test("foreign message identities cannot contribute to owned child progress", async () => {
	const observed = await observeWait("foreign-message");
	expect(String(observed.result)).toContain(
		"Owned progress transcript is malformed",
	);
	expect(observed.aborts).toBe(1);
});

test("malformed child endpoint reports observation failure instead of a root wedge", async () => {
	const observed = await observeWait("malformed-endpoint");
	expect(String(observed.result)).toContain(
		"Owned progress children response is malformed",
	);
	expect(String(observed.result)).not.toContain("wedged");
	expect(observed.aborts).toBe(1);
	expect(observed.now).toBe(2_000);
});

test("owned-child polling cancellation preserves the reason and aborts the root once", async () => {
	const observed = await observeWait("cancel-child");
	expect(observed.result).toBe(observed.cancelled);
	expect(observed.aborts).toBe(1);
});

test("owned-child traversal refuses more than 128 sessions including the root", async () => {
	const observed = await observeWait("tree-limit");
	expect(String(observed.result)).toContain(
		"Owned progress tree exceeds 128 sessions",
	);
	expect(
		observed.visits.filter((path) => path.includes("/ses_child_")),
	).toHaveLength(0);
	expect(observed.aborts).toBe(1);
});

test("asynchronous child reads retain the canonical hard-deadline diagnostic", async () => {
	const observed = await observeWait("async-deadline");
	expect(String(observed.result)).toContain(
		"Scenario exceeded 60000ms without going quiet",
	);
	expect(String(observed.result)).not.toContain("TimeoutError");
	expect(observed.aborts).toBe(1);
});

for (const mode of ["child-suspend", "root-suspend"] as const) {
	test(`${mode} preserves a progressing review across a suspended poll`, async () => {
		const observed = await observeWait(mode);
		expect(observed.result).toBe("quiet");
		expect(observed.now).toBeGreaterThan(60_000);
		expect(observed.now).toBeLessThanOrEqual(104_000);
		expect(observed.aborts).toBe(0);
	});
}

test("descendant suspension credit remains capped at one full timeout", async () => {
	const observed = await observeWait("credit-cap");
	expect(String(observed.result)).toContain(
		"Scenario exceeded 60000ms without going quiet",
	);
	expect(String(observed.result)).toContain("Excluded 60s");
	expect(observed.now).toBeGreaterThanOrEqual(120_000);
	expect(observed.aborts).toBe(1);
});

test("a deadline interrupted by suspension rearms observation within restored budget", async () => {
	const observed = await observeWait("deadline-suspend");
	expect(observed.result).toBe("quiet");
	expect(observed.childReads).toBeGreaterThan(1);
	expect(observed.now).toBeLessThanOrEqual(120_000);
	expect(observed.aborts).toBe(0);
});

test("cancellation during suspended observation preserves the original reason", async () => {
	const observed = await observeWait("cancel-suspend");
	expect(observed.result).toBe(observed.cancelled);
	expect(observed.childReads).toBe(1);
	expect(observed.aborts).toBe(1);
});

test("an independent child HTTP timeout retains its original failure", async () => {
	const observed = await observeWait("request-timeout");
	expect(observed.result).toBe(observed.requestTimeout);
	expect(observed.aborts).toBe(1);
	expect(observed.now).toBe(2_000);
});

test("root and child suspension credit accounts each poll interval once", async () => {
	const observed = await observeWait("combined-credit");
	expect(String(observed.result)).toContain(
		"Scenario exceeded 120000ms without going quiet",
	);
	expect(String(observed.result)).toContain("Excluded 82s");
	expect(observed.now).toBe(204_000);
	expect(observed.aborts).toBe(1);
});

test("a clock crossing at observer setup retains deadline diagnosis and abort", async () => {
	const observed = await observeWait("clock-boundary");
	expect(String(observed.result)).toContain(
		"Scenario exceeded 60000ms without going quiet",
	);
	expect(String(observed.result)).not.toContain("RangeError");
	expect(observed.aborts).toBe(1);
});
