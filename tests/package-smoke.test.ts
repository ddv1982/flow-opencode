import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
	PACKED_PACKAGE_PATHS,
	PUBLIC_DECLARATION_PATHS,
} from "../scripts/lib/package-surface.js";

const repositoryRoot = new URL("..", import.meta.url);

async function run(command: string[]): Promise<string> {
	const process = Bun.spawn(command, {
		cwd: repositoryRoot.pathname,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(`${command.join(" ")} failed:\n${stdout}${stderr}`);
	}
	return `${stdout}${stderr}`;
}

describe("package smoke", () => {
	test("packs only the small public plugin surface and imports it", async () => {
		await run(["bun", "run", "build"]);
		const output = await run(["bun", "pm", "pack", "--dry-run"]);
		const metadata = JSON.parse(
			await readFile(new URL("package.json", repositoryRoot), "utf8"),
		) as {
			bin?: unknown;
			version?: unknown;
		};

		expect(metadata.version).toMatch(/^\d+\.\d+\.\d+$/);
		expect(metadata.bin).toBeUndefined();
		expect(output).toContain(`Total files: ${PACKED_PACKAGE_PATHS.length}`);
		for (const path of PACKED_PACKAGE_PATHS) {
			expect(output).toMatch(
				new RegExp(`packed [^\\n]+ ${path.replaceAll(".", "\\.")}`),
			);
		}
		for (const path of PUBLIC_DECLARATION_PATHS) {
			expect(await Bun.file(new URL(path, repositoryRoot)).exists()).toBe(true);
		}

		const entryUrl = pathToFileURL(
			new URL("dist/index.js", repositoryRoot).pathname,
		);
		const plugin = (await import(`${entryUrl.href}?smoke=${Date.now()}`)) as {
			default?: unknown;
		};
		expect(typeof plugin.default).toBe("function");
	}, 30_000);
});
