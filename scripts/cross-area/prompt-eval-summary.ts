import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	buildPromptBehaviorEvalSummary,
	readPromptBehaviorEvalCorpus,
} from "../../tests/prompt-behavior-eval-helpers";
import {
	buildPromptEvalCoverageSummary,
	readPromptEvalCorpus,
} from "../../tests/prompt-eval-helpers";
import {
	buildPromptModeBehaviorEvalSummary,
	readPromptModeBehaviorEvalCorpus,
} from "../../tests/prompt-mode-behavior-eval-helpers";

async function main() {
	const repoRoot = resolve(import.meta.dir, "..", "..");
	const outputDir = join(repoRoot, ".release-artifacts", "prompt-exports");
	const promptSurfaceSummary = buildPromptEvalCoverageSummary(
		readPromptEvalCorpus(),
	);
	const promptBehaviorSummary = buildPromptBehaviorEvalSummary(
		readPromptBehaviorEvalCorpus(),
	);
	const promptModeBehaviorSummary = buildPromptModeBehaviorEvalSummary(
		readPromptModeBehaviorEvalCorpus(),
	);
	const report = [
		promptSurfaceSummary.report,
		"",
		promptBehaviorSummary.report,
		"",
		promptModeBehaviorSummary.report,
	].join("\n");
	const summary = {
		promptSurfaces: promptSurfaceSummary,
		promptBehavior: promptBehaviorSummary,
		promptModeBehavior: promptModeBehaviorSummary,
		report,
	};

	await mkdir(outputDir, { recursive: true });
	await writeFile(
		join(outputDir, "prompt-eval-summary.json"),
		`${JSON.stringify(summary, null, 2)}\n`,
		"utf8",
	);
	await writeFile(
		join(outputDir, "prompt-eval-summary.txt"),
		`${report}\n`,
		"utf8",
	);
	await writeFile(
		join(outputDir, "prompt-behavior-eval-summary.md"),
		`${promptBehaviorSummary.markdownReport}\n`,
		"utf8",
	);
	await writeFile(
		join(outputDir, "prompt-mode-behavior-eval-summary.md"),
		`${promptModeBehaviorSummary.markdownReport}\n`,
		"utf8",
	);

	console.log(report);
}

await main();
