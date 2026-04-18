import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createMidExecutionSession } from "../../bench/fixtures";
import { getFeatureDocPath, getIndexDocPath } from "../../src/runtime/paths";
import { saveSession } from "../../src/runtime/session";
import { createTempDirRegistry } from "../runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry(
	"flow-markdown-parity-",
);

afterEach(() => {
	mock.restore();
	cleanupTempDirs();
});

function normalizeMarkdown(value: string): string {
	return value
		.replace(/- updated: .+/g, "- updated: <normalized-updated-at>")
		.replace(/- created: .+/g, "- created: <normalized-created-at>")
		.replace(
			/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/g,
			"<normalized-timestamp>",
		);
}

describe("cross-area markdown parity", () => {
	test("10-feature fixture preserves golden bytes and rewrites only the changed feature doc plus index", async () => {
		const worktree = makeTempDir();
		const session = createMidExecutionSession(10);
		const saved = await saveSession(worktree, session);
		const fixtureRoot = path.resolve(
			import.meta.dir,
			"..",
			"__fixtures__",
			"render",
			"mid-execution-10-features",
		);

		expect(
			normalizeMarkdown(
				await readFile(getIndexDocPath(worktree, saved.id), "utf8"),
			),
		).toBe(
			normalizeMarkdown(await readFile(`${fixtureRoot}/index.md`, "utf8")),
		);

		for (const feature of saved.plan?.features ?? []) {
			expect(
				normalizeMarkdown(
					await readFile(
						getFeatureDocPath(worktree, saved.id, feature.id),
						"utf8",
					),
				),
			).toBe(
				normalizeMarkdown(
					await readFile(`${fixtureRoot}/features/${feature.id}.md`, "utf8"),
				),
			);
		}

		const changedFeatureId = "feature-6";
		const plan = saved.plan;
		if (!plan) {
			throw new Error("Expected plan for mutation test.");
		}
		const mutated = {
			...saved,
			plan: {
				...plan,
				features: plan.features.map((feature) =>
					feature.id === changedFeatureId
						? { ...feature, status: "blocked" as const }
						: feature,
				),
			},
		};

		const writeSpy = spyOn(fsPromises, "writeFile");
		await saveSession(worktree, mutated);

		const docWrites = writeSpy.mock.calls
			.map(([target]) => target)
			.filter(
				(target): target is string =>
					typeof target === "string" &&
					target.includes("/docs/") &&
					target.endsWith(".md"),
			);

		expect(docWrites).toHaveLength(2);
		expect(docWrites.sort()).toEqual(
			[
				getIndexDocPath(worktree, saved.id),
				getFeatureDocPath(worktree, saved.id, changedFeatureId),
			].sort(),
		);
	});
});
