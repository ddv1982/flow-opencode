import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { readdir, readFile } from "node:fs/promises";
import {
	createApprovedSession,
	createCompletedSession,
} from "../../bench/fixtures";
import { getFeatureDocPath, getIndexDocPath } from "../../src/runtime/paths";
import {
	createSession,
	saveSession,
	syncSessionArtifacts,
} from "../../src/runtime/session";
import { createTempDirRegistry } from "../runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry(
	"flow-render-incremental-",
);

afterEach(() => {
	mock.restore();
	cleanupTempDirs();
});

describe("incremental markdown rendering", () => {
	test("idempotent save issues zero markdown writes on the second call", async () => {
		const worktree = makeTempDir();
		const session = createApprovedSession(5);
		const saved = await saveSession(worktree, session);

		const writeSpy = spyOn(fsPromises, "writeFile");
		await saveSession(worktree, saved);

		const docWrites = writeSpy.mock.calls
			.map(([target]) => target)
			.filter(
				(target): target is string =>
					typeof target === "string" &&
					target.includes("/docs/") &&
					target.endsWith(".md"),
			);

		expect(docWrites).toHaveLength(0);
	});

	test("single-feature mutation rewrites only index.md and the changed feature doc", async () => {
		const worktree = makeTempDir();
		const session = createApprovedSession(5);
		const saved = await saveSession(worktree, session);
		const changedFeatureId = "feature-3";
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
						? { ...feature, status: "completed" as const }
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

	test("post-replan sync prunes all stale feature docs when the plan becomes null", async () => {
		const worktree = makeTempDir();
		const session = createApprovedSession(5);
		const saved = await saveSession(worktree, session);
		const featuresDir = `${worktree}/.flow/sessions/${saved.id}/docs/features`;

		expect((await readdir(featuresDir)).length).toBe(5);

		await syncSessionArtifacts(worktree, { ...saved, plan: null });

		expect(await readdir(featuresDir)).toEqual([]);
	});

	test("all-completed plan omits an active feature section in index.md", async () => {
		const worktree = makeTempDir();
		const session = createCompletedSession(5);
		const saved = await saveSession(worktree, session);
		const index = await readFile(getIndexDocPath(worktree, saved.id), "utf8");

		expect(index).not.toContain("## Active Feature");
		expect(index).toContain("- active feature: none");
	});

	test("empty-plan second sync issues zero markdown writes", async () => {
		const worktree = makeTempDir();
		const session = createSession("Empty plan incremental fixture");

		const saved = await saveSession(worktree, session);

		const writeSpy = spyOn(fsPromises, "writeFile");
		await saveSession(worktree, saved);

		const docWrites = writeSpy.mock.calls
			.map(([target]) => target)
			.filter(
				(target): target is string =>
					typeof target === "string" &&
					target.includes("/docs/") &&
					target.endsWith(".md"),
			);

		expect(docWrites).toHaveLength(0);
	});

	test("hundred-feature fixture renders and second save issues zero markdown writes", async () => {
		const worktree = makeTempDir();
		const session = createApprovedSession(100);
		const saved = await saveSession(worktree, session);
		const featuresDir = `${worktree}/.flow/sessions/${saved.id}/docs/features`;

		expect((await readdir(featuresDir)).length).toBe(100);

		const writeSpy = spyOn(fsPromises, "writeFile");
		await saveSession(worktree, saved);

		const docWrites = writeSpy.mock.calls
			.map(([target]) => target)
			.filter(
				(target): target is string =>
					typeof target === "string" &&
					target.includes("/docs/") &&
					target.endsWith(".md"),
			);

		expect(docWrites).toHaveLength(0);
	});
});
