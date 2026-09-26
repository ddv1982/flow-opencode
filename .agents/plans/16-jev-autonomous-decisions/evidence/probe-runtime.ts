import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { consumePaidDispatch } from "../../../../scripts/paid-budget.js";
import type { DecisionPacket } from "../../../../src/application/ports/decision-provider.js";
import { createJevDecisionProvider } from "../../../../src/infrastructure/jev-decision-provider.js";
import { createJevBudget } from "../../../../src/infrastructure/jev-transport.js";

const packet: DecisionPacket = {
	sessionId: "synthetic-runtime-probe",
	revision: 3,
	sourceDigest: `sha256:${"0".repeat(64)}`,
	goal: "Fix parseCount so null returns zero while preserving numeric input behavior.",
	planDigest: "0".repeat(64),
	rubric: "recovery-v1",
	findings: [
		{
			id: "null-count",
			summary:
				"The previous repair still dereferences null before checking it.",
			evidence:
				"Synthetic failing assertion: parseCount(null) throws; expected zero.",
		},
	],
	candidates: [
		{
			id: "guard-null",
			action: "retry",
			featureId: "parse-count",
			remedy:
				"Return zero for null before any dereference; retain the existing numeric path.",
			changedFromPreviousAttempt:
				"Move the null check ahead of the dereference and add the null regression case.",
			findingIds: ["null-count"],
		},
	],
};
const sources = [
	"src/application/ports/decision-provider.ts",
	"src/infrastructure/jev-decision-provider.ts",
	"src/infrastructure/jev-transport.ts",
];
const sourceDigests = Object.fromEntries(
	await Promise.all(
		sources.map(async (path) => [
			path,
			createHash("sha256")
				.update(await readFile(path))
				.digest("hex"),
		]),
	),
);
const budget = createJevBudget(3, 0.01);
const output = await open(
	new URL("runtime-live.json", import.meta.url),
	"wx",
	0o600,
);
const controller = new AbortController();
const cancel = () => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
try {
	await consumePaidDispatch(
		{ model: "typesafe/jev-1.13.0", kind: "probe" },
		".paid-budget/jev-probe-20260921T121051Z",
	);
	const startedAt = new Date().toISOString();
	const advice = await createJevDecisionProvider(
		() => process.env.TYPESAFE_API_KEY,
	).assess(packet, {
		signal: controller.signal,
		reserveAttempt: () => budget.reserve(),
	});
	const report = {
		schemaVersion: 1,
		purpose:
			"Production adapter availability and response-contract probe; not runtime recovery qualification",
		origin: "live",
		synthetic: true,
		startedAt,
		finishedAt: new Date().toISOString(),
		sourceDigests,
		packet,
		advice,
		budget: budget.snapshot(),
		estimatedUsd:
			advice.kind === "answered" && budget.snapshot().calls === 1
				? (advice.inputTokens * 0.042) / 1_000_000
				: null,
	};
	const encoded = JSON.stringify(report, null, 2);
	const key = process.env.TYPESAFE_API_KEY;
	if (key && encoded.includes(key))
		throw new Error("Refusing credential persistence");
	await output.writeFile(`${encoded}\n`);
	console.log(JSON.stringify({ kind: advice.kind, budget: budget.snapshot() }));
	process.exitCode = advice.kind === "answered" ? 0 : 2;
} finally {
	process.removeListener("SIGINT", cancel);
	process.removeListener("SIGTERM", cancel);
	await output.close();
}
