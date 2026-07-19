import {
	type ActivationApplyReport,
	type ActivationCheckReport,
	type ActivationScope,
	applyFlowActivation,
	checkFlowActivation,
} from "./distribution/activation.js";
import {
	cleanupLegacySkills,
	type LegacyCleanupReport,
} from "./distribution/legacy-cleanup.js";
import { resolveFlowPluginVersion } from "./version.js";

function usage(): string {
	return [
		"usage:",
		"  opencode-plugin-flow install --project <absolute-path> --scope <global|project> [--json]",
		"  opencode-plugin-flow activation-check --project <absolute-path> [--target <exact-version>] [--json]",
		"  opencode-plugin-flow activation-apply --project <absolute-path> --scope <global|project> [--target <exact-version>] [--apply] [--json]",
		"  opencode-plugin-flow legacy-cleanup <--dry-run|--apply> [--json]",
		"",
		"commands:",
		"  install             Converge immediately to this package's exact version and remove proven older copies",
		"  activation-check    Inventory global sources, one selected project, and cache artifacts",
		"  activation-apply    Plan a single-version activation; mutate only with --apply",
		"  legacy-cleanup      Inspect or archive marker-proven legacy global Flow skills",
		"",
		"activation options:",
		"  --project <path>    Absolute project/worktree path; other project trees are not scanned",
		"  --scope <scope>     Config that receives the one canonical exact npm pin",
		"  --target <version>  Exact version only; defaults to this package's embedded version",
		"  --apply             Create backups/journal and apply the activation plan",
		"                      Without --apply, activation-apply is read-only",
		"",
		"legacy cleanup options:",
		"  --dry-run           Report eligible folders without changing the filesystem",
		"  --apply             Move eligible folders to a recoverable archive outside skill discovery",
		"                      Cleanup never deletes legacy folders",
		"",
		"common options:",
		"  --json              Write the report as JSON",
		"  --help              Show this help",
		"  --version           Print the plugin version",
	].join("\n");
}

function writeLegacyReport(report: LegacyCleanupReport, json: boolean): void {
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

function writeActivationCheck(
	report: ActivationCheckReport,
	json: boolean,
): void {
	if (json) {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		return;
	}
	process.stdout.write(
		`Flow activation check: ${report.singleVersionSatisfied ? "satisfied" : "not satisfied"}\n`,
	);
	process.stdout.write(`- project: ${report.project}\n`);
	process.stdout.write(
		"- coverage: global sources plus the selected project; other project trees are not scanned\n",
	);
	process.stdout.write(`- target: opencode-plugin-flow@${report.target}\n`);
	process.stdout.write(`- activation sources: ${report.records.length}\n`);
	for (const record of report.records) {
		process.stdout.write(
			`  - ${record.source}: ${record.specifier} (${record.ownership}, ${record.status}, version=${record.resolvedVersion ?? "unresolved"})\n`,
		);
		if (record.reason) process.stdout.write(`    reason: ${record.reason}\n`);
	}
	process.stdout.write(
		`- Flow cache artifacts: ${report.cacheArtifacts.length}\n`,
	);
	for (const artifact of report.cacheArtifacts) {
		process.stdout.write(
			`  - ${artifact.specifier}: ${artifact.status} (version=${artifact.resolvedVersion ?? "unresolved"})\n`,
		);
		if (artifact.reason)
			process.stdout.write(`    reason: ${artifact.reason}\n`);
	}
	for (const limitation of report.limitations) {
		process.stdout.write(
			`- limitation (${limitation.coverage}): ${limitation.source}\n  ${limitation.detail}\n`,
		);
	}
	for (const reason of report.reasons) {
		process.stdout.write(`- blocked: ${reason}\n`);
	}
}

function writeActivationApply(
	report: ActivationApplyReport,
	json: boolean,
): void {
	if (json) {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		return;
	}
	process.stdout.write(`Flow activation ${report.mode}: ${report.status}\n`);
	process.stdout.write(`- project: ${report.project}\n`);
	process.stdout.write(
		"- coverage: global sources plus the selected project; other project trees are not scanned\n",
	);
	process.stdout.write(`- canonical scope: ${report.scope}\n`);
	process.stdout.write(`- target: opencode-plugin-flow@${report.target}\n`);
	for (const refusal of report.refusals) {
		process.stdout.write(`- refused: ${refusal}\n`);
	}
	if (report.status === "refused" && report.plan.length > 0) {
		process.stdout.write("- blocked plan (not executed):\n");
	}
	for (const operation of report.plan) {
		const action =
			report.status === "refused"
				? `would-${operation.action}`
				: operation.action;
		process.stdout.write(
			`- ${action}: ${operation.path}\n  ${operation.detail}\n`,
		);
	}
	if (report.recovery) {
		process.stdout.write(
			`- recovery journal: ${report.recovery.journalPath}\n`,
		);
	}
	if (report.failure) {
		process.stdout.write(
			`- recovery state: ${report.failure.recoveryState}\n- failure: ${report.failure.message}\n`,
		);
		for (const guidance of report.failure.guidance) {
			process.stdout.write(`  recovery: ${guidance}\n`);
		}
	}
	if (report.mode === "dry-run" && report.status === "ready") {
		process.stdout.write(
			"- no files changed; repeat with --apply to execute\n",
		);
	}
}

type ParsedActivationFlags = {
	project?: string;
	target?: string;
	scope?: string;
	apply: boolean;
	json: boolean;
	help: boolean;
};

function parseActivationFlags(flags: string[]): ParsedActivationFlags | null {
	const parsed: ParsedActivationFlags = {
		apply: false,
		json: false,
		help: false,
	};
	const seen = new Set<string>();
	for (let index = 0; index < flags.length; index += 1) {
		const flag = flags[index];
		if (!flag || seen.has(flag)) return null;
		seen.add(flag);
		if (flag === "--apply") {
			parsed.apply = true;
			continue;
		}
		if (flag === "--json") {
			parsed.json = true;
			continue;
		}
		if (flag === "--help" || flag === "-h") {
			parsed.help = true;
			continue;
		}
		if (!["--project", "--target", "--scope"].includes(flag)) return null;
		const value = flags[index + 1];
		if (!value || value.startsWith("--")) return null;
		index += 1;
		if (flag === "--project") parsed.project = value;
		if (flag === "--target") parsed.target = value;
		if (flag === "--scope") parsed.scope = value;
	}
	return parsed;
}

function activationScope(value: string | undefined): ActivationScope | null {
	return value === "global" || value === "project" ? value : null;
}

async function runActivationCheck(flags: string[]): Promise<void> {
	const parsed = parseActivationFlags(flags);
	if (
		!parsed ||
		parsed.apply ||
		parsed.scope ||
		(!parsed.project && !parsed.help)
	) {
		process.stderr.write(`${usage()}\n`);
		process.exitCode = 2;
		return;
	}
	if (parsed.help) {
		process.stdout.write(`${usage()}\n`);
		return;
	}
	const report = await checkFlowActivation({
		project: parsed.project as string,
		...(parsed.target ? { target: parsed.target } : {}),
	});
	writeActivationCheck(report, parsed.json);
	if (!report.singleVersionSatisfied) process.exitCode = 1;
}

async function runActivationApply(flags: string[]): Promise<void> {
	const parsed = parseActivationFlags(flags);
	const scope = activationScope(parsed?.scope);
	if (
		!parsed ||
		(!parsed.project && !parsed.help) ||
		(!scope && !parsed.help)
	) {
		process.stderr.write(`${usage()}\n`);
		process.exitCode = 2;
		return;
	}
	if (parsed.help) {
		process.stdout.write(`${usage()}\n`);
		return;
	}
	const report = await applyFlowActivation({
		project: parsed.project as string,
		scope: scope as ActivationScope,
		apply: parsed.apply,
		...(parsed.target ? { target: parsed.target } : {}),
	});
	writeActivationApply(report, parsed.json);
	if (report.status === "refused") process.exitCode = 1;
}

async function runInstall(flags: string[]): Promise<void> {
	const parsed = parseActivationFlags(flags);
	const scope = activationScope(parsed?.scope);
	if (
		!parsed ||
		parsed.apply ||
		parsed.target ||
		(!parsed.project && !parsed.help) ||
		(!scope && !parsed.help)
	) {
		process.stderr.write(`${usage()}\n`);
		process.exitCode = 2;
		return;
	}
	if (parsed.help) {
		process.stdout.write(`${usage()}\n`);
		return;
	}
	const report = await applyFlowActivation({
		project: parsed.project as string,
		scope: scope as ActivationScope,
		apply: true,
	});
	writeActivationApply(report, parsed.json);
	if (report.status === "refused") process.exitCode = 1;
}

async function runLegacyCleanup(flags: string[]): Promise<void> {
	const knownFlags = new Set(["--dry-run", "--apply", "--json"]);
	const validFlags = flags.every((flag) => knownFlags.has(flag));
	const dryRun = flags.includes("--dry-run");
	const apply = flags.includes("--apply");
	if (!validFlags || dryRun === apply) {
		process.stderr.write(`${usage()}\n`);
		process.exitCode = 2;
		return;
	}
	const report = await cleanupLegacySkills({ apply });
	writeLegacyReport(report, flags.includes("--json"));
	if (
		apply &&
		report.results.some((result) =>
			["refused", "quarantined"].includes(result.status),
		)
	) {
		process.exitCode = 1;
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
	if (command === "activation-check") {
		await runActivationCheck(flags);
		return;
	}
	if (command === "install") {
		await runInstall(flags);
		return;
	}
	if (command === "activation-apply") {
		await runActivationApply(flags);
		return;
	}
	if (command === "legacy-cleanup") {
		await runLegacyCleanup(flags);
		return;
	}
	process.stderr.write(`${usage()}\n`);
	process.exitCode = 2;
}

main(process.argv).catch((error) => {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
