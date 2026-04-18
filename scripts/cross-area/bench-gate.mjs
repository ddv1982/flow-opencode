import { readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_BASELINE = "bench/BASELINE.md";
const DEFAULT_RESULTS = "bench/RESULTS.md";
const WARM_SAVE_NAME = "warm saveSession cycle";
const MAX_DELTA_PERCENT = 5;
const MAX_WARM_SAVE_MS = 1;

function splitTableRow(line) {
	return line
		.trim()
		.split("|")
		.slice(1, -1)
		.map((cell) => cell.trim());
}

function isSeparatorRow(columns) {
	return columns.every((column) => /^:?-{3,}:?$/.test(column));
}

function parseMarkdownTables(markdown) {
	const rows = [];

	for (const line of markdown.split(/\r?\n/u)) {
		if (!line.trim().startsWith("|")) {
			continue;
		}

		const columns = splitTableRow(line);
		if (columns.length === 0 || isSeparatorRow(columns)) {
			continue;
		}

		rows.push(columns);
	}

	return rows;
}

function parseBaselineRows(markdown) {
	const rows = new Map();

	for (const [benchmark, measurement] of parseMarkdownTables(markdown)) {
		if (
			benchmark?.toLowerCase() === "benchmark" ||
			measurement === undefined
		) {
			continue;
		}

		rows.set(benchmark, {
			benchmark,
			measurement,
			meanMs: parseDurationToMilliseconds(measurement),
		});
	}

	return rows;
}

function parseResultsRows(markdown) {
	const rows = new Map();

	for (const columns of parseMarkdownTables(markdown)) {
		const [benchmark, baseline, after, delta, notes = ""] = columns;

		if (
			benchmark?.toLowerCase() === "benchmark" ||
			benchmark?.toLowerCase() === "baseline" ||
			after === undefined
		) {
			continue;
		}

		rows.set(benchmark, {
			benchmark,
			baseline,
			after,
			delta,
			notes,
			meanMs: parseDurationToMilliseconds(after),
			explained: notes.toLowerCase().includes("explained:"),
		});
	}

	return rows;
}

function parseDurationToMilliseconds(value) {
	const match = value.match(/([0-9]+(?:\.[0-9]+)?)\s*(ns|µs|us|ms|s)\b/u);

	if (!match) {
		throw new Error(`Could not parse timing value from "${value}".`);
	}

	const [, amountText, unit] = match;
	const amount = Number(amountText);

	switch (unit) {
		case "ns":
			return amount / 1_000_000;
		case "µs":
		case "us":
			return amount / 1_000;
		case "ms":
			return amount;
		case "s":
			return amount * 1_000;
		default:
			throw new Error(`Unsupported timing unit "${unit}".`);
	}
}

function parseArguments(argv) {
	const positional = [];

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];

		if (argument === "--files") {
			const baseline = argv[index + 1];
			const results = argv[index + 2];

			if (!baseline || !results) {
				throw new Error("--files requires <baseline> and <results> paths.");
			}

			return [baseline, results];
		}

		positional.push(argument);
	}

	if (positional.length === 0) {
		return [DEFAULT_BASELINE, DEFAULT_RESULTS];
	}

	if (positional.length === 2) {
		return positional;
	}

	throw new Error(
		"Usage: node scripts/cross-area/bench-gate.mjs [baseline results] or --files <baseline> <results>",
	);
}

function main() {
	const [baselineArg, resultsArg] = parseArguments(process.argv.slice(2));
	const baselinePath = path.resolve(process.cwd(), baselineArg);
	const resultsPath = path.resolve(process.cwd(), resultsArg);
	const baselineRows = parseBaselineRows(readFileSync(baselinePath, "utf8"));
	const resultsRows = parseResultsRows(readFileSync(resultsPath, "utf8"));
	const failures = [];

	for (const [benchmark, baselineRow] of baselineRows) {
		const resultRow = resultsRows.get(benchmark);

		if (!resultRow) {
			failures.push(`Missing benchmark result row for "${benchmark}".`);
			continue;
		}

		const deltaPercent = (resultRow.meanMs / baselineRow.meanMs - 1) * 100;

		if (!resultRow.explained && deltaPercent > MAX_DELTA_PERCENT) {
			failures.push(
				`${benchmark} regressed by ${deltaPercent.toFixed(2)}% without an explained note.`,
			);
		}
	}

	const warmSaveRow = [...resultsRows.values()].find((row) =>
		row.benchmark.includes(WARM_SAVE_NAME),
	);

	if (!warmSaveRow) {
		failures.push(`Missing "${WARM_SAVE_NAME}" result row.`);
	} else if (warmSaveRow.meanMs > MAX_WARM_SAVE_MS) {
		failures.push(
			`${warmSaveRow.benchmark} mean ${warmSaveRow.meanMs.toFixed(3)} ms exceeds ${MAX_WARM_SAVE_MS.toFixed(1)} ms.`,
		);
	}

	if (failures.length > 0) {
		for (const failure of failures) {
			console.error(failure);
		}

		process.exitCode = 1;
		return;
	}

	console.log(
		`Bench gate passed for ${baselineRows.size} baseline row(s) using ${path.basename(
			baselinePath,
		)} and ${path.basename(resultsPath)}.`,
	);
}

main();
