import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const [modulePath, outputPath, recoveryPath] = process.argv.slice(2);
if (!modulePath || !outputPath)
	throw new Error("Expected module and output paths");
const rssColdBeforeBytes = process.memoryUsage().rss;
const { AutoDriveCoordinator } = await import(pathToFileURL(modulePath).href);
const RecoveryController = recoveryPath
	? (await import(pathToFileURL(recoveryPath).href)).RecoveryController
	: null;
const delivery = {
	agent: "build",
	model: { providerID: "provider", modelID: "model" },
};
const scenarios = [
	"no-lease",
	"ready-continuation",
	"blocked-handback",
	"recovery-checkpoint",
	"inactive",
] as const;
const fixture = {
	scenarios,
	warmupPerScenario: 300,
	samplesPerScenario: 1500,
	hostSessionId: "host-1",
	initialRevision: 11,
	nextRevision: 12,
};
const rssAfterImportsBytes = process.memoryUsage().rss;
const rssBefore = rssAfterImportsBytes;
const rssCheckpoints: number[] = [];
let fetchCalls = 0;
let providerCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
	fetchCalls++;
	throw new Error(`Network call during disabled mode: ${String(args[0])}`);
}) as typeof fetch;

async function makeCase(kind: (typeof scenarios)[number]) {
	let projection =
		kind === "no-lease"
			? { status: "idle", revision: 0, nextAction: null }
			: {
					sessionId: "flow-1",
					status: "ready",
					revision: 11,
					nextAction: "flow_run_start",
				};
	let prompts = 0;
	let warnings = 0;
	let reads = 0;
	let proposalLookups = 0;
	const recovery = RecoveryController
		? new RecoveryController({
				decide: () => {
					providerCalls++;
					throw new Error("Provider call during disabled mode");
				},
			})
		: undefined;
	if (recovery) {
		const original = recovery.proposalPrompt.bind(recovery);
		recovery.proposalPrompt = (
			host: string,
			session: string | undefined,
			revision: number,
			nextAction: string | null,
		) => {
			proposalLookups++;
			return original(host, session, revision, nextAction);
		};
	}
	const driver = new AutoDriveCoordinator({
		recovery,
		readProjection: () => {
			reads++;
			return Promise.resolve(projection);
		},
		prompt: () => {
			prompts++;
			return Promise.resolve();
		},
		onWarning: () => {
			warnings++;
		},
		createToken: () => "token-1",
		now: () => 0,
	});
	if (kind !== "no-lease") {
		const metadata = await driver.activate("host-1");
		await driver.observeMessage(
			"host-1",
			delivery,
			[{ synthetic: true, metadata }],
			"command-message",
		);
		if (kind === "ready-continuation") {
			projection = {
				sessionId: "flow-1",
				status: "ready",
				revision: 12,
				nextAction: "flow_run_start",
			};
			driver.observeHostMessage("host-1", {
				id: "assistant-1",
				role: "assistant",
				parentID: "command-message",
			});
			driver.observeMutation("host-1", 12, undefined, "assistant-1", false);
		} else if (kind === "blocked-handback" || kind === "recovery-checkpoint") {
			projection = {
				sessionId: "flow-1",
				status: "blocked",
				revision: 12,
				nextAction:
					kind === "recovery-checkpoint"
						? "await-user-direction"
						: "flow_feature_reset",
			};
			driver.observeHostMessage("host-1", {
				id: "assistant-1",
				role: "assistant",
				parentID: "command-message",
			});
			driver.observeMutation("host-1", 12, undefined, "assistant-1", false);
		} else {
			projection = { status: "idle", revision: 0, nextAction: null };
		}
	}
	reads = 0;
	return {
		driver,
		counters: () => ({ prompts, warnings, reads, proposalLookups }),
	};
}
function percentile(samples: number[], p: number) {
	const sorted = samples.toSorted((a, b) => a - b);
	return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}
const results = [];
for (const kind of scenarios) {
	for (let i = 0; i < fixture.warmupPerScenario; i++)
		await (await makeCase(kind)).driver.onIdle("host-1");
	const samples = [];
	let promptTotal = 0,
		warningTotal = 0,
		readTotal = 0,
		proposalLookupTotal = 0;
	for (let i = 0; i < fixture.samplesPerScenario; i++) {
		const run = await makeCase(kind);
		const start = performance.now();
		await run.driver.onIdle("host-1");
		samples.push((performance.now() - start) * 1000);
		const counters = run.counters();
		promptTotal += counters.prompts;
		warningTotal += counters.warnings;
		readTotal += counters.reads;
		proposalLookupTotal += counters.proposalLookups;
	}
	const expectedPrompts =
		kind === "ready-continuation" ||
		kind === "blocked-handback" ||
		kind === "recovery-checkpoint"
			? fixture.samplesPerScenario
			: 0;
	const expectedReads = kind === "no-lease" ? 0 : fixture.samplesPerScenario;
	const expectedLookups =
		kind === "recovery-checkpoint" && RecoveryController
			? fixture.samplesPerScenario
			: 0;
	if (
		promptTotal !== expectedPrompts ||
		readTotal !== expectedReads ||
		warningTotal !== 0 ||
		proposalLookupTotal !== expectedLookups
	)
		throw new Error(`Unexpected route outcome: ${kind}`);
	rssCheckpoints.push(process.memoryUsage().rss);
	results.push({
		kind,
		samplesUs: samples,
		p50Us: percentile(samples, 0.5),
		p95Us: percentile(samples, 0.95),
		promptTotal,
		warningTotal,
		readTotal,
		proposalLookupTotal,
	});
}
globalThis.fetch = originalFetch;
if (fetchCalls !== 0 || providerCalls !== 0)
	throw new Error("Disabled mode made a provider or network call");
const output = {
	schemaVersion: 1,
	fixture,
	fixtureDigest: createHash("sha256")
		.update(JSON.stringify(fixture))
		.digest("hex"),
	moduleSha256: createHash("sha256")
		.update(await readFile(modulePath))
		.digest("hex"),
	recoverySha256: recoveryPath
		? createHash("sha256")
				.update(await readFile(recoveryPath))
				.digest("hex")
		: null,
	runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
	fetchCalls,
	providerCalls,
	rssColdBeforeBytes,
	rssAfterImportsBytes,
	rssBeforeBytes: rssBefore,
	rssCheckpointsBytes: rssCheckpoints,
	rssAfterBytes: process.memoryUsage().rss,
	results,
};
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(
	`${JSON.stringify({
		fixtureDigest: output.fixtureDigest,
		fetchCalls,
		providerCalls,
		rssColdBeforeBytes: output.rssColdBeforeBytes,
		rssAfterImportsBytes: output.rssAfterImportsBytes,
		rssBeforeBytes: output.rssBeforeBytes,
		rssAfterBytes: output.rssAfterBytes,
		results: results.map(
			({
				kind,
				p50Us,
				p95Us,
				promptTotal,
				warningTotal,
				readTotal,
				proposalLookupTotal,
			}) => ({
				kind,
				p50Us,
				p95Us,
				promptTotal,
				warningTotal,
				readTotal,
				proposalLookupTotal,
			}),
		),
	})}\n`,
);
