import { resolve } from "node:path";
import { measureCausalTransport } from "./lib/causal-transport-measurement.js";

const DEFAULT_FIXTURE = "tests/fixtures/transport/phase2-current-run.json";

function fixtureArgument(args: readonly string[]): string {
	const index = args.indexOf("--fixture");
	if (index === -1) return DEFAULT_FIXTURE;
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error("--fixture requires a local JSON path.");
	}
	return value;
}

try {
	const report = await measureCausalTransport(
		resolve(process.cwd(), fixtureArgument(process.argv.slice(2))),
	);
	console.log(JSON.stringify(report, null, 2));
	if (!report.phase2Acceptance.localGatesPass) process.exitCode = 1;
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 2;
}
