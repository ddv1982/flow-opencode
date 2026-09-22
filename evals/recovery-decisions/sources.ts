import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
export async function recoverySourceDigests() {
	const runtimePaths = (await readdir("src", { recursive: true }))
		.filter((path) => path.endsWith(".ts"))
		.map((path) => `src/${path.replaceAll("\\", "/")}`);
	const paths = [
		...runtimePaths,
		"package.json",
		"bun.lock",
		"evals/recovery-decisions/evaluate.ts",
		"evals/recovery-decisions/schema.ts",
		"evals/recovery-decisions/dataset.ts",
		"evals/recovery-decisions/run.ts",
		"evals/recovery-decisions/collect.ts",
		"evals/recovery-decisions/capture.ts",
		"evals/recovery-decisions/capture-plugin.ts",
		"evals/recovery-decisions/sources.ts",
		"evals/recovery-decisions/campaign.ts",
		"evals/recovery-decisions/calibration.ts",
		"evals/recovery-decisions/qualification.ts",
		"evals/recovery-decisions/manager-models.ts",
		"evals/recovery-decisions/request-budget.ts",
		"evals/recovery-decisions/request-gate.ts",
		"evals/recovery-decisions/budget-plugin.ts",
		"evals/recovery-decisions/treatment.ts",
		"evals/recovery-decisions/treatment-plugin.ts",
		"evals/recovery-decisions/live-treatment-plugin.ts",
		"evals/recovery-decisions/simulation-transport.ts",
		"evals/harness.ts",
		"evals/host-artifacts.ts",
		"evals/recovery-decisions/compare.ts",
		"evals/recovery-decisions/decision-quality.ts",
		"evals/recovery-decisions/episodes.ts",
		"evals/recovery-decisions/episode-receipts.ts",
		"evals/recovery-decisions/episode-runner.ts",
		"evals/recovery-decisions/episode-host.ts",
		"evals/recovery-decisions/episode-operator.ts",
		"scripts/paid-budget.ts",
		"scripts/lib/exclusive-json.ts",
	].sort();
	return Object.fromEntries(
		await Promise.all(
			paths.map(async (path) => [
				path,
				createHash("sha256")
					.update(await readFile(path))
					.digest("hex"),
			]),
		),
	);
}
