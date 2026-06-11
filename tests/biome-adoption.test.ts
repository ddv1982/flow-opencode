import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

describe("biome adoption", () => {
	test("package.json exposes lint and check scripts wired through Biome", async () => {
		const manifest = JSON.parse(
			await readFile(new URL("../package.json", import.meta.url), "utf8"),
		) as {
			scripts?: Record<string, string>;
		};

		expect(manifest.scripts?.lint).toContain("biome check");
		expect(manifest.scripts?.["build:plugin"]).toContain("--drop=console");
		expect(manifest.scripts?.check).toContain("bun run check:release-hygiene");
		expect(manifest.scripts?.check).toContain("bun run lint");
	});

	test("biome.json enables formatter, recommended lint, and source no-console release hygiene", async () => {
		const config = JSON.parse(
			await readFile(new URL("../biome.json", import.meta.url), "utf8"),
		) as {
			formatter?: { enabled?: boolean };
			linter?: {
				enabled?: boolean;
				rules?: {
					recommended?: boolean;
					nursery?: unknown;
					suspicious?: { noConsole?: unknown };
				};
			};
			overrides?: { includes?: string[]; linter?: { rules?: unknown } }[];
		};

		expect(config.formatter?.enabled).toBe(true);
		expect(config.linter?.enabled).toBe(true);
		expect(config.linter?.rules?.recommended).toBe(true);
		expect(config.linter?.rules?.suspicious?.noConsole).toBe("error");
		expect(config.linter?.rules?.nursery).toBeUndefined();
		expect(
			config.overrides?.some((override) =>
				override.includes?.includes("scripts/**"),
			),
		).toBe(true);
	});
});
