import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { BenchmarkProbe } from "../evals/benchmark-evidence.js";
import {
	BenchmarkOracleSchema,
	gradeDevelopmentProject,
} from "../evals/benchmark-grader.js";
import { DEVELOPMENT_CASES } from "../evals/development-cases.js";

const HOLDOUT_DIRECTORY = join(import.meta.dir, "../evals/holdout");
const MANIFEST_DIGEST =
	"sha256:dbb52b76d38a967329342deed33b7fe042c7836f9ca268a0115e0c3c519b1898";
const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const ObjectId = z.string().regex(/^sha256-[a-f0-9]{64}$/);
const ManifestSchema = z
	.object({
		schemaVersion: z.literal(1),
		purpose: z.literal("sealed-confirmation"),
		used: z.literal(false),
		count: z.number().int().min(12),
		objects: z.array(
			z
				.object({
					id: ObjectId,
					artifact: z.string().regex(/^objects\/sha256-[a-f0-9]{64}$/),
					sha256: Digest,
					bytes: z.number().int().positive(),
					taskClass: z.enum([
						"allocation",
						"batch-processing",
						"date-processing",
						"encoding-validation",
						"numeric-processing",
						"ordering",
						"path-validation",
						"preference-selection",
						"state-lifecycle",
						"structure-traversal",
						"text-transformation",
					]),
				})
				.strict(),
		),
	})
	.strict();

const Files = z.record(z.string(), z.string());
const SealedFixtureSchema = z
	.object({
		schemaVersion: z.literal(1),
		purpose: z.literal("sealed-confirmation"),
		used: z.literal(false),
		case: z
			.object({
				id: ObjectId,
				caseVersion: z.number().int().positive(),
				description: z.string().min(1),
				files: Files,
				prompt: z.string().min(40),
				probes: z.array(z.unknown()).min(4),
				knownBadMutations: z
					.array(z.object({ id: z.string(), fileOverrides: Files }).strict())
					.min(2),
				provenance: z
					.object({
						kind: z.literal("synthetic-development"),
						source: z.string().min(40),
					})
					.strict(),
			})
			.strict(),
		knownGoodFileOverrides: Files,
	})
	.strict();

function digest(value: Uint8Array | string): string {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function manifest() {
	const raw = await readFile(join(HOLDOUT_DIRECTORY, "manifest.json"));
	const parsed = ManifestSchema.safeParse(JSON.parse(raw.toString()));
	if (!parsed.success) throw new Error("Invalid sealed manifest metadata.");
	return { raw, data: parsed.data };
}

async function sealedFixture(artifact: string) {
	try {
		const raw = await readFile(join(HOLDOUT_DIRECTORY, artifact));
		const parsed = SealedFixtureSchema.safeParse(JSON.parse(raw.toString()));
		if (!parsed.success) throw new Error();
		const oracle = BenchmarkOracleSchema.safeParse({
			schemaVersion: 1,
			caseId: parsed.data.case.id,
			caseVersion: parsed.data.case.caseVersion,
			probes: parsed.data.case.probes,
		});
		if (!oracle.success) throw new Error();
		return {
			raw,
			data: {
				...parsed.data,
				case: {
					...parsed.data.case,
					probes: oracle.data.probes.map(
						({ preserveArgs, ...probe }): BenchmarkProbe =>
							preserveArgs ? { ...probe, preserveArgs } : probe,
					),
				},
			},
		};
	} catch {
		throw new Error("A sealed fixture failed its structural check.");
	}
}

async function inProject<T>(
	files: Readonly<Record<string, string>>,
	check: (directory: string) => Promise<T>,
): Promise<T> {
	const directory = await mkdtemp(join(tmpdir(), "sealed-check-"));
	try {
		for (const [path, contents] of Object.entries(files)) {
			const target = join(directory, path);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, contents);
		}
		return await check(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

describe("sealed confirmation corpus", () => {
	test("pins twelve opaque artifacts with hash-only public metadata", async () => {
		const { raw, data } = await manifest();
		expect(digest(raw)).toBe(MANIFEST_DIGEST);
		expect(data.count).toBe(data.objects.length);
		expect(new Set(data.objects.map((entry) => entry.id)).size).toBe(
			data.count,
		);
		const names = await readdir(join(HOLDOUT_DIRECTORY, "objects"));
		expect(names.length).toBe(data.count);
		let valid = 0;
		for (const entry of data.objects) {
			const bytes = await readFile(join(HOLDOUT_DIRECTORY, entry.artifact));
			if (
				digest(bytes) === entry.sha256 &&
				bytes.byteLength === entry.bytes &&
				entry.id === entry.sha256.replace("sha256:", "sha256-") &&
				entry.artifact === `objects/${entry.id}` &&
				names.includes(entry.id)
			)
				valid++;
		}
		expect(valid).toBe(data.count);
	});

	test("holds separate complete task contracts without development imports", async () => {
		const { data } = await manifest();
		const promptDigests = new Set<string>();
		const caseIds = new Set<string>();
		const sourceDigests = new Set<string>();
		const developmentPrompts = new Set(
			DEVELOPMENT_CASES.map((item) => digest(item.prompt)),
		);
		let valid = 0;
		for (const entry of data.objects) {
			const { data: fixture } = await sealedFixture(entry.artifact);
			const item = fixture.case;
			const promptDigest = digest(item.prompt);
			promptDigests.add(promptDigest);
			caseIds.add(item.id);
			sourceDigests.add(digest(JSON.stringify(fixture.knownGoodFileOverrides)));
			const packageJson = JSON.parse(item.files["package.json"] ?? "null");
			const labeled = /\b(?:flow|evals?|benchmarks?)\b/i.test(
				`${packageJson?.name} ${item.prompt} ${Object.keys(item.files).join(" ")}`,
			);
			const paths = [
				...Object.keys(item.files),
				...Object.keys(fixture.knownGoodFileOverrides),
				...item.knownBadMutations.flatMap((mutation) =>
					Object.keys(mutation.fileOverrides),
				),
			];
			const validPaths = paths.every(
				(path) =>
					!path.startsWith("/") &&
					!path.split("/").includes("..") &&
					!path.includes("\\"),
			);
			const promisesPreservation =
				/(?:do not|without) (?:mutate|chang)|(?:keep|leave) (?:the )?input (?:untouched|unchanged)/i.test(
					item.prompt,
				);
			const checksPreservation = item.probes.every(
				(probe) => probe.preserveArgs === true,
			);
			if (
				!labeled &&
				validPaths &&
				promisesPreservation === checksPreservation &&
				!developmentPrompts.has(promptDigest) &&
				item.probes.every((probe) => Object.hasOwn(item.files, probe.module)) &&
				Object.keys(fixture.knownGoodFileOverrides).length > 0 &&
				item.knownBadMutations.every(
					(mutation) => Object.keys(mutation.fileOverrides).length > 0,
				)
			)
				valid++;
		}
		expect(valid).toBe(data.count);
		expect(promptDigests.size).toBe(data.count);
		expect(caseIds.size).toBe(data.count);
		expect(sourceDigests.size).toBe(data.count);
		const entrypoints = [
			"benchmark-run.ts",
			"benchmarks.ts",
			"benchmark.ts",
			"development-cases.ts",
		];
		let importsHoldout = false;
		for (const path of entrypoints) {
			const source = await readFile(
				join(import.meta.dir, "../evals", path),
				"utf8",
			);
			importsHoldout ||= /(?:from\s+|import\s*\(?\s*)["'][^"']*holdout\//.test(
				source,
			);
		}
		expect(importsHoldout).toBe(false);
	});

	test("executes local oracles and mutations while reporting only aggregate counts", async () => {
		const { data } = await manifest();
		let goodPasses = 0;
		let badRejections = 0;
		let expectedBad = 0;
		let publicPasses = 0;
		let executionErrors = 0;
		let argumentControls = 0;
		let outputOnlyPasses = 0;
		for (const entry of data.objects) {
			try {
				const { data: fixture } = await sealedFixture(entry.artifact);
				const item = fixture.case;
				const corrected = { ...item.files, ...fixture.knownGoodFileOverrides };
				await inProject(corrected, async (directory) => {
					if ((await gradeDevelopmentProject(directory, item)).passed)
						goodPasses++;
					const execution = spawnSync(process.execPath, ["run", "test"], {
						cwd: directory,
						encoding: "utf8",
						timeout: 10_000,
					});
					if (!execution.error && execution.status === 0) publicPasses++;
				});
				for (const mutation of item.knownBadMutations) {
					expectedBad++;
					await inProject(
						{ ...corrected, ...mutation.fileOverrides },
						async (directory) => {
							if (
								mutation.id === "m2" &&
								item.probes.every((probe) => probe.preserveArgs === true)
							) {
								argumentControls++;
								const outputOnly = {
									...item,
									probes: item.probes.map(
										({ preserveArgs: _preserveArgs, ...probe }) => probe,
									),
								};
								if (
									(await gradeDevelopmentProject(directory, outputOnly)).passed
								)
									outputOnlyPasses++;
							}
							if (!(await gradeDevelopmentProject(directory, item)).passed)
								badRejections++;
						},
					);
				}
			} catch {
				executionErrors++;
			}
		}
		expect(executionErrors).toBe(0);
		expect(goodPasses).toBe(data.count);
		expect(publicPasses).toBe(data.count);
		expect(expectedBad).toBeGreaterThanOrEqual(data.count * 2);
		expect(badRejections).toBe(expectedBad);
		expect(argumentControls).toBe(5);
		expect(outputOnlyPasses).toBe(argumentControls);
	}, 60_000);
});
