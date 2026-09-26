import { stripVTControlCharacters } from "node:util";
import { z } from "zod";
import { writeExclusive } from "../../scripts/lib/exclusive-json.js";
import { datasetDigest } from "./schema.js";

export const EvaluationManagers = [
	{
		model: "openai/gpt-5.6-terra",
		provider: "openai",
		apiModel: "gpt-5.6-terra",
		authLabel: "OpenAI",
	},
	{
		model: "xai/grok-4.6",
		provider: "xai",
		apiModel: "grok-4.6",
		authLabel: "xAI",
	},
] as const;
const NumberMetric = z.number().finite().nonnegative();
const Metadata = z.object({
	id: z.string(),
	providerID: z.string(),
	status: z.string(),
	api: z.object({ id: z.string(), npm: z.string() }),
	cost: z.object({
		input: NumberMetric,
		output: NumberMetric,
		cache: z.object({ read: NumberMetric, write: NumberMetric }),
		tiers: z.array(z.unknown()).optional(),
	}),
	limit: z.object({
		context: NumberMetric,
		input: NumberMetric.optional(),
		output: NumberMetric,
	}),
});

export function inspectManagerCatalog(
	model: (typeof EvaluationManagers)[number],
	stdout: string,
	authOutput: string,
) {
	const entries = stdout.split(/(?=^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:-]+\r?$)/m);
	const entry = entries.find(
		(value) => value.split(/\r?\n/, 1)[0] === model.model,
	);
	if (!entry) throw new Error(`Requested manager is missing: ${model.model}`);
	const metadata = Metadata.parse(
		JSON.parse(entry.slice(entry.indexOf("\n") + 1)),
	);
	if (
		metadata.providerID !== model.provider ||
		metadata.id !== model.apiModel ||
		metadata.api.id !== model.apiModel ||
		metadata.status !== "active"
	)
		throw new Error("Manager route does not match the selected active model.");
	const plainAuth = stripVTControlCharacters(authOutput);
	const authTypes = plainAuth.split(/\r?\n/).flatMap((line) => {
		const match = /^\s*[●•]\s+(.+?)\s+(oauth|api)\s*$/.exec(line);
		return match?.[1] === model.authLabel ? [match[2]] : [];
	});
	const authType = authTypes.length === 1 ? authTypes[0] : "unconfirmed";
	return {
		model: model.model,
		provider: model.provider,
		apiModel: metadata.api.id,
		sdk: metadata.api.npm,
		authType,
		catalogCosts: {
			input: metadata.cost.input,
			output: metadata.cost.output,
			cache: metadata.cost.cache,
		},
		catalogHasPricingTiers: (metadata.cost.tiers?.length ?? 0) > 0,
		catalogLimits: metadata.limit,
		catalogMetadataDigest: datasetDigest(metadata),
		billing: "unverified",
		inferenceAvailability: "unprobed",
		arms: ["manager-only", "manager-plus-jev"],
	};
}

export async function runManagerPreflight(args: readonly string[]) {
	const [command, output, ...extra] = args;
	if (command !== "manager-preflight" || !output || extra.length)
		throw new Error("Expected manager-preflight <new-report>.");
	const read = async (argv: string[]) => {
		const child = Bun.spawn(["opencode", ...argv], {
			stdout: "pipe",
			stderr: "ignore",
		});
		const timer = setTimeout(() => child.kill(), 30_000);
		try {
			const stdout = await new Response(child.stdout).text();
			if ((await child.exited) !== 0 || stdout.length > 5_000_000)
				throw new Error("OpenCode catalog command failed.");
			return stdout;
		} finally {
			clearTimeout(timer);
		}
	};
	const opencodeVersion = z
		.string()
		.regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/)
		.parse((await read(["--version"])).trim());
	const auth = await read(["auth", "list"]);
	const managers = [];
	for (const model of EvaluationManagers)
		managers.push(
			inspectManagerCatalog(
				model,
				await read(["models", model.provider, "--verbose"]),
				auth,
			),
		);
	await writeExclusive(output, {
		schemaVersion: 1,
		qualification: "inconclusive",
		checkedAt: new Date().toISOString(),
		opencodeVersion,
		managers,
		executionReady: false,
		assurance:
			"Catalog membership and connection metadata only. Zero catalog cost is not proof of free inference. OAuth is not API-key billing. Each manager requires its own paired comparison and qualification evidence.",
		remaining: [
			"Verify the actual OAuth request and billing boundary without replacing the selected connection.",
			"Enforce all-model spending and explicit campaign authorization before inference.",
			"Complete isolated Jev treatment and episode host integration.",
		],
	});
	return 0;
}
