import { describe, expect, test } from "bun:test";
import { runPackageSurfaceSmoke } from "./support/lifecycle-package-smoke.js";

describe("package smoke", () => {
	test("package metadata, README pins, packed bin, declarations, and consumers are valid", async () => {
		const evidence = await runPackageSurfaceSmoke();
		expect(evidence.packageVersion).toMatch(/^\d+\.\d+\.\d+$/);
		expect(evidence.pinnedReadmeVersionCount).toBeGreaterThan(0);
		expect(evidence.tarballEntryCount).toBeGreaterThan(0);
		expect(evidence.declarationCount).toBeGreaterThan(0);
		expect(evidence.cliVersion).toBe(evidence.packageVersion);
		expect(evidence.legacyCleanupDryRun).toBe(true);
		expect(evidence.consumerTypechecked).toBe(true);
		expect(evidence.runtimeImported).toBe(true);
	}, 30_000);
});
