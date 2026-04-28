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
		expect(files).toContain("execution-completion.ts");
		expect(files).toContain("execution-completion-normalization.ts");
		expect(files).toContain("execution-completion-validation.ts");
		expect(files).toContain("execution-completion-finalization.ts");
		expect(files).toContain("index.ts");
		expect(files).toContain("plan.ts");
		expect(files).toContain("recovery.ts");
		expect(files).toContain("review.ts");
		expect(files).toContain("shared.ts");
		expect(files.length).toBeLessThanOrEqual(11);
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
			"shared.ts",
		]);
		for (const count of Object.values(sessionToolModuleCounts)) {
			expect(count).toBeLessThanOrEqual(200);
		}
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
					/from\s+["'][^"']*session-(lifecycle|persistence|workspace|history)["']/.test(
						contents,
					)
				) {
					directSessionImports.push(fullPath.replace(`${repoRoot}/`, ""));
				}
			}
		};

		visit(srcDir);
		expect(directSessionImports).toEqual(["src/runtime/session.ts"]);
	});
});
