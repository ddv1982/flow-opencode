import { describe, expect, test } from "bun:test";
import {
	AutoDriveCoordinator,
	type AutoDriveDelivery,
	type AutoDriveProjection,
	FLOW_AUTO_METADATA_KEY,
} from "../src/platform/opencode/auto-drive.js";

const DELIVERY: AutoDriveDelivery = {
	agent: "build",
	model: { providerID: "provider", modelID: "model" },
};

function harness(initial: AutoDriveProjection) {
	let projection = initial;
	let now = 0;
	let token = 0;
	const prompts: Array<{
		text: string;
		delivery: AutoDriveDelivery;
		metadata: Readonly<Record<string, unknown>>;
	}> = [];
	const warnings: string[] = [];
	const driver = new AutoDriveCoordinator({
		readProjection: () => Promise.resolve(projection),
		prompt: (_sessionID, text, delivery, metadata) => {
			prompts.push({ text, delivery, metadata });
			return Promise.resolve();
		},
		onWarning: (message) => warnings.push(message),
		createToken: () => `token-${++token}`,
		now: () => now,
	});
	return {
		driver,
		prompts,
		warnings,
		async activate(sessionID = "host-1", delivery = DELIVERY) {
			const metadata = await driver.activate(sessionID);
			await driver.observeMessage(sessionID, delivery, [
				{ synthetic: true, metadata },
			]);
			return metadata;
		},
		setProjection(next: AutoDriveProjection) {
			projection = next;
		},
		setNow(next: number) {
			now = next;
		},
	};
}

describe("Flow auto-drive coordinator", () => {
	test("continues ready work once and does not reprompt an unchanged revision", async () => {
		const state = harness({
			sessionId: "flow-1",
			status: "ready",
			revision: 11,
			nextAction: "flow_run_start",
		});
		await state.activate();
		state.setProjection({
			sessionId: "flow-1",
			status: "ready",
			revision: 12,
			nextAction: "flow_run_start",
		});
		state.setNow(25);

		await state.driver.onIdle("host-1");
		expect(state.prompts).toHaveLength(1);
		expect(state.prompts[0]).toMatchObject({
			delivery: DELIVERY,
			metadata: { [FLOW_AUTO_METADATA_KEY]: "token-1" },
		});
		expect(state.prompts[0]?.text).toContain("revision 12");

		await state.driver.onIdle("host-1");
		expect(state.prompts).toHaveLength(1);
		expect(state.warnings.at(-1)).toContain("made no lifecycle progress");
		expect(state.driver.compactionContext("host-1")).not.toBeNull();
		state.setNow(1_000);
		expect(state.driver.timingSnapshot()).toMatchObject({
			state: "paused",
			activeMs: 25,
			waitingForUserMs: 0,
		});
	});

	test("separates an overnight checkpoint and resumes after durable progress", async () => {
		const state = harness({
			sessionId: "flow-1",
			status: "blocked",
			revision: 20,
			nextAction: "await-user-direction",
		});
		await state.activate();
		state.setNow(10);
		await state.driver.onIdle("host-1");

		state.setNow(21_600_010);
		expect(state.driver.timingSnapshot()).toMatchObject({
			state: "waiting-for-user",
			activeMs: 10,
			waitingForUserMs: 21_600_000,
			pausedTimeExcluded: true,
		});

		const resumedDelivery: AutoDriveDelivery = {
			agent: "build-resumed",
			model: { providerID: "provider", modelID: "new-model" },
		};
		await state.driver.observeMessage("host-1", resumedDelivery, [
			{ synthetic: false },
		]);
		state.setProjection({
			sessionId: "flow-1",
			status: "ready",
			revision: 21,
			nextAction: "flow_run_start",
		});
		state.setNow(21_600_015);
		await state.driver.onIdle("host-1");

		expect(state.prompts).toHaveLength(1);
		expect(state.prompts[0]?.delivery).toEqual(resumedDelivery);
		expect(state.driver.timingSnapshot()).toMatchObject({
			state: "active",
			activeMs: 15,
			waitingForUserMs: 21_600_000,
		});
	});

	test("requires lifecycle progress after the checkpoint reply", async () => {
		const state = harness({
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		});
		await state.activate();
		await state.driver.onIdle("host-1");
		state.setProjection({
			sessionId: "flow-1",
			status: "ready",
			revision: 5,
			nextAction: "flow_run_start",
		});
		await state.driver.observeMessage("host-1", DELIVERY, [
			{ synthetic: false },
		]);
		await state.driver.onIdle("host-1");

		expect(state.prompts).toHaveLength(0);
		expect(state.driver.compactionContext("host-1")).toBeNull();
	});

	test("excludes paused time and resets timing for a new invocation", async () => {
		const state = harness({
			sessionId: "flow-1",
			status: "running",
			revision: 3,
			nextAction: "flow_validation_start",
		});
		await state.activate();
		state.setProjection({
			sessionId: "flow-1",
			status: "running",
			revision: 4,
			nextAction: "flow_validation_start",
		});
		state.setNow(8);
		await state.driver.onIdle("host-1");
		state.setNow(1_000);
		expect(state.driver.timingSnapshot()).toMatchObject({
			state: "inactive",
			activeMs: 8,
			waitingForUserMs: 0,
		});

		await state.activate();
		expect(state.driver.timingSnapshot()).toMatchObject({
			state: "active",
			activeMs: 0,
			waitingForUserMs: 0,
		});
	});

	test("routes only mechanical start and close states", async () => {
		const cases: Array<[AutoDriveProjection, boolean]> = [
			[
				{
					sessionId: "flow-1",
					status: "ready",
					revision: 1,
					nextAction: "flow_run_start",
				},
				true,
			],
			[
				{
					sessionId: "flow-1",
					status: "completed",
					revision: 2,
					nextAction: "flow_session_close",
				},
				true,
			],
			[
				{
					sessionId: "flow-1",
					status: "closed",
					revision: 3,
					nextAction: "flow_session_close",
				},
				true,
			],
			[
				{
					sessionId: "flow-1",
					status: "planning",
					revision: 4,
					nextAction: "flow_plan_approve",
				},
				false,
			],
			[
				{
					sessionId: "flow-1",
					status: "running",
					revision: 5,
					nextAction: "flow_validation_start",
				},
				false,
			],
			[
				{
					sessionId: "flow-1",
					status: "blocked",
					revision: 6,
					nextAction: "await-user-direction",
				},
				false,
			],
			[{ status: "idle", revision: 0, nextAction: "flow_plan_save" }, false],
		];

		for (const [projection, shouldPrompt] of cases) {
			const baseline =
				projection.status === "idle" ||
				projection.nextAction === "flow_plan_approve" ||
				projection.nextAction === "await-user-direction"
					? projection
					: { ...projection, revision: projection.revision - 1 };
			const state = harness(baseline);
			await state.activate();
			state.setProjection(projection);
			await state.driver.onIdle("host-1");
			expect(state.prompts.length > 0).toBe(shouldPrompt);
		}
	});

	test("requires initiating progress and rejects a replacement Flow session", async () => {
		const unchanged = harness({
			sessionId: "flow-1",
			status: "ready",
			revision: 1,
			nextAction: "flow_run_start",
		});
		await unchanged.activate();
		await unchanged.driver.onIdle("host-1");
		expect(unchanged.prompts).toHaveLength(0);
		expect(unchanged.driver.compactionContext("host-1")).toBeNull();

		const created = harness({
			status: "idle",
			revision: 0,
			nextAction: "flow_plan_save",
		});
		await created.activate();
		created.setProjection({
			sessionId: "flow-new",
			status: "ready",
			revision: 2,
			nextAction: "flow_run_start",
		});
		await created.driver.onIdle("host-1");
		expect(created.prompts).toHaveLength(1);

		const replaced = harness({
			sessionId: "flow-old",
			status: "ready",
			revision: 1,
			nextAction: "flow_run_start",
		});
		await replaced.activate();
		replaced.setProjection({
			sessionId: "flow-new",
			status: "ready",
			revision: 2,
			nextAction: "flow_run_start",
		});
		await replaced.driver.onIdle("host-1");
		expect(replaced.driver.compactionContext("host-1")).toBeNull();
	});

	test("preserves a fast reply only when the pending read finds a checkpoint", async () => {
		let projection: AutoDriveProjection = {
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		};
		let resolvePending: ((projection: AutoDriveProjection) => void) | undefined;
		let reads = 0;
		const prompts: AutoDriveDelivery[] = [];
		const driver = new AutoDriveCoordinator({
			readProjection: () => {
				if (++reads === 2) {
					return new Promise((resolve) => {
						resolvePending = resolve;
					});
				}
				return Promise.resolve(projection);
			},
			prompt: (_sessionID, _prompt, delivery) => {
				prompts.push(delivery);
				return Promise.resolve();
			},
			createToken: () => "token",
		});
		const metadata = await driver.activate("host-1");
		await driver.observeMessage("host-1", DELIVERY, [
			{ synthetic: true, metadata },
		]);

		const idle = driver.onIdle("host-1");
		const replyDelivery = {
			agent: "resumed",
			model: { providerID: "provider", modelID: "new-model" },
		};
		await driver.observeMessage("host-1", replyDelivery, [
			{ synthetic: false },
		]);
		resolvePending?.(projection);
		await idle;
		expect(driver.compactionContext("host-1")).not.toBeNull();

		projection = {
			sessionId: "flow-1",
			status: "ready",
			revision: 5,
			nextAction: "flow_run_start",
		};
		await driver.onIdle("host-1");
		expect(prompts).toEqual([replyDelivery]);
	});

	test("a real user message interrupts, including during a status read", async () => {
		let resolveProjection:
			| ((projection: AutoDriveProjection) => void)
			| undefined;
		const prompts: string[] = [];
		let reads = 0;
		const driver = new AutoDriveCoordinator({
			readProjection: () => {
				if (++reads === 1) {
					return Promise.resolve({
						sessionId: "flow-1",
						status: "ready",
						revision: 1,
						nextAction: "flow_run_start",
					});
				}
				return new Promise((resolve) => {
					resolveProjection = resolve;
				});
			},
			prompt: (_sessionID, prompt) => {
				prompts.push(prompt);
				return Promise.resolve();
			},
			createToken: () => "token",
		});
		await driver.activate("host-1");
		await driver.observeMessage("host-1", DELIVERY, [
			{
				synthetic: true,
				metadata: { [FLOW_AUTO_METADATA_KEY]: "token" },
			},
		]);

		const idle = driver.onIdle("host-1");
		await driver.observeMessage("host-1", DELIVERY, [{ synthetic: false }]);
		resolveProjection?.({
			sessionId: "flow-1",
			status: "ready",
			revision: 2,
			nextAction: "flow_run_start",
		});
		await idle;

		expect(prompts).toHaveLength(0);
		expect(driver.compactionContext("host-1")).toBeNull();
	});

	test("a user interruption during prompt enqueue cannot answer a future checkpoint", async () => {
		let projection: AutoDriveProjection = {
			sessionId: "flow-1",
			status: "ready",
			revision: 1,
			nextAction: "flow_run_start",
		};
		let promptCount = 0;
		let resolvePrompt: (() => void) | undefined;
		let markPromptStarted: (() => void) | undefined;
		const promptStarted = new Promise<void>((resolve) => {
			markPromptStarted = resolve;
		});
		const driver = new AutoDriveCoordinator({
			readProjection: () => Promise.resolve(projection),
			prompt: () => {
				promptCount += 1;
				markPromptStarted?.();
				return new Promise((resolve) => {
					resolvePrompt = resolve;
				});
			},
		});
		const metadata = await driver.activate("host-1");
		await driver.observeMessage("host-1", DELIVERY, [
			{ synthetic: true, metadata },
		]);
		projection = {
			sessionId: "flow-1",
			status: "ready",
			revision: 2,
			nextAction: "flow_run_start",
		};
		const idle = driver.onIdle("host-1");
		await promptStarted;
		await driver.observeMessage("host-1", DELIVERY, [{ synthetic: false }]);
		projection = {
			sessionId: "flow-1",
			status: "blocked",
			revision: 3,
			nextAction: "await-user-direction",
		};
		resolvePrompt?.();
		await idle;
		await driver.onIdle("host-1");

		expect(promptCount).toBe(1);
		expect(driver.compactionContext("host-1")).toBeNull();
	});

	test("an old rejected read cannot clear a newer same-host lease", async () => {
		let rejectOld: ((error: Error) => void) | undefined;
		let reads = 0;
		const driver = new AutoDriveCoordinator({
			readProjection: () => {
				reads += 1;
				if (reads === 2) {
					return new Promise((_resolve, reject) => {
						rejectOld = reject;
					});
				}
				return Promise.resolve({
					sessionId: `flow-${reads}`,
					status: "ready",
					revision: reads,
					nextAction: "flow_run_start",
				});
			},
			prompt: () => Promise.resolve(),
			createToken: () => `token-${reads}`,
		});
		await driver.activate("host-1");
		const oldIdle = driver.onIdle("host-1");
		const metadata = await driver.activate("host-1");
		await driver.observeMessage("host-1", DELIVERY, [
			{ synthetic: true, metadata },
		]);
		rejectOld?.(new Error("old status failure"));
		await oldIdle;

		expect(driver.compactionContext("host-1")).not.toBeNull();
	});

	test("overlapping baseline reads cannot revive an older activation", async () => {
		let resolveFirst: ((projection: AutoDriveProjection) => void) | undefined;
		let reads = 0;
		const driver = new AutoDriveCoordinator({
			readProjection: () => {
				if (++reads === 1) {
					return new Promise((resolve) => {
						resolveFirst = resolve;
					});
				}
				return Promise.resolve({
					sessionId: "flow-new",
					status: "ready",
					revision: 2,
					nextAction: "flow_run_start",
				});
			},
			prompt: () => Promise.resolve(),
		});
		const first = driver.activate("host-1");
		const second = await driver.activate("host-1");
		await driver.observeMessage("host-1", DELIVERY, [
			{ synthetic: true, metadata: second },
		]);
		resolveFirst?.({
			sessionId: "flow-old",
			status: "ready",
			revision: 1,
			nextAction: "flow_run_start",
		});

		await expect(first).rejects.toThrow("superseded");
		expect(driver.compactionContext("host-1")).not.toBeNull();
	});

	test("rejects stale internal messages and preserves a live lease through compaction", async () => {
		const state = harness({
			status: "ready",
			revision: 1,
			nextAction: "flow_run_start",
		});
		await state.activate();
		expect(state.driver.compactionContext("host-1")).toContain(
			"/flow-auto continuation",
		);
		expect(
			await state.driver.observeMessage("host-1", DELIVERY, [
				{
					synthetic: true,
					metadata: { [FLOW_AUTO_METADATA_KEY]: "stale" },
				},
			]),
		).toBe("stale-continuation");
	});

	test("fails closed on replacement state and status or prompt errors", async () => {
		const changed = harness({
			sessionId: "flow-1",
			status: "ready",
			revision: 0,
			nextAction: "flow_run_start",
		});
		await changed.activate();
		changed.setProjection({
			sessionId: "flow-1",
			status: "ready",
			revision: 1,
			nextAction: "flow_run_start",
		});
		await changed.driver.onIdle("host-1");
		changed.setProjection({
			sessionId: "flow-2",
			status: "ready",
			revision: 2,
			nextAction: "flow_run_start",
		});
		await changed.driver.onIdle("host-1");
		expect(changed.driver.compactionContext("host-1")).toBeNull();

		for (const failure of ["status", "prompt"] as const) {
			let reads = 0;
			const driver = new AutoDriveCoordinator({
				readProjection: () =>
					++reads > 1 && failure === "status"
						? Promise.reject(new Error("unavailable"))
						: Promise.resolve({
								sessionId: "flow-1",
								status: "ready",
								revision: reads,
								nextAction: "flow_run_start",
							}),
				prompt: () => Promise.reject(new Error("unavailable")),
				createToken: () => failure,
			});
			await driver.activate("host-1");
			await driver.observeMessage("host-1", DELIVERY, [
				{
					synthetic: true,
					metadata: { [FLOW_AUTO_METADATA_KEY]: failure },
				},
			]);
			await driver.onIdle("host-1");
			expect(driver.compactionContext("host-1")).toBeNull();
		}
	});
});
