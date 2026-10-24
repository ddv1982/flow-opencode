import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import {
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	realpath,
	rename,
	rmdir,
	unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import type { StoredModelPreferences } from "../../application/model-preferences.js";
import { storedPreferencesSchema } from "../../application/model-preferences-schema.js";

const EMPTY_MODEL_PREFERENCES: StoredModelPreferences = {
	schemaVersion: 1,
	revision: 0,
	roles: { planning: { kind: "default" }, review: { kind: "default" } },
};
const ownerSchema = z.strictObject({
	token: z.string().uuid(),
	pid: z.number().int().positive(),
});
function hasCode(error: unknown, code: string) {
	return error instanceof Error && "code" in error && error.code === code;
}
function dead(pid: number) {
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		return hasCode(error, "ESRCH");
	}
}

export function modelPreferencePath(env: NodeJS.ProcessEnv = process.env) {
	const state = env.XDG_STATE_HOME;
	return join(
		state && isAbsolute(state)
			? state
			: join(
					env.HOME && isAbsolute(env.HOME) ? env.HOME : homedir(),
					".local",
					"state",
				),
		"opencode-plugin-flow",
		"model-preferences.json",
	);
}

interface ModelPreferenceStore {
	read(): Promise<StoredModelPreferences>;
	update<T>(
		mutation: (current: StoredModelPreferences) => Promise<{
			value: T;
			next?: StoredModelPreferences;
			beforeCommit?: () => void;
		}>,
	): Promise<T>;
	watch(onChange: () => void, onError: (error: Error) => void): () => void;
}

export async function createModelPreferenceStore(
	file = modelPreferencePath(),
	options: { lockTimeoutMs?: number } = {},
): Promise<ModelPreferenceStore> {
	await mkdir(dirname(file), { recursive: true, mode: 0o700 });
	const directory = await realpath(dirname(file));
	const target = join(directory, basename(file));
	const lock = join(directory, "model-preferences.lock");
	const read = async () => {
		try {
			if (!(await lstat(target)).isFile())
				throw new Error("Flow model preferences must be a regular file.");
			return storedPreferencesSchema.parse(
				JSON.parse(await readFile(target, "utf8")),
			);
		} catch (error) {
			if (hasCode(error, "ENOENT"))
				return structuredClone(EMPTY_MODEL_PREFERENCES);
			throw error;
		}
	};
	const removeOwner = async (name: string) => {
		try {
			await unlink(join(lock, name));
		} catch (error) {
			if (hasCode(error, "ENOENT")) return;
			throw error;
		}
		try {
			await rmdir(lock);
		} catch (error) {
			if (
				!hasCode(error, "ENOENT") &&
				!hasCode(error, "ENOTEMPTY") &&
				!hasCode(error, "EEXIST")
			)
				throw error;
		}
	};
	const reclaim = async () => {
		try {
			if (!(await lstat(lock)).isDirectory())
				throw new Error("Flow model preference lock must be a directory.");
			const entries = await readdir(lock);
			if (!entries.length) {
				try {
					await rmdir(lock);
				} catch (error) {
					if (
						!hasCode(error, "ENOENT") &&
						!hasCode(error, "ENOTEMPTY") &&
						!hasCode(error, "EEXIST")
					)
						throw error;
				}
				return;
			}
			if (entries.length !== 1 || !entries[0]?.startsWith("owner-")) return;
			const name = entries[0];
			const owner = ownerSchema.parse(
				JSON.parse(await readFile(join(lock, name), "utf8")),
			);
			if (name === `owner-${owner.token}.json` && dead(owner.pid))
				await removeOwner(name);
		} catch (error) {
			if (!hasCode(error, "ENOENT")) throw error;
		}
	};
	const acquire = async () => {
		const token = randomUUID();
		const temporary = join(directory, `.preferences-lock-${token}`);
		const name = `owner-${token}.json`;
		await mkdir(temporary, { mode: 0o700 });
		await writeNewFile(
			join(temporary, name),
			JSON.stringify({ token, pid: process.pid }),
		);
		const started = Date.now();
		try {
			while (true) {
				try {
					await rename(temporary, lock);
					return () => removeOwner(name);
				} catch (error) {
					if (!hasCode(error, "ENOTEMPTY") && !hasCode(error, "EEXIST"))
						throw error;
				}
				await reclaim();
				if (Date.now() - started >= (options.lockTimeoutMs ?? 5_000))
					throw new Error(
						"Timed out waiting for the Flow model preference lock.",
					);
				await sleep(10);
			}
		} finally {
			await removeCandidate(temporary, name);
		}
	};
	return {
		read,
		async update(mutation) {
			const release = await acquire();
			try {
				const current = await read();
				const { value, next, beforeCommit } = await mutation(current);
				if (next) {
					storedPreferencesSchema.parse(next);
					if (next.revision !== current.revision + 1)
						throw new Error(
							"Flow model preference revision must advance once.",
						);
					const temporary = join(
						directory,
						`.model-preferences-${randomUUID()}.json`,
					);
					try {
						await writeNewFile(temporary, `${JSON.stringify(next)}\n`);
						beforeCommit?.();
						await rename(temporary, target);
						const parent = await open(directory, "r");
						try {
							await parent.sync();
						} finally {
							await parent.close();
						}
					} finally {
						await removeTemporaryFile(temporary);
					}
				}
				return value;
			} finally {
				await release();
			}
		},
		watch(onChange, onError) {
			const watcher = watch(
				directory,
				{ persistent: false },
				(_event, name) => {
					if (name === null || name.toString() === basename(file)) onChange();
				},
			);
			watcher.on("error", onError);
			return () => watcher.close();
		},
	};
}

async function writeNewFile(path: string, text: string) {
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.writeFile(text, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function removeTemporaryFile(path: string) {
	try {
		await unlink(path);
	} catch (error) {
		if (!hasCode(error, "ENOENT")) throw error;
	}
}
async function removeCandidate(path: string, owner: string) {
	try {
		await unlink(join(path, owner));
		await rmdir(path);
	} catch (error) {
		if (!hasCode(error, "ENOENT")) throw error;
	}
}
