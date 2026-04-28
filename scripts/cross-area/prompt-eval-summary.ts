import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	buildPromptEvalCoverageSummary,
	readPromptEvalCorpus,
} from "../../tests/prompt-eval-helpers";

async function main() {
	const repoRoot = resolve(import.meta.dir, "..", "..");
	const outputDir = join(repoRoot, "prompt-exports");
	const summary = buildPromptEvalCoverageSummary(readPromptEvalCorpus());

	await mkdir(outputDir, { recursive: true });
	await writeFile(
		join(outputDir, "prompt-eval-summary.json"),
		`${JSON.stringify(summary, null, 2)}\n`,
		"utf8",
	);
	await writeFile(
		join(outputDir, "prompt-eval-summary.txt"),
		`${summary.report}\n`,
		"utf8",
	);

	console.log(summary.report);
}

await main();
