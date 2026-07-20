import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

async function workflow(name: string): Promise<string> {
	return readFile(`.github/workflows/${name}`, "utf8");
}

describe("harness workflow contract", () => {
	test("normal CI reports the deterministic fixture without promoting a candidate", async () => {
		const ci = await workflow("ci.yml");
		expect(ci).toContain("run: bun run harness:report -- --json");
		expect(ci).not.toContain("harness:gate");
		expect(ci).not.toMatch(/harness:report[^\n]*--require/);
	});

	test("release preserves the existing control rollout", async () => {
		const release = await workflow("release.yml");
		expect(release).not.toContain("harness:gate");
		expect(release).not.toMatch(/harness:report[^\n]*--require/);
	});

	test("release publication is integrity-checked and safely resumable", async () => {
		const release = await workflow("release.yml");
		expect(release).toContain(
			`npm view "\${package_name}@\${package_version}" dist.integrity`,
		);
		expect(release).toContain(
			`npm already contains \${package_name}@\${package_version} with different tarball integrity`,
		);
		expect(release).toContain("retry_idempotent()");
		expect(release).toContain(
			'gh release create "$tag" --title "$tag" --notes-file release-notes.md',
		);
		expect(release).toContain(
			'retry_idempotent gh release upload "$tag" "$tarball" --clobber',
		);
		expect(release).toContain(
			`retry_idempotent gh release upload "$tag" "\${tarball}.sha256" --clobber`,
		);
		expect(release).not.toContain(
			`gh release create "$tag" "$tarball" "\${tarball}.sha256"`,
		);
	});

	test("candidate promotion is manual, read-only, and explicit", async () => {
		const promotion = await workflow("harness-promotion.yml");
		expect(promotion).toContain("workflow_dispatch:");
		expect(promotion).not.toMatch(/^ {2}(?:pull_request|push|schedule):/m);
		expect(promotion).toContain("contents: read");
		expect(promotion).toContain("- standard");
		expect(promotion).toContain("- assurance");
		expect(promotion).toMatch(
			/run: bun run harness:report -- --json --require "\$\{\{ inputs\.variant \}\}"/,
		);
		expect(promotion).not.toMatch(/\bnpm publish\b|\bgh release\b/);
	});
});
