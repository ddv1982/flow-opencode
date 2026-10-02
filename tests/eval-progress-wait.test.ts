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
	| "wrong-parent"
	| "wrong-directory"
	| "deadline"
	| "cancel-child"
	| "tree-limit";

async function observeWait(mode: Mode) {
	const project = await mkdtemp(join(tmpdir(), "flow-progress-wait-"));
	const controller = new AbortController();
	const cancelled = new CampaignCancelled(143);
	const host = Reflect.construct(EvalHost, [
		project,
		project,
		controller.signal,
	]) as EvalHost;
	Object.assign(host, { baseUrl: "http://progress-fixture" });
	let now = 0;
	let aborts = 0;
	const visits: string[] = [];
	const clock = spyOn(Date, "now").mockImplementation(() => now);
	const sleep = spyOn(Bun, "sleep").mockImplementation(async () => {
		now += 2_000;
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
					...(mode === "owned-progress" && now >= 210_000
						? { completed: 210_000 }
						: {}),
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
						status:
							mode === "owned-progress" && now >= 210_000
								? "completed"
								: "running",
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
					mode === "wedged"
						? 1
						: Math.floor(
								Math.min(now, mode === "owned-progress" ? 210_000 : now) /
									16_000,
							) + 1,
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
							output: `source page ${index}`,
						},
					},
				],
			}),
		);
	const transport = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (input: Parameters<typeof fetch>[0]) => {
				const path = new URL(String(input)).pathname;
				visits.push(path);
				if (path.endsWith("/abort")) {
					aborts++;
					return Response.json(true);
				}
				if (path === "/session/ses_root/command") return Response.json({});
				if (path === "/session/ses_root/message")
					return Response.json(rootMessages());
				if (path === "/session/ses_root")
					return Response.json({ id: "ses_root", directory: project });
				if (path === "/session/ses_root/children")
					return Response.json(
						mode === "tree-limit"
							? Array.from({ length: 128 }, (_, index) => ({
									...childMetadata,
									id: `ses_child_${index}`,
								}))
							: [childMetadata],
					);
				if (path === "/session/ses_child") return Response.json(childMetadata);
				if (
					path === "/session/ses_child/children" ||
					/\/session\/ses_child_\d+\/children/.test(path)
				)
					return Response.json([]);
				if (path === "/session/ses_child/message") {
					if (mode === "cancel-child") controller.abort(cancelled);
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
					{ request },
				]),
		}).catch((error: unknown) => error);
		return { result, now, aborts, visits, cancelled };
	} finally {
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

for (const mode of ["wedged", "wrong-parent", "wrong-directory"] as const) {
	test(`${mode} child activity cannot extend a silent root task`, async () => {
		const observed = await observeWait(mode);
		expect(observed.result).toBeInstanceOf(Error);
		expect(String(observed.result)).toContain(
			"Scenario made no progress for 180000ms: wedged",
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
		"Scenario exceeded 1200000ms without going quiet: still working",
	);
	expect(observed.now).toBe(1_202_000);
	expect(observed.aborts).toBe(1);
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
