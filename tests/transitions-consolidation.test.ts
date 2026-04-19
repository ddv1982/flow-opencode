import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const transitionsDir = join(repoRoot, "src", "runtime", "transitions");
const srcDir = join(repoRoot, "src");
const sessionToolsDir = join(srcDir, "tools", "session-tools");

describe("transition consolidation", () => {
	test("transitions directory stays within the bounded module surface", () => {
		const files = readdirSync(transitionsDir)
			.filter((file) => file.endsWith(".ts"))
			.sort();

		expect(files).toContain("execution.ts");
		expect(files).toContain("index.ts");
		expect(files).toContain("plan.ts");
		expect(files).toContain("recovery.ts");
		expect(files).toContain("review.ts");
		expect(files).toContain("shared.ts");
		expect(files.length).toBeLessThanOrEqual(8);
	});

	test("transition and tool hotspots stay within maintainability caps", () => {
		const lineCounts = Object.fromEntries(
			readdirSync(transitionsDir)
				.filter((file) => file.endsWith(".ts") && file !== "index.ts")
				.map((file) => [
					file,
					readFileSync(join(transitionsDir, file), "utf8").split("\n").length,
				]),
		);

		expect(lineCounts["execution.ts"]).toEqual(expect.any(Number));
		expect(lineCounts["plan.ts"]).toEqual(expect.any(Number));
		expect(lineCounts["recovery.ts"]).toEqual(expect.any(Number));
		expect(lineCounts["review.ts"]).toEqual(expect.any(Number));
		expect(lineCounts["shared.ts"]).toEqual(expect.any(Number));
		for (const count of Object.values(lineCounts)) {
			expect(count).toBeLessThanOrEqual(550);
		}
		const runtimeToolsCount = readFileSync(
			join(srcDir, "tools", "runtime-tools.ts"),
			"utf8",
		).split("\n").length;
		const sessionToolsCount = readFileSync(
			join(srcDir, "tools", "session-tools.ts"),
			"utf8",
		).split("\n").length;
		expect(runtimeToolsCount).toBeLessThanOrEqual(700);
		expect(sessionToolsCount).toBeLessThanOrEqual(40);
		const sessionToolModuleCounts = Object.fromEntries(
			readdirSync(sessionToolsDir)
				.filter((file) => file.endsWith(".ts"))
				.sort()
				.map((file) => [
					file,
					readFileSync(join(sessionToolsDir, file), "utf8").split("\n").length,
				]),
		);
		expect(Object.keys(sessionToolModuleCounts)).toEqual([
			"history-tools.ts",
			"lifecycle-tools.ts",
			"next-command-policy.ts",
			"planning-tools.ts",
			"responses.ts",
			"shared.ts",
		]);
		for (const count of Object.values(sessionToolModuleCounts)) {
			expect(count).toBeLessThanOrEqual(200);
		}
	});

	test("session tool modules keep stable ownership boundaries", () => {
		const historyTools = readFileSync(
			join(sessionToolsDir, "history-tools.ts"),
			"utf8",
		);
		const planningTools = readFileSync(
			join(sessionToolsDir, "planning-tools.ts"),
			"utf8",
		);
		const lifecycleTools = readFileSync(
			join(sessionToolsDir, "lifecycle-tools.ts"),
			"utf8",
		);
		const nextCommandPolicy = readFileSync(
			join(sessionToolsDir, "next-command-policy.ts"),
			"utf8",
		);
		const responseTools = readFileSync(
			join(sessionToolsDir, "responses.ts"),
			"utf8",
		);
		const sharedTools = readFileSync(
			join(sessionToolsDir, "shared.ts"),
			"utf8",
		);

		expect(historyTools).toContain("export function createHistorySessionTools");
		expect(historyTools).toContain(
			"Session tool boundary: history/lookup/activation tool registrations only.",
		);
		expect(historyTools).toContain("flow_status");
		expect(historyTools).toContain("flow_history");
		expect(historyTools).toContain("flow_history_show");
		expect(historyTools).toContain("flow_session_activate");
		expect(historyTools).not.toContain("flow_plan_start");
		expect(historyTools).not.toContain("flow_auto_prepare");
		expect(historyTools).not.toContain("flow_session_close");

		expect(planningTools).toContain(
			"export function createPlanningSessionTools",
		);
		expect(planningTools).toContain(
			"Session tool boundary: planning/resume classification tool registrations only.",
		);
		expect(planningTools).toContain("flow_plan_start");
		expect(planningTools).toContain("flow_auto_prepare");
		expect(planningTools).not.toContain("flow_status");
		expect(planningTools).not.toContain("flow_history");
		expect(planningTools).not.toContain("flow_session_close");

		expect(lifecycleTools).toContain(
			"export function createLifecycleSessionTools",
		);
		expect(lifecycleTools).toContain(
			"Session tool boundary: lifecycle/close tool registrations only.",
		);
		expect(lifecycleTools).toContain("flow_session_close");
		expect(lifecycleTools).not.toContain("flow_status");
		expect(lifecycleTools).not.toContain("flow_plan_start");
		expect(lifecycleTools).not.toContain("flow_history");

		expect(responseTools).toContain("export function historyResponse");
		expect(responseTools).toContain("export function storedSessionResponse");
		expect(responseTools).toContain("export function autoPrepareResponse");
		expect(responseTools).toContain("export function closeSessionResponse");
		expect(responseTools).toContain(
			"Session tool boundary: JSON response envelope assembly only.",
		);
		expect(responseTools).not.toContain("tool({");
		expect(responseTools).not.toContain("flowSessionActivateCommand");
		expect(responseTools).not.toContain("FLOW_AUTO_RESUME_COMMAND");
		expect(responseTools).not.toContain("FLOW_AUTO_WITH_GOAL_COMMAND");
		expect(responseTools).not.toContain("FLOW_HISTORY_COMMAND");
		expect(responseTools).not.toContain("FLOW_PLAN_WITH_GOAL_COMMAND");
		expect(responseTools).not.toContain("FLOW_STATUS_COMMAND");

		expect(nextCommandPolicy).toContain(
			"export function nextCommandForHistory",
		);
		expect(nextCommandPolicy).toContain(
			"Session tool boundary: next-command and navigation policy only.",
		);
		expect(nextCommandPolicy).toContain(
			"export function nextCommandForStoredSession",
		);
		expect(nextCommandPolicy).toContain("export function autoPreparePolicy");
		expect(nextCommandPolicy).toContain(
			"export function nextCommandForResetSession",
		);
		expect(nextCommandPolicy).toContain("FLOW_STATUS_COMMAND");
		expect(nextCommandPolicy).not.toContain("tool({");

		expect(sharedTools).toContain("export function resolveToolSessionRoot");
		expect(sharedTools).toContain("export function recordToolMetadata");
		expect(sharedTools).toContain(
			"Session tool boundary: tiny shared helpers only.",
		);
		expect(sharedTools).not.toContain("missingGoalResponse");
		expect(sharedTools).not.toContain("missingStoredSessionResponse");
		expect(sharedTools).not.toContain("flow_status");
		expect(sharedTools).not.toContain("flow_plan_start");
		expect(sharedTools).not.toContain("flow_session_close");
	});

	test("transition index exposes the stable public transition surface", () => {
		const indexContents = readFileSync(
			join(transitionsDir, "index.ts"),
			"utf8",
		);

		expect(indexContents).toContain("completeRun");
		expect(indexContents).toContain("startRun");
		expect(indexContents).toContain("applyPlan");
		expect(indexContents).toContain("approvePlan");
		expect(indexContents).toContain("recordReviewerDecision");
		expect(indexContents).toContain("resetFeature");
	});

	test("session internals are imported only from the runtime/session barrel", () => {
		const directSessionImports: string[] = [];

		const visit = (directory: string) => {
			for (const entry of readdirSync(directory, { withFileTypes: true })) {
				if (entry.name.startsWith(".")) continue;
				const fullPath = join(directory, entry.name);
				if (entry.isDirectory()) {
					visit(fullPath);
					continue;
				}
				if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
				if (/src\/runtime\/session-[^/]+\.ts$/.test(fullPath)) continue;

				const contents = readFileSync(fullPath, "utf8");
				if (
					/session-(lifecycle|persistence|workspace|history)/.test(contents)
				) {
					directSessionImports.push(fullPath.replace(`${repoRoot}/`, ""));
				}
			}
		};

		visit(srcDir);
		expect(directSessionImports).toEqual(["src/runtime/session.ts"]);
	});
});
