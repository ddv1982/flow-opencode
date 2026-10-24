import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { NativeAuthentication } from "./native-auth/host.js";
import {
	type NativeAccountConnection,
	parseConnection,
	refuse,
} from "./native-auth/protocol.js";

export async function readNativeAccountConnection(
	path: string,
): Promise<NativeAccountConnection> {
	try {
		const absolute = resolve(path);
		const parent = await lstat(dirname(absolute));
		if (
			!parent.isDirectory() ||
			parent.isSymbolicLink() ||
			parent.uid !== process.getuid?.() ||
			(parent.mode & 0o777) !== 0o700
		)
			refuse();
		const file = await open(
			absolute,
			constants.O_RDONLY | constants.O_NOFOLLOW,
		);
		try {
			const stat = await file.stat();
			if (
				!stat.isFile() ||
				stat.nlink !== 1 ||
				stat.uid !== process.getuid?.() ||
				(stat.mode & 0o777) !== 0o600 ||
				stat.size > 1024 * 1024
			)
				refuse();
			return parseConnection(JSON.parse(await file.readFile("utf8")));
		} finally {
			await file.close();
		}
	} catch {
		refuse();
	}
}

export async function nativeAuthenticationFromEnvironment(
	models: readonly string[],
	environment: NodeJS.ProcessEnv = process.env,
): Promise<NativeAuthentication | undefined> {
	const path = environment.FLOW_EVAL_NATIVE_AUTH?.trim();
	if (!path) return undefined;
	return {
		configuration: await readNativeAccountConnection(path),
		models: [...models],
	};
}
