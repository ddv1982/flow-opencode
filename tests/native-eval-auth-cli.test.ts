import { afterEach, expect, test } from "bun:test";
import {
	access,
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeAccountConnection } from "../evals/native-auth/protocol.js";
import { readNativeAccountConnection } from "../evals/native-auth-config.js";
import { runNativeAccountSource } from "../scripts/native-eval-auth.js";
import { authorizePaidRun } from "../scripts/paid-budget.js";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});
const configuration = {
	version: 1,
	url: "http://127.0.0.1:43124/",
	capability: "a".repeat(64),
	accounts: [
		{
			route: {
				providerID: "fixture",
				integrationID: "fixture-native",
				credentialID: "fixture-account",
				methodID: "fixture-method",
				label: "Synthetic",
			},
		},
	],
} satisfies NativeAccountConnection;
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "native-auth-command-"));
	roots.push(root);
	const budgetDirectory = join(root, "budget");
	await authorizePaidRun(budgetDirectory, {
		schemaVersion: 1,
		purpose: "Synthetic command lifecycle test",
		models: ["fixture/model"],
		maxDispatches: 1,
		expiresAt: "2099-01-01T00:00:00.000Z",
	});
	const controller = new AbortController();
	return {
		root,
		controller,
		input: {
			opencodeExecutable: "synthetic-never-executed",
			models: ["fixture/model"],
			output: join(root, "private", "configuration.json"),
			signal: controller.signal,
			budgetDirectory,
		},
	};
}
async function waitForConfiguration(path: string) {
	for (let attempt = 0; attempt < 1000; attempt++) {
		try {
			return await readNativeAccountConnection(path);
		} catch {
			await Bun.sleep(5);
		}
	}
	throw new Error("Synthetic source configuration was not published");
}

test("native source command publishes private configuration and closes its owned files", async () => {
	const f = await fixture();
	let stopped = 0;
	const running = runNativeAccountSource(f.input, async () => ({
		configuration,
		dispose: async () => {
			stopped++;
		},
	}));
	try {
		expect(await waitForConfiguration(f.input.output)).toEqual(configuration);
		expect((await lstat(f.input.output)).mode & 0o777).toBe(0o600);
		expect((await lstat(join(f.root, "private"))).mode & 0o777).toBe(0o700);
	} finally {
		f.controller.abort();
		await running;
	}
	expect(stopped).toBe(1);
	await expect(access(join(f.root, "private"))).rejects.toThrow();
});

test("native source command refuses an unapproved model before touching the source", async () => {
	const f = await fixture();
	let starts = 0;
	await expect(
		runNativeAccountSource(
			{ ...f.input, models: ["other/model"] },
			async () => {
				starts++;
				throw new Error("Must not start");
			},
		),
	).rejects.toThrow("not authorized");
	expect(starts).toBe(0);
	await expect(access(join(f.root, "private"))).rejects.toThrow();
});

test("native source command refuses a missing authorization before touching the source", async () => {
	const f = await fixture();
	let starts = 0;
	await expect(
		runNativeAccountSource(
			{ ...f.input, budgetDirectory: join(f.root, "missing") },
			async () => {
				starts++;
				throw new Error("Must not start");
			},
		),
	).rejects.toThrow();
	expect(starts).toBe(0);
	await expect(access(join(f.root, "private"))).rejects.toThrow();
});

test("native source command preserves an existing output file and avoids source startup", async () => {
	const f = await fixture();
	await mkdir(join(f.root, "private"), { mode: 0o700 });
	await writeFile(f.input.output, "existing private file", { mode: 0o600 });
	let starts = 0;
	await expect(
		runNativeAccountSource(f.input, async () => {
			starts++;
			throw new Error("Must not start");
		}),
	).rejects.toThrow();
	expect(starts).toBe(0);
	expect(await readFile(f.input.output, "utf8")).toBe("existing private file");
});

test("native source command refuses a public directory without changing its permissions", async () => {
	const f = await fixture();
	await mkdir(join(f.root, "private"));
	await chmod(join(f.root, "private"), 0o755);
	let starts = 0;
	await expect(
		runNativeAccountSource(f.input, async () => {
			starts++;
			throw new Error("Must not start");
		}),
	).rejects.toThrow("private output directory");
	expect(starts).toBe(0);
	expect((await lstat(join(f.root, "private"))).mode & 0o777).toBe(0o755);
});

test("failed native source startup removes only the new owned output", async () => {
	const f = await fixture();
	await expect(
		runNativeAccountSource(f.input, async () => {
			throw new Error("Synthetic startup failed");
		}),
	).rejects.toThrow("Synthetic startup failed");
	await expect(access(join(f.root, "private"))).rejects.toThrow();
});

test("native source disposal failure still removes private files", async () => {
	const f = await fixture();
	const result = runNativeAccountSource(f.input, async () => ({
		configuration,
		dispose: () => {
			throw new Error("Synthetic disposal failed");
		},
	})).then(
		() => undefined,
		(error: unknown) => error,
	);
	await waitForConfiguration(f.input.output);
	f.controller.abort();
	expect(String(await result)).toBe("Error: Synthetic disposal failed");
	await expect(access(join(f.root, "private"))).rejects.toThrow();
});

test("native source cleanup preserves a replacement output owned by another run", async () => {
	const f = await fixture();
	let disposed = 0;
	const result = runNativeAccountSource(f.input, async () => ({
		configuration,
		dispose: async () => {
			disposed++;
		},
	})).then(
		() => undefined,
		(error: unknown) => error,
	);
	await waitForConfiguration(f.input.output);
	const replacement = join(f.root, "replacement.json");
	await writeFile(replacement, "replacement owned by another run", {
		mode: 0o600,
	});
	await rename(replacement, f.input.output);
	f.controller.abort();
	expect(await result).toBeInstanceOf(Error);
	expect(disposed).toBe(1);
	expect(await readFile(f.input.output, "utf8")).toBe(
		"replacement owned by another run",
	);
});
