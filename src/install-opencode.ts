import { runInstallCommand, writeStderrLine } from "./installer";

try {
	await runInstallCommand(Bun.argv.slice(2));
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	writeStderrLine(message);
	process.exitCode = 1;
}
