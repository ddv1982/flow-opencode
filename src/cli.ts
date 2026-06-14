import { uninstallFlowSkills } from "./distribution/sync";

async function main(argv: string[]): Promise<void> {
	const command = argv[2];
	if (command !== "uninstall") {
		process.stderr.write("usage: opencode-plugin-flow uninstall\n");
		process.exitCode = 2;
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
