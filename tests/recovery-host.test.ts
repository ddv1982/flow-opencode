import { expect, test } from "bun:test";
import { RecoveryController } from "../src/application/recovery-policy.js";
import {
	AutoDriveCoordinator,
	type AutoDriveProjection,
	FLOW_AUTO_METADATA_KEY,
} from "../src/platform/opencode/auto-drive.js";

const delivery = {
	agent: "build",
	model: { providerID: "test", modelID: "manager" },
};
const unavailable = {
	async assess() {
		return { kind: "unavailable" as const, reason: "simulation" };
	},
};
test("fast recovery continuation receipt survives enqueue and advances to next feature", async () => {
	const recovery = new RecoveryController(unavailable);
	recovery.activate("host", { mode: "shadow", maxCalls: 2, maxUsd: 0.01 });
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
		prompt: async (host, _text, model, metadata) => {
			prompts++;
			await auto.observeMessage(
				host,
				model,
				[{ type: "text", synthetic: true, metadata }],
				`continuation-${prompts}`,
			);
			auto.observeHostMessage(host, {
				id: `assistant-${prompts}`,
				role: "assistant",
				parentID: `continuation-${prompts}`,
			});
		},
	});
	const metadata = await auto.activate("host");
	await auto.observeMessage(
		"host",
		delivery,
		[{ type: "text", synthetic: true, metadata }],
		"initial",
	);
	await auto.onIdle("host");
	expect(prompts).toBe(1);
	projection = {
		sessionId: "flow",
		status: "ready",
		revision: 14,
		nextAction: "flow_run_start",
	};
	auto.observeMutation("host", 14, undefined, "assistant-1", false);
	await auto.onIdle("host");
	expect(prompts).toBe(2);
	expect(auto.compactionContext("host")).not.toBeNull();
});
test("recovery never overrides unowned-session stop and prompt failure revokes", async () => {
	for (const fault of ["replacement", "prompt"]) {
		const recovery = new RecoveryController(unavailable);
		recovery.activate("host", { mode: "shadow", maxCalls: 2, maxUsd: 0.01 });
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
			prompt: async () => {
				prompts++;
				throw new Error("host unavailable");
			},
		});
		const metadata = await auto.activate("host");
		expect(metadata[FLOW_AUTO_METADATA_KEY]).toBeDefined();
		await auto.observeMessage(
			"host",
			delivery,
			[{ type: "text", synthetic: true, metadata }],
			"initial",
		);
		if (fault === "replacement")
			projection = { ...projection, sessionId: "other" };
		await auto.onIdle("host");
		expect(prompts).toBe(fault === "replacement" ? 0 : 1);
		expect(recovery.snapshot()).toEqual({ mode: "off" });
	}
});

test("real command hook captures explicit shadow limits and stop revokes", async () => {
	const { createCommandHook } = await import(
		"../src/platform/opencode/command-hook.js"
	);
	const { createFlowService } = await import(
		"../src/application/flow-service.js"
	);
	const { MemorySessionRepository, deterministicEnvironment } = await import(
		"./runtime-test-support.js"
	);
	const recovery = new RecoveryController(unavailable);
	const flow = createFlowService(
		new MemorySessionRepository(),
		deterministicEnvironment(),
	);
	const auto = new AutoDriveCoordinator({
		recovery,
		readProjection: async () => ({
			status: "idle",
			revision: 0,
			nextAction: "flow_plan_save",
		}),
		prompt: async () => {
			throw new Error("not used");
		},
	});
	const visibleRefusals: string[] = [];
	const hook = createCommandHook({
		recovery,
		autoDrive: auto,
		flow,
		assertOperational() {},
		async showRefusal(message) {
			visibleRefusals.push(message);
		},
	});
	const output = { parts: [] } as Parameters<typeof hook>[1];
	await hook(
		{
			command: "flow-auto",
			sessionID: "host",
			arguments:
				"--recovery=shadow --recovery-calls=2 --recovery-usd=0.01 Fix parser",
		},
		output,
	);
	expect(recovery.snapshot()).toMatchObject({
		mode: "shadow",
		remainingCalls: 2,
		maxUsd: 0.01,
	});
	expect(JSON.stringify(output)).not.toContain("--recovery");
	expect(JSON.stringify(output)).toContain("Fix parser");
	await hook({ command: "flow-auto", sessionID: "host", arguments: "stop" }, {
		parts: [],
	} as Parameters<typeof hook>[1]);
	expect(recovery.snapshot()).toEqual({ mode: "off" });
	await expect(
		hook(
			{
				command: "flow-auto",
				sessionID: "host",
				arguments:
					"--recovery=delegated --recovery-calls=2 --recovery-usd=0.01 Fix parser",
			},
			{ parts: [] } as Parameters<typeof hook>[1],
		),
	).rejects.toThrow("No release-owned live qualification");
	expect(visibleRefusals).toHaveLength(1);
	expect(visibleRefusals[0]).toContain("Use shadow.");
	expect(recovery.snapshot()).toEqual({ mode: "off" });
});

test("configured auto defaults to bounded shadow and explicit off wins", async () => {
	const { createCommandHook } = await import(
		"../src/platform/opencode/command-hook.js"
	);
	const { createFlowService } = await import(
		"../src/application/flow-service.js"
	);
	const { MemorySessionRepository, deterministicEnvironment } = await import(
		"./runtime-test-support.js"
	);
	const recovery = new RecoveryController(unavailable);
	const auto = new AutoDriveCoordinator({
		recovery,
		readProjection: async () => ({
			status: "idle",
			revision: 0,
			nextAction: "flow_plan_save",
		}),
		prompt: async () => {},
	});
	let configured = true;
	const hook = createCommandHook({
		recovery,
		autoDrive: auto,
		flow: createFlowService(
			new MemorySessionRepository(),
			deterministicEnvironment(),
		),
		assertOperational() {},
		defaultRecovery: () =>
			configured ? { mode: "shadow", maxCalls: 6, maxUsd: 0.02 } : null,
	});
	const run = async (argumentsText: string) => {
		const output = { parts: [] } as Parameters<typeof hook>[1];
		await hook(
			{ command: "flow-auto", sessionID: "host", arguments: argumentsText },
			output,
		);
		return output;
	};
	const automatic = await run("Fix parser");
	expect(recovery.snapshot()).toMatchObject({
		mode: "shadow",
		remainingCalls: 6,
		maxUsd: 0.02,
	});
	expect(JSON.stringify(automatic)).toContain("Fix parser");
	expect(JSON.stringify(automatic)).not.toContain("--recovery");
	await run("--recovery=off Fix parser");
	expect(recovery.snapshot()).toEqual({ mode: "off" });
	const trailingOptOut = await run("Fix parser --recovery=off");
	expect(recovery.snapshot()).toEqual({ mode: "off" });
	expect(JSON.stringify(trailingOptOut)).toContain("Fix parser");
	expect(JSON.stringify(trailingOptOut)).not.toContain("--recovery");
	configured = false;
	await run("Fix parser");
	expect(recovery.snapshot()).toEqual({ mode: "off" });
	await run(
		"--recovery=shadow --recovery-calls=2 --recovery-usd=0.01 Fix parser",
	);
	expect(recovery.snapshot()).toMatchObject({
		mode: "shadow",
		remainingCalls: 2,
		maxUsd: 0.01,
	});
});

test("cross-host plain auto synchronously revokes the prior recovery invocation", async () => {
	const { createCommandHook } = await import(
		"../src/platform/opencode/command-hook.js"
	);
	const { createFlowService } = await import(
		"../src/application/flow-service.js"
	);
	const { MemorySessionRepository, deterministicEnvironment } = await import(
		"./runtime-test-support.js"
	);
	const recovery = new RecoveryController(unavailable);
	const flow = createFlowService(
		new MemorySessionRepository(),
		deterministicEnvironment(),
	);
	const auto = new AutoDriveCoordinator({
		recovery,
		readProjection: async () => ({
			status: "idle",
			revision: 0,
			nextAction: "flow_plan_save",
		}),
		prompt: async () => {},
	});
	const hook = createCommandHook({
		recovery,
		autoDrive: auto,
		flow,
		assertOperational() {},
	});
	const output = () => ({ parts: [] }) as Parameters<typeof hook>[1];
	await hook(
		{
			command: "flow-auto",
			sessionID: "A",
			arguments:
				"--recovery=shadow --recovery-calls=2 --recovery-usd=0.01 Goal",
		},
		output(),
	);
	expect(recovery.snapshot()).toMatchObject({ mode: "shadow" });
	const replacement = hook(
		{ command: "flow-auto", sessionID: "B", arguments: "Goal" },
		output(),
	);
	expect(recovery.snapshot()).toEqual({ mode: "off" });
	await replacement;
});

test("overlapping command setup cannot revive or revoke a newer invocation", async () => {
	const { createCommandHook } = await import(
		"../src/platform/opencode/command-hook.js"
	);
	const { createFlowService } = await import(
		"../src/application/flow-service.js"
	);
	const { MemorySessionRepository, deterministicEnvironment } = await import(
		"./runtime-test-support.js"
	);
	for (const waitAt of ["status", "anchor"]) {
		const base = createFlowService(
			new MemorySessionRepository(),
			deterministicEnvironment(),
		);
		let release: () => void = () => {};
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		let entered: () => void = () => {};
		const waiting = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const flow = {
			...base,
			status: async (input: unknown) => {
				if (waitAt === "status") {
					entered();
					await barrier;
				}
				return base.status(input);
			},
			requestAnchor: async () => {
				if (waitAt === "anchor") {
					entered();
					await barrier;
					throw new Error("old anchor failed");
				}
			},
		};
		const recovery = new RecoveryController(unavailable);
		const auto = new AutoDriveCoordinator({
			recovery,
			readProjection: async () => ({
				status: "idle",
				revision: 0,
				nextAction: "flow_plan_save",
			}),
			prompt: async () => {},
		});
		const hook = createCommandHook({
			recovery,
			autoDrive: auto,
			flow,
			assertOperational() {},
		});
		const output = () => ({ parts: [] }) as Parameters<typeof hook>[1];
		const old = hook(
			{
				command: "flow-auto",
				sessionID: "A",
				arguments:
					'--recovery=shadow --recovery-calls=2 --recovery-usd=0.01 Cover test named "old"',
			},
			output(),
		).then(
			() => null,
			(error) => error,
		);
		await waiting;
		await hook(
			{
				command: "flow-auto",
				sessionID: "A",
				arguments:
					"--recovery=shadow --recovery-calls=5 --recovery-usd=0.02 New goal",
			},
			output(),
		);
		release();
		expect((await old).message).toBe(
			waitAt === "anchor"
				? "old anchor failed"
				: "Flow command was superseded.",
		);
		expect(recovery.snapshot()).toMatchObject({
			mode: "shadow",
			remainingCalls: 5,
			maxUsd: 0.02,
		});
	}
});

test("same-host stop invalidates a pending request-anchor setup", async () => {
	const { createCommandHook } = await import(
		"../src/platform/opencode/command-hook.js"
	);
	const { createFlowService } = await import(
		"../src/application/flow-service.js"
	);
	const { MemorySessionRepository, deterministicEnvironment } = await import(
		"./runtime-test-support.js"
	);
	const base = createFlowService(
		new MemorySessionRepository(),
		deterministicEnvironment(),
	);
	let release: () => void = () => {};
	const barrier = new Promise<void>((resolve) => {
		release = resolve;
	});
	let entered: () => void = () => {};
	const waiting = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const flow = {
		...base,
		requestAnchor: async () => {
			entered();
			await barrier;
		},
	};
	const recovery = new RecoveryController(unavailable);
	const auto = new AutoDriveCoordinator({
		recovery,
		readProjection: async () => ({
			status: "idle",
			revision: 0,
			nextAction: "flow_plan_save",
		}),
		prompt: async () => {},
	});
	const hook = createCommandHook({
		recovery,
		autoDrive: auto,
		flow,
		assertOperational() {},
	});
	const output = () => ({ parts: [] }) as Parameters<typeof hook>[1];
	const old = hook(
		{
			command: "flow-auto",
			sessionID: "A",
			arguments:
				'--recovery=shadow --recovery-calls=2 --recovery-usd=0.01 Cover test named "old"',
		},
		output(),
	).then(
		() => null,
		(error) => error,
	);
	await waiting;
	await hook(
		{ command: "flow-auto", sessionID: "A", arguments: "stop" },
		output(),
	);
	release();
	expect(await old).toBeInstanceOf(Error);
	expect(recovery.snapshot()).toEqual({ mode: "off" });
	expect(auto.compactionContext("A")).toBeNull();
});

test("failed auto setup revokes its recovery lease", async () => {
	const { createCommandHook } = await import(
		"../src/platform/opencode/command-hook.js"
	);
	const { createFlowService } = await import(
		"../src/application/flow-service.js"
	);
	const { MemorySessionRepository, deterministicEnvironment } = await import(
		"./runtime-test-support.js"
	);
	const base = createFlowService(
		new MemorySessionRepository(),
		deterministicEnvironment(),
	);
	const recovery = new RecoveryController(unavailable);
	const auto = new AutoDriveCoordinator({
		recovery,
		readProjection: async () => ({
			status: "idle",
			revision: 0,
			nextAction: "flow_plan_save",
		}),
		prompt: async () => {},
	});
	const hook = createCommandHook({
		recovery,
		autoDrive: auto,
		flow: {
			...base,
			requestAnchor: async () => {
				throw new Error("anchor failed");
			},
		},
		assertOperational() {},
	});
	await expect(
		hook(
			{
				command: "flow-auto",
				sessionID: "host",
				arguments:
					'--recovery=shadow --recovery-calls=2 --recovery-usd=0.01 Cover test named "x"',
			},
			{ parts: [] } as Parameters<typeof hook>[1],
		),
	).rejects.toThrow("anchor failed");
	expect(recovery.snapshot()).toEqual({ mode: "off" });
});

test("shadow recovery prompt does not add a second handback at one checkpoint", async () => {
	const recovery = new RecoveryController(unavailable);
	recovery.activate("host", { mode: "shadow", maxCalls: 2, maxUsd: 0.01 });
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
		prompt: async (_host, prompt) => {
			prompts.push(prompt);
		},
	});
	const metadata = await auto.activate("host");
	await auto.observeMessage(
		"host",
		delivery,
		[{ type: "text", synthetic: true, metadata }],
		"initial",
	);
	await auto.onIdle("host");
	expect(prompts).toHaveLength(1);
	await auto.onIdle("host");
	expect(prompts).toHaveLength(1);
	revision = 11;
	await auto.onIdle("host");
	expect(prompts).toHaveLength(2);
	await auto.onIdle("host");
	expect(prompts).toHaveLength(2);
});

test("running state cannot trigger Jev even with a direction-shaped next action", async () => {
	const recovery = new RecoveryController(unavailable);
	recovery.activate("host", { mode: "shadow", maxCalls: 2, maxUsd: 0.01 });
	const prompts: string[] = [];
	const auto = new AutoDriveCoordinator({
		recovery,
		readProjection: async () => ({
			sessionId: "flow",
			status: "running",
			revision: 10,
			nextAction: "await-user-direction",
		}),
		prompt: async (_host, prompt) => {
			prompts.push(prompt);
		},
	});
	const metadata = await auto.activate("host");
	await auto.observeMessage(
		"host",
		delivery,
		[{ synthetic: true, metadata }],
		"initial",
	);
	await auto.onIdle("host");
	expect(prompts).toEqual([]);
	expect(recovery.snapshot("host")).toMatchObject({
		mode: "shadow",
		remainingCalls: 2,
		reservedUsd: 0,
	});
});

test("ordinary handback and flow-run keep one shadow lease for the next checkpoint", async () => {
	const { createCommandHook } = await import(
		"../src/platform/opencode/command-hook.js"
	);
	const { createFlowService } = await import(
		"../src/application/flow-service.js"
	);
	const { MemorySessionRepository, deterministicEnvironment } = await import(
		"./runtime-test-support.js"
	);
	let now = 0;
	let projection: AutoDriveProjection = {
		sessionId: "flow",
		status: "blocked",
		revision: 10,
		nextAction: "await-user-direction",
	};
	const prompts: string[] = [];
	const recovery = new RecoveryController(unavailable, { now: () => now });
	const auto = new AutoDriveCoordinator({
		recovery,
		readProjection: async () => projection,
		prompt: async (_host, prompt) => {
			prompts.push(prompt);
		},
	});
	const hook = createCommandHook({
		recovery,
		autoDrive: auto,
		flow: createFlowService(
			new MemorySessionRepository(),
			deterministicEnvironment(),
		),
		assertOperational() {},
	});
	const output = () => ({ parts: [] }) as Parameters<typeof hook>[1];
	const initial = output();
	await hook(
		{
			command: "flow-auto",
			sessionID: "host",
			arguments:
				"--recovery=shadow --recovery-calls=2 --recovery-usd=0.01 Fix parser",
		},
		initial,
	);
	const metadata = initial.parts.find(
		(part) => part.type === "text" && part.synthetic === true,
	);
	if (metadata?.type !== "text") throw new Error("missing auto metadata");
	await auto.observeMessage("host", delivery, [metadata], "initial");
	recovery.observeMessage("host", "initial", true);
	await auto.onIdle("host");
	expect(prompts).toHaveLength(1);
	expect(prompts[0]).toContain("recoveryProposal");

	await auto.observeMessage(
		"host",
		delivery,
		[{ text: "Continue this Flow task" }],
		"reply",
	);
	recovery.observeMessage("host", "reply", false);
	expect(recovery.snapshot("host")).toMatchObject({
		mode: "shadow",
		remainingCalls: 2,
		reservedUsd: 0,
		maxUsd: 0.01,
	});
	const inspected = output();
	await hook(
		{ command: "flow-status", sessionID: "host", arguments: "" },
		inspected,
	);
	await auto.observeMessage(
		"host",
		delivery,
		inspected.parts,
		"status-command",
	);
	recovery.observeMessage("host", "status-command", false);
	await auto.onIdle("host");
	expect(prompts).toHaveLength(1);
	now = 30 * 60 * 1000;
	const resumed = output();
	await hook(
		{
			command: "flow-run",
			sessionID: "host",
			arguments: "Continue parser repair",
		},
		resumed,
	);
	await auto.observeMessage("host", delivery, resumed.parts, "run-command");
	recovery.observeMessage("host", "run-command", false);
	auto.observeHostMessage("host", {
		id: "reset-assistant",
		role: "assistant",
		parentID: "run-command",
	});
	auto.observeMutation("host", 11, undefined, "reset-assistant", false);
	projection = {
		sessionId: "flow",
		status: "ready",
		revision: 11,
		nextAction: "flow_run_start",
	};
	const afterReset = output();
	await hook(
		{ command: "flow-status", sessionID: "host", arguments: "" },
		afterReset,
	);
	await auto.observeMessage("host", delivery, afterReset.parts, "ready-status");
	recovery.observeMessage("host", "ready-status", false);
	await auto.onIdle("host");
	expect(prompts).toHaveLength(1);
	projection = {
		sessionId: "flow",
		status: "running",
		revision: 12,
		nextAction: "dispatch-flow-reviewer",
	};
	const afterRun = output();
	await hook(
		{
			command: "flow-run",
			sessionID: "host",
			arguments: "Review parser repair",
		},
		afterRun,
	);
	await auto.observeMessage(
		"host",
		delivery,
		afterRun.parts,
		"running-command",
	);
	recovery.observeMessage("host", "running-command", false);
	await auto.onIdle("host");
	expect(prompts).toHaveLength(1);
	projection = {
		sessionId: "flow",
		status: "blocked",
		revision: 13,
		nextAction: "await-user-direction",
	};
	await auto.onIdle("host");
	expect(prompts).toHaveLength(2);
	expect(prompts[1]).toContain("recoveryProposal");
	expect(recovery.snapshot("host")).toMatchObject({
		mode: "shadow",
		remainingCalls: 2,
		reservedUsd: 0,
		maxUsd: 0.01,
	});
	now = 60 * 60 * 1000;
	expect(
		recovery.proposalPrompt("host", "flow", 12, "await-user-direction"),
	).toBeNull();
	expect(recovery.snapshot("host")).toEqual({ mode: "off" });
});
