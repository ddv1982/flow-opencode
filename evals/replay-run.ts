#!/usr/bin/env bun
// Replays recorded cassettes against this build's Flow runtime.
//
//   bun run replay                       # the committed set in evals/cassettes
//   bun run replay -- --from evals/results/2026-07-28T…Z.cassettes
//   bun run replay -- --accept           # re-derive expectations, deliberately
//
// Free and offline, so this runs on every change rather than once a release. A
// gated cassette that no longer reproduces its recorded verdict is a runtime
// regression against a decision a real model actually made.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	type Cassette,
	cassetteFidelity,
	type FidelityNote,
	isGated,
} from "./cassette.js";
import { completionHonesty, type MetricSession } from "./metrics.js";
import { replayCassette } from "./replay.js";
import { SCENARIOS } from "./scenarios.js";

const DEFAULT_DIRECTORY = "evals/cassettes";

type Comparison = Readonly<{
	cassette: Cassette;
	gated: boolean;
	fidelity: readonly FidelityNote[];
	verdict: "MATCH" | "DIVERGED" | "NO-SCENARIO" | "UNSUPPORTED";
	differences: readonly string[];
	replayed: Readonly<{
		issues: readonly string[];
		falseCompletion: boolean;
		closureKind: string | null;
	}>;
}>;

function parseArgs(argv: readonly string[]) {
	let from = DEFAULT_DIRECTORY;
	let accept = false;
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (flag === "--from" && value) {
			from = value;
			index += 1;
		} else if (flag === "--accept") {
			accept = true;
		} else if (flag === "--help" || flag === "-h") {
			console.log(
				"usage: bun run replay -- [--from <directory>] [--accept]\n\n" +
					"--accept rewrites supported cassette expectations from this replay.\n" +
					"It refuses cassettes with unavailable replay evidence.\n" +
					"It is a deliberate act: the rewritten expectations land in the diff and\n" +
					"have to be reviewed like any other change to what the suite asserts.",
			);
			process.exit(0);
		}
	}
	return { from, accept };
}

function closureOf(
	documents: readonly Record<string, unknown>[],
): string | null {
	for (const document of documents) {
		const closure = document.closure;
		if (closure && typeof closure === "object") {
			const kind = (closure as Record<string, unknown>).kind;
			if (typeof kind === "string") return kind;
		}
	}
	return null;
}

function sameIssues(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return (
		left.length === right.length &&
		[...left].sort().join("\0") === [...right].sort().join("\0")
	);
}

async function compare(cassette: Cassette): Promise<Comparison> {
	const scenario = SCENARIOS.find((entry) => entry.id === cassette.scenario);
	const fidelity = cassetteFidelity(cassette, scenario?.replayRequires);
	const gated = isGated(cassette, scenario?.replayRequires);
	if (!scenario) {
		return {
			cassette,
			gated,
			fidelity,
			verdict: "NO-SCENARIO",
			differences: [
				`this build has no scenario named ${cassette.scenario}; the cassette is stale`,
			],
			replayed: { issues: [], falseCompletion: false, closureKind: null },
		};
	}
	const { outcome, divergences } = await replayCassette(cassette);
	const documents = [
		...(outcome.session ? [outcome.session] : []),
		...outcome.archives,
	];
	const supported = !fidelity.includes("native-host-provenance-unreplayed");
	const issues = supported ? scenario.check(outcome) : [];
	const honesty = completionHonesty(
		(documents.find((document) => document.closure) ??
			null) as MetricSession | null,
	);
	const closureKind = closureOf(documents);
	const differences = [...divergences];
	if (supported && !sameIssues(cassette.expected.issues, issues)) {
		differences.push(
			`issues changed:\n    recorded: ${cassette.expected.issues.join("; ") || "none"}\n    replayed: ${issues.join("; ") || "none"}`,
		);
	}
	if (cassette.expected.falseCompletion !== honesty.falseCompletion) {
		differences.push(
			`falseCompletion changed: recorded ${cassette.expected.falseCompletion}, replayed ${honesty.falseCompletion} (${honesty.gaps.join(", ") || "no gaps"})`,
		);
	}
	if (cassette.expected.closureKind !== closureKind) {
		differences.push(
			`closure changed: recorded ${cassette.expected.closureKind ?? "none"}, replayed ${closureKind ?? "none"}`,
		);
	}
	return {
		cassette,
		gated,
		fidelity,
		verdict: !supported
			? "UNSUPPORTED"
			: differences.length === 0
				? "MATCH"
				: "DIVERGED",
		differences,
		replayed: {
			issues,
			falseCompletion: honesty.falseCompletion,
			closureKind,
		},
	};
}

async function main(): Promise<void> {
	const { from, accept } = parseArgs(process.argv.slice(2));
	const directory = resolve(join(import.meta.dir, ".."), from);
	let names: string[];
	try {
		names = (await readdir(directory))
			.filter((name) => name.endsWith(".json"))
			.sort();
	} catch {
		console.error(`No cassette directory at ${directory}.`);
		process.exit(2);
	}
	if (names.length === 0) {
		// Not a pass and not a failure: there is nothing recorded to reproduce. Saying
		// so beats printing a green line over an empty set.
		console.log(
			`No cassettes in ${directory}. Record some with \`bun run eval\`, then copy the ones worth keeping into ${DEFAULT_DIRECTORY}.`,
		);
		process.exit(0);
	}

	console.log(`Replaying ${names.length} cassette(s) from ${from}\n`);
	const comparisons: Comparison[] = [];
	let refused = false;
	for (const name of names) {
		const cassette = JSON.parse(
			await readFile(join(directory, name), "utf8"),
		) as Cassette;
		process.stdout.write(`- ${name} ... `);
		const comparison = await compare(cassette);
		comparisons.push(comparison);
		console.log(
			`${comparison.verdict}${comparison.gated ? "" : ` (advisory: ${comparison.fidelity.join(", ")})`}`,
		);
		for (const difference of comparison.differences) {
			console.log(`    ${difference}`);
		}
		if (accept && (!comparison.gated || comparison.verdict === "NO-SCENARIO")) {
			refused = true;
			console.log(
				"    refused: unavailable replay evidence; original expectation retained",
			);
		} else if (accept && comparison.verdict === "DIVERGED") {
			const updated: Cassette = {
				...cassette,
				expected: {
					verdict: cassette.expected.verdict,
					issues: comparison.replayed.issues,
					falseCompletion: comparison.replayed.falseCompletion,
					closureKind: comparison.replayed.closureKind,
				},
			};
			await writeFile(
				join(directory, name),
				`${JSON.stringify(updated, null, 2)}\n`,
				"utf8",
			);
			console.log("    accepted: expectation rewritten from this replay");
		}
	}

	const gated = comparisons.filter((comparison) => comparison.gated);
	const failed = gated.filter((comparison) => comparison.verdict !== "MATCH");
	const advisory = comparisons.filter(
		(comparison) => !comparison.gated && comparison.verdict !== "MATCH",
	);
	console.log(
		`\n${gated.length - failed.length}/${gated.length} gated cassette(s) reproduced${
			advisory.length > 0
				? `\n${advisory.length} advisory cassette(s) diverged or lack supported evidence; reported rather than gated`
				: ""
		}`,
	);
	process.exit(refused || (!accept && failed.length > 0) ? 1 : 0);
}

await main();
