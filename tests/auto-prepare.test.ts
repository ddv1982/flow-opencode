import { afterEach, describe, expect, test } from "bun:test";
import { readValidStackStandardsProfileCache } from "../src/runtime/application/stack-standards-profile";
import { createSession, saveSession } from "../src/runtime/session";
import {
	createTempDirRegistry,
	createTestTools,
	samplePlan,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

const sampleStackProfile = {
	languages: [
		{ name: "TypeScript", evidenceRefs: ["tsconfig.json"], confidence: "high" },
	],
	frameworks: [],
	runtimes: [],
	packageManagers: [
		{ name: "bun", evidenceRefs: ["package.json"], confidence: "high" },
	],
	tools: [],
} as const;

const sampleStandardsProfile = {
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
	gaps: [],
	precedence: ["local repo guidance before external standards"],
} as const;

afterEach(() => {
	cleanupTempDirs();
});

describe("flow_auto_prepare semantics", () => {
	test("resume mode returns /flow-auto resume for empty input and explicit resume", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		await saveSession(worktree, createSession("Build a workflow plugin"));

		for (const input of [{}, { argumentString: "resume" }]) {
			const response = await tools.flow_auto_prepare.execute(input, {
				worktree,
			} as never);
			const parsed = JSON.parse(response);

			expect(parsed.status).toBe("ok");
			expect(parsed.mode).toBe("resume");
			expect(parsed.goal).toBe("Build a workflow plugin");
			expect(parsed.phase).toBe("planning");
			expect(parsed.lane).toBe("lite");
			expect(parsed.nextCommand).toBe("/flow-auto resume");
		}
	});

	test("missing session plus empty input returns missing_goal with /flow-auto <goal>", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();

		const response = await tools.flow_auto_prepare.execute({}, {
			worktree,
		} as never);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("missing_goal");
		expect(parsed.phase).toBe("idle");
		expect(parsed.lane).toBe("lite");
		expect(parsed.nextCommand).toBe("/flow-auto <goal>");
		expect(String(parsed.summary)).toContain("goal");
	});

	test("planning context schema accepts a decision log payload", async () => {
		const tools = createTestTools();
		const worktree = makeTempDir();
		await tools.flow_plan_start.execute({ goal: "Build a workflow plugin" }, {
			worktree,
		} as never);

		const response = await tools.flow_plan_context_record.execute(
			{
				repoProfile: ["TypeScript", "Bun"],
				packageManager: "bun",
				research: [
					"Confirm Bun plugin packaging docs if local evidence is unclear.",
				],
				stackProfile: sampleStackProfile,
				standardsProfile: sampleStandardsProfile,
				decisionLog: [
					{
						question:
							"How should autonomous mode handle unresolved architecture choices?",
						decisionMode: "recommend_confirm",
						decisionDomain: "architecture",
						options: [
							{ label: "Pause and ask", tradeoffs: ["safer", "slower"] },
							{ label: "Auto-guess", tradeoffs: ["faster", "riskier"] },
						],
						recommendation: "Pause and ask",
						rationale: ["Preserves user intent for meaningful decisions."],
					},
				],
			},
			{ worktree } as never,
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		expect(parsed.session.planning.packageManager).toBe("bun");
		expect(parsed.session.planning.decisionLog).toHaveLength(1);
		expect(parsed.session.planning.decisionLog[0]).toMatchObject({
			decisionMode: "recommend_confirm",
			decisionDomain: "architecture",
		});
		const cachedProfile = await readValidStackStandardsProfileCache(
			worktree,
			undefined,
			{ packageManager: "bun", ambiguous: false },
		);
		expect(cachedProfile?.stackProfile?.languages[0]?.name).toBe("TypeScript");
		expect(cachedProfile?.standardsProfile?.localGuidelines[0]?.reference).toBe(
			"AGENTS.md",
		);
	});

	test("plan apply writes a strict readable stack standards cache", async () => {
		const tools = createTestTools();
		const worktree = makeTempDir();
		await tools.flow_plan_start.execute({ goal: "Build a workflow plugin" }, {
			worktree,
		} as never);

		const response = await tools.flow_plan_apply.execute(
			{
				plan: samplePlan(),
				planning: {
					repoProfile: ["TypeScript", "Bun"],
					packageManager: "bun",
					stackProfile: sampleStackProfile,
					standardsProfile: sampleStandardsProfile,
				},
			},
			{ worktree } as never,
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		const cachedProfile = await readValidStackStandardsProfileCache(
			worktree,
			undefined,
			{ packageManager: "bun", ambiguous: false },
		);
		expect(cachedProfile?.stackProfile?.packageManagers[0]?.name).toBe("bun");
		expect(cachedProfile).not.toHaveProperty("repoProfile");
	});
});
