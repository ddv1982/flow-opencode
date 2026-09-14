import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { terminateChildProcessTree } from "../evals/harness.js";
import { parsePreparedCanary } from "./eval-canary.js";
import { consumePaidDispatch } from "./paid-budget.js";

export async function runPaidCanary(
	input: { prepared: string; model: string; prompt: string },
	launch: (
		directory: string,
		model: string,
		prompt: string,
	) => Promise<number> = launchCanary,
): Promise<number> {
	const directory = dirname(resolve(input.prepared));
	const prepared = parsePreparedCanary(
		JSON.parse(await readFile(input.prepared, "utf8")),
	);
	const digest = async (path: string) =>
		`sha256:${createHash("sha256")
			.update(await readFile(path))
			.digest("hex")}`;
	if (
		(await digest(join(directory, prepared.artifactFile))) !==
			prepared.artifact.tarballSha256 ||
		(await digest(join(directory, "fixture/.opencode/plugins/flow.js"))) !==
			prepared.pluginEntrySha256
	)
		throw new Error("Prepared canary bytes changed.");
	const prompt = await readFile(input.prompt, "utf8");
	if (!prompt.trim()) throw new Error("Canary prompt is empty.");
	await consumePaidDispatch({ model: input.model, kind: "canary" });
	return launch(join(directory, "fixture"), input.model, prompt);
}
async function launchCanary(
	directory: string,
	model: string,
	prompt: string,
): Promise<number> {
	return new Promise((resolve, reject) => {
		const environment = { ...process.env };
		delete environment.FLOW_EVAL_AUTHORIZATION;
		const child = spawn(
			"opencode",
			["run", "--model", model, "--format", "json", "--", prompt],
			{
				cwd: directory,
				env: environment,
				stdio: "inherit",
				detached: process.platform !== "win32",
			},
		);
		let stopping: Promise<void> | undefined;
		let cancelledCode: number | undefined;
		const stop = (code: number) => {
			cancelledCode ??= code;
			stopping ??= terminateChildProcessTree(child);
			void stopping.catch(reject);
		};
		const interrupt = () => stop(130);
		const terminate = () => stop(143);
		process.on("SIGINT", interrupt);
		process.on("SIGTERM", terminate);
		const cleanup = () => {
			process.off("SIGINT", interrupt);
			process.off("SIGTERM", terminate);
		};
		child.once("error", (error) => {
			cleanup();
			reject(error);
		});
		child.once("close", (code, signal) => {
			cleanup();
			void (stopping ?? Promise.resolve()).then(
				() =>
					resolve(cancelledCode ?? code ?? (signal === "SIGINT" ? 130 : 143)),
				reject,
			);
		});
	});
}
if (import.meta.main) {
	const [prepared, model, prompt, ...extra] = process.argv.slice(2);
	if (!prepared || prepared === "--help")
		console.log(
			"canary-run <prepared.json> <provider/model> <prompt-file> (requires FLOW_EVAL_AUTHORIZATION)",
		);
	else if (!model || !prompt || extra.length) {
		console.error("Expected prepared.json, model, and prompt file.");
		process.exitCode = 1;
	} else
		runPaidCanary({ prepared, model, prompt })
			.then((code) => {
				process.exitCode = code;
			})
			.catch((error) => {
				console.error(error.message);
				process.exitCode = 1;
			});
}
