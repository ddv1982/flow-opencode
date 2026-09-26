import { expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type EpisodeQuestion,
	submitEpisodeReply,
} from "../evals/recovery-decisions/episode-operator.js";
import {
	type EpisodeDriver,
	recoverEpisodeJournal,
	runEpisode,
} from "../evals/recovery-decisions/episode-runner.js";
import { datasetDigest } from "../evals/recovery-decisions/schema.js";
import {
	awaitQuestion,
	operatorRegistration,
} from "./recovery-operator-support.js";

const question: EpisodeQuestion = {
	sessionId: "session-one",
	calls: [
		{
			messageId: "message-one",
			callId: "call-one",
			input: {
				questions: [
					{ question: "Which output?", header: "Output", options: [] },
				],
			},
		},
	],
};
async function fixture(
	waits = 1,
	maxInterventions = 2,
	inputQuestion = question,
) {
	const root = await mkdtemp(join(tmpdir(), "episode-operator-"));
	const directory = join(root, "run");
	const answers: string[] = [];
	const controller = new AbortController();
	const driver: EpisodeDriver = {
		origin: "simulation",
		harnessDigest: datasetDigest("operator-driver"),
		operatorPolicy: { kind: "file-mailbox-v1", maxInterventions },
		async prepare() {
			return { task: "task", initialState: "before" };
		},
		async run(context) {
			for (let i = 0; i < waits; i++)
				answers.push(await context.waitForOperator(inputQuestion));
		},
		async evaluate() {
			return { met: true, evidence: "completed" };
		},
		async stop() {},
	};
	const registration = await operatorRegistration(driver, {
		task: "task",
		initialState: "before",
		completionCriteria: "done",
	});
	const pending = runEpisode({
		registration,
		episodeId: "one",
		arm: "manager-only",
		outputDirectory: directory,
		recordedBy: "test",
		origin: "simulation",
		driver,
		signal: controller.signal,
	});
	return { root, directory, answers, controller, registration, pending };
}
const reply = (
	requestDigest: string,
	text = "  Preserve this exact answer.\n",
) => ({
	requestDigest,
	text,
	recordedBy: "simulation-operator",
	attribution: "unverified",
});

test("mailbox resumes repeated waits with exact inline evidence and rejects stale duplicate replies", async () => {
	const f = await fixture(2);
	try {
		const first = await awaitQuestion(f.directory, AbortSignal.timeout(2000));
		await expect(
			submitEpisodeReply(f.directory, reply("0".repeat(64))),
		).rejects.toThrow("another wait");
		await submitEpisodeReply(f.directory, reply(first.digest));
		await expect(
			submitEpisodeReply(f.directory, reply(first.digest)),
		).rejects.toThrow();
		let second = first;
		while (second.digest === first.digest) {
			await Bun.sleep(10);
			second = await awaitQuestion(f.directory, AbortSignal.timeout(2000));
		}
		await expect(
			submitEpisodeReply(f.directory, reply(first.digest)),
		).rejects.toThrow("another wait");
		await submitEpisodeReply(
			f.directory,
			reply(second.digest, "Second answer"),
		);
		const result = await f.pending;
		if (!result) throw new Error("Missing result");
		expect(f.answers).toEqual([
			"  Preserve this exact answer.\n",
			"Second answer",
		]);
		expect(result?.observation.interruptions).toBe(2);
		expect(result?.receipt.events.map((event) => event.kind)).toEqual([
			"start",
			"wait-start",
			"intervention",
			"wait-end",
			"wait-start",
			"intervention",
			"wait-end",
			"terminal",
		]);
		expect(await recoverEpisodeJournal(f.registration, f.directory)).toEqual(
			result,
		);
		await expect(
			submitEpisodeReply(f.directory, reply(second.digest)),
		).rejects.toThrow("No current");
	} finally {
		f.controller.abort();
		await f.pending;
		await rm(f.root, { recursive: true, force: true });
	}
});

test("cancellation and intervention cap do not accept or return a late reply", async () => {
	const f = await fixture(2, 1);
	try {
		const first = await awaitQuestion(f.directory, AbortSignal.timeout(2000));
		await submitEpisodeReply(f.directory, reply(first.digest));
		while (f.answers.length !== 1) await Bun.sleep(10);
		f.controller.abort();
		const result = await f.pending;
		expect(f.answers).toHaveLength(1);
		expect(result?.observation.result).toEqual({
			kind: "terminal",
			outcome: "cancelled",
		});
		expect(result?.observation.interruptions).toBe(1);
		expect(
			result?.receipt.events.filter((event) => event.kind === "wait-start"),
		).toHaveLength(2);
		await expect(
			submitEpisodeReply(f.directory, reply(first.digest)),
		).rejects.toThrow();
	} finally {
		f.controller.abort();
		await f.pending;
		await rm(f.root, { recursive: true, force: true });
	}
});

for (const kind of ["malformed", "oversized", "symlink", "stale"] as const)
	test(`mailbox ${kind} reply cannot continue`, async () => {
		const f = await fixture();
		try {
			const current = await awaitQuestion(
				f.directory,
				AbortSignal.timeout(2000),
			);
			const path = join(
				f.directory,
				"operator",
				"replies",
				`${current.digest}.json`,
			);
			if (kind === "symlink") {
				const target = join(f.root, "input");
				await writeFile(target, JSON.stringify(reply(current.digest)));
				await symlink(target, path);
			} else
				await writeFile(
					path,
					kind === "malformed"
						? "{"
						: kind === "oversized"
							? "x".repeat(1000001)
							: JSON.stringify(reply("0".repeat(64))),
				);
			const result = await f.pending;
			if (!result) throw new Error("Missing result");
			expect(f.answers).toEqual([]);
			expect(result?.observation.result.kind).toBe("unavailable");
			expect(result?.receipt.events.map((event) => event.kind)).toEqual([
				"start",
				"wait-start",
			]);
		} finally {
			f.controller.abort();
			await f.pending;
			await rm(f.root, { recursive: true, force: true });
		}
	});

test("journal failure before intervention prevents continuation", async () => {
	const f = await fixture();
	try {
		const current = await awaitQuestion(f.directory, AbortSignal.timeout(2000));
		await mkdir(join(f.directory, "events", "000002.json"));
		await writeFile(
			join(f.directory, "operator", "replies", `${current.digest}.json`),
			JSON.stringify(reply(current.digest)),
		);
		await expect(f.pending).rejects.toThrow();
		expect(f.answers).toEqual([]);
		const status = JSON.parse(
			await readFile(join(f.directory, "status.json"), "utf8"),
		);
		expect(status.persistenceFailed).toBe(true);
	} finally {
		f.controller.abort();
		await f.pending.catch(() => {});
		await rm(f.root, { recursive: true, force: true });
	}
});

test("bound receipts reject stale mixed duplicate and unfinished successful waits", async () => {
	const f = await fixture();
	try {
		const current = await awaitQuestion(f.directory, AbortSignal.timeout(2000));
		await submitEpisodeReply(f.directory, reply(current.digest));
		const result = await f.pending;
		if (!result) throw new Error("Missing receipt");
		const { reduceEpisodeReceipt } = await import(
			"../evals/recovery-decisions/episode-receipts.js"
		);
		const events = result.receipt.events;
		const start = events[1],
			intervention = events[2],
			end = events[3],
			terminal = events[4];
		if (
			start?.kind !== "wait-start" ||
			intervention?.kind !== "intervention" ||
			end?.kind !== "wait-end" ||
			terminal?.kind !== "terminal"
		)
			throw new Error("Missing wait evidence");
		for (const invalid of [
			[events[0], start, intervention, intervention, end, terminal],
			[
				events[0],
				start,
				{ kind: "intervention", atMs: intervention.atMs },
				end,
				terminal,
			],
			[
				events[0],
				start,
				intervention,
				{ kind: "wait-end", atMs: end.atMs },
				terminal,
			],
			[
				events[0],
				start,
				intervention,
				{ ...end, requestDigest: "0".repeat(64) },
				terminal,
			],
			[events[0], start, intervention, terminal],
			[
				events[0],
				{
					...start,
					request: { ...start.request, headerDigest: "0".repeat(64) },
				},
				intervention,
				end,
				terminal,
			],
			[
				events[0],
				{ kind: "wait-start", atMs: start.atMs },
				intervention,
				end,
				terminal,
			],
		])
			await expect(
				reduceEpisodeReceipt(f.registration, {
					...result.receipt,
					events: invalid,
				}),
			).rejects.toThrow();
	} finally {
		f.controller.abort();
		await f.pending;
		await rm(f.root, { recursive: true, force: true });
	}
});

test("bounded nested questions remain readable after private JSON formatting", async () => {
	const nested = {
		sessionId: "session",
		calls: [
			{
				messageId: "message",
				callId: "call",
				input: {
					questions: Array.from({ length: 10 }, () => ({
						question: "Choose",
						header: "Choice",
						options: Array.from({ length: 100 }, () => ({
							label: "x",
							description: "y",
						})),
					})),
				},
			},
		],
	};
	const f = await fixture(1, 1, nested);
	try {
		const current = await awaitQuestion(f.directory, AbortSignal.timeout(2000));
		expect(current.request.question).toEqual(nested);
		expect(
			(
				await readFile(
					join(f.directory, "operator", "requests", `${current.digest}.json`),
				)
			).length,
		).toBeGreaterThan(100000);
		await submitEpisodeReply(f.directory, reply(current.digest));
		expect((await f.pending)?.observation.result).toEqual({
			kind: "terminal",
			outcome: "completed",
		});
	} finally {
		f.controller.abort();
		await f.pending;
		await rm(f.root, { recursive: true, force: true });
	}
});
