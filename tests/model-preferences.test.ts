import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
	OpenCodeEvent,
	SessionInfo,
	SessionMessageInfo,
} from "@opencode/client";
import { Location, Model, Provider } from "@opencode/plugin";
import type { RpcCallContext } from "@opencode/plugin/promise/rpc";
import { Schema } from "effect";
import type {
	PickerChoice,
	SaveModelPreference,
} from "../src/application/model-preferences.js";
import {
	pickerSnapshotSchema,
	savePreferenceResultSchema,
} from "../src/application/model-preferences-schema.js";
import { resolveFlowReviewerConfiguration } from "../src/config-shared.js";
import type { FlowModelPreferencesRpc } from "../src/flow-rpc.js";
import {
	createFlowModelPreferences,
	type FlowModelPreferences,
	type FlowModelPreferencesContext,
} from "../src/platform/opencode/model-preferences.js";

const base = resolveFlowReviewerConfiguration({
	env: {},
	pluginOptions: {
		reviewer: { model: "test/base", variant: "high", steps: 80 },
	},
});
const model: PickerChoice = {
	kind: "model",
	model: { providerID: "test", id: "native-id" },
};
const defaults: PickerChoice = { kind: "default" };
const directories: string[] = [];
const cleanups: Array<() => Promise<void>> = [];
const previousStateHome = process.env.XDG_STATE_HOME;
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((dispose) => dispose()));
	if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
	else process.env.XDG_STATE_HOME = previousStateHome;
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});
async function isolated() {
	const root = await mkdtemp(join(tmpdir(), "flow-model-preferences-rpc-"));
	directories.push(root);
	process.env.XDG_STATE_HOME = root;
}
async function fixture(
	directory = "/project",
	options: Record<string, unknown> = {},
) {
	let read: (() => Promise<unknown>) | undefined;
	let set:
		| ((input: SaveModelPreference, signal?: AbortSignal) => Promise<unknown>)
		| undefined;
	let wake = Promise.withResolvers<void>();
	let ended = false;
	const queue: OpenCodeEvent[] = [];
	const messages = new Map<string, SessionMessageInfo[]>();
	let sessions: SessionInfo[] = [];
	let catalog = [
		Model.Info.default(Provider.ID.make("test"), Model.ID.make("native-id")),
	];
	catalog = catalog.map((value) => ({
		...value,
		enabled: true,
		capabilities: {
			...value.capabilities,
			tools: true,
			input: ["text"],
			output: ["text"],
		},
	}));
	let modelEffect = () => {};
	const changed: Array<{ planning: string | undefined; reviewer: unknown }> =
		[];
	let preferences: FlowModelPreferences | undefined;
	let disposed = false;
	const context: FlowModelPreferencesContext = {
		location: Schema.decodeUnknownSync(Location.Info)({
			directory,
			project: { id: "project", directory, canonical: directory },
		}),
		options,
		model: {
			async list() {
				modelEffect();
				return { location: { directory }, data: catalog };
			},
		},
		session: {
			async hook() {
				return { async dispose() {} };
			},
			async list() {
				return { data: sessions, cursor: {} };
			},
			async context(input) {
				return messages.get(input.sessionID) ?? [];
			},
		},
		event: {
			async *subscribe({ signal } = {}) {
				signal?.addEventListener("abort", () => wake.resolve(), { once: true });
				while (!ended && !signal?.aborted) {
					while (queue.length) {
						const next = queue.shift();
						if (next) yield next;
					}
					await wake.promise;
					wake = Promise.withResolvers<void>();
				}
			},
		},
		rpc: {
			async register(_definition, handlers) {
				const call = {
					signal: new AbortController().signal,
					error() {
						throw new Error("Not used.");
					},
				} satisfies RpcCallContext<typeof FlowModelPreferencesRpc.methods.read>;
				read = async () => handlers.read({}, call);
				set = async (input, signal) =>
					handlers.set(input, { ...call, signal: signal ?? call.signal });
				return {
					async dispose() {
						disposed = true;
					},
					events: { async emit() {} },
				};
			},
		},
	};
	preferences = await createFlowModelPreferences(context, {
		onChange() {
			if (!preferences) throw new Error("Initial setup must not notify.");
			changed.push({
				planning: preferences.planningModel(),
				reviewer: preferences.reviewerConfiguration(base),
			});
		},
	});
	cleanups.push(() => preferences.dispose());
	return {
		preferences,
		changed,
		options,
		async read() {
			if (!read) throw new Error("No RPC read.");
			return pickerSnapshotSchema.parse(await read());
		},
		async save(input: SaveModelPreference, signal?: AbortSignal) {
			if (!set) throw new Error("No RPC set.");
			return savePreferenceResultSchema.parse(await set(input, signal));
		},
		catalog(value: typeof catalog) {
			catalog = value;
		},
		onCatalog(effect: () => void) {
			modelEffect = effect;
		},
		endEvents() {
			ended = true;
			wake.resolve();
		},
		emit(event: OpenCodeEvent) {
			queue.push(event);
			wake.resolve();
		},
		setSession(session: SessionInfo, context: SessionMessageInfo[]) {
			sessions = [session];
			messages.set(session.id, context);
		},
		disposed: () => disposed,
		busy() {
			sessions = [
				{
					id: "busy",
					projectID: "project",
					cost: 0,
					tokens: {
						input: 0,
						output: 0,
						reasoning: 0,
						cache: { read: 0, write: 0 },
					},
					time: { created: 1, updated: 2 },
					location: { directory },
				},
			];
			messages.set("busy", [
				{ type: "user", id: "user", time: { created: 2 }, text: "working" },
			]);
		},
	};
}
async function request(
	f: Awaited<ReturnType<typeof fixture>>,
	role: "planning" | "review",
	choice: PickerChoice,
) {
	const snapshot = await f.read();
	return {
		role,
		choice,
		expectedRevision: snapshot.revision,
		expectedProject: snapshot.project,
	};
}
async function until(condition: () => boolean) {
	for (let i = 0; i < 100 && !condition(); i++) await Bun.sleep(10);
	expect(condition()).toBe(true);
}
test("RPC saves update role inputs before callback, preserve independent roles, and restore base on reset", async () => {
	await isolated();
	const f = await fixture();
	expect(f.changed).toEqual([]);
	expect((await f.save(await request(f, "review", model))).kind).toBe("saved");
	expect(f.changed).toEqual([
		{
			planning: undefined,
			reviewer: {
				model: { kind: "explicit", source: "picker", value: "test/native-id" },
				steps: { kind: "explicit", source: "plugin-option", value: 80 },
			},
		},
	]);
	await f.save(await request(f, "planning", model));
	expect(f.preferences.planningModel()).toBe("test/native-id");
	await f.save(await request(f, "review", defaults));
	expect(f.preferences.reviewerConfiguration(base)).toEqual(base);
	expect(f.preferences.planningModel()).toBe("test/native-id");
	expect((await f.save(await request(f, "review", defaults))).kind).toBe(
		"unchanged",
	);
	expect(f.changed.length).toBe(3);
});
test("every loaded location refreshes global choices and project default suppresses them", async () => {
	await isolated();
	const a = await fixture("/a");
	const b = await fixture("/b");
	const project = await fixture("/project", {
		modelPreferences: {
			review: defaults,
			planning: {
				kind: "model",
				model: { providerID: "project", id: "planner" },
			},
		},
	});
	await a.save(await request(a, "review", model));
	await until(() => b.changed.length === 1 && project.changed.length === 1);
	expect(b.preferences.reviewerConfiguration(base).model).toEqual({
		kind: "explicit",
		source: "picker",
		value: "test/native-id",
	});
	expect(project.preferences.reviewerConfiguration(base)).toEqual(base);
	expect(project.preferences.planningModel()).toBe("project/planner");
	expect((await project.read()).effective.review).toEqual({
		choice: defaults,
		source: "project",
	});
});
test("concurrent stale confirmations have only one successful writer", async () => {
	await isolated();
	const a = await fixture("/a");
	const b = await fixture("/b");
	const [ra, rb] = await Promise.all([
		request(a, "review", model),
		request(b, "planning", model),
	]);
	const results = await Promise.all([a.save(ra), b.save(rb)]);
	expect(results.map((result) => result.kind).sort()).toEqual([
		"refused",
		"saved",
	]);
	expect(results.find((result) => result.kind === "refused")).toEqual({
		kind: "refused",
		reason: "stale-preference",
	});
	expect((await a.read()).revision).toBe(1);
});
test("server refuses unavailable models and fresh project changes under the lock", async () => {
	await isolated();
	const f = await fixture();
	const input = await request(f, "review", model);
	f.catalog([]);
	expect(await f.save(input)).toEqual({
		kind: "refused",
		reason: "unavailable-model",
	});
	f.options.modelPreferences = { review: defaults };
	expect(await f.save(input)).toEqual({
		kind: "refused",
		reason: "stale-project",
	});
	expect((await f.read()).revision).toBe(0);
});
test("project changes during catalog validation refuse before commit", async () => {
	await isolated();
	const f = await fixture();
	const input = await request(f, "review", model);
	f.onCatalog(() => {
		f.options.modelPreferences = { review: defaults };
	});
	expect(await f.save(input)).toEqual({
		kind: "refused",
		reason: "stale-project",
	});
	expect(f.changed).toEqual([]);
});
test("server refuses a running transcript even when the client bypasses the TUI activity check", async () => {
	await isolated();
	const f = await fixture();
	f.busy();
	expect(await f.save(await request(f, "review", model))).toEqual({
		kind: "refused",
		reason: "busy",
	});
	expect((await f.read()).revision).toBe(0);
});
test("aborted and unloaded RPC saves cannot write, and dispose is idempotent", async () => {
	await isolated();
	const f = await fixture();
	const input = await request(f, "review", model);
	const abort = new AbortController();
	abort.abort();
	expect(await f.save(input, abort.signal)).toEqual({
		kind: "refused",
		reason: "unloaded",
	});
	await f.preferences.dispose();
	await f.preferences.dispose();
	expect(f.disposed()).toBe(true);
	expect(await f.save(input)).toEqual({ kind: "refused", reason: "unloaded" });
	expect(f.changed).toEqual([]);
});
test("event stream loss refuses further saves", async () => {
	await isolated();
	const f = await fixture();
	const input = await request(f, "review", model);
	f.endEvents();
	await Bun.sleep(0);
	await expect(f.save(input)).rejects.toThrow("event stream ended");
});

test("a separate process refreshes every loaded role input through the shared file", async () => {
	await isolated();
	const a = await fixture("/a");
	const b = await fixture("/b");
	const file = join(
		process.env.XDG_STATE_HOME ?? "",
		"opencode-plugin-flow",
		"model-preferences.json",
	);
	const child = Bun.spawn(
		[
			process.execPath,
			"-e",
			`
		import { createModelPreferenceStore } from ${JSON.stringify(resolve("src/infrastructure/fs/model-preference-store.ts"))};
		const store = await createModelPreferenceStore(Bun.argv.at(-1));
		await store.update(async current => ({ value: undefined, next: { ...current, revision: current.revision + 1, roles: { ...current.roles, review: {kind:'model',model:{providerID:'test',id:'other-process'}} } } }));
	`,
			file,
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const errors = await new Response(child.stderr).text();
	expect(await child.exited, errors).toBe(0);
	await until(() => a.changed.length === 1 && b.changed.length === 1);
	expect(a.preferences.reviewerConfiguration(base).model).toEqual({
		kind: "explicit",
		source: "picker",
		value: "test/other-process",
	});
	expect(b.preferences.reviewerConfiguration(base).model).toEqual({
		kind: "explicit",
		source: "picker",
		value: "test/other-process",
	});
});

for (const outcome of ["succeeded", "failed", "interrupted"] as const) {
	test(`native execution events refuse work and release after ${outcome}`, async () => {
		await isolated();
		const f = await fixture();
		const input = await request(f, "review", model);
		const shared = {
			id: "evt_start",
			created: 1,
			durable: { aggregateID: "busy", seq: 1, version: 1 as const },
		};
		f.emit({
			...shared,
			type: "session.execution.started",
			data: { sessionID: "busy" },
		});
		await Bun.sleep(0);
		expect(await f.save(input)).toEqual({ kind: "refused", reason: "busy" });
		if (outcome === "failed")
			f.emit({
				...shared,
				type: "session.execution.failed",
				data: {
					sessionID: "busy",
					error: {
						type: "provider.invalid-request",
						message: "Local fixture failure",
					},
				},
			});
		else if (outcome === "interrupted")
			f.emit({
				...shared,
				type: "session.execution.interrupted",
				data: { sessionID: "busy", reason: "user" },
			});
		else
			f.emit({
				...shared,
				type: "session.execution.succeeded",
				data: { sessionID: "busy" },
			});
		await Bun.sleep(0);
		expect((await f.save(input)).kind).toBe("saved");
	});
}
test("native session timestamps refuse a new execution that retains a previous completed assistant", async () => {
	await isolated();
	const f = await fixture();
	const session: SessionInfo = {
		id: "busy",
		projectID: "project",
		cost: 0,
		tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
		outcome: "succeeded",
		time: { created: 1, updated: 4, idle: 3 },
		location: { directory: "/project" },
	};
	const assistant: SessionMessageInfo = {
		type: "assistant",
		id: "assistant",
		agent: "build",
		model: { providerID: "test", id: "native-id" },
		time: { created: 2, completed: 3 },
		content: [],
	};
	f.setSession(session, [assistant]);
	expect(await f.save(await request(f, "review", model))).toEqual({
		kind: "refused",
		reason: "busy",
	});
	f.setSession({ ...session, time: { ...session.time, updated: 3 } }, [
		assistant,
	]);
	expect((await f.save(await request(f, "review", model))).kind).toBe("saved");
});
