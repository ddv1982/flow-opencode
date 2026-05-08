import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
	deriveFeatureDocDrilldownTarget,
	resolveFeatureDocDrilldownTarget,
} from "../src/runtime/feature-doc-drilldown";
import {
	getCompletedSessionDir,
	getFeatureDocPath,
	getFeatureDocPathFromSessionDir,
	getSessionPath,
	getSessionPathFromDir,
	getStoredSessionDir,
	InvalidFlowPathInputError,
} from "../src/runtime/paths";
import { createTempDirRegistry } from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry(
	"flow-feature-drilldown-",
);

afterEach(() => {
	cleanupTempDirs();
});

describe("feature doc drilldown resolver", () => {
	test("derives available feature doc targets for active, stored, and completed sessions", async () => {
		const worktree = makeTempDir();
		const featureId = "feature-alpha";
		const completedDirName = "session-complete-20260508T120000.000";
		const cases = [
			{
				source: {
					location: "active" as const,
					worktree,
					sessionId: "session-active",
				},
				expectedPath: getFeatureDocPath(worktree, "session-active", featureId),
				expectedSessionPath: getSessionPath(worktree, "session-active"),
			},
			{
				source: {
					location: "stored" as const,
					worktree,
					sessionId: "session-stored",
				},
				expectedPath: getFeatureDocPath(
					worktree,
					"session-stored",
					featureId,
					"stored",
				),
				expectedSessionPath: getSessionPath(
					worktree,
					"session-stored",
					"stored",
				),
			},
			{
				source: {
					location: "completed" as const,
					worktree,
					completedDirName,
					sessionId: "session-complete",
				},
				expectedPath: getFeatureDocPathFromSessionDir(
					getCompletedSessionDir(worktree, completedDirName),
					featureId,
				),
				expectedSessionPath: getSessionPathFromDir(
					getCompletedSessionDir(worktree, completedDirName),
				),
			},
		];

		for (const { source, expectedPath, expectedSessionPath } of cases) {
			await mkdir(dirname(expectedPath), { recursive: true });
			await writeFile(expectedPath, "# Feature feature-alpha\n", "utf8");

			const target = await resolveFeatureDocDrilldownTarget({
				featureId,
				source,
			});

			expect(target).toMatchObject({
				kind: "feature_doc",
				label: "Open feature details",
				featureId,
				path: expectedPath,
				available: true,
				availability: "available",
				sessionLocation: source.location,
				sessionPath: expectedSessionPath,
			});
		}
	});

	test("derives targets from known session roots and session paths", () => {
		const worktree = makeTempDir();
		const featureId = "feature-beta";
		const storedDir = getStoredSessionDir(worktree, "session-stored");
		const completedDir = getCompletedSessionDir(
			worktree,
			"session-complete-20260508T120000.000",
		);

		expect(
			deriveFeatureDocDrilldownTarget({
				featureId,
				source: {
					location: "stored",
					sessionDir: relative(worktree, storedDir),
					sessionId: "session-stored",
					worktree,
				},
			}),
		).toMatchObject({
			sessionLocation: "stored",
			sessionDir: storedDir,
			sessionPath: getSessionPathFromDir(storedDir),
			path: join(storedDir, "docs", "features", "feature-beta.md"),
		});

		expect(
			deriveFeatureDocDrilldownTarget({
				featureId,
				source: {
					location: "completed",
					sessionPath: relative(worktree, getSessionPathFromDir(completedDir)),
					completedDirName: "session-complete-20260508T120000.000",
					worktree,
				},
			}),
		).toMatchObject({
			sessionLocation: "completed",
			sessionDir: completedDir,
			sessionPath: getSessionPathFromDir(completedDir),
			path: join(completedDir, "docs", "features", "feature-beta.md"),
		});
	});

	test("reports missing session roots and missing feature docs gracefully", async () => {
		const worktree = makeTempDir();
		const featureId = "feature-missing";
		const missingRootTarget = await resolveFeatureDocDrilldownTarget({
			featureId,
			source: {
				location: "active",
				worktree,
				sessionId: "missing-session",
			},
		});

		expect(missingRootTarget).toMatchObject({
			featureId,
			path: getFeatureDocPath(worktree, "missing-session", featureId),
			available: false,
			availability: "missing_session_root",
		});

		const sessionDir = getStoredSessionDir(worktree, "stored-without-docs");
		await mkdir(sessionDir, { recursive: true });

		const missingDocTarget = await resolveFeatureDocDrilldownTarget({
			featureId,
			source: {
				location: "stored",
				sessionDir,
				sessionId: "stored-without-docs",
				worktree,
			},
		});

		expect(missingDocTarget).toMatchObject({
			featureId,
			path: join(sessionDir, "docs", "features", "feature-missing.md"),
			available: false,
			availability: "missing_feature_doc",
		});

		const fileSessionRoot = join(worktree, ".flow", "active", "file-root");
		await mkdir(dirname(fileSessionRoot), { recursive: true });
		await writeFile(fileSessionRoot, "not a directory", "utf8");

		await expect(
			resolveFeatureDocDrilldownTarget({
				featureId,
				source: {
					location: "active",
					sessionDir: fileSessionRoot,
					worktree,
				},
			}),
		).resolves.toMatchObject({
			available: false,
			availability: "missing_session_root",
		});

		const directoryAtFeatureDocPath = join(
			sessionDir,
			"docs",
			"features",
			"feature-missing.md",
		);
		await mkdir(directoryAtFeatureDocPath, { recursive: true });

		await expect(
			resolveFeatureDocDrilldownTarget({
				featureId,
				source: {
					location: "stored",
					sessionDir,
					worktree,
				},
			}),
		).resolves.toMatchObject({
			available: false,
			availability: "missing_feature_doc",
		});
	});

	test("keeps unsafe feature and session inputs rejected by path builders", () => {
		const worktree = makeTempDir();
		const storedDir = getStoredSessionDir(worktree, "safe-session");
		const completedDirName = "session-complete-20260508T120000.000";

		expect(() =>
			deriveFeatureDocDrilldownTarget({
				featureId: "../escape",
				source: {
					location: "active",
					worktree,
					sessionId: "safe-session",
				},
			}),
		).toThrow(InvalidFlowPathInputError);

		expect(() =>
			deriveFeatureDocDrilldownTarget({
				featureId: "safe-feature",
				source: {
					location: "stored",
					worktree,
					sessionId: "../escape",
				},
			}),
		).toThrow(InvalidFlowPathInputError);

		expect(() =>
			deriveFeatureDocDrilldownTarget({
				featureId: "safe-feature",
				source: {
					location: "stored",
					worktree,
					sessionDir: "../outside",
				},
			}),
		).toThrow(InvalidFlowPathInputError);

		expect(() =>
			deriveFeatureDocDrilldownTarget({
				featureId: "safe-feature",
				source: {
					location: "stored",
					worktree,
					sessionPath: "../outside/session.json",
				},
			}),
		).toThrow(InvalidFlowPathInputError);

		expect(() =>
			deriveFeatureDocDrilldownTarget({
				featureId: "safe-feature",
				source: {
					location: "stored",
					worktree,
					sessionDir: storedDir,
					sessionId: "other-session",
				},
			}),
		).toThrow(InvalidFlowPathInputError);

		expect(() =>
			deriveFeatureDocDrilldownTarget({
				featureId: "safe-feature",
				source: {
					location: "completed",
					worktree,
					sessionDir: getStoredSessionDir(worktree, "safe-session"),
					completedDirName,
				},
			}),
		).toThrow(InvalidFlowPathInputError);

		expect(() =>
			deriveFeatureDocDrilldownTarget({
				featureId: "safe-feature",
				source: {
					location: "stored",
					sessionDir: storedDir,
				},
			}),
		).toThrow(InvalidFlowPathInputError);
	});
});
