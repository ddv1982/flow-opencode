import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { collectSimulatedJevEvidence } from "../../../../../../evals/blocker-decisions/jev.ts";
import { parseCampaign } from "../../../../../../evals/blocker-decisions/schema.ts";

const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

const base = new URL(
	"../../../../../../evals/blocker-decisions/",
	import.meta.url,
);
const campaign = parseCampaign(
	JSON.parse(
		await readFile(new URL("development-manifest.json", base), "utf8"),
	),
	JSON.parse(await readFile(new URL("v1.json", base), "utf8")),
);

const results = [];
for (const status of [429, 529]) {
	let dispatches = 0;
	const started = performance.now();
	const evidence = await collectSimulatedJevEvidence(
		campaign,
		{ apiKey: "synthetic-lane-8", maxCalls: 3, maxUsd: 0.009 },
		async (url) => {
			if (url !== JEV_ENDPOINT) throw new Error("Wrong endpoint");
			dispatches++;
			return new Response("Unavailable", {
				status,
				headers: { "retry-after": "0" },
			});
		},
	);
	const first = evidence.observations[0];
	if (dispatches !== 3 || first?.result.kind !== "unavailable")
		throw new Error("Rate or overload bound failed");
	results.push({
		case: status === 429 ? "rate-limit" : "overload",
		injectedHttpStatus: status,
		dispatches,
		result: first.result,
		metrics: first.metrics,
		elapsedMs: performance.now() - started,
	});
}

let dispatches = 0;
const started = performance.now();
const evidence = await collectSimulatedJevEvidence(
	campaign,
	{ apiKey: "synthetic-lane-8", maxCalls: 1, maxUsd: 0.003 },
	async (url) => {
		if (url !== JEV_ENDPOINT) throw new Error("Wrong endpoint");
		dispatches++;
		return new Promise<Response>(() => {});
	},
);
const first = evidence.observations[0];
if (
	dispatches !== 1 ||
	first?.result.kind !== "unavailable" ||
	first.result.reason !== "timeout"
)
	throw new Error("Timeout bound failed");
results.push({
	case: "timeout",
	dispatches,
	result: first.result,
	metrics: first.metrics,
	elapsedMs: performance.now() - started,
});

const output = {
	schemaVersion: 1,
	head: "5db4e9852492cf671f16534be52a23e00fb655a4",
	origin: "simulation",
	providerCalls: 0,
	cases: results,
};
const destination = process.argv[2];
if (!destination) throw new Error("An output path is required");
await writeFile(destination, `${JSON.stringify(output, null, 2)}\n`, {
	flag: "wx",
});
for (const row of results)
	process.stdout.write(
		`${row.case} ${row.dispatches} ${row.result.reason} ${row.elapsedMs.toFixed(1)}\n`,
	);
