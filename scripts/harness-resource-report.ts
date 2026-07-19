import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	buildHarnessResourceReport,
	type HarnessCandidateVariant,
} from "../src/application/harness/resource-report.js";

type CliOptions = {
	fixturePath: string;
	requiredVariant?: HarnessCandidateVariant;
	json: boolean;
};

function usageError(message: string): never {
	throw new Error(
		`${message} Usage: --fixture <path> [--require <standard|assurance>] [--json]`,
	);
}

export function parseHarnessReportArguments(
	args: readonly string[],
): CliOptions {
	let fixturePath: string | undefined;
	let requiredVariant: HarnessCandidateVariant | undefined;
	let json = false;
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--fixture") {
			if (fixturePath !== undefined)
				usageError("Conflicting --fixture options.");
			const value = args[index + 1];
			if (!value || value.startsWith("--")) usageError("Missing fixture path.");
			fixturePath = value;
			index += 1;
			continue;
		}
		if (argument === "--require") {
			if (requiredVariant !== undefined)
				usageError("Conflicting --require options.");
			const value = args[index + 1];
			if (value !== "standard" && value !== "assurance") {
				usageError("Invalid required variant.");
			}
			requiredVariant = value;
			index += 1;
			continue;
		}
		if (argument === "--json") {
			if (json) usageError("Conflicting --json options.");
			json = true;
			continue;
		}
		usageError("Unknown argument.");
	}
	if (!fixturePath) usageError("Missing --fixture.");
	return {
		fixturePath,
		...(requiredVariant ? { requiredVariant } : {}),
		json,
	};
}

async function main(): Promise<number> {
	let options: CliOptions;
	try {
		options = parseHarnessReportArguments(process.argv.slice(2));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`harness-report: ${message}\n`);
		return 2;
	}
	try {
		const fixture = JSON.parse(
			await readFile(resolve(process.cwd(), options.fixturePath), "utf8"),
		);
		const report = buildHarnessResourceReport(fixture);
		if (options.json) {
			process.stdout.write(`${JSON.stringify(report)}\n`);
		} else {
			const gates = report.gates
				.map((gate) => `${gate.variant}=${gate.status}`)
				.join(" ");
			process.stdout.write(
				`${report.caseID} control=${report.controlStatus} ${gates}\n`,
			);
		}
		if (!options.requiredVariant) return 0;
		const requiredGate = report.gates.find(
			(gate) => gate.variant === options.requiredVariant,
		);
		return requiredGate?.status === "pass" ? 0 : 1;
	} catch {
		process.stderr.write(
			"harness-report: unable to read or validate the fixture.\n",
		);
		return 1;
	}
}

if (import.meta.main) process.exitCode = await main();
