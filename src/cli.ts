import {
	cleanupLegacySkills,
	type LegacyCleanupReport,
} from "./distribution/legacy-cleanup.js";
import { resolveFlowPluginVersion } from "./version.js";

function usage(): string {
	return [
		"usage: opencode-plugin-flow legacy-cleanup <--dry-run|--apply> [--json]",
		"",
		"commands:",
		"  legacy-cleanup      Inspect or archive marker-proven legacy global Flow skills",
		"",
		"options:",
		"  --dry-run           Report eligible folders without changing the filesystem",
		"  --apply             Move eligible folders to a recoverable archive outside skill discovery",
		"                      Cleanup never deletes legacy folders",
		"  --json              Write the report as JSON",
		"  --help              Show this help",
		"  --version           Print the plugin version",
	].join("\n");
}

function writeReport(report: LegacyCleanupReport, json: boolean): void {
	if (json) {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		return;
	}
	process.stdout.write(`Flow legacy skill cleanup (${report.mode})\n`);
	process.stdout.write(`- legacy root: ${report.root}\n`);
	process.stdout.write(`- archive root: ${report.archiveRoot}\n`);
	for (const result of report.results) {
		process.stdout.write(`- ${result.name}: ${result.status}\n`);
		if (result.reason) process.stdout.write(`  reason: ${result.reason}\n`);
		if (result.archivePath) {
			const label = result.status === "archived" ? "archived" : "preserved";
			process.stdout.write(`  ${label} at: ${result.archivePath}\n`);
		}
	}
}

async function main(argv: string[]): Promise<void> {
	const [command, ...flags] = argv.slice(2);
	if (command === "--help" || command === "-h") {
		process.stdout.write(`${usage()}\n`);
		return;
	}
	if (command === "--version" || command === "-v") {
		process.stdout.write(`${resolveFlowPluginVersion()}\n`);
		return;
	}
	const knownFlags = new Set(["--dry-run", "--apply", "--json"]);
	const validFlags = flags.every((flag) => knownFlags.has(flag));
	const dryRun = flags.includes("--dry-run");
	const apply = flags.includes("--apply");
	if (command !== "legacy-cleanup" || !validFlags || dryRun === apply) {
		process.stderr.write(`${usage()}\n`);
		process.exitCode = 2;
		return;
	}
	const report = await cleanupLegacySkills({ apply });
	writeReport(report, flags.includes("--json"));
	if (
		apply &&
		report.results.some((result) =>
			["refused", "quarantined"].includes(result.status),
		)
	) {
		process.exitCode = 1;
	}
}

main(process.argv).catch((error) => {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
