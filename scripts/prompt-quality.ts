import {
	evaluatePromptVariant,
	PROMPT_REPETITION_CLASSIFICATIONS,
	promptInventoryForVariant,
} from "../src/prompt-quality.js";
import type { FlowPromptVariant } from "../src/prompt-surfaces.js";

const VARIANTS: readonly FlowPromptVariant[] = [
	"baseline",
	"lexically-deduplicated",
	"surface-specific",
	"surface-specific-bookended",
];

function report() {
	return {
		generatedAt: new Date().toISOString(),
		tokenEstimate:
			"ceil(characters / 4); comparative estimate, not a model tokenizer",
		inventories: Object.fromEntries(
			VARIANTS.map((variant) => [variant, promptInventoryForVariant(variant)]),
		),
		evaluations: VARIANTS.map(evaluatePromptVariant),
		repetitionClassifications: PROMPT_REPETITION_CLASSIFICATIONS,
	};
}

function markdown(): string {
	const data = report();
	const lines = [
		"# Flow prompt quality report",
		"",
		`Generated: ${data.generatedAt}`,
		"",
		`Token estimate: ${data.tokenEstimate}.`,
		"",
		"## Static contract coverage by variant",
		"",
		"| Variant | Fixtures with all contracts | Static criteria | Approx tokens | Exact duplicate lines | Role-inapplicable lines |",
		"| --- | ---: | ---: | ---: | ---: | ---: |",
		...data.evaluations.map(
			(evaluation) =>
				`| ${evaluation.variant} | ${evaluation.scenariosPassed}/${evaluation.scenariosTotal} | ${evaluation.criteriaPassed}/${evaluation.criteriaTotal} | ${evaluation.staticApproximateTokens} | ${evaluation.exactDuplicateLines} | ${evaluation.roleInapplicableLines} |`,
		),
		"",
		"## Implemented surface inventory",
		"",
		"| Surface | Words | Approx tokens | Actions | Exact dupes | Near dupes | Negative density | Sources |",
		"| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
		...(data.inventories["surface-specific-bookended"] ?? []).map(
			(metric) =>
				`| ${metric.surface} | ${metric.words} | ${metric.approximateTokens} | ${metric.actionableInstructions} | ${metric.exactDuplicateLines} | ${metric.nearDuplicateLinePairs} | ${metric.negativeInstructionDensity} | ${metric.sources.length} |`,
		),
		"",
		"## Static contract gaps by variant",
		"",
	];
	for (const evaluation of data.evaluations) {
		const failures = evaluation.scenarios.filter(
			(scenario) => !scenario.passed,
		);
		lines.push(`### ${evaluation.variant}`, "");
		if (failures.length === 0) lines.push("None.", "");
		else {
			for (const failure of failures) {
				lines.push(`- ${failure.name}: ${failure.failures.join("; ")}`);
			}
			lines.push("");
		}
	}
	lines.push("## Repetition classifications", "");
	for (const classification of data.repetitionClassifications) {
		lines.push(
			`- ${classification.id} — ${classification.classification}: ${classification.rationale}`,
		);
	}
	return `${lines.join("\n")}\n`;
}

if (process.argv.includes("--json")) {
	console.log(JSON.stringify(report(), null, 2));
} else {
	process.stdout.write(markdown());
}
