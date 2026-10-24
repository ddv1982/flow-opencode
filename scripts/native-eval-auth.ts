import { constants } from "node:fs";
import { lstat, mkdir, open, rm, rmdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
	type NativeAccountBroker,
	startNativeAccountBroker,
} from "../evals/native-auth/broker.js";
import { requirePaidAuthorization } from "./paid-budget.js";

export async function runNativeAccountSource(
	input: {
		opencodeExecutable: string;
		models: readonly string[];
		output: string;
		signal: AbortSignal;
		budgetDirectory?: string;
	},
	start: typeof startNativeAccountBroker = startNativeAccountBroker,
): Promise<void> {
	input.signal.throwIfAborted();
	const budget = await requirePaidAuthorization(input.budgetDirectory);
	if (
		input.models.length === 0 ||
		input.models.some((model) => !budget.authorization.models.includes(model))
	)
		throw new Error("Native account source models are not authorized.");
	const output = resolve(input.output);
	const directory = dirname(output);
	let directoryCreated = false;
	let outputCreated = false;
	let broker: NativeAccountBroker | undefined;
	let file: Awaited<ReturnType<typeof open>> | undefined;
	let outputIdentity: { dev: number; ino: number } | undefined;
	let directoryIdentity: { dev: number; ino: number } | undefined;
	const failures: unknown[] = [];
	try {
		try {
			await mkdir(directory, { mode: 0o700 });
			directoryCreated = true;
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "EEXIST")
			)
				throw error;
		}
		const parent = await lstat(directory);
		if (
			!parent.isDirectory() ||
			parent.isSymbolicLink() ||
			parent.uid !== process.getuid?.() ||
			(parent.mode & 0o777) !== 0o700
		)
			throw new Error(
				"Native account source requires a private output directory.",
			);
		directoryIdentity = { dev: parent.dev, ino: parent.ino };
		file = await open(
			output,
			constants.O_WRONLY |
				constants.O_CREAT |
				constants.O_EXCL |
				constants.O_NOFOLLOW,
			0o600,
		);
		outputCreated = true;
		const identity = await file.stat();
		outputIdentity = { dev: identity.dev, ino: identity.ino };
		broker = await start({
			opencodeExecutable: input.opencodeExecutable,
			models: input.models,
			signal: input.signal,
		});
		await file.writeFile(`${JSON.stringify(broker.configuration)}\n`);
		await file.sync();
		console.log("Native account source ready.");
		await new Promise<void>((complete) => {
			if (input.signal.aborted) complete();
			else
				input.signal.addEventListener("abort", () => complete(), {
					once: true,
				});
		});
	} catch (error) {
		failures.push(error);
	}
	const settled = await Promise.allSettled([
		Promise.resolve().then(() => broker?.dispose()),
		Promise.resolve().then(() => file?.close()),
	]);
	for (const result of settled)
		if (result.status === "rejected") failures.push(result.reason);
	if (outputCreated) {
		try {
			const current = await lstat(output);
			if (
				!outputIdentity ||
				current.dev !== outputIdentity.dev ||
				current.ino !== outputIdentity.ino
			)
				throw new Error("Native account source output changed.");
			await rm(output);
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				failures.push(error);
		}
	}
	if (directoryCreated) {
		try {
			const current = await lstat(directory);
			if (
				!directoryIdentity ||
				current.dev !== directoryIdentity.dev ||
				current.ino !== directoryIdentity.ino
			)
				throw new Error("Native account source directory changed.");
			await rmdir(directory);
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				failures.push(error);
		}
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1)
		throw new AggregateError(
			failures,
			"Native account source did not close cleanly.",
		);
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	if (args.includes("--help"))
		console.log(
			"native-eval-auth --opencode <opencode2> --model <provider/model> [--model ...] --out <private-file> (requires FLOW_EVAL_AUTHORIZATION; stop with SIGINT or SIGTERM)",
		);
	else {
		const models: string[] = [];
		let output: string | undefined;
		let executable = "opencode2";
		let valid = true;
		for (let index = 0; index < args.length; index += 2) {
			const flag = args[index];
			const value = args[index + 1];
			if (!value) {
				valid = false;
				break;
			}
			if (flag === "--model") models.push(value);
			else if (flag === "--out" && output === undefined) output = value;
			else if (flag === "--opencode") executable = value;
			else valid = false;
		}
		if (!valid || !output || models.length === 0) {
			console.error("Expected model selection and one private output file.");
			process.exitCode = 2;
		} else {
			const controller = new AbortController();
			const stop = () => controller.abort();
			process.once("SIGINT", stop);
			process.once("SIGTERM", stop);
			try {
				await runNativeAccountSource({
					opencodeExecutable: executable,
					models,
					output,
					signal: controller.signal,
				});
			} catch {
				console.error(
					"Native account source failed. Check authorization and private configuration.",
				);
				process.exitCode = 2;
			} finally {
				process.off("SIGINT", stop);
				process.off("SIGTERM", stop);
			}
		}
	}
}
