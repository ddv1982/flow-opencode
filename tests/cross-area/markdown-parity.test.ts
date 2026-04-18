import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import * as fsPromises from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createMidExecutionSession } from "../../bench/fixtures";
import { getFeatureDocPath, getIndexDocPath } from "../../src/runtime/paths";
import { renderSessionDocs } from "../../src/runtime/render";
import { ensureWorkspace, saveSession } from "../../src/runtime/session";
import { setNowIsoOverride } from "../../src/runtime/util";
import { createTempDirRegistry } from "../runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry(
	"flow-markdown-parity-",
);

afterEach(() => {
	mock.restore();
	setNowIsoOverride(null);
	cleanupTempDirs();
});

beforeEach(() => {
	let callCount = 0;
	setNowIsoOverride(() => {
		const value = new Date(
			Date.parse("2026-01-01T00:00:00.000Z") + callCount * 1_000,
		).toISOString();
		callCount += 1;
		return value;
	});
});

describe("cross-area markdown parity", () => {
	test("10-feature fixture preserves golden bytes and rewrites only the changed feature doc plus index", async () => {
		const worktree = makeTempDir();
		const session = createMidExecutionSession(10);
		await ensureWorkspace(worktree);
		await renderSessionDocs(worktree, session);
		const fixtureRoot = path.resolve(
			import.meta.dir,
			"..",
			"__fixtures__",
			"render",
			"mid-execution-10-features",
		);

		expect(await readFile(getIndexDocPath(worktree, session.id), "utf8")).toBe(
			await readFile(`${fixtureRoot}/index.md`, "utf8"),
		);

		for (const feature of session.plan?.features ?? []) {
			expect(
				await readFile(
					getFeatureDocPath(worktree, session.id, feature.id),
					"utf8",
				),
			).toBe(
				await readFile(`${fixtureRoot}/features/${feature.id}.md`, "utf8"),
			);
		}

		const changedFeatureId = "feature-6";
		const plan = session.plan;
		if (!plan) {
			throw new Error("Expected plan for mutation test.");
		}
		const mutated = {
			...session,
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
				getIndexDocPath(worktree, session.id),
				getFeatureDocPath(worktree, session.id, changedFeatureId),
			].sort(),
		);
	});
});
