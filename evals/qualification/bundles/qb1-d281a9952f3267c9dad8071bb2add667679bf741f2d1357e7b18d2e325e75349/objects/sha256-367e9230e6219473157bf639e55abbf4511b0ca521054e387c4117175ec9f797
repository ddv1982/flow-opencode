import { spawn } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
	lstat,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
	type BenchmarkCaseBinding,
	type BenchmarkProbe,
	type JsonValue,
	type RetainedBenchmarkInputs,
	RetainedBenchmarkInputsSchema,
} from "./benchmark-evidence.js";
import { canonicalJson } from "./canonical-json.js";
import { EvidenceStore, evidenceSha256 } from "./evidence-store.js";
import {
	FixtureSnapshotSchema,
	fixturePath,
	restoreSnapshot,
	snapshotFiles,
	snapshotProject,
} from "./fixture-snapshot.js";

const JsonSchema: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		z.null(),
		z.boolean(),
		z.number().finite(),
		z.string(),
		z.array(JsonSchema),
		z.record(z.string(), JsonSchema),
	]),
);
const ProbeSchema = z
	.object({
		id: z.string().min(1).max(256),
		module: z.string().refine(fixturePath),
		exportName: z.string().min(1).max(256),
		args: z.array(JsonSchema).max(128),
		preserveArgs: z.literal(true).optional(),
		expected: z.discriminatedUnion("kind", [
			z.object({ kind: z.literal("return"), value: JsonSchema }).strict(),
			z.object({ kind: z.literal("throw") }).strict(),
		]),
	})
	.strict();
export const BenchmarkOracleSchema = z
	.object({
		schemaVersion: z.literal(1),
		caseId: z.string().min(1).max(256),
		caseVersion: z.number().int().safe().positive(),
		probes: z.array(ProbeSchema).min(1).max(128),
	})
	.strict()
	.refine(
		(oracle) =>
			new Set(oracle.probes.map((probe) => probe.id)).size ===
			oracle.probes.length,
		"Probe IDs must be unique.",
	);

const SOURCE_FILES = [
	"benchmark-grader.ts",
	"benchmark-evidence.ts",
	"benchmark-transcript.ts",
	"canonical-json.ts",
	"completion-claim.ts",
	"evidence-store.ts",
	"fixture-snapshot.ts",
	"probe-worker.ts",
	"regrade-benchmark.ts",
] as const;
const RuntimeSchema = z
	.object({
		schemaVersion: z.literal(1),
		bunVersion: z.string().min(1),
		executableSha256: z.string(),
		dependencySha256: z.string(),
		lockfileSha256: z.string(),
		probeTimeoutMs: z.literal(5_000),
		maxResultBytes: z.literal(1024 * 1024),
		sources: z
			.array(
				z
					.object({
						path: z.enum(SOURCE_FILES),
						source: z.string(),
						sha256: z.string(),
					})
					.strict(),
			)
			.length(SOURCE_FILES.length),
		containment: z.literal("credential-free-subprocess-no-os-sandbox"),
	})
	.strict();

export const GradeReceiptSchema = z
	.object({
		schemaVersion: z.literal(1),
		inputs: RetainedBenchmarkInputsSchema,
		probes: z
			.array(
				z
					.object({
						id: z.string().min(1).max(256),
						disposition: z.enum(["passed", "failed", "not-observed"]),
						detail: z.string().max(1024).nullable(),
						observation: z.lazy(() => ObservationSchema).nullable(),
					})
					.strict(),
			)
			.min(1)
			.max(128),
		passed: z.boolean(),
		containment: z.literal("credential-free-subprocess-no-os-sandbox"),
	})
	.strict()
	.refine(
		(receipt) =>
			receipt.passed ===
				receipt.probes.every((probe) => probe.disposition === "passed") &&
			new Set(receipt.probes.map((probe) => probe.id)).size ===
				receipt.probes.length,
		"Grade must agree with all probe results.",
	);
export type GradeReceipt = z.infer<typeof GradeReceiptSchema>;

let executableDigest: Promise<string> | undefined;
async function dependencyDigest(): Promise<string> {
	const root = dirname(fileURLToPath(import.meta.resolve("zod/package.json")));
	const entries: { path: string; sha256: string }[] = [];
	const visit = async (relative: string): Promise<void> => {
		for (const name of (await readdir(join(root, relative))).sort()) {
			const path = relative ? `${relative}/${name}` : name;
			const stat = await lstat(join(root, path));
			if (stat.isDirectory()) await visit(path);
			else if (stat.isFile())
				entries.push({
					path,
					sha256: evidenceSha256(await readFile(join(root, path))),
				});
			else throw new Error("Grader dependency has an unsupported entry.");
		}
	};
	await visit("");
	return evidenceSha256(canonicalJson(entries));
}
export async function benchmarkRuntimeIdentity() {
	if (!process.versions.bun)
		throw new Error("Benchmark grading requires the recorded Bun runtime.");
	executableDigest ??= readFile(process.execPath).then(evidenceSha256);
	return RuntimeSchema.parse({
		schemaVersion: 1,
		bunVersion: process.versions.bun,
		executableSha256: await executableDigest,
		dependencySha256: await dependencyDigest(),
		lockfileSha256: evidenceSha256(
			await readFile(join(import.meta.dir, "..", "bun.lock")),
		),
		probeTimeoutMs: 5_000,
		maxResultBytes: 1024 * 1024,
		sources: await Promise.all(
			SOURCE_FILES.map(async (path) => {
				const source = await readFile(join(import.meta.dir, path), "utf8");
				return { path, source, sha256: evidenceSha256(source) };
			}),
		),
		containment: "credential-free-subprocess-no-os-sandbox",
	});
}

export function bindBenchmarkCase(
	benchmark: {
		id: string;
		caseVersion: number;
		files: Readonly<Record<string, string>>;
		probes: readonly BenchmarkProbe[];
	},
	runtimeSha256: string,
): BenchmarkCaseBinding {
	const oracle = BenchmarkOracleSchema.parse({
		schemaVersion: 1,
		caseId: benchmark.id,
		caseVersion: benchmark.caseVersion,
		probes: benchmark.probes,
	});
	return {
		caseId: benchmark.id,
		caseVersion: benchmark.caseVersion,
		baseSha256: evidenceSha256(canonicalJson(snapshotFiles(benchmark.files))),
		oracleSha256: evidenceSha256(canonicalJson(oracle)),
		runtimeSha256,
	};
}

export async function retainBenchmarkInputs(input: {
	project: string;
	benchmark: {
		id: string;
		caseVersion: number;
		files: Readonly<Record<string, string>>;
		probes: readonly BenchmarkProbe[];
	};
	store: EvidenceStore;
}): Promise<RetainedBenchmarkInputs> {
	const oracle = BenchmarkOracleSchema.parse({
		schemaVersion: 1,
		caseId: input.benchmark.id,
		caseVersion: input.benchmark.caseVersion,
		probes: input.benchmark.probes,
	});
	const [base, final, retainedOracle, runtime] = await Promise.all([
		input.store.writeJson(snapshotFiles(input.benchmark.files)),
		snapshotProject(input.project).then((snapshot) =>
			input.store.writeJson(snapshot),
		),
		input.store.writeJson(oracle),
		benchmarkRuntimeIdentity().then((identity) =>
			input.store.writeJson(identity),
		),
	]);
	return {
		schemaVersion: 1,
		caseId: oracle.caseId,
		caseVersion: oracle.caseVersion,
		base,
		final,
		oracle: retainedOracle,
		runtime,
	};
}

const ObservationSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("returned"),
			value: JsonSchema,
			args: z.array(JsonSchema),
		})
		.strict(),
	z.object({ kind: z.literal("threw"), args: z.array(JsonSchema) }).strict(),
	z
		.object({
			kind: z.literal("execution-error"),
			detail: z.string().max(1024),
		})
		.strict(),
]);

function runProbeProcess(input: {
	project: string;
	config: string;
	source: string;
	request: string;
	timeout: number;
	maxBytes: number;
}): Promise<{ status: number | null; failed: boolean; receipt: string }> {
	return new Promise((resolve) => {
		const child = spawn(
			process.execPath,
			[
				"--no-install",
				"--no-env-file",
				`--config=${input.config}`,
				"-e",
				input.source,
			],
			{
				cwd: input.project,
				stdio: ["pipe", "pipe", "pipe"],
				detached: process.platform !== "win32",
				env: {
					PATH: dirname(process.execPath),
					HOME: input.project,
					TMPDIR: input.project,
					BUN_INSTALL_CACHE_DIR: join(input.project, ".cache"),
				},
			},
		);
		let failed = false;
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const receiptChunks: Buffer[] = [];
		let bytes = 0;
		const terminate = () => {
			try {
				if (process.platform !== "win32" && child.pid)
					process.kill(-child.pid, "SIGKILL");
				else child.kill("SIGKILL");
			} catch {}
		};
		const settle = (status: number | null, closeStreams = false) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			terminate();
			if (closeStreams) {
				for (const stream of child.stdio) stream?.destroy();
				child.unref();
			}
			resolve({
				status,
				failed,
				receipt: Buffer.concat(receiptChunks).toString("utf8"),
			});
		};
		timer = setTimeout(() => {
			failed = true;
			settle(null, true);
		}, input.timeout);
		for (const [index, stream] of child.stdio.entries()) {
			if (index === 0 || !stream || !("on" in stream)) continue;
			stream.on("data", (chunk: Buffer) => {
				if (settled) return;
				bytes += chunk.length;
				if (bytes > input.maxBytes) {
					failed = true;
					settle(null, true);
					return;
				}
				if (index === 1) receiptChunks.push(chunk);
			});
		}
		child.on("error", () => {
			failed = true;
			settle(null, true);
		});
		child.on("close", (status) => {
			settle(status);
		});
		child.stdin?.on("error", () => {
			failed = true;
			settle(null, true);
		});
		child.stdin?.end(input.request);
	});
}

export async function gradeRetainedBenchmark(input: {
	inputs: RetainedBenchmarkInputs;
	store: EvidenceStore;
	requireOsSandbox?: boolean;
}): Promise<GradeReceipt> {
	if (input.requireOsSandbox)
		throw new Error(
			"OS sandbox containment is unavailable in this grading runtime.",
		);
	const inputs = RetainedBenchmarkInputsSchema.parse(input.inputs);
	const [baseInput, finalInput, oracleInput, runtimeInput, currentRuntime] =
		await Promise.all([
			input.store.readJson(inputs.base),
			input.store.readJson(inputs.final),
			input.store.readJson(inputs.oracle),
			input.store.readJson(inputs.runtime),
			benchmarkRuntimeIdentity(),
		]);
	FixtureSnapshotSchema.parse(baseInput);
	const snapshot = FixtureSnapshotSchema.parse(finalInput);
	const oracle = BenchmarkOracleSchema.parse(oracleInput);
	const runtime = RuntimeSchema.parse(runtimeInput);
	if (
		oracle.caseId !== inputs.caseId ||
		oracle.caseVersion !== inputs.caseVersion
	)
		throw new Error("Retained oracle does not match the attempt case.");
	if (canonicalJson(runtime) !== canonicalJson(currentRuntime))
		throw new Error(
			"Exact retained grader source or runtime identity is unavailable.",
		);
	const worker = runtime.sources.find(
		(source) => source.path === "probe-worker.ts",
	);
	if (!worker) throw new Error("Retained grader worker is absent.");
	const results: GradeReceipt["probes"] = [];
	for (const probe of oracle.probes) {
		const project = await mkdtemp(join(tmpdir(), "source-check-"));
		const authority = await mkdtemp(join(tmpdir(), "runtime-config-"));
		try {
			await restoreSnapshot(snapshot, project);
			const config = join(authority, "bunfig.toml");
			await writeFile(config, "");
			const authenticationKey = randomBytes(32).toString("hex");
			const execution = await runProbeProcess({
				project,
				config,
				source: worker.source,
				request: JSON.stringify({
					module: join(project, probe.module),
					exportName: probe.exportName,
					args: probe.args,
					authenticationKey,
				}),
				timeout: runtime.probeTimeoutMs,
				maxBytes: runtime.maxResultBytes,
			});
			let observation: z.infer<typeof ObservationSchema> | null = null;
			let authenticated = 0;
			for (const line of execution.receipt.split("\n")) {
				try {
					const envelope = z
						.object({
							message: z.string(),
							authentication: z.string().regex(/^[a-f0-9]{64}$/),
						})
						.strict()
						.parse(JSON.parse(line));
					const expected = createHmac("sha256", authenticationKey)
						.update(envelope.message)
						.digest();
					if (
						!timingSafeEqual(
							expected,
							Buffer.from(envelope.authentication, "hex"),
						)
					)
						continue;
					authenticated += 1;
					const parsed = ObservationSchema.safeParse(
						JSON.parse(envelope.message),
					);
					if (parsed.success) observation = parsed.data;
				} catch {}
			}
			if (
				execution.failed ||
				execution.status !== 0 ||
				authenticated !== 1 ||
				!observation
			) {
				results.push({
					id: probe.id,
					disposition: "not-observed",
					observation: null,
					detail:
						"Candidate execution did not produce one complete result observation.",
				});
				continue;
			}
			const behaviorPassed =
				probe.expected.kind === "throw"
					? observation.kind === "threw"
					: observation.kind === "returned" &&
						canonicalJson(observation.value) ===
							canonicalJson(probe.expected.value);
			const passed =
				behaviorPassed &&
				(!probe.preserveArgs ||
					(observation.kind !== "execution-error" &&
						canonicalJson(observation.args) === canonicalJson(probe.args)));
			results.push({
				id: probe.id,
				disposition: passed ? "passed" : "failed",
				observation,
				detail: passed
					? null
					: observation.kind === "execution-error"
						? observation.detail
						: "Observed behavior differs from the independent expected result.",
			});
		} finally {
			await Promise.all([
				rm(project, { recursive: true, force: true }),
				rm(authority, { recursive: true, force: true }),
			]);
		}
	}
	return GradeReceiptSchema.parse({
		schemaVersion: 1,
		inputs,
		probes: results,
		passed: results.every((result) => result.disposition === "passed"),
		containment: runtime.containment,
	});
}

export async function gradeDevelopmentProject(
	project: string,
	benchmark: {
		id: string;
		caseVersion: number;
		files: Readonly<Record<string, string>>;
		probes: readonly BenchmarkProbe[];
	},
): Promise<{ passed: boolean; issues: string[] }> {
	const directory = await mkdtemp(join(tmpdir(), "source-evidence-"));
	try {
		const store = new EvidenceStore(directory);
		const inputs = await retainBenchmarkInputs({ project, benchmark, store });
		const receipt = await gradeRetainedBenchmark({ inputs, store });
		return {
			passed: receipt.passed,
			issues: receipt.probes
				.filter((probe) => probe.disposition !== "passed")
				.map((probe) => `${probe.id}: ${probe.detail}`),
		};
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
