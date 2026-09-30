import { spawn } from "node:child_process";

const MAX_DIFF_BYTES = 4 * 1024 * 1024;

export function collectGitDiff(
	args: readonly string[],
	environment: NodeJS.ProcessEnv,
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const child = spawn("git", args, {
			env: environment,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const chunks: Buffer[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let failure: Error | undefined;
		let settled = false;
		const onError = (error: Error) => {
			if (settled || failure) return;
			failure = error;
			chunks.length = 0;
			try {
				child.kill("SIGKILL");
			} catch (killError) {
				failure = new AggregateError(
					[error, killError],
					"Git diff could not be terminated.",
				);
			}
		};
		const onStdout = (chunk: Buffer) => {
			if (settled || failure) return;
			stdoutBytes += chunk.length;
			if (stdoutBytes > MAX_DIFF_BYTES) {
				onError(new Error("Git diff stdout exceeds its capacity."));
				return;
			}
			chunks.push(chunk);
		};
		const onStderr = (chunk: Buffer) => {
			if (settled || failure) return;
			stderrBytes += chunk.length;
			if (stderrBytes > MAX_DIFF_BYTES) {
				onError(new Error("Git diff stderr exceeds its capacity."));
			}
		};
		child.on("error", onError);
		child.stdout.on("error", onError);
		child.stderr.on("error", onError);
		child.stdout.on("data", onStdout);
		child.stderr.on("data", onStderr);
		child.once("close", (code, signal) => {
			if (settled) return;
			settled = true;
			child.stdout.removeListener("data", onStdout);
			child.stderr.removeListener("data", onStderr);
			if (!failure && (signal !== null || (code !== 0 && code !== 1))) {
				failure = new Error(
					`Git diff exited with code ${code} and signal ${signal}.`,
				);
			}
			try {
				if (failure) reject(failure);
				else resolve(Buffer.concat(chunks, stdoutBytes));
			} catch (error) {
				reject(error);
			} finally {
				chunks.length = 0;
			}
		});
	});
}

export function jsonStringBytes(text: string): number {
	let bytes = Buffer.byteLength(text) + 2;
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (
			code === 34 ||
			code === 92 ||
			code === 8 ||
			code === 9 ||
			code === 10 ||
			code === 12 ||
			code === 13
		)
			bytes += 1;
		else if (code < 32) bytes += 5;
		// JSON escapes lone surrogates with six bytes; UTF-8 replacement uses three.
		else if (code >= 0xd800 && code <= 0xdbff) {
			const next = text.charCodeAt(index + 1);
			if (next >= 0xdc00 && next <= 0xdfff) index += 1;
			else bytes += 3;
		} else if (code >= 0xdc00 && code <= 0xdfff) bytes += 3;
	}
	return bytes;
}
