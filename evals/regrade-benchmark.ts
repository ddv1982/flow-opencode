#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
	GradeReceiptSchema,
	gradeRetainedBenchmark,
} from "./benchmark-grader.js";
import { verifyBenchmarkTranscript } from "./benchmark-transcript.js";
import { canonicalJson } from "./canonical-json.js";
import { parseCaseCatalog } from "./catalog.js";
import { EvidenceStore } from "./evidence-store.js";
import { parseReport } from "./report.js";

export async function regradeBenchmarkReport(
	reportPath: string,
): Promise<{ attempts: number; passed: number }> {
	const directory = dirname(resolve(reportPath));
	const catalog = parseCaseCatalog(
		JSON.parse(await readFile(join(directory, "catalog.json"), "utf8")),
	);
	if (!catalog.ok) throw new Error("Benchmark catalog is invalid.");
	const report = parseReport(
		JSON.parse(await readFile(reportPath, "utf8")),
		catalog.value,
	);
	if (!report.ok) throw new Error("Benchmark report is invalid.");
	const store = new EvidenceStore(directory);
	let attempts = 0;
	let passed = 0;
	for (const attempt of report.value.attempts) {
		if (
			attempt.outcome.kind !== "product" ||
			attempt.outcome.evidence.kind !== "paired-value"
		)
			continue;
		const evidence = attempt.outcome.evidence.assessment;
		if (!evidence)
			throw new Error(
				"Historical benchmark has no independently regradable retained evidence.",
			);
		await verifyBenchmarkTranscript({
			directory,
			attemptId: attempt.attemptId,
			transcript: attempt.transcript,
			assessment: evidence,
		});
		if (
			evidence.inputs.caseId !== attempt.caseId ||
			evidence.inputs.caseVersion !== attempt.caseVersion
		)
			throw new Error("Retained evidence belongs to another case.");
		const recorded = GradeReceiptSchema.parse(
			await store.readJson(evidence.receipt),
		);
		const reproduced = await gradeRetainedBenchmark({
			inputs: evidence.inputs,
			store,
		});
		if (
			canonicalJson(recorded) !== canonicalJson(reproduced) ||
			reproduced.passed !== attempt.outcome.passed
		)
			throw new Error(`Retained grade differs for ${attempt.attemptId}.`);
		attempts += 1;
		passed += Number(reproduced.passed);
	}
	if (attempts === 0)
		throw new Error("Report contains no retained benchmark product attempts.");
	return { attempts, passed };
}

if (import.meta.main) {
	const [flag, path, extra] = process.argv.slice(2);
	if (flag !== "--report" || !path || extra)
		throw new Error(
			"usage: bun evals/regrade-benchmark.ts --report <campaign/report.json>",
		);
	console.log(JSON.stringify(await regradeBenchmarkReport(path)));
}
