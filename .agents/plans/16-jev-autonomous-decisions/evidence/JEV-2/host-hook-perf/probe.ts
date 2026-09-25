import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [modulePath, outputPath] = process.argv.slice(2);
if (!modulePath || !outputPath)
	throw new Error("Expected plugin module and output paths");
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
	const files: string[] = [];
	async function visit(directory: string): Promise<void> {
		for (const item of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, item.name);
			if (item.isDirectory()) await visit(path);
			else if (item.isFile()) files.push(`src/${relative(sourceRoot, path)}`);
			else throw new Error(`Unsupported source entry: ${path}`);
		}
	}
	await visit(sourceRoot);
	files.sort();
	const hash = createHash("sha256");
	for (const path of files) {
		const bytes = await readFile(join(sourceRoot, path.slice(4)));
		const length = Buffer.alloc(8);
		length.writeBigUInt64BE(BigInt(bytes.length));
		hash.update(path).update("\0").update(length).update(bytes);
	}
	return { digest: hash.digest("hex"), fileCount: files.length };
}
const percentile = (samples: number[], fraction: number) => {
	const ordered = samples.toSorted((a, b) => a - b);
	return ordered[Math.ceil(fraction * ordered.length) - 1];
};
const rssBeforeImportBytes = process.memoryUsage().rss;
const FlowPlugin = (await import(pathToFileURL(modulePath).href)).default;
const rssAfterImportBytes = process.memoryUsage().rss;
const sourceTree = await sourceTreeIdentity();
const workspace = await mkdtemp(join(tmpdir(), "flow-idle-hook-"));
let promptCalls = 0;
let fetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
	fetchCalls++;
	throw new Error(`Network call during disabled mode: ${String(args[0])}`);
}) as typeof fetch;
const context = {
	client: {
		app: { log() {} },
		session: {
			promptAsync() {
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
	const output = {
		schemaVersion: 1,
		fixture,
		fixtureDigest: sha(JSON.stringify(fixture)),
		moduleSha256: sha(await readFile(modulePath)),
		sourceTreeDigest: sourceTree.digest,
		sourceFileCount: sourceTree.fileCount,
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
		rssAfterProbeBytes: process.memoryUsage().rss,
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
