import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
	createApprovedSession,
	createCompletedSession,
	createMidExecutionSession,
	createPlan,
	createSession,
} from "../bench/fixtures";
import { getFeatureDocPath, getIndexDocPath } from "../src/runtime/paths";
import { saveSession } from "../src/runtime/session";
import { applyPlan } from "../src/runtime/transitions";
import { setNowIsoOverride } from "../src/runtime/util";
import { createTempDirRegistry } from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry(
	"flow-render-fixtures-",
);

afterEach(() => {
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

function assertOk<T>(
	result: { ok: true; value: T } | { ok: false; message: string },
): T {
	if (!result.ok) {
		throw new Error(result.message);
	}

	return result.value;
}

type FixtureSpec = {
	name: string;
	createSession: () => ReturnType<typeof createSession>;
	featureIds: string[];
};

async function renderFixture(
	worktree: string,
	session: ReturnType<FixtureSpec["createSession"]>,
) {
	const saved = await saveSession(worktree, session);
	const index = await readFile(getIndexDocPath(worktree, saved.id), "utf8");
	const featureDocs = await Promise.all(
		(saved.plan?.features ?? []).map(
			async (feature) =>
				[
					feature.id,
					await readFile(
						getFeatureDocPath(worktree, saved.id, feature.id),
						"utf8",
					),
				] as const,
		),
	);

	return { saved, index, featureDocs: new Map(featureDocs) };
}

describe("render fixtures", () => {
	const fixtures = [
		{
			name: "empty-plan",
			createSession: () => ({
				...createSession("Empty plan fixture"),
				id: "render-empty-plan",
				timestamps: {
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
					approvedAt: null,
					completedAt: null,
				},
			}),
			featureIds: [],
		},
		{
			name: "single-feature",
			createSession: () =>
				assertOk(
					applyPlan(
						{
							...createSession("Single feature fixture"),
							id: "render-single-feature",
							timestamps: {
								createdAt: "2026-01-01T00:00:00.000Z",
								updatedAt: "2026-01-01T00:00:00.000Z",
								approvedAt: null,
								completedAt: null,
							},
						},
						createPlan(1),
					),
				),
			featureIds: ["feature-1"],
		},
		{
			name: "mid-execution-10-features",
			createSession: () => createMidExecutionSession(10),
			featureIds: Array.from(
				{ length: 10 },
				(_, index) => `feature-${index + 1}`,
			),
		},
		{
			name: "save-session-20-features",
			createSession: () => createApprovedSession(20),
			featureIds: Array.from(
				{ length: 20 },
				(_, index) => `feature-${index + 1}`,
			),
		},
		{
			name: "all-completed",
			createSession: () => createCompletedSession(5),
			featureIds: Array.from(
				{ length: 5 },
				(_, index) => `feature-${index + 1}`,
			),
		},
		{
			name: "hundred-features",
			createSession: () => createApprovedSession(100),
			featureIds: Array.from(
				{ length: 100 },
				(_, index) => `feature-${index + 1}`,
			),
		},
	] satisfies FixtureSpec[];

	for (const fixture of fixtures) {
		test(`matches committed golden snapshot for ${fixture.name}`, async () => {
			const worktree = makeTempDir();
			const rendered = await renderFixture(worktree, fixture.createSession());
			const fixtureRoot = path.resolve(
				import.meta.dir,
				"__fixtures__",
				"render",
				fixture.name,
			);
			const actualFeatureFiles = await readdir(`${fixtureRoot}/features`).catch(
				() => [],
			);

			const expectedIndex = await readFile(`${fixtureRoot}/index.md`, "utf8");
			expect(rendered.index).toBe(expectedIndex);

			expect([...rendered.featureDocs.keys()].sort()).toEqual(
				[...fixture.featureIds].sort(),
			);
			expect(actualFeatureFiles.sort()).toEqual(
				fixture.featureIds.map((featureId) => `${featureId}.md`).sort(),
			);

			for (const featureId of fixture.featureIds) {
				expect(rendered.featureDocs.get(featureId) ?? "").toBe(
					await readFile(`${fixtureRoot}/features/${featureId}.md`, "utf8"),
				);
			}
		});
	}
});
