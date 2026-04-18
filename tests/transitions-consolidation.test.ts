import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const transitionsDir = join(repoRoot, "src", "runtime", "transitions");
const srcDir = join(repoRoot, "src");

describe("transition consolidation", () => {
	test("transitions directory is consolidated to the approved module set", () => {
		const files = readdirSync(transitionsDir)
			.filter((file) => file.endsWith(".ts"))
			.sort();

		expect(files).toEqual([
			"execution.ts",
			"index.ts",
			"plan.ts",
			"recovery.ts",
			"review.ts",
			"shared.ts",
		]);
	});

	test("each consolidated transition file stays within the 550 line maintainability cap", () => {
		const lineCounts = Object.fromEntries(
			readdirSync(transitionsDir)
				.filter((file) => file.endsWith(".ts") && file !== "index.ts")
				.map((file) => [
					file,
					readFileSync(join(transitionsDir, file), "utf8").split("\n").length,
				]),
		);

		expect(lineCounts).toEqual({
			"execution.ts": expect.any(Number),
			"plan.ts": expect.any(Number),
			"recovery.ts": expect.any(Number),
			"review.ts": expect.any(Number),
			"shared.ts": expect.any(Number),
		});
		for (const count of Object.values(lineCounts)) {
			expect(count).toBeLessThanOrEqual(550);
		}
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
