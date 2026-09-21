import { readFile } from "node:fs/promises";
import { writeExclusive } from "../../scripts/lib/exclusive-json.js";
import { runCalibrationCommand } from "./calibration.js";
import { collectRecoveryEvaluation, recoverySourceDigests } from "./collect.js";
import { runCampaignCommand } from "./compare.js";
import { runDatasetCommand } from "./dataset.js";
import { runEpisodeReceiptCommand } from "./episode-receipts.js";
import { runEpisodeJournalCommand } from "./episode-runner.js";
import { runEpisodeCommand } from "./episodes.js";
import { CorpusSchema, evaluateRecoveryCorpus } from "./evaluate.js";
import { runManagerPreflight } from "./manager-models.js";
import { runQualificationCommand } from "./qualification.js";
import { runRequestBudgetCommand } from "./request-budget.js";

export async function prepareRecoveryEvaluation(args: readonly string[]) {
	const [command, corpusPath, outputPath, ...extra] = args;
	if (command !== "prepare" || !corpusPath || !outputPath || extra.length)
		throw new Error(
			"Usage: eval:recovery prepare <corpus.json> <new-output.json>",
		);
	const corpus = CorpusSchema.parse(
		JSON.parse(await readFile(corpusPath, "utf8")),
	);
	const report = await evaluateRecoveryCorpus(corpus);
	const sourceDigests = await recoverySourceDigests();
	await writeExclusive(outputPath, {
		...report,
		sourceDigestEncoding: "sha256-of-source-bytes",
		sourceDigests,
	});
	return report.rows.every((row) => row.eligibilityMatches) ? 0 : 2;
}

export async function runRecoveryEvaluation(args: readonly string[]) {
	if (args[0]?.startsWith("request-budget-"))
		return runRequestBudgetCommand(args);
	if (args[0] === "manager-preflight") return runManagerPreflight(args);
	if (args[0] === "qualification-report") return runQualificationCommand(args);
	if (args[0]?.startsWith("calibration-")) return runCalibrationCommand(args);
	if (args[0] === "episode-recover") return runEpisodeJournalCommand(args);
	if (args[0] === "episode-reduce") return runEpisodeReceiptCommand(args);
	if (args[0]?.startsWith("episode-")) return runEpisodeCommand(args);
	if (args[0]?.startsWith("campaign-")) return runCampaignCommand(args);
	if (args[0]?.startsWith("dataset-")) return runDatasetCommand(args);
	if (args[0] !== "collect") return prepareRecoveryEvaluation(args);
	const [, corpusPath, outputDirectory, ...flags] = args;
	const values = new Map<string, string>();
	for (let i = 0; i < flags.length; i += 2) {
		const flag = flags[i],
			value = flags[i + 1];
		if (
			!flag ||
			!["--max-calls", "--max-usd", "--registration"].includes(flag) ||
			!value ||
			values.has(flag)
		)
			throw new Error("Invalid collection options.");
		values.set(flag, value);
	}
	if (
		!corpusPath ||
		!outputDirectory ||
		!values.has("--max-calls") ||
		!values.has("--max-usd")
	)
		throw new Error(
			"Usage: eval:recovery collect <corpus.json> <new-output-directory> --max-calls N --max-usd X [--registration registration.json]",
		);
	if (
		!/^[1-9]\d*$/.test(values.get("--max-calls") ?? "") ||
		!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(values.get("--max-usd") ?? "")
	)
		throw new Error("Collection caps require decimal numbers.");
	const controller = new AbortController();
	let cancellationCode = 0;
	const interrupt = () => {
		cancellationCode = 130;
		controller.abort();
	};
	const terminate = () => {
		cancellationCode = 143;
		controller.abort();
	};
	process.on("SIGINT", interrupt);
	process.on("SIGTERM", terminate);
	try {
		const report = await collectRecoveryEvaluation({
			corpus: JSON.parse(await readFile(corpusPath, "utf8")),
			registration: values.has("--registration")
				? JSON.parse(await readFile(values.get("--registration") ?? "", "utf8"))
				: undefined,
			outputDirectory,
			authorizationDirectory: process.env.FLOW_EVAL_AUTHORIZATION ?? "",
			apiKey: process.env.TYPESAFE_API_KEY ?? "",
			maxCalls: Number(values.get("--max-calls")),
			maxUsd: Number(values.get("--max-usd")),
			signal: controller.signal,
		});
		return cancellationCode || (report.status === "complete" ? 0 : 2);
	} catch {
		if (cancellationCode) return cancellationCode;
		throw new Error(
			"Recovery collection failed. Check inputs, explicit caps, authorization, and the new output directory.",
		);
	} finally {
		process.off("SIGINT", interrupt);
		process.off("SIGTERM", terminate);
	}
}

if (import.meta.main) {
	try {
		process.exitCode = await runRecoveryEvaluation(process.argv.slice(2));
	} catch {
		console.error(
			"Recovery evaluation failed. Check the command, inputs, and output destination.",
		);
		process.exitCode = 2;
	}
}
