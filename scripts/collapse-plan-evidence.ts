import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function collapsePlan(plan: { [key: string]: Json }): void {
	if (plan.evidence !== undefined) {
		delete plan.gate;
		delete plan.externalEvidence;
		return;
	}
	if (plan.gate === undefined && plan.externalEvidence === undefined) return;
	const extras = Array.isArray(plan.externalEvidence)
		? plan.externalEvidence.map((entry) =>
				typeof entry === "object" && entry !== null && !Array.isArray(entry)
					? { ...entry, scope: "extra" }
					: entry,
			)
		: [];
	const evidence: Json[] = [];
	if (typeof plan.gate === "string") {
		evidence.push({
			scope: "gate",
			requirement: "Repository suite",
			environment: "this host",
			command: plan.gate,
			platform: "other",
			assertions: [],
		});
	}
	evidence.push(...extras);
	plan.evidence = evidence;
	delete plan.gate;
	delete plan.externalEvidence;
}

function walk(value: Json): void {
	if (Array.isArray(value)) {
		for (const item of value) walk(item);
		return;
	}
	if (value && typeof value === "object") {
		if (
			("gate" in value || "externalEvidence" in value) &&
			("features" in value || "summary" in value)
		) {
			collapsePlan(value);
		}
		for (const child of Object.values(value)) walk(child);
	}
}

const directory = join(import.meta.dir, "../evals/cassettes");
const names = (await readdir(directory)).filter((name) =>
	name.endsWith(".json"),
);
for (const name of names) {
	const path = join(directory, name);
	const document = JSON.parse(await readFile(path, "utf8")) as Json;
	walk(document);
	await writeFile(path, `${JSON.stringify(document, null, "\t")}\n`);
}
console.info(`collapsed ${names.length} cassettes`);
