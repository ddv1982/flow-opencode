import { homedir } from "node:os";
import { uninstallFlow } from "./distribution/uninstall";

const USAGE = `opencode-plugin-flow — Flow plugin lifecycle commands

Usage:
  bunx opencode-plugin-flow uninstall [--dry-run]

Commands:
  uninstall   Remove Flow-owned global skills from ~/.config/opencode/skills/
              and the pre-npm plugin copy at ~/.config/opencode/plugins/flow.js.
              Prints the opencode.json cleanup step; never touches files that
              are not Flow-owned.

Options:
  --dry-run   Show what would be removed without deleting anything
  --help      Show this message`;

function writeLine(message: string): void {
	process.stdout.write(`${message}\n`);
}

function writeErrorLine(message: string): void {
	process.stderr.write(`${message}\n`);
}

async function runCli(argv: string[]): Promise<number> {
	const args = [...argv];
	if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
		writeLine(USAGE);
		return 0;
	}

	const command = args.shift();
	if (command !== "uninstall") {
		writeErrorLine(`Unknown command: ${command}\n\n${USAGE}`);
		return 1;
	}

	let dryRun = false;
	for (const argument of args) {
		if (argument === "--dry-run") {
			dryRun = true;
			continue;
		}
		writeErrorLine(`Unknown argument: ${argument}\n\n${USAGE}`);
		return 1;
	}

	await uninstallFlow({
		homeDir: process.env.HOME ?? homedir(),
		dryRun,
		logger: writeLine,
	});
	return 0;
}

// This module is only ever executed as the package bin entry (dist/cli.js);
// the reusable logic lives in adapters/opencode/uninstall.ts.
try {
	process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
	writeErrorLine(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
