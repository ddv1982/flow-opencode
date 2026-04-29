import { afterEach, describe, expect, test } from "bun:test";
import { createSession, saveSession } from "../src/runtime/session";
import { createTempDirRegistry, createTestTools } from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

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
				planningJson: JSON.stringify({
					repoProfile: ["TypeScript", "Bun"],
					packageManager: "bun",
					research: [
						"Confirm Bun plugin packaging docs if local evidence is unclear.",
					],
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
				}),
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
	});
});
