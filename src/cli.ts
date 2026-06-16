import {
	formatFlowSkillDoctor,
	inspectFlowSkillInstall,
	resolveFlowPluginVersion,
	syncFlowSkills,
	uninstallFlowSkills,
} from "./distribution/sync";

async function main(argv: string[]): Promise<void> {
	const command = argv[2];
	if (command !== "uninstall" && command !== "doctor" && command !== "sync") {
		process.stderr.write(
			"usage: opencode-plugin-flow <doctor|sync|uninstall>\n",
		);
		process.exitCode = 2;
		return;
	}
	if (command === "doctor") {
		process.stdout.write(
			formatFlowSkillDoctor(await inspectFlowSkillInstall()),
		);
		return;
	}
	if (command === "sync") {
		const version = resolveFlowPluginVersion();
		const results = await syncFlowSkills(version);
		const changed = results.filter((result) =>
			["installed", "updated", "updated_with_backup"].includes(result.action),
		);
		const actionRequired = results.filter(
			(result) => result.action === "skipped_foreign",
		);
		process.stdout.write(`Flow skill sync (${version})\n`);
		for (const result of results) {
			process.stdout.write(`- ${result.name}: ${result.action}\n`);
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
	const result = await uninstallFlowSkills();
	for (const path of result.removed) {
		process.stdout.write(`Removed Flow skill: ${path}\n`);
	}
	for (const path of result.kept) {
		process.stdout.write(`Kept non-Flow or user-edited skill: ${path}\n`);
	}
	process.stdout.write(
		'Remove "opencode-plugin-flow" from opencode.json and restart OpenCode.\n',
	);
}

main(process.argv).catch((error) => {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
