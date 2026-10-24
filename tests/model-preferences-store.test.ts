import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	createModelPreferenceStore,
	modelPreferencePath,
} from "../src/infrastructure/fs/model-preference-store.js";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "flow-model-preferences-"));
	directories.push(root);
	const file = join(root, "model-preferences.json");
	return {
		root,
		file,
		store: await createModelPreferenceStore(file, { lockTimeoutMs: 150 }),
	};
}
const modulePath = resolve("src/infrastructure/fs/model-preference-store.ts");
function worker(file: string, mode: "save" | "hold", identity: string) {
	return Bun.spawn(
		[
			process.execPath,
			"-e",
			`
		import { createModelPreferenceStore } from ${JSON.stringify(modulePath)};
		import { writeFile } from 'node:fs/promises';
		const [file, mode, identity] = Bun.argv.slice(-3);
		const store = await createModelPreferenceStore(file);
		const result = await store.update(async current => {
			if (mode === 'hold') {
				await writeFile(file + '.ready', 'ready');
				await new Promise(() => { setInterval(() => {}, 1000); });
			}
			if (current.revision !== 0) return { value: 'stale' };
			return { value: 'saved', next: { ...current, revision: 1, roles: { ...current.roles, review: { kind: 'model', model: { providerID: 'test', id: identity } } } } };
		});
		console.log(result);
	`,
			file,
			mode,
			identity,
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
}
async function ready(path: string) {
	for (let attempt = 0; attempt < 200; attempt++) {
		try {
			if ((await readFile(path, "utf8")) === "ready") return;
		} catch {}
		await Bun.sleep(10);
	}
	throw new Error("Child did not acquire its preference lock.");
}
test("global preference path honors XDG state and never depends on the project", () => {
	expect(
		modelPreferencePath({ XDG_STATE_HOME: "/state", HOME: "/home/test" }),
	).toBe("/state/opencode-plugin-flow/model-preferences.json");
	expect(
		modelPreferencePath({ XDG_STATE_HOME: "relative", HOME: "/home/test" }),
	).toBe("/home/test/.local/state/opencode-plugin-flow/model-preferences.json");
});
test("independent processes reject the same stale revision and preserve atomic JSON", async () => {
	const f = await fixture();
	const children = [
		worker(f.file, "save", "one"),
		worker(f.file, "save", "two"),
		worker(f.file, "save", "three"),
	];
	const results = await Promise.all(
		children.map(async (child) => {
			const output = await new Response(child.stdout).text();
			const errors = await new Response(child.stderr).text();
			expect(await child.exited, errors).toBe(0);
			return output.trim();
		}),
	);
	expect(results.sort()).toEqual(["saved", "stale", "stale"]);
	const stored = await f.store.read();
	expect(stored.revision).toBe(1);
	expect(stored.roles.planning).toEqual({ kind: "default" });
	expect(JSON.parse(await readFile(f.file, "utf8"))).toEqual(stored);
	expect((await readdir(f.root)).sort()).toEqual(["model-preferences.json"]);
});
test("a dead writer is reclaimed without losing the last committed preferences", async () => {
	const f = await fixture();
	const child = worker(f.file, "hold", "crashed");
	try {
		await ready(`${f.file}.ready`);
		await expect(
			f.store.update(async () => ({ value: "must not enter" })),
		).rejects.toThrow("Timed out");
	} finally {
		child.kill("SIGKILL");
		await child.exited;
	}
	await f.store.update(async (current) => ({
		value: undefined,
		next: {
			...current,
			revision: 1,
			roles: {
				planning: {
					kind: "model",
					model: { providerID: "test", id: "planner" },
				},
				review: { kind: "default" },
			},
		},
	}));
	expect(await f.store.read()).toEqual({
		schemaVersion: 1,
		revision: 1,
		roles: {
			planning: { kind: "model", model: { providerID: "test", id: "planner" } },
			review: { kind: "default" },
		},
	});
});
test("recovers an empty released lock and ignores abandoned unpublished owner directories", async () => {
	const f = await fixture();
	await mkdir(join(f.root, "model-preferences.lock"));
	await mkdir(join(f.root, ".preferences-lock-abandoned"));
	const result = await f.store.update(async (current) => ({
		value: current.revision,
	}));
	expect(result).toBe(0);
});
test("a live replacement owner survives old-owner cleanup", async () => {
	const f = await fixture();
	const lock = join(f.root, "model-preferences.lock");
	const replacement = randomUUID();
	await f.store.update(async () => {
		await rm(lock, { recursive: true });
		await mkdir(lock);
		await writeFile(
			join(lock, `owner-${replacement}.json`),
			JSON.stringify({ token: replacement, pid: process.pid }),
		);
		return { value: undefined };
	});
	expect(await readdir(lock)).toEqual([`owner-${replacement}.json`]);
});
test("canonical state directories share a lock through path aliases", async () => {
	const f = await fixture();
	const alias = `${f.root}-alias`;
	directories.push(alias);
	await symlink(f.root, alias);
	const other = await createModelPreferenceStore(
		join(alias, "model-preferences.json"),
		{ lockTimeoutMs: 50 },
	);
	await f.store.update(async () => {
		await expect(
			other.update(async () => ({ value: undefined })),
		).rejects.toThrow("Timed out");
		return { value: undefined };
	});
});
test("failed mutations and stale precommit guards preserve the committed record", async () => {
	const f = await fixture();
	await expect(
		f.store.update(async (current) => ({
			value: undefined,
			next: { ...current, revision: 1 },
			beforeCommit() {
				throw new Error("stale");
			},
		})),
	).rejects.toThrow("stale");
	expect((await f.store.read()).revision).toBe(0);
	expect(await readdir(f.root)).toEqual([]);
	await expect(
		f.store.update(async () => {
			throw new Error("rejected");
		}),
	).rejects.toThrow("rejected");
	expect((await f.store.read()).revision).toBe(0);
});
test("file watch observes another store's atomic replacement", async () => {
	const f = await fixture();
	const other = await createModelPreferenceStore(f.file);
	const event = Promise.withResolvers<void>();
	const close = f.store.watch(() => event.resolve(), event.reject);
	try {
		await other.update(async (current) => ({
			value: undefined,
			next: { ...current, revision: 1 },
		}));
		await Promise.race([
			event.promise,
			Bun.sleep(1_000).then(() => {
				throw new Error("No preference watch event.");
			}),
		]);
		expect((await f.store.read()).revision).toBe(1);
	} finally {
		close();
	}
});
test("malformed persisted state fails closed", async () => {
	const f = await fixture();
	await writeFile(f.file, '{"schemaVersion":1,"revision":0,"roles":{}}');
	await expect(f.store.read()).rejects.toThrow();
	await expect(
		f.store.update(async () => ({ value: undefined })),
	).rejects.toThrow();
	expect(await readFile(f.file, "utf8")).toBe(
		'{"schemaVersion":1,"revision":0,"roles":{}}',
	);
});
