import { describe, expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { PUBLIC_DECLARATION_PATHS } from "../scripts/lib/package-surface.js";

const repositoryRoot = resolve(import.meta.dir, "..");
const sourceRoot = join(repositoryRoot, "src");
/**
 * Raised from 200 KiB, then from 208 KiB, both times to buy explanation rather
 * than code: first the densest decisions in `auto-drive.ts`, then the invariant
 * families in `session-invariants.ts`, which was the 963-line `transitions.ts`
 * carrying two comment lines and the repository's least-explained rules.
 *
 * Prefer paying for growth by deleting code; raise this only when the thing that
 * does not fit is prose about code that is already as small as it should be. The
 * second raise met that test and is the whole reason the criterion is written
 * down: the alternative was landing the split with 616 bytes of headroom, which
 * would have made the next person's explanation the thing that did not fit.
 *
 * Raised again, from 216 KiB, for `plan.gate` and the auto-continuation capability
 * signal. Both are small: a declared command the runtime matches byte-for-byte, and
 * a three-state observation of whether this host reports message parentage. What
 * did not fit is why either exists — a measured false completion over a can't-fail
 * gate, and a host limit that made `/flow-auto` look broken — and neither is
 * inferable from the conditionals. The same criterion applied: after tightening,
 * the total landed 44 bytes under the old ceiling, which is the zero-headroom state
 * this comment already warns about.
 *
 * Raised again, from 224 KiB, for `ExternalEvidence.platform` and the host each
 * observation was recorded on. The code is a four-value union, one normalizer, one
 * added condition in `unsatisfiedExternalEvidence`, and two optional schema fields.
 * What did not fit is why prose was not enough: a measured run declared it needed
 * Windows, ran its exact declared command on Linux where the Windows case skips,
 * and closed `completed` with every recorded field true. Nothing in the comparison
 * says that, and 1,609 bytes of headroom would have bought only the union.
 *
 * Raised again, from 232 KiB, for declared `assertions` and the named results each
 * observation now records. This is the largest single raise so far and the code is
 * the reason, not the prose: a JUnit reader, a report reader that checks the file was
 * written after arming, four new schema fields across both mirrors, and a satisfaction
 * rule that had to be threaded through the refusal message as a third distinct state.
 * The tightening this comment asks for went first — every doc comment in the change
 * was cut once the ADR existed to hold the story — and it bought 1.4 KiB of the 14.5.
 *
 * What did not fit is a guarantee, not an explanation: `hostPlatform` closed the wrong
 * machine and left the same skip on the right one, where a case can be guarded,
 * filtered, or renamed out of a run and the process still exits zero. Flow read exit
 * codes, which was recorded as a limitation rather than fixed
 * (`docs/adr/0012-named-results-over-exit-codes.md`).
 *
 * The 3.6 KiB left is deliberately more than the last two raises left, because the
 * next phase replaces three overlapping evidence checks with one and should *return*
 * bytes. If it does not, that is the signal to stop adding fields.
 *
 * Raised again, from 248 KiB, for Phase 1 thin routers. The manager command prompts
 * (flow-auto, flow-plan, flow-run) were inlining full SKILL.md guidance at compile
 * time, consuming ~27KB of the 38.5KB compiled prompt ceiling with only 15 bytes of
 * headroom. The thin routers add 3.7 KiB of source but remove 21.1 KiB from the
 * compiled surface (flow-run alone dropped from 15KB to 2KB). The SKILL.md files
 * remain unchanged as the judgment source, now loaded lazily via flow_guidance.
 */
const MAX_TYPESCRIPT_SOURCE_BYTES = 252 * 1024;
const MAX_TYPESCRIPT_FILE_LINES = 1_000;
const inwardLayers = new Set(["domain", "application", "infrastructure"]);
const allowedTargets = {
	domain: new Set(["domain"]),
	application: new Set(["domain", "application"]),
	infrastructure: new Set(["domain", "application", "infrastructure"]),
} as const;

async function sourceFiles(directory = sourceRoot): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map((entry) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) return sourceFiles(path);
			return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
		}),
	);
	return files.flat();
}

function relativeImports(source: string): string[] {
	return [
		...source.matchAll(/(?:from\s+|import\s*)["'](\.[^"']+)["']/g),
	].flatMap((match) => (match[1] ? [match[1]] : []));
}

function sourceLayer(path: string): string {
	return relative(sourceRoot, path).split(sep)[0] ?? "";
}

/** Repository-relative and slash-separated, so comparisons hold on Windows. */
function repositoryPath(file: string): string {
	return relative(repositoryRoot, file).split(sep).join("/");
}

const DECLARED_EXPORT =
	/^export\s+(?:async\s+)?(?:type|const|let|function\*?|class|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^export\s+(?:type\s+)?\{([^}]*)\}/gm;
const IMPORT_LIST = /^(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from/gm;

/**
 * The names a braced import or export list moves across a module boundary. In
 * `{ a as b }` an export list exposes `b` while an import list reads `a`, so
 * `side` picks which end of the rename the caller means.
 */
function bindings(
	source: string,
	pattern: RegExp,
	side: "exposed" | "local",
): string[] {
	return [...source.matchAll(pattern)].flatMap((match) =>
		(match[1] ?? "").split(",").flatMap((member) => {
			const parts = member
				.replace(/\btype\s+/, "")
				.trim()
				.split(/\s+as\s+/);
			const name = side === "exposed" ? (parts[1] ?? parts[0]) : parts[0];
			return name && name !== "default" ? [name] : [];
		}),
	);
}

async function expectMissing(path: string): Promise<void> {
	await expect(stat(join(repositoryRoot, path))).rejects.toMatchObject({
		code: "ENOENT",
	});
}

describe("v6 architecture boundaries", () => {
	test("keeps deleted framework subsystems out of the runtime", async () => {
		for (const path of [
			"src/application/replay/index.ts",
			"src/application/harness/resource-report.ts",
			"src/application/validation-receipts.ts",
			"src/cli.ts",
			"src/distribution/activation.ts",
			"src/distribution/markdown-modules.d.ts",
			"src/domain/audit-ledger.ts",
			"src/domain/orchestration-policy.ts",
			"src/domain/validation-receipt.ts",
			"src/infrastructure/fs/evidence-artifact-store.ts",
			"src/platform/opencode/harness-tools.ts",
			"src/platform/opencode/observation.ts",
			"src/platform/opencode/orchestration-admission.ts",
		]) {
			await expectMissing(path);
		}
	});

	// The size is in the constant, not the title: the title said 224 KiB through two
	// raises past it, which is how a ceiling stops describing itself.
	test("keeps TypeScript source within its budget and each file within 1,000 lines", async () => {
		const files = await sourceFiles();
		const measurements = await Promise.all(
			files.map(async (path) => {
				const source = await readFile(path, "utf8");
				return {
					path: relative(sourceRoot, path),
					bytes: Buffer.byteLength(source, "utf8"),
					lines: source.split("\n").length,
				};
			}),
		);
		const totalBytes = measurements.reduce((sum, item) => sum + item.bytes, 0);
		const oversized = measurements.filter(
			(item) => item.lines > MAX_TYPESCRIPT_FILE_LINES,
		);

		// Reported because a budget that only speaks up once it is exceeded blocks
		// the change that discovered the problem rather than the one that caused it.
		const headroom = MAX_TYPESCRIPT_SOURCE_BYTES - totalBytes;
		console.info(
			`src TypeScript: ${totalBytes} bytes, ${headroom} of ${MAX_TYPESCRIPT_SOURCE_BYTES} remaining.`,
		);

		expect(totalBytes).toBeLessThanOrEqual(MAX_TYPESCRIPT_SOURCE_BYTES);
		expect(oversized).toEqual([]);
	});

	test("keeps every src export referenced outside its declaring file", async () => {
		// `noUnusedLocals` cannot see an export that nothing imports, so dead
		// exported types and constants accumulate silently. Anything outside the
		// published declarations must have an in-repository consumer.
		//
		// References are read from import bindings rather than searched for as text,
		// so a name that only survives in a comment or a string does not look live.
		// No source in the repository uses a namespace import, so an import binding
		// is the only way one file can reach another's export. Module paths are
		// ignored, so two exports sharing a name vouch for each other.
		const allowed = new Set(
			PUBLIC_DECLARATION_PATHS.map((path) =>
				path.replace(/^dist\//, "src/").replace(/\.d\.ts$/, ".ts"),
			),
		);
		const files = new Map<string, string>();
		for (const root of ["src", "tests", "scripts", "evals"]) {
			for (const file of await sourceFiles(join(repositoryRoot, root))) {
				files.set(repositoryPath(file), await readFile(file, "utf8"));
			}
		}
		const imported = new Map(
			[...files].map(([path, source]) => [
				path,
				new Set(bindings(source, IMPORT_LIST, "local")),
			]),
		);

		const unused: string[] = [];
		for (const [path, source] of files) {
			if (!path.startsWith("src/") || allowed.has(path)) continue;
			const exported = [
				...[...source.matchAll(DECLARED_EXPORT)].flatMap((match) =>
					match[1] ? [match[1]] : [],
				),
				...bindings(source, EXPORT_LIST, "exposed"),
			];
			for (const name of exported) {
				const referenced = [...imported].some(
					([other, names]) => other !== path && names.has(name),
				);
				if (!referenced) unused.push(`${path}:${name}`);
			}
		}

		expect(unused).toEqual([]);
	});

	test("routes every OpenCode host import through src/platform/opencode/sdk.ts", async () => {
		// One seam holds the peer-dependency surface, and it is the only host import
		// the published declarations expose. It had already drifted once, so it is
		// enforced here rather than described in prose.
		const importers: string[] = [];
		for (const file of await sourceFiles()) {
			const source = await readFile(file, "utf8");
			if (/(?:from\s+|import\s*)["']@opencode-ai\//.test(source)) {
				importers.push(repositoryPath(file));
			}
		}
		expect(importers).toEqual(["src/platform/opencode/sdk.ts"]);
	});

	test("keeps domain, application, and infrastructure dependencies inward", async () => {
		const violations: string[] = [];
		for (const file of await sourceFiles()) {
			const layer = sourceLayer(file);
			if (!inwardLayers.has(layer)) continue;
			const source = await readFile(file, "utf8");
			for (const specifier of relativeImports(source)) {
				const targetLayer = sourceLayer(resolve(dirname(file), specifier));
				const allowed = allowedTargets[layer as keyof typeof allowedTargets];
				if (!allowed.has(targetLayer)) {
					violations.push(
						`${relative(sourceRoot, file)} imports ${specifier} (${targetLayer})`,
					);
				}
			}

			if (
				(layer === "domain" || layer === "application") &&
				/(?:from\s+|import\s*)["']@opencode-ai\//.test(source)
			) {
				violations.push(
					`${relative(sourceRoot, file)} imports the OpenCode host`,
				);
			}
		}
		expect(violations).toEqual([]);
	});
});
