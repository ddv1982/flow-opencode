import { afterEach, expect, test } from "bun:test";
import {
	createFlowService,
	type FlowService,
} from "../src/application/flow-service.js";
import { RecoveryController } from "../src/application/recovery-policy.js";
import {
	AutoDriveCoordinator,
	type AutoDriveProjection,
	FLOW_AUTO_METADATA_KEY,
} from "../src/platform/opencode/auto-drive.js";
import { continuationCommands } from "./fixtures/continuation-commands.js";
import {
	fixtureAutomaticPrompt,
	verifiedContinuationOrigin,
} from "./fixtures/verified-continuation-origin.js";
import {
	deterministicEnvironment,
	MemorySessionRepository,
} from "./runtime-test-support.js";

const delivery = {
	agent: "build",
	model: { providerID: "test", modelID: "manager" },
};
const unavailable = {
	async assess() {
		return { kind: "unavailable" as const, reason: "simulation" };
	},
};
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const dispose of cleanups.splice(0)) await dispose();
});
async function commandFixture(
	options: {
		flow?: FlowService;
		readProjection?: () => Promise<AutoDriveProjection>;
		defaultRecovery?: () => {
			mode: "shadow";
			maxCalls: number;
			maxUsd: number;
		} | null;
		now?: () => number;
	} = {},
) {
	let projection: AutoDriveProjection = {
		status: "idle",
		revision: 0,
		nextAction: "flow_plan_save",
	};
	const recovery = new RecoveryController(
		unavailable,
		options.now ? { now: options.now } : {},
	);
	const flow =
		options.flow ??
		createFlowService(
			new MemorySessionRepository(),
			deterministicEnvironment(),
		);
	const prompts: string[] = [];
	const auto = new AutoDriveCoordinator({
		recovery,
		readProjection: options.readProjection ?? (async () => projection),
		prompt: fixtureAutomaticPrompt(
			() => auto,
			async (_host, prompt) => {
				prompts.push(prompt);
			},
		),
	});
	const commands = await continuationCommands({
		autoDrive: auto,
		recovery,
		flow,
		...(options.defaultRecovery
			? { defaultRecovery: options.defaultRecovery }
			: {}),
	});
	cleanups.push(commands.dispose);
	return {
		auto,
		recovery,
		commands,
		prompts,
		setProjection(value: AutoDriveProjection) {
			projection = value;
		},
	};
}

test("fast recovery continuation receipt survives enqueue and advances to next feature", async () => {
	const recovery = new RecoveryController(unavailable);
	recovery.activate("ses_host", { mode: "shadow", maxCalls: 2, maxUsd: 0.01 });
	let projection: AutoDriveProjection = {
		sessionId: "flow",
		status: "blocked",
		revision: 10,
		nextAction: "await-user-direction",
	};
	let prompts = 0;
	const auto = new AutoDriveCoordinator({
		recovery,
		readProjection: async () => projection,
		prompt: fixtureAutomaticPrompt(
			() => auto,
			async (host, _text, model, metadata) => {
				prompts++;
				await auto.observeMessage(
					host,
					model,
					[{ type: "text", synthetic: true, metadata }],
					`msg_continuation-${prompts}`,
				);
				await verifiedContinuationOrigin(
					auto,
					host,
					`msg_continuation-${prompts}`,
					`msg_assistant-${prompts}`,
					model,
				);
			},
			true,
		),
	});
	const metadata = await auto.activate("ses_host");
	await auto.observeMessage(
		"ses_host",
		delivery,
		[{ type: "text", synthetic: true, metadata }],
		"msg_initial",
	);
	await auto.onIdle("ses_host");
	expect(prompts).toBe(1);
	projection = {
		sessionId: "flow",
		status: "ready",
		revision: 14,
		nextAction: "flow_run_start",
	};
	auto.observeMutation("ses_host", 14, undefined, "msg_assistant-1", false);
	await auto.onIdle("ses_host");
	expect(prompts).toBe(2);
	expect(auto.compactionContext("ses_host")).not.toBeNull();
});

test("recovery never overrides unowned-session stop and prompt failure revokes", async () => {
	for (const fault of ["replacement", "prompt"]) {
		const recovery = new RecoveryController(unavailable);
		recovery.activate("ses_host", {
			mode: "shadow",
			maxCalls: 2,
			maxUsd: 0.01,
		});
		let prompts = 0;
		let projection: AutoDriveProjection = {
			sessionId: "flow",
			status: "blocked",
			revision: 10,
			nextAction: "await-user-direction",
		};
		const auto = new AutoDriveCoordinator({
			recovery,
			readProjection: async () => projection,
			prompt: fixtureAutomaticPrompt(
				() => auto,
				async () => {
					prompts++;
					throw new Error("host unavailable");
				},
			),
		});
		const metadata = await auto.activate("ses_host");
		expect(metadata[FLOW_AUTO_METADATA_KEY]).toBeDefined();
		await auto.observeMessage(
			"ses_host",
			delivery,
			[{ type: "text", synthetic: true, metadata }],
			"msg_initial",
		);
		if (fault === "replacement")
			projection = { ...projection, sessionId: "other" };
		await auto.onIdle("ses_host");
		expect(prompts).toBe(fault === "replacement" ? 0 : 1);
		expect(recovery.snapshot()).toMatchObject({ mode: "off" });
	}
});

test("shadow recovery prompt does not add a second handback at one checkpoint", async () => {
	const recovery = new RecoveryController(unavailable);
	recovery.activate("ses_host", { mode: "shadow", maxCalls: 2, maxUsd: 0.01 });
	const prompts: string[] = [];
	let revision = 10;
	const auto = new AutoDriveCoordinator({
		recovery,
		readProjection: async () => ({
			sessionId: "flow",
			status: "blocked",
			revision,
			nextAction: "await-user-direction",
		}),
		prompt: fixtureAutomaticPrompt(
			() => auto,
			async (_host, prompt) => {
				prompts.push(prompt);
			},
		),
	});
	const metadata = await auto.activate("ses_host");
	await auto.observeMessage(
		"ses_host",
		delivery,
		[{ type: "text", synthetic: true, metadata }],
		"msg_initial",
	);
	await auto.onIdle("ses_host");
	expect(prompts).toHaveLength(1);
	await auto.onIdle("ses_host");
	expect(prompts).toHaveLength(1);
	revision = 11;
	await auto.onIdle("ses_host");
	expect(prompts).toHaveLength(2);
	await auto.onIdle("ses_host");
	expect(prompts).toHaveLength(2);
});

test("running state cannot trigger Jev even with a direction-shaped next action", async () => {
	const recovery = new RecoveryController(unavailable);
	recovery.activate("ses_host", { mode: "shadow", maxCalls: 2, maxUsd: 0.01 });
	const prompts: string[] = [];
	const auto = new AutoDriveCoordinator({
		recovery,
		readProjection: async () => ({
			sessionId: "flow",
			status: "running",
			revision: 10,
			nextAction: "await-user-direction",
		}),
		prompt: fixtureAutomaticPrompt(
			() => auto,
			async (_host, prompt) => {
				prompts.push(prompt);
			},
		),
	});
	const metadata = await auto.activate("ses_host");
	await auto.observeMessage(
		"ses_host",
		delivery,
		[{ synthetic: true, metadata }],
		"msg_initial",
	);
	await auto.onIdle("ses_host");
	expect(prompts).toEqual([]);
	expect(recovery.snapshot("ses_host")).toMatchObject({
		mode: "shadow",
		remainingCalls: 2,
		reservedUsd: 0,
	});
});

test("accepted native command captures explicit shadow limits and stop revokes", async () => {
	const f = await commandFixture();
	const accepted = await f.commands.execute(
		"flow-auto",
		"--recovery=shadow --recovery-calls=2 --recovery-usd=0.01 Fix parser",
	);
	expect(f.recovery.snapshot()).toMatchObject({
		mode: "shadow",
		remainingCalls: 2,
		maxUsd: 0.01,
	});
	expect(accepted.text.split("\n")[0]).toBe("Flow flow-auto: Fix parser");
	expect(accepted.text).not.toContain("--recovery");
	await f.commands.execute("flow-auto", "stop");
	expect(f.recovery.snapshot()).toMatchObject({ mode: "off" });
	await expect(
		f.commands.execute(
			"flow-auto",
			"--recovery=delegated --recovery-calls=2 --recovery-usd=0.01 Fix parser",
		),
	).rejects.toThrow("No release-owned live qualification");
	expect(f.recovery.snapshot()).toMatchObject({ mode: "off" });
});

test("configured auto defaults to bounded shadow and explicit off wins", async () => {
	let configured = true;
	const f = await commandFixture({
		defaultRecovery: () =>
			configured ? { mode: "shadow", maxCalls: 6, maxUsd: 0.02 } : null,
	});
	const initial = await f.commands.execute("flow-auto", "Fix parser");
	expect(f.recovery.snapshot()).toMatchObject({
		mode: "shadow",
		remainingCalls: 6,
		maxUsd: 0.02,
	});
	expect(initial.text.split("\n")[0]).toBe("Flow flow-auto: Fix parser");
	await f.commands.execute("flow-auto", "--recovery=off Fix parser");
	expect(f.recovery.snapshot()).toMatchObject({ mode: "off" });
	const trailing = await f.commands.execute(
		"flow-auto",
		"Fix parser --recovery=off",
	);
	expect(f.recovery.snapshot()).toMatchObject({ mode: "off" });
	expect(trailing.text.split("\n")[0]).toBe("Flow flow-auto: Fix parser");
	expect(trailing.text).not.toContain("--recovery");
	configured = false;
	await f.commands.execute("flow-auto", "Fix parser");
	expect(f.recovery.snapshot()).toMatchObject({ mode: "off" });
	await f.commands.execute(
		"flow-auto",
		"--recovery=shadow --recovery-calls=2 --recovery-usd=0.01 Fix parser",
	);
	expect(f.recovery.snapshot()).toMatchObject({
		mode: "shadow",
		remainingCalls: 2,
		maxUsd: 0.01,
	});
});

test("accepted cross-host plain auto revokes the prior recovery invocation", async () => {
	const f = await commandFixture();
	await f.commands.execute(
		"flow-auto",
		"--recovery=shadow --recovery-calls=2 --recovery-usd=0.01 Goal",
		"ses_A",
	);
	expect(f.recovery.snapshot()).toMatchObject({ mode: "shadow" });
	await f.commands.execute("flow-auto", "Goal", "ses_B");
	expect(f.recovery.snapshot()).toMatchObject({
		mode: "off",
		automation: { active: true },
	});
});

test("overlapping accepted command setup cannot revive or revoke a newer invocation", async () => {
	for (const waitAt of ["status", "anchor"]) {
		const base = createFlowService(
			new MemorySessionRepository(),
			deterministicEnvironment(),
		);
		const barrier = Promise.withResolvers<void>();
		const waiting = Promise.withResolvers<void>();
		const flow: FlowService = {
			...base,
			status: async (input) => {
				if (waitAt === "status") {
					waiting.resolve();
					await barrier.promise;
				}
				return base.status(input);
			},
			requestAnchor: async () => {
				if (waitAt === "anchor") {
					waiting.resolve();
					await barrier.promise;
					throw new Error("old anchor failed");
				}
				return null;
			},
		};
		const f = await commandFixture({ flow });
		const old = f.commands
			.execute(
				"flow-auto",
				'--recovery=shadow --recovery-calls=2 --recovery-usd=0.01 Cover test named "old"',
				"ses_A",
			)
			.catch((error: unknown) => error);
		await waiting.promise;
		await f.commands.execute(
			"flow-auto",
			"--recovery=shadow --recovery-calls=5 --recovery-usd=0.02 New goal",
			"ses_A",
		);
		barrier.resolve();
		const failure = await old;
		expect(failure instanceof Error ? failure.message : "missing failure").toBe(
			waitAt === "anchor"
				? "old anchor failed"
				: "Flow execution epoch was revoked.",
		);
		expect(f.recovery.snapshot()).toMatchObject({
			mode: "shadow",
			remainingCalls: 5,
			maxUsd: 0.02,
		});
	}
});

test("same-host stop invalidates a pending request-anchor setup", async () => {
	const base = createFlowService(
		new MemorySessionRepository(),
		deterministicEnvironment(),
	);
	const barrier = Promise.withResolvers<void>();
	const waiting = Promise.withResolvers<void>();
	const f = await commandFixture({
		flow: {
			...base,
			requestAnchor: async () => {
				waiting.resolve();
				await barrier.promise;
				return null;
			},
		},
	});
	const old = f.commands
		.execute(
			"flow-auto",
			'--recovery=shadow --recovery-calls=2 --recovery-usd=0.01 Cover test named "old"',
		)
		.catch((error: unknown) => error);
	await waiting.promise;
	await f.commands.execute("flow-auto", "stop");
	barrier.resolve();
	const failure = await old;
	expect(failure instanceof Error ? failure.message : "missing failure").toBe(
		"Flow execution epoch was revoked.",
	);
	expect(f.recovery.snapshot()).toMatchObject({ mode: "off" });
	expect(f.auto.compactionContext("ses_host")).toBeNull();
});

test("failed accepted auto setup revokes its recovery lease", async () => {
	const base = createFlowService(
		new MemorySessionRepository(),
		deterministicEnvironment(),
	);
	const f = await commandFixture({
		flow: {
			...base,
			requestAnchor: async () => {
				throw new Error("anchor failed");
			},
		},
	});
	await expect(
		f.commands.execute(
			"flow-auto",
			'--recovery=shadow --recovery-calls=2 --recovery-usd=0.01 Cover test named "x"',
		),
	).rejects.toThrow("anchor failed");
	expect(f.recovery.snapshot()).toMatchObject({ mode: "off" });
});

test("ordinary handback and native flow-run keep one shadow lease for the next checkpoint", async () => {
	let now = 0;
	const f = await commandFixture({ now: () => now });
	f.setProjection({
		sessionId: "flow",
		status: "blocked",
		revision: 10,
		nextAction: "await-user-direction",
	});
	await f.commands.execute(
		"flow-auto",
		"--recovery=shadow --recovery-calls=2 --recovery-usd=0.01 Fix parser",
	);
	await f.auto.onIdle("ses_host");
	expect(f.prompts).toHaveLength(1);
	expect(f.prompts[0]).toContain("recoveryProposal");
	await f.auto.observeMessage(
		"ses_host",
		delivery,
		[{ text: "Continue this Flow task" }],
		"msg_reply",
	);
	f.recovery.observeMessage("ses_host", "msg_reply", false);
	expect(f.recovery.snapshot("ses_host")).toMatchObject({
		mode: "shadow",
		remainingCalls: 2,
		reservedUsd: 0,
		maxUsd: 0.01,
	});
	await f.commands.execute("flow-status", "");
	await f.auto.onIdle("ses_host");
	expect(f.prompts).toHaveLength(1);
	now = 30 * 60 * 1000;
	const resumed = await f.commands.execute(
		"flow-run",
		"Continue parser repair",
	);
	await verifiedContinuationOrigin(
		f.auto,
		"ses_host",
		resumed.id,
		"msg_reset_assistant",
	);
	f.auto.observeMutation(
		"ses_host",
		11,
		undefined,
		"msg_reset_assistant",
		false,
	);
	f.setProjection({
		sessionId: "flow",
		status: "ready",
		revision: 11,
		nextAction: "flow_run_start",
	});
	await f.commands.execute("flow-status", "");
	await f.auto.onIdle("ses_host");
	expect(f.prompts).toHaveLength(1);
	f.setProjection({
		sessionId: "flow",
		status: "running",
		revision: 12,
		nextAction: "dispatch-flow-reviewer",
	});
	await f.commands.execute("flow-run", "Review parser repair");
	await f.auto.onIdle("ses_host");
	expect(f.prompts).toHaveLength(1);
	f.setProjection({
		sessionId: "flow",
		status: "blocked",
		revision: 13,
		nextAction: "await-user-direction",
	});
	await f.auto.onIdle("ses_host");
	expect(f.prompts).toHaveLength(2);
	expect(f.prompts[1]).toContain("recoveryProposal");
	expect(f.recovery.snapshot("ses_host")).toMatchObject({
		mode: "shadow",
		remainingCalls: 2,
		reservedUsd: 0,
		maxUsd: 0.01,
	});
	now = 60 * 60 * 1000;
	expect(
		f.recovery.prepareProposalPrompt(
			"ses_host",
			"flow",
			12,
			"await-user-direction",
		),
	).toBeNull();
	expect(f.recovery.snapshot("ses_host")).toMatchObject({
		mode: "off",
		automation: { active: true },
		advice: { inactiveReason: "expired" },
	});
});
