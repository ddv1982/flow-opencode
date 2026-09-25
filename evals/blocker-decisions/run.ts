#!/usr/bin/env bun
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { evaluateCampaign, evaluateDeterministicPolicy } from "./evaluate.js";
import { collectJevEvidence } from "./jev.js";
import {
	digest,
	importLiveEvidence,
	mergeEvidence,
	parseCampaign,
	parseEvidence,
} from "./schema.js";

export async function runBlockerCli(
	args: readonly string[],
	environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
	const [command, ...rest] = args;
	if (!command || !["check", "report", "collect-jev"].includes(command))
		throw new Error("Expected check, report, or collect-jev");
	const options = new Map<string, string>();
	const allowed = new Set([
		"--manifest",
		"--corpus",
		...(command === "check" ? [] : ["--out"]),
		...(command === "report" ? ["--evidence", "--live-receipt"] : []),
		...(command === "collect-jev" ? ["--max-calls", "--max-usd"] : []),
	]);
	for (let index = 0; index < rest.length; index += 2) {
		const key = rest[index],
			value = rest[index + 1];
		if (
			!key ||
			!allowed.has(key) ||
			!value ||
			value.startsWith("--") ||
			options.has(key)
		)
			throw new Error("Invalid or duplicate blocker option");
		options.set(key, value);
	}
	const load = async (path: string): Promise<unknown> =>
		JSON.parse(await readFile(path, "utf8")) as unknown;
	const campaign = parseCampaign(
		await load(
			options.get("--manifest") ??
				"evals/blocker-decisions/development-manifest.json",
		),
		await load(options.get("--corpus") ?? "evals/blocker-decisions/v1.json"),
	);
	if (command === "check") {
		process.stdout.write(
			`${JSON.stringify({ campaignDigest: digest(campaign.manifest), episodes: campaign.corpus.episodes.length, registration: campaign.manifest.registration.status })}\n`,
		);
		return 0;
	}
	const out = options.get("--out");
	if (!out) throw new Error("--out is required");
	const calls = options.get("--max-calls"),
		usd = options.get("--max-usd");
	if (
		command === "collect-jev" &&
		(!calls || !usd || !/^\d+$/.test(calls) || !/^\d+(\.\d+)?$/.test(usd))
	)
		throw new Error("Explicit --max-calls and --max-usd are required");
	await mkdir(dirname(out), { recursive: true });
	const outputFile = await open(out, "wx");
	try {
		let output: unknown;
		let code = 0;
		if (command === "collect-jev") {
			const apiKey = environment.TYPESAFE_API_KEY;
			const controller = new AbortController();
			let stopped = 0;
			const interrupt = () => {
				stopped = 130;
				controller.abort();
			};
			const terminate = () => {
				stopped = 143;
				controller.abort();
			};
			process.once("SIGINT", interrupt);
			process.once("SIGTERM", terminate);
			try {
				const result = await collectJevEvidence(campaign, {
					...(apiKey ? { apiKey } : {}),
					maxCalls: Number(calls),
					maxUsd: Number(usd),
					signal: controller.signal,
				});
				output = result;
				code =
					stopped ||
					(result.observations.some((row) => row.result.kind === "unavailable")
						? 2
						: 0);
			} finally {
				process.removeListener("SIGINT", interrupt);
				process.removeListener("SIGTERM", terminate);
			}
		} else {
			const path = options.get("--evidence"),
				receipt = options.get("--live-receipt");
			if (receipt && !path) throw new Error("A live receipt requires evidence");
			const input = path
				? await load(path)
				: {
						schemaVersion: 1,
						campaignDigest: digest(campaign.manifest),
						observations: [],
					};
			const evidence = receipt
				? importLiveEvidence(campaign, input, await load(receipt))
				: parseEvidence(campaign, input);
			output = evaluateCampaign(
				campaign,
				mergeEvidence(
					campaign,
					evaluateDeterministicPolicy(campaign),
					evidence,
				),
			);
		}
		await outputFile.writeFile(`${JSON.stringify(output, null, 2)}\n`);
		process.stdout.write(`${JSON.stringify({ output: out })}\n`);
		return code;
	} catch (error) {
		await outputFile
			.writeFile(
				JSON.stringify({
					status: "incomplete",
					reason: "collection-or-publication-failed",
				}),
			)
			.catch(() => {});
		throw error;
	} finally {
		await outputFile.close();
	}
}
if (import.meta.main) {
	try {
		process.exitCode = await runBlockerCli(process.argv.slice(2));
	} catch {
		process.stderr.write(
			"Blocker evaluator failed. Check arguments, immutable output path, and validated input files.\n",
		);
		process.exitCode = 2;
	}
}
