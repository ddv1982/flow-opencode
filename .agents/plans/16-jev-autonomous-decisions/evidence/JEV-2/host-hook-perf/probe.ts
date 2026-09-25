import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [modulePath, outputPath, arm, pairText, ordinalText] =
	process.argv.slice(2);
const pairIndex = Number(pairText);
const sequenceOrdinal = Number(ordinalText);
const captureOrder = [
	["trunk", 1],
	["head", 1],
	["head", 2],
	["trunk", 2],
	["trunk", 3],
	["head", 3],
] as const;
if (
	!modulePath ||
	!outputPath ||
	!Number.isInteger(sequenceOrdinal) ||
	!Number.isInteger(pairIndex) ||
	captureOrder[sequenceOrdinal - 1]?.[0] !== arm ||
	captureOrder[sequenceOrdinal - 1]?.[1] !== pairIndex
)
	throw new Error(
		"Expected plugin module, output, arm, pair, and capture ordinal",
	);
const captureStartedAt = new Date().toISOString();
const fixture = {
	event: "session.idle",
	command: "flow-auto",
	workflow: "idle-workspace-initial-prompt",
	warmup: 300,
	samples: 1500,
	hostSessionId: "host-1",
};
const sha = (value: string | Uint8Array) =>
	createHash("sha256").update(value).digest("hex");
async function sourceTreeIdentity() {
	const sourceRoot = resolve(dirname(modulePath), "..", "..");
	const repositoryRoot = resolve(sourceRoot, "..");
	async function collect(directory: string, prefix: string): Promise<string[]> {
		const files: string[] = [];
		async function visit(current: string): Promise<void> {
			for (const item of await readdir(current, { withFileTypes: true })) {
				const path = join(current, item.name);
				if (item.isDirectory()) await visit(path);
				else if (item.isFile())
					files.push(`${prefix}/${relative(directory, path)}`);
				else throw new Error(`Unsupported source entry: ${path}`);
			}
		}
		await visit(directory);
		return files;
	}
	async function digest(files: string[]) {
		const hash = createHash("sha256");
		for (const path of files.toSorted()) {
			const bytes = await readFile(join(repositoryRoot, path));
			const length = Buffer.alloc(8);
			length.writeBigUInt64BE(BigInt(bytes.length));
			hash.update(path).update("\0").update(length).update(bytes);
		}
		return hash.digest("hex");
	}
	const sourceFiles = await collect(sourceRoot, "src");
	const runtimeFiles = [
		...sourceFiles,
		...(await collect(join(repositoryRoot, "skills"), "skills")),
		"package.json",
		"bun.lock",
	];
	return {
		digest: await digest(sourceFiles),
		fileCount: sourceFiles.length,
		runtimeDigest: await digest(runtimeFiles),
		runtimeFileCount: runtimeFiles.length,
	};
}
const percentile = (samples: number[], fraction: number) => {
	const ordered = samples.toSorted((a, b) => a - b);
	return ordered[Math.ceil(fraction * ordered.length) - 1];
};
const rssBeforeImportBytes = process.memoryUsage().rss;
const FlowPlugin = (await import(pathToFileURL(modulePath).href)).default;
const rssAfterImportBytes = process.memoryUsage().rss;
const workspace = await mkdtemp(join(tmpdir(), "flow-idle-hook-"));
let promptCalls = 0;
let fetchCalls = 0;
let activationToken: string | null = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
	fetchCalls++;
	throw new Error(`Network call during disabled mode: ${String(args[0])}`);
}) as typeof fetch;
const context = {
	client: {
		app: { log() {} },
		session: {
			promptAsync(request: unknown) {
				const row = request as {
					path?: { id?: string };
					query?: { directory?: string };
					body?: {
						agent?: string;
						model?: { providerID?: string; modelID?: string };
						parts?: Array<{
							type?: string;
							text?: string;
							synthetic?: boolean;
							metadata?: Record<string, unknown>;
						}>;
					};
					throwOnError?: boolean;
				};
				const part = row.body?.parts?.[0];
				if (
					row.path?.id !== fixture.hostSessionId ||
					row.query?.directory !== workspace ||
					row.body?.agent !== "build" ||
					row.body.model?.providerID !== "provider" ||
					row.body.model.modelID !== "model" ||
					row.body.parts?.length !== 1 ||
					part?.type !== "text" ||
					part.synthetic !== true ||
					!part.text?.startsWith(
						"Read compact status, load flow-plan, then call flow_plan_save.\n\n",
					) ||
					part.metadata?.["opencode-plugin-flow/auto"] !== activationToken ||
					row.throwOnError !== true
				)
					throw new Error("Unexpected initial-route prompt request.");
				promptCalls++;
				return Promise.resolve({ data: undefined });
			},
		},
		tui: { showToast: () => Promise.resolve({ data: undefined }) },
	},
	project: {},
	directory: workspace,
	worktree: workspace,
	experimental_workspace: { register() {} },
	serverUrl: new URL("http://localhost"),
	$: {},
};
let hooks: Awaited<ReturnType<typeof FlowPlugin>> | undefined;
try {
	hooks = await FlowPlugin(context, {});
	const before = hooks["command.execute.before"];
	const chat = hooks["chat.message"];
	const event = hooks.event;
	if (!before || !chat || !event) throw new Error("Missing plugin host hooks");
	const rssAfterHooksBytes = process.memoryUsage().rss;
	const samplesUs: number[] = [];
	for (let index = 0; index < fixture.warmup + fixture.samples; index++) {
		const commandOutput = { parts: [{ type: "text", text: "stale" }] };
		await before(
			{
				command: fixture.command,
				sessionID: fixture.hostSessionId,
				arguments: "",
			},
			commandOutput,
		);
		const instruction = commandOutput.parts.find(
			(part) => (part as { synthetic?: boolean }).synthetic === true,
		);
		const token = (
			instruction as { metadata?: Record<string, unknown> } | undefined
		)?.metadata?.["opencode-plugin-flow/auto"];
		if (typeof token !== "string" || !token)
			throw new Error(`Missing activation token at command ${index}`);
		activationToken = token;
		await chat(
			{ sessionID: fixture.hostSessionId },
			{
				message: {
					id: `command-${index}`,
					agent: "build",
					model: { providerID: "provider", modelID: "model" },
				},
				parts: commandOutput.parts,
			},
		);
		const priorPrompts = promptCalls;
		const started = performance.now();
		await event({
			event: {
				type: fixture.event,
				properties: { sessionID: fixture.hostSessionId },
			},
		});
		if (index >= fixture.warmup)
			samplesUs.push((performance.now() - started) * 1000);
		if (promptCalls !== priorPrompts + 1)
			throw new Error(`Unexpected prompt count at event ${index}`);
	}
	if (fetchCalls !== 0) throw new Error("Disabled mode made a fetch call");
	const captureEndedAt = new Date().toISOString();
	const rssAfterProbeBytes = process.memoryUsage().rss;
	const sourceTree = await sourceTreeIdentity();
	const output = {
		schemaVersion: 1,
		arm,
		pairIndex,
		sequenceOrdinal,
		captureStartedAt,
		captureEndedAt,
		fixture,
		fixtureDigest: sha(JSON.stringify(fixture)),
		moduleSha256: sha(await readFile(modulePath)),
		sourceTreeDigest: sourceTree.digest,
		sourceFileCount: sourceTree.fileCount,
		runtimeInputDigest: sourceTree.runtimeDigest,
		runtimeInputFileCount: sourceTree.runtimeFileCount,
		runtime: {
			bun: Bun.version,
			platform: process.platform,
			arch: process.arch,
		},
		fetchCalls,
		promptCalls,
		rssBeforeImportBytes,
		rssAfterImportBytes,
		rssAfterHooksBytes,
		rssAfterProbeBytes,
		samplesUs,
		p50Us: percentile(samplesUs, 0.5),
		p95Us: percentile(samplesUs, 0.95),
	};
	await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
	process.stdout.write(
		`${JSON.stringify({ samples: samplesUs.length, promptCalls, fetchCalls, p95Us: output.p95Us, rssAfterProbeBytes: output.rssAfterProbeBytes })}\n`,
	);
} finally {
	await hooks?.dispose?.();
	globalThis.fetch = originalFetch;
	await rm(workspace, { recursive: true, force: true });
}
