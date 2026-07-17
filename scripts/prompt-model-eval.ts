import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildPromptModelEvaluationPacket,
	gradeModelDecisions,
	parseModelDecisionResponse,
} from "../src/prompt-model-evaluation";
import type { FlowPromptVariant } from "../src/prompt-surfaces";

const SUPPORTED_VARIANTS: readonly FlowPromptVariant[] = [
	"baseline",
	"lexically-deduplicated",
	"surface-specific",
	"surface-specific-bookended",
];

function valuesAfter(flag: string): string[] {
	return process.argv.flatMap((value, index, values) =>
		value === flag && values[index + 1] ? [values[index + 1] as string] : [],
	);
}

const model = valuesAfter("--model")[0];
const reasoning = valuesAfter("--reasoning")[0];
const timeoutValue = valuesAfter("--timeout-ms")[0];
const timeoutMs = timeoutValue === undefined ? 300_000 : Number(timeoutValue);
const requestedVariants = valuesAfter("--prompt-variant");
const variants = (
	requestedVariants.length > 0
		? requestedVariants
		: ["baseline", "surface-specific-bookended"]
) as FlowPromptVariant[];

if (
	!model ||
	!Number.isSafeInteger(timeoutMs) ||
	timeoutMs <= 0 ||
	variants.some((variant) => !SUPPORTED_VARIANTS.includes(variant))
) {
	process.stderr.write(
		"Usage: bun run prompt:model-eval -- --model provider/model [--reasoning high] [--timeout-ms 300000] [--prompt-variant baseline] [--prompt-variant surface-specific-bookended]\n",
	);
	process.exit(2);
}

const results = [];
for (const variant of variants) {
	const evaluationDir = await mkdtemp(
		join(tmpdir(), "flow-prompt-model-eval-"),
	);
	try {
		const command = [
			"bunx",
			"opencode-ai@1.18.3",
			"run",
			"--pure",
			"--dir",
			evaluationDir,
			"--model",
			model,
			"--format",
			"json",
			...(reasoning ? ["--variant", reasoning] : []),
		];
		const processResult = Bun.spawn(command, {
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		processResult.stdin.write(buildPromptModelEvaluationPacket(variant));
		processResult.stdin.end();
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			processResult.kill("SIGKILL");
		}, timeoutMs);
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(processResult.stdout).text(),
			new Response(processResult.stderr).text(),
			processResult.exited,
		]).finally(() => clearTimeout(timeout));
		if (timedOut) {
			throw new Error(
				`OpenCode model evaluation exceeded the ${timeoutMs}ms timeout.`,
			);
		}
		if (exitCode !== 0) {
			throw new Error(
				`OpenCode exited ${exitCode}: ${stderr.trim() || stdout.trim()}`,
			);
		}
		const events = stdout
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		const responseText = events
			.filter((event) => event.type === "text")
			.map((event) => (event.part as { text?: string } | undefined)?.text ?? "")
			.join("");
		const toolEvents = events.filter((event) =>
			String(event.type).includes("tool"),
		).length;
		const finish = events.findLast((event) => event.type === "step_finish");
		const decisions = parseModelDecisionResponse(responseText);
		results.push({
			model,
			reasoning: reasoning ?? "provider default",
			openCodeVersion: "1.18.3",
			promptVariant: variant,
			toolEvents,
			tokens: (finish?.part as { tokens?: unknown } | undefined)?.tokens,
			grade: gradeModelDecisions(decisions),
			decisions,
		});
	} finally {
		await rm(evaluationDir, { recursive: true, force: true });
	}
}

process.stdout.write(
	`${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
);
