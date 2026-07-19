import { describe, expect, test } from "bun:test";
import {
	PACKED_PACKAGE_PATHS,
	PUBLIC_DECLARATION_PATHS,
} from "../scripts/lib/package-surface.js";
import { runPackageSurfaceSmoke } from "./support/lifecycle-package-smoke.js";

describe("package smoke", () => {
	test("package metadata, README pins, packed bin, declarations, and consumers are valid", async () => {
		const evidence = await runPackageSurfaceSmoke();
		expect(evidence.packageVersion).toMatch(/^\d+\.\d+\.\d+$/);
		expect(evidence.pinnedReadmeVersionCount).toBeGreaterThan(0);
		expect(evidence.tarballEntryCount).toBe(PACKED_PACKAGE_PATHS.length);
		expect(evidence.declarationCount).toBe(PUBLIC_DECLARATION_PATHS.length);
		expect(evidence.cliVersion).toBe(evidence.packageVersion);
		expect(evidence.legacyCleanupDryRun).toBe(true);
		expect(evidence.activationDryRun).toBe(true);
		expect(evidence.activationApplied).toBe(true);
		expect(evidence.activationSingleVersion).toBe(true);
		expect(evidence.consumerTypechecked).toBe(true);
		expect(evidence.runtimeImported).toBe(true);
	}, 30_000);
});
