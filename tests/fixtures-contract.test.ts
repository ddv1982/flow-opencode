import { describe, expect, test } from "bun:test";
import path from "node:path";
import { PlanSchema, SessionSchema } from "../src/runtime/schema";
import { samplePlan, sampleSession } from "./fixtures";

describe("shared test fixtures", () => {
	test("canonical samplePlan and sampleSession satisfy runtime schemas", () => {
		expect(PlanSchema.safeParse(samplePlan).success).toBe(true);
		expect(SessionSchema.safeParse(sampleSession).success).toBe(true);
	});

	test("canonical plan and session literals are only defined in tests/fixtures.ts", async () => {
		const repoRoot = path.resolve(import.meta.dir, "..");
		const testFiles = Array.from(
			new Bun.Glob("tests/**/*.ts").scanSync(repoRoot),
		).filter(
			(file) =>
				file !== "tests/fixtures.ts" &&
				file !== "tests/fixtures-contract.test.ts" &&
				file !== "tests/runtime-test-helpers.ts" &&
				!file.startsWith("tests/__fixtures__/"),
		);

		for (const file of testFiles) {
			const contents = await Bun.file(path.join(repoRoot, file)).text();
			expect(contents).not.toContain("function samplePlan()");
			expect(contents).not.toContain("const samplePlan =");
		}
	});
});
