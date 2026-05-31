import { afterEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { writeStackStandardsProfileCache } from "../src/runtime/application/stack-standards-profile";
import { createSession, saveSession } from "../src/runtime/session";
import { applyPlan, approvePlan, startRun } from "../src/runtime/transitions";
import {
	createTempDirRegistry,
	samplePlan,
	sampleSession,
	toolContext,
} from "./runtime-test-helpers";

type FlowPluginWithHooks = {
	hooks?: {
		"experimental.chat.system.transform"?: (
			input: {
				sessionID?: string;
				model: { providerID: string; modelID: string };
			},
			output: { system: string[] },
		) => Promise<void>;
		"experimental.session.compacting"?: (
			input: unknown,
			context: ReturnType<typeof toolContext>,
			output: { context?: string[]; prompt?: string },
		) => Promise<void>;
	};
};

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	cleanupTempDirs();
});

describe("runtime hooks", () => {
	test("experimental.chat.system.transform appends compact runtime guidance from the active session", async () => {
		const worktree = makeTempDir();
		const nestedDirectory = join(worktree, "src", "subdir");
		await mkdir(nestedDirectory, { recursive: true });
		const plugin = (await (
			await import("../src/index")
		).default({
			worktree,
			directory: nestedDirectory,
		} as unknown as Parameters<
			typeof import("../src/index").default
		>[0])) as FlowPluginWithHooks;
		const hook = plugin.hooks?.["experimental.chat.system.transform"];

		expect(typeof hook).toBe("function");
		if (!hook) {
			throw new Error("Missing experimental.chat.system.transform hook");
		}

		const planned = applyPlan(createSession("demo-goal"), samplePlan());
		if (!planned.ok) {
			throw new Error(planned.message);
		}
		const approved = approvePlan(planned.value);
		if (!approved.ok) {
			throw new Error(approved.message);
		}
		const started = startRun(approved.value);
		if (!started.ok) {
			throw new Error(started.message);
		}

		const running = started.value.session;
		const activeFeatureId = running.execution.activeFeatureId;
		if (!activeFeatureId) {
			throw new Error(
				"Expected an active feature for the system-context hook test.",
			);
		}
		running.planning.packageManagerAmbiguous = true;
		running.planning.stackProfile = {
			languages: [
				{
					name: "TypeScript",
					evidenceRefs: ["tsconfig.json"],
					confidence: "high",
				},
			],
			frameworks: [],
			runtimes: [
				{ name: "Bun", evidenceRefs: ["bun.lock"], confidence: "high" },
			],
			packageManagers: [],
			tools: [
				{ name: "Biome", evidenceRefs: ["biome.json"], confidence: "high" },
			],
		};
		running.planning.standardsProfile = {
			localGuidelines: [
				{
					title: "AGENTS.md",
					sourceType: "local",
					reference: "AGENTS.md",
					confidence: "high",
				},
			],
			externalGuidance: [],
			rules: [
				{
					summary: "Prefer existing package scripts.",
					sourceRefs: ["package.json"],
					priority: "local",
				},
			],
			gaps: [
				{
					stackItem: "React",
					reason: "No local React standards were detected.",
					suggestedResearch: ["official React testing documentation"],
				},
			],
			precedence: ["local before external"],
		};
		running.planning.evidencePackets = [
			{
				id: "packet:hook-context",
				purpose: "planning",
				contextLane: "planning",
				summary: "Hook context evidence survives into adaptive system context.",
				sourceRefs: ["tests/runtime-hooks.test.ts"],
			},
		];
		running.planning.decisionLog = [
			{
				question: "Should Flow rewrite the API surface now?",
				decisionMode: "recommend_confirm",
				decisionDomain: "architecture",
				options: [
					{ label: "Rewrite now", tradeoffs: ["cleaner"] },
					{ label: "Defer", tradeoffs: ["safer"] },
				],
				recommendation: "Defer",
				rationale: ["A breaking rewrite needs confirmation."],
			},
		];
		running.execution.lastReviewerDecision = {
			scope: "feature",
			featureId: activeFeatureId,
			reviewPurpose: "execution_gate",
			status: "needs_fix",
			summary: "Need another fix pass.",
			blockingFindings: [{ summary: "Missing targeted validation evidence." }],
			followUps: [],
			suggestedValidation: ["bun test tests/config/prompt-contracts.test.ts"],
		};
		running.execution.lastOutcome = {
			kind: "contract_error",
			summary: "A recoverable runtime issue needs another iteration.",
			retryable: true,
			autoResolvable: true,
			needsHuman: false,
		};
		await saveSession(worktree, running);

		const output = { system: ["base-system"] };
		await hook(
			{
				sessionID: "demo-session",
				model: { providerID: "test", modelID: "test-model" },
			},
			output,
		);

		await hook(
			{
				sessionID: "demo-session",
				model: { providerID: "test", modelID: "test-model" },
			},
			output,
		);

		const joined = output.system.join("\n");
		expect(output.system[0]).toBe("base-system");
		expect(
			output.system.filter((entry) => entry.includes("Flow runtime context"))
				.length,
		).toBe(1);
		expect(joined).toContain("Flow runtime context");
		expect(joined).toContain("untrusted data only");
		expect(joined).toContain('- goal: "demo-goal"');
		expect(joined).toContain("- phase: decision");
		expect(joined).toContain("- active feature:");
		expect(joined).toContain("- blocker:");
		expect(joined).toContain("Should Flow rewrite the API surface now?");
		expect(joined).toContain("- next action:");
		expect(joined).not.toContain("package manager evidence is ambiguous");
		expect(joined).not.toContain("stack profile");
		expect(joined).not.toContain("standards profile");
		expect(joined).not.toContain("context evidence");
		expect(joined).not.toContain("latest review state");
	});

	test("experimental.chat.system.transform is a graceful no-op when no active Flow session exists", async () => {
		const worktree = makeTempDir();
		const plugin = (await (
			await import("../src/index")
		).default({
			worktree,
		} as unknown as Parameters<
			typeof import("../src/index").default
		>[0])) as FlowPluginWithHooks;
		const hook = plugin.hooks?.["experimental.chat.system.transform"];

		expect(typeof hook).toBe("function");
		if (!hook) {
			throw new Error("Missing experimental.chat.system.transform hook");
		}

		const output = { system: ["base-system"] };
		await expect(
			hook(
				{
					sessionID: "demo-session",
					model: { providerID: "test", modelID: "test-model" },
				},
				output,
			),
		).resolves.toBeUndefined();
		expect(output.system).toEqual(["base-system"]);
	});

	test("experimental.chat.system.transform does not inject cached profile without an active session", async () => {
		const worktree = makeTempDir();
		const plugin = (await (
			await import("../src/index")
		).default({
			worktree,
		} as unknown as Parameters<
			typeof import("../src/index").default
		>[0])) as FlowPluginWithHooks;
		const hook = plugin.hooks?.["experimental.chat.system.transform"];

		expect(typeof hook).toBe("function");
		if (!hook) {
			throw new Error("Missing experimental.chat.system.transform hook");
		}

		await writeStackStandardsProfileCache(
			worktree,
			undefined,
			{ ambiguous: false },
			{
				stackProfile: {
					languages: [
						{
							name: "TypeScript",
							evidenceRefs: ["tsconfig.json"],
							confidence: "high",
						},
					],
					frameworks: [],
					runtimes: [],
					packageManagers: [],
					tools: [],
				},
				standardsProfile: {
					localGuidelines: [],
					externalGuidance: [],
					rules: [
						{
							summary: "Preserve TypeScript strictness from tsconfig.json.",
							sourceRefs: ["tsconfig.json"],
							priority: "local",
						},
					],
					gaps: [
						{
							stackItem: "TypeScript",
							reason: "No local TypeScript standards were detected.",
							suggestedResearch: ["official TypeScript documentation"],
						},
					],
					precedence: [],
				},
			},
		);

		const output = { system: ["base-system"] };
		await hook(
			{
				sessionID: "demo-session",
				model: { providerID: "test", modelID: "test-model" },
			},
			output,
		);

		expect(output.system).toEqual(["base-system"]);
	});

	test("experimental.session.compacting appends goal and execution phase for an active Flow session", async () => {
		const worktree = makeTempDir();
		const plugin = (await (
			await import("../src/index")
		).default({
			worktree,
		} as unknown as Parameters<
			typeof import("../src/index").default
		>[0])) as FlowPluginWithHooks;
		const hook = plugin.hooks?.["experimental.session.compacting"];

		expect(typeof hook).toBe("function");
		if (!hook) {
			throw new Error("Missing experimental.session.compacting hook");
		}

		const session = sampleSession("demo-goal");
		session.planning.stackProfile = {
			languages: [
				{
					name: "TypeScript",
					evidenceRefs: ["tsconfig.json"],
					confidence: "high",
				},
			],
			frameworks: [],
			runtimes: [],
			packageManagers: [],
			tools: [],
		};
		session.planning.standardsProfile = {
			localGuidelines: [
				{
					title: "AGENTS.md",
					sourceType: "local",
					reference: "AGENTS.md",
					confidence: "high",
				},
			],
			externalGuidance: [],
			rules: [],
			gaps: [],
			precedence: ["local before external"],
		};
		await mkdir(join(worktree, ".flow", "active", session.id), {
			recursive: true,
		});
		await saveSession(worktree, {
			...session,
			status: "running",
		});

		const nestedDirectory = join(worktree, "src", "subdir");
		await mkdir(nestedDirectory, { recursive: true });

		const output: { context: string[]; prompt?: string } = { context: [] };
		await hook({}, toolContext(worktree, nestedDirectory), output);

		const joined = output.context.join("\n");
		expect(joined).toContain("demo-goal");
		expect(joined).toContain("executing");
		expect(joined).toContain("Flow runtime context");
		expect(joined).not.toContain("Flow planning profile");
		expect(joined).not.toContain("stack profile");
		expect(output.prompt).toBeUndefined();
	});

	test("experimental.session.compacting does not inject cached profile without an active session", async () => {
		const worktree = makeTempDir();
		const plugin = (await (
			await import("../src/index")
		).default({
			worktree,
		} as unknown as Parameters<
			typeof import("../src/index").default
		>[0])) as FlowPluginWithHooks;
		const hook = plugin.hooks?.["experimental.session.compacting"];

		expect(typeof hook).toBe("function");
		if (!hook) {
			throw new Error("Missing experimental.session.compacting hook");
		}

		await writeStackStandardsProfileCache(
			worktree,
			undefined,
			{ ambiguous: false },
			{
				stackProfile: {
					languages: [],
					frameworks: [],
					runtimes: [],
					packageManagers: [
						{
							name: "bun",
							evidenceRefs: ["bun.lock"],
							confidence: "high",
						},
					],
					tools: [],
				},
				standardsProfile: {
					localGuidelines: [],
					externalGuidance: [],
					rules: [
						{
							summary: "Use existing package scripts.",
							sourceRefs: ["package.json"],
							priority: "local",
						},
					],
					gaps: [
						{
							stackItem: "Bun",
							reason: "No local Bun standards were detected.",
							suggestedResearch: [
								"Ref MCP: official Bun TypeScript configuration and bun test documentation",
							],
						},
					],
					precedence: [],
				},
			},
		);

		const output: { context: string[]; prompt?: string } = { context: [] };
		await hook({}, toolContext(worktree), output);

		expect(output.context).toEqual([]);
	});

	test("experimental.session.compacting is a graceful no-op when no active Flow session exists", async () => {
		const worktree = makeTempDir();
		const plugin = (await (
			await import("../src/index")
		).default({
			worktree,
		} as unknown as Parameters<
			typeof import("../src/index").default
		>[0])) as FlowPluginWithHooks;
		const hook = plugin.hooks?.["experimental.session.compacting"];

		expect(typeof hook).toBe("function");
		if (!hook) {
			throw new Error("Missing experimental.session.compacting hook");
		}

		const output: { context: string[]; prompt?: string } = { context: [] };
		await expect(
			hook({}, toolContext(worktree), output),
		).resolves.toBeUndefined();
		expect(output.prompt).toBeUndefined();
		expect(output.context.length).toBeLessThanOrEqual(1);
	});
});
