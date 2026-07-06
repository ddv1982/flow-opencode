import {
	type FlowSkillDoctorReport,
	formatFlowSkillDoctor,
	inspectFlowSkillInstall,
	isChangedSyncAction,
	resolveFlowPluginVersion,
	syncFlowSkills,
	uninstallFlowSkills,
} from "./distribution/sync";

function usage(): string {
	return [
		"usage: opencode-plugin-flow <doctor|sync|uninstall> [options]",
		"",
		"commands:",
		"  doctor              Inspect managed Flow skills",
		"  sync                Install or refresh managed Flow skills",
		"  uninstall           Remove pristine Flow-owned managed skills",
		"",
		"doctor options:",
		"  --json              Write the doctor report as JSON",
		"  --check, --strict   Exit nonzero when doctor status is not ok",
		"",
		"uninstall options:",
		"  --dry-run           Preview removals without deleting anything",
		"",
		"global options:",
		"  --help              Show this help",
		"  --version           Print the plugin version",
	].join("\n");
}

function hasOnlyKnownFlags(flags: string[], known: Set<string>): boolean {
	return flags.every((flag) => known.has(flag));
}

function writeDoctorReport(
	report: FlowSkillDoctorReport,
	options: { json: boolean },
): void {
	if (options.json) {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		return;
	}
	process.stdout.write(formatFlowSkillDoctor(report));
}

async function main(argv: string[]): Promise<void> {
	const command = argv[2];
	const flags = argv.slice(3);
	if (command === "--help" || command === "-h") {
		process.stdout.write(`${usage()}\n`);
		return;
	}
	if (command === "--version" || command === "-v") {
		process.stdout.write(`${resolveFlowPluginVersion()}\n`);
		return;
	}
	if (command !== "uninstall" && command !== "doctor" && command !== "sync") {
		process.stderr.write(`${usage()}\n`);
		process.exitCode = 2;
		return;
	}
	if (command === "doctor") {
		const knownDoctorFlags = new Set(["--json", "--check", "--strict"]);
		if (!hasOnlyKnownFlags(flags, knownDoctorFlags)) {
			process.stderr.write(`${usage()}\n`);
			process.exitCode = 2;
			return;
		}
		const report = await inspectFlowSkillInstall();
		writeDoctorReport(report, { json: flags.includes("--json") });
		if (
			(report.status === "sync_required" ||
				report.status === "action_required") &&
			(flags.includes("--check") || flags.includes("--strict"))
		) {
			process.exitCode = 1;
		}
		return;
	}
	const knownUninstallFlags = new Set(["--dry-run"]);
	if (
		command === "uninstall" &&
		!hasOnlyKnownFlags(flags, knownUninstallFlags)
	) {
		process.stderr.write(`${usage()}\n`);
		process.exitCode = 2;
		return;
	}
	if (command === "sync" && flags.length > 0) {
		process.stderr.write(`${usage()}\n`);
		process.exitCode = 2;
		return;
	}
	if (command === "sync") {
		const version = resolveFlowPluginVersion();
		const results = await syncFlowSkills(version);
		const changed = results.filter((result) =>
			isChangedSyncAction(result.action),
		);
		const actionRequired = results.filter(
			(result) => result.action === "skipped_foreign",
		);
		process.stdout.write(`Flow skill sync (${version})\n`);
		for (const result of results) {
			process.stdout.write(`- ${result.name}: ${result.action}\n`);
			for (const backupPath of result.backupPaths ?? []) {
				process.stdout.write(`  backup: ${backupPath}\n`);
			}
		}
		if (changed.length > 0) {
			process.stdout.write(
				"Restart OpenCode so the refreshed skill registry is used.\n",
			);
		}
		if (actionRequired.length > 0) {
			process.stdout.write(
				"Some managed skill folders are user-owned or edited; run doctor for repair guidance.\n",
			);
		}
		return;
	}
	const dryRun = flags.includes("--dry-run");
	const result = await uninstallFlowSkills(undefined, { dryRun });
	for (const path of result.removed) {
		process.stdout.write(
			`${dryRun ? "Would remove" : "Removed"} Flow skill: ${path}\n`,
		);
	}
	for (const path of result.kept) {
		process.stdout.write(`Kept non-Flow or user-edited skill: ${path}\n`);
	}
	if (result.removedBackups.length > 0) {
		process.stdout.write(
			`${dryRun ? "Would remove" : "Removed"} Flow-created backup files holding your earlier edits:\n`,
		);
		for (const path of result.removedBackups) {
			process.stdout.write(`  ${path}\n`);
		}
	}
	process.stdout.write(
		dryRun
			? "Dry run: no files were removed.\n"
			: "Remove opencode-plugin-flow from your OpenCode plugin config and restart OpenCode.\n",
	);
}

main(process.argv).catch((error) => {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
