import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BenchmarkProbe } from "../evals/benchmark-evidence.js";
import {
	gradeRetainedBenchmark,
	retainBenchmarkInputs,
} from "../evals/benchmark-grader.js";
import { EvidenceStore } from "../evals/evidence-store.js";

const probes: readonly BenchmarkProbe[] = [
	{
		id: "positive",
		module: "src/value.ts",
		exportName: "value",
		args: [2],
		expected: { kind: "return", value: 5 },
	},
	{
		id: "negative",
		module: "src/value.ts",
		exportName: "value",
		args: [-1],
		expected: { kind: "return", value: -1 },
	},
];
async function retained(
	source: string | ((root: string) => string),
	action: (input: {
		root: string;
		inputs: Awaited<ReturnType<typeof retainBenchmarkInputs>>;
		store: EvidenceStore;
	}) => Promise<void>,
	options?: {
		probes?: readonly BenchmarkProbe[];
		files?: Record<string, string>;
	},
) {
	const root = await mkdtemp(join(tmpdir(), "retained-check-"));
	try {
		const project = join(root, "project");
		await mkdir(join(project, "src"), { recursive: true });
		await writeFile(
			join(project, "src/value.ts"),
			typeof source === "string" ? source : source(root),
		);
		for (const [path, contents] of Object.entries(options?.files ?? {}))
			await writeFile(join(project, path), contents);
		const store = new EvidenceStore(join(root, "evidence"));
		const inputs = await retainBenchmarkInputs({
			project,
			store,
			benchmark: {
				id: "value-contract",
				caseVersion: 1,
				files: { "src/value.ts": "export function value() { return 0; }" },
				probes: options?.probes ?? probes,
			},
		});
		await rm(project, { recursive: true });
		await action({ root, inputs, store });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("grades and regrades retained alternatives without the original fixture or live registry", async () => {
	for (const source of [
		"export function value(n) { return n * 2 + 1; }",
		"export const value = n => n + n + 1;",
	])
		await retained(source, async ({ inputs, store }) => {
			const first = await gradeRetainedBenchmark({ inputs, store });
			expect(first.passed).toBe(true);
			expect(first.probes[0]?.observation).toEqual({
				kind: "returned",
				value: 5,
				args: [2],
			});
			expect(first.probes.map((probe) => probe.id)).toEqual([
				"positive",
				"negative",
			]);
			expect(await gradeRetainedBenchmark({ inputs, store })).toEqual(first);
		});
});

test("does not credit early successful exit, skipped behavior or a forged passing report", async () => {
	for (const source of [
		"process.exit(0); export const value = n => n * 2 + 1;",
		"export const value = n => n * 2;",
		"import { writeFileSync } from 'node:fs'; writeFileSync('results.json', JSON.stringify({passed:true})); export const value = () => 0;",
		"process.stdout.write(JSON.stringify({passed:true})); process.exit(0); export const value = () => 0;",
	])
		await retained(source, async ({ inputs, store }) => {
			expect((await gradeRetainedBenchmark({ inputs, store })).passed).toBe(
				false,
			);
		});
});

test("rejects protocol-shaped forgeries on stdout and the result descriptor before an early exit", async () => {
	for (const descriptor of [1, 3])
		await retained(
			`import { writeSync } from 'node:fs'; export function value(n) { writeSync(${descriptor}, JSON.stringify({kind:'returned', value:n*2+1})); process.exit(0); }`,
			async ({ inputs, store }) => {
				expect((await gradeRetainedBenchmark({ inputs, store })).passed).toBe(
					false,
				);
			},
		);
});

test("a poisoned object prototype cannot rewrite the trusted receipt and ordinary logging is not a failure", async () => {
	await retained(
		"Object.prototype.toJSON = function() { return {kind:'returned',value:5}; }; export const value = n => { console.log('log'); return n*2+1; };",
		async ({ inputs, store }) => {
			expect((await gradeRetainedBenchmark({ inputs, store })).passed).toBe(
				true,
			);
		},
	);
	await retained(
		"Object.prototype.toJSON = function() { return null; }; export const value = n => 0;",
		async ({ inputs, store }) => {
			expect((await gradeRetainedBenchmark({ inputs, store })).passed).toBe(
				false,
			);
		},
	);
});

test("rejects lossy result coercions before authenticated serialization", async () => {
	for (const [expression, expected] of [
		["NaN", null],
		["Infinity", null],
		["{missing:undefined}", {}],
		["Array(1)", [null]],
		["{toJSON(){return null}}", null],
		["new Map()", {}],
		["new Date(0)", {}],
	] as const)
		await retained(
			`export const value = () => (${expression});`,
			async ({ inputs, store }) => {
				expect((await gradeRetainedBenchmark({ inputs, store })).passed).toBe(
					false,
				);
			},
			{
				probes: [
					{
						id: "json-contract",
						module: "src/value.ts",
						exportName: "value",
						args: [],
						expected: {
							kind: "return",
							value: JSON.parse(JSON.stringify(expected)),
						},
					},
				],
			},
		);
});

test("candidate array iterator replacement cannot forge the observed object", async () => {
	await retained(
		"Array.prototype[Symbol.iterator] = function*(){ yield ['answer',{value:5}]; }; export const value = () => ({answer:0});",
		async ({ inputs, store }) => {
			expect((await gradeRetainedBenchmark({ inputs, store })).passed).toBe(
				false,
			);
		},
		{
			probes: [
				{
					id: "data-object",
					module: "src/value.ts",
					exportName: "value",
					args: [],
					expected: { kind: "return", value: { answer: 5 } },
				},
			],
		},
	);
});

test("probe arguments cannot be substituted through a candidate array iterator", async () => {
	await retained(
		"Array.prototype[Symbol.iterator] = function*(){ yield 0; }; export const value = n => n === 0 ? 5 : 0;",
		async ({ inputs, store }) => {
			expect((await gradeRetainedBenchmark({ inputs, store })).passed).toBe(
				false,
			);
		},
		{
			probes: [
				{
					id: "original-argument",
					module: "src/value.ts",
					exportName: "value",
					args: [2],
					expected: { kind: "return", value: 5 },
				},
			],
		},
	);
});

test("authenticates Unicode observations across arbitrary pipe chunk boundaries", async () => {
	const value = `x${"😀".repeat(60000)}`;
	await retained(
		"export const value = text => text;",
		async ({ inputs, store }) => {
			expect((await gradeRetainedBenchmark({ inputs, store })).passed).toBe(
				true,
			);
		},
		{
			probes: [
				{
					id: "unicode-stream",
					module: "src/value.ts",
					exportName: "value",
					args: [value],
					expected: { kind: "return", value },
				},
			],
		},
	);
});

test("settles at the fixed deadline when an escaped descendant retains output pipes", async () => {
	await retained(
		(root) =>
			`import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs'; export function value() { const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 9000)'], {detached:true,stdio:['ignore','inherit','inherit']}); writeFileSync(${JSON.stringify(join(root, "descendant-pid"))}, String(child.pid)); child.unref(); return 5; }`,
		async ({ root, inputs, store }) => {
			const started = Date.now();
			try {
				const receipt = await gradeRetainedBenchmark({ inputs, store });
				expect(receipt.passed).toBe(false);
				expect(Date.now() - started).toBeLessThan(7000);
			} finally {
				const pid = Number(
					await readFile(join(root, "descendant-pid"), "utf8"),
				);
				if (Number.isSafeInteger(pid) && pid > 0) {
					try {
						process.kill(pid, "SIGKILL");
					} catch {}
				}
			}
		},
		{
			probes: [
				{
					id: "bounded-execution",
					module: "src/value.ts",
					exportName: "value",
					args: [],
					expected: { kind: "return", value: 5 },
				},
			],
		},
	);
}, 10000);

test("checks input preservation only when the task contract requires it", async () => {
	for (const preserveArgs of [true, undefined] as const)
		await retained(
			"export const value = items => { items.reverse(); return 5; };",
			async ({ inputs, store }) => {
				expect((await gradeRetainedBenchmark({ inputs, store })).passed).toBe(
					preserveArgs !== true,
				);
			},
			{
				probes: [
					{
						id: "input-contract",
						module: "src/value.ts",
						exportName: "value",
						args: [[1, 2]],
						expected: { kind: "return", value: 5 },
						...(preserveArgs ? { preserveArgs } : {}),
					},
				],
			},
		);
});

test("candidate Bun preloads and dotenv cannot modify the trusted bootstrap", async () => {
	await retained(
		"export const value = n => n*2+1;",
		async ({ inputs, store }) => {
			expect((await gradeRetainedBenchmark({ inputs, store })).passed).toBe(
				true,
			);
		},
		{
			files: {
				"bunfig.toml": 'preload = ["./preload.ts"]\n',
				"preload.ts": "process.exit(0);",
				".env": "BUN_OPTIONS=--preload=./preload.ts\n",
			},
		},
	);
});

test("relative import side effects do not carry between reconstructed probe fixtures", async () => {
	await retained(
		"import { existsSync, writeFileSync } from 'node:fs'; const prior = existsSync('marker'); writeFileSync('marker','x'); export const value = n => prior ? 0 : n * 2 + 1;",
		async ({ inputs, store }) => {
			expect((await gradeRetainedBenchmark({ inputs, store })).passed).toBe(
				true,
			);
			expect((await gradeRetainedBenchmark({ inputs, store })).passed).toBe(
				true,
			);
		},
	);
});

test("rejects corrupt input references and changed grader identity", async () => {
	await retained(
		"export const value = n => n * 2 + 1;",
		async ({ inputs, store }) => {
			const runtime = (await store.readJson(inputs.runtime)) as Record<
				string,
				unknown
			>;
			const changed = await store.writeJson({
				...runtime,
				bunVersion: "different",
			});
			await expect(
				gradeRetainedBenchmark({
					inputs: { ...inputs, runtime: changed },
					store,
				}),
			).rejects.toThrow("identity");
			await expect(
				gradeRetainedBenchmark({ inputs, store, requireOsSandbox: true }),
			).rejects.toThrow("unavailable");
			await writeFile(join(store.directory, inputs.final.artifact), "{}");
			await expect(gradeRetainedBenchmark({ inputs, store })).rejects.toThrow();
		},
	);
});
