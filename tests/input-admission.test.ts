import { expect, test } from "bun:test";
import { Agent, Model, Provider } from "@opencode/plugin";
import type { SessionContext } from "@opencode/plugin/promise/session";
import { Session } from "@opencode/schema/session";
import { Skill } from "@opencode/schema/skill";
import { InputAdmissions } from "../src/platform/opencode/input-admission.js";

const host = Session.ID.make("session-ledger");
const agent = Agent.ID.make("build");
const model = {
	providerID: Provider.ID.make("local"),
	id: Model.ID.make("scripted"),
};
const delivery = {
	agent,
	model: { providerID: model.providerID, modelID: model.id },
};
const context = (
	id: string,
): Pick<SessionContext, "sessionID" | "messages" | "agent" | "model"> => ({
	agent,
	model,
	sessionID: host,
	messages: [
		{ role: "user", id, content: [{ type: "text", text: "Approved task" }] },
	],
});
const selected: SessionInfo = {
	id: host,
	agent,
	model,
	projectID: "test",
	location: { directory: process.cwd() },
	time: { created: 0, updated: 0 },
	cost: 0,
	tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};
const effects = { check: () => {}, supersede: () => {} };
function fixture() {
	let open = true;
	const inputs = new InputAdmissions({
		assertOpen: () => {
			if (!open) throw Error("closed");
		},
		authorityCurrent: () => true,
		authority: () => null,
		observeReal: async () => {},
	});
	const reservation = inputs.reserve(host, "user-1");
	const admission = inputs.register(reservation, {
		type: "user",
		payload: { text: "Approved task" },
	});
	const receipt = {
		id: "user-1",
		sessionID: host,
		type: "user" as const,
		payload: { text: "Approved task" },
		time: { created: 0 },
		delivery: "queue" as const,
	};
	return {
		inputs,
		reservation,
		admission,
		receipt,
		close() {
			open = false;
			inputs.clear();
		},
		origin: () =>
			inputs.makeOrigin(host, "user-1", delivery, false, reservation.epoch),
	};
}
test("matching receipt wakes only the exact admission scope", async () => {
	const f = fixture();
	const scope = f.inputs.openSource(context("user-1"));
	const ready = scope.scope.ready();
	expect(f.admission.state).toBe("pending");
	await f.inputs.accept(f.admission, f.receipt, async () => f.origin());
	await ready;
	const resolved = await scope.resolve(
		[
			{
				type: "user",
				id: "user-1",
				text: "Approved task",
				time: { created: 0 },
			},
		],
		selected,
		effects,
	);
	expect(
		resolved.evidence.kind === "live" ? resolved.evidence.origin.id : null,
	).toBe("user-1");
	scope.release();
	f.close();
});
test("conflicting exact receipt payload rejects admission without materializing an origin", async () => {
	const f = fixture();
	let activated = false;
	await expect(
		f.inputs.accept(
			f.admission,
			{ ...f.receipt, payload: { text: "Different" } },
			async () => {
				activated = true;
				return f.origin();
			},
		),
	).rejects.toThrow("exact local payload");
	expect(activated).toBe(false);
	await expect(f.admission.ready).rejects.toThrow("exact local payload");
	f.close();
});
test("a superseded reservation cannot accept a receipt under the new lifetime", async () => {
	const f = fixture();
	f.inputs.invalidate(host);
	await expect(
		f.inputs.accept(f.admission, f.receipt, async () => f.origin()),
	).rejects.toThrow("epoch was revoked");
	await expect(f.admission.ready).rejects.toThrow("epoch was revoked");
	f.close();
});
for (const invalidation of ["lifetime", "frontier", "unload"] as const)
	test(`held readiness scope wakes on ${invalidation} without settling admission`, async () => {
		const f = fixture();
		const scope = f.inputs.openSource(context("user-1"));
		let settled = false;
		void f.admission.ready.then(
			() => {
				settled = true;
			},
			() => {
				settled = true;
			},
		);
		const wait = scope.scope.ready();
		const caught = wait.catch((error) => String(error));
		if (invalidation === "lifetime") f.inputs.invalidate(host);
		else if (invalidation === "frontier") f.inputs.reserve(host, "fresh");
		else f.close();
		expect(await caught).toBe("Error: Flow execution epoch was revoked.");
		await Promise.resolve();
		expect(settled).toBe(false);
		scope.release();
		f.close();
	});
test("pre-registration reservation blocks old consumed lineage in the same lifetime", () => {
	const f = fixture();
	f.inputs.reserve(host, "fresh-before-get");
	expect(() => f.inputs.openSource(context("user-1"))).toThrow(
		"epoch was revoked",
	);
	expect(() =>
		f.inputs.register(f.reservation, {
			type: "synthetic",
			payload: { text: "Old" },
		}),
	).toThrow("epoch was revoked");
	f.close();
});
test("a new frontier cancels old scope without rejecting a fresh exact ready", async () => {
	const f = fixture();
	const old = f.inputs.openSource(context("user-1"));
	const oldWait = old.scope.ready().catch((error) => String(error));
	const reservation = f.inputs.reserve(host, "fresh");
	const admission = f.inputs.register(reservation, {
		type: "synthetic",
		payload: { text: "Fresh" },
	});
	const fresh = f.inputs.openSource(context("fresh"));
	let settled = false;
	const ready = fresh.scope.ready().then(() => {
		settled = true;
	});
	expect(await oldWait).toBe("Error: Flow execution epoch was revoked.");
	old.release();
	await Promise.resolve();
	expect(settled).toBe(false);
	await f.inputs.accept(
		admission,
		{
			...f.receipt,
			id: "fresh",
			type: "synthetic",
			payload: { text: "Fresh" },
		},
		async () =>
			f.inputs.makeOrigin(host, "fresh", delivery, false, reservation.epoch),
	);
	await ready;
	const resolved = await fresh.resolve(
		[{ type: "synthetic", id: "fresh", text: "Fresh", time: { created: 0 } }],
		selected,
		effects,
	);
	expect(
		resolved.evidence.kind === "live" ? resolved.evidence.origin.id : null,
	).toBe("fresh");
	fresh.release();
	f.close();
});

import type { SessionInfo, SessionMessageInfo } from "@opencode/client";
import { CompactionBoundary } from "../src/platform/opencode/auto-compaction.js";

async function compactionFixture() {
	const f = fixture();
	await f.inputs.accept(f.admission, f.receipt, async () => f.origin());
	const native: SessionMessageInfo[] = [
		{ type: "user", id: "user-1", text: "Approved task", time: { created: 0 } },
		{
			type: "compaction",
			id: "msg_control",
			status: "running",
			reason: "auto",
			summary: "summary",
			time: { created: 1 },
		},
	];
	const input = {
		...context("user-1"),
		agent,
		model,
		system: [],
		options: {},
		tools: {},
	};
	const boundary = new CompactionBoundary({
		inputs: f.inputs,
		readNative: async () => structuredClone(native),
		readSelected: async () => selected,
		captureReplacement: () => ({
			check: () => {},
			supersede: () => {},
			current: () => true,
		}),
		failure: () => {},
		hasActivePrimary: () => false,
		guidance: () => null,
		observe: () => {},
	});
	return { ...f, native, input, boundary };
}
test("duplicate checked control admission returns the same record and checkpoint origin", async () => {
	const f = await compactionFixture();
	try {
		const first = await f.boundary.admit(f.input);
		const second = await f.boundary.admit(f.input);
		expect(second).toBe(first);
		expect(first.kind).toBe("continuation");
		const control = f.native[1];
		if (control?.type !== "compaction") throw Error("missing control");
		f.native.splice(0, f.native.length, {
			...control,
			status: "completed",
			summary: "summary",
		});
		const input = { ...f.input, ...context("msg_control") };
		const origin = f.boundary.completed(input, f.native);
		expect(origin).toBe(f.boundary.completed(input, f.native));
		if (first.kind !== "continuation") throw Error("missing continuation");
		expect(origin).toBe(first.origin);
	} finally {
		f.close();
	}
});
for (const corruption of [
	"reason",
	"prefix",
	"delivery",
	"replaced-during-wait",
] as const)
	test(`compaction boundary rejects exact ${corruption} mismatch`, async () => {
		const f = await compactionFixture();
		try {
			if (corruption === "reason") {
				const control = f.native[1];
				Object.defineProperty(control, "reason", { value: "future-reason" });
			}
			if (corruption === "prefix")
				f.native.unshift({
					type: "user",
					id: "foreign",
					text: "Foreign",
					time: { created: 0 },
				});
			if (corruption === "delivery")
				f.input.model = { ...model, id: Model.ID.make("different") };
			if (corruption === "replaced-during-wait") {
				const first = Promise.withResolvers<void>(),
					release = Promise.withResolvers<void>();
				let read = 0;
				const boundary = new CompactionBoundary({
					inputs: f.inputs,
					readNative: async () => {
						const snapshot = structuredClone(f.native);
						if (read++ === 0) {
							first.resolve();
							await release.promise;
						}
						return snapshot;
					},
					readSelected: async () => selected,
					captureReplacement: () => ({
						check: () => {},
						supersede: () => {},
						current: () => true,
					}),
					failure: () => {},
					hasActivePrimary: () => false,
					guidance: () => null,
					observe: () => {},
				});
				const pending = boundary.admit(f.input);
				await first.promise;
				const control = f.native[1];
				if (control?.type !== "compaction") throw Error("missing control");
				control.id = "msg_replacement";
				release.resolve();
				await expect(pending).rejects.toThrow("control identity changed");
			} else await expect(f.boundary.admit(f.input)).rejects.toThrow();
		} finally {
			f.close();
		}
	});

test("manual summary of unowned trailing history retains the ordinary local frontier lineage", async () => {
	const f = await compactionFixture();
	try {
		f.inputs.invalidate(host);
		const running = f.native[1];
		if (running?.type !== "compaction") throw Error("missing control");
		running.reason = "manual";
		f.native.splice(1, 0, {
			type: "synthetic",
			id: "msg_unowned",
			text: "Unowned native history",
			time: { created: 1 },
		});
		f.input.messages.push({ role: "user", id: "msg_unowned", content: [] });
		const first = await f.boundary.admit(f.input);
		expect(first.kind).toBe("summary-only");
		expect("origin" in first).toBe(false);
		const control = f.native[2];
		if (control?.type !== "compaction") throw Error("missing control");
		f.native.splice(
			0,
			f.native.length,
			{ ...control, status: "completed", summary: "summary" },
			{
				type: "compaction",
				id: "msg_second_control",
				status: "running",
				reason: "manual",
				summary: "second summary",
				time: { created: 2 },
			},
		);
		const completedInput = { ...f.input, ...context("msg_control") };
		expect(() => f.boundary.completed(completedInput, f.native)).toThrow(
			"unknown, synthetic, or stale real input",
		);
		const scope = f.inputs.openSource(completedInput);
		const resolved = await scope.resolve(f.native, selected, effects);
		expect("origin" in resolved.evidence).toBe(false);
		expect(resolved.evidence).toEqual({
			kind: "retired-ordinary",
		});
		scope.release();
		const second = await f.boundary.admit({
			...f.input,
			...context("msg_control"),
		});
		expect(second.kind).toBe("summary-only");
		expect("origin" in second).toBe(false);
	} finally {
		f.close();
	}
});
for (const aliasDepth of [0, 2])
	test(`unowned trailing history cannot erase automatic history after ${aliasDepth} checked aliases`, async () => {
		const authority = { hostSessionId: host, token: "token", epoch: 1 };
		let live = true;
		const inputs = new InputAdmissions({
			assertOpen: () => {},
			authorityCurrent: () => live,
			authority: () => (live ? authority : null),
			observeReal: async () => {},
		});
		const reservation = inputs.reserve(host, "user-1");
		const admission = inputs.register(reservation, {
			type: "user",
			payload: { text: "Approved task" },
		});
		await inputs.accept(
			admission,
			{
				sessionID: host,
				id: "user-1",
				type: "user",
				payload: { text: "Approved task" },
				time: { created: 0 },
				delivery: "queue",
			},
			async () =>
				inputs.makeOrigin(host, "user-1", delivery, false, reservation.epoch),
		);
		const native: SessionMessageInfo[] = [
			{
				type: "user",
				id: "user-1",
				text: "Approved task",
				time: { created: 0 },
			},
		];
		const input = {
			...context("user-1"),
			agent,
			model,
			system: [],
			options: {},
			tools: {},
		};
		const boundary = new CompactionBoundary({
			inputs,
			readNative: async () => native,
			readSelected: async () => selected,
			captureReplacement: () => ({
				check: () => {},
				supersede: () => {},
				current: () => true,
			}),
			failure: () => {},
			hasActivePrimary: () => false,
			guidance: () => null,
			observe: () => {},
		});
		try {
			for (let index = 0; index < aliasDepth; index++) {
				const control = {
					type: "compaction" as const,
					id: `msg_alias_${index}`,
					status: "running" as const,
					reason: "auto" as const,
					summary: "Automatic summary",
					time: { created: index + 1 },
				};
				native.push(control);
				expect((await boundary.admit(input)).kind).toBe("continuation");
				native.splice(0, native.length, { ...control, status: "completed" });
				input.messages = [{ role: "user", id: control.id, content: [] }];
			}
			live = false;
			inputs.invalidate(host);
			native.push(
				{
					type: "synthetic",
					id: "msg_unowned",
					text: "Unowned native history",
					time: { created: 3 },
				},
				{
					type: "compaction",
					id: "msg_control",
					status: "running",
					reason: "manual",
					summary: "summary",
					time: { created: 4 },
				},
			);
			input.messages.push({ role: "user", id: "msg_unowned", content: [] });
			await expect(boundary.admit(input)).rejects.toThrow("epoch was revoked");
			await expect(boundary.admit(input)).rejects.toThrow("epoch was revoked");
			const scope = inputs.openSource(input);
			const resolved = await scope.resolve(
				native.filter(
					(message) =>
						message.type !== "compaction" || message.status === "completed",
				),
				selected,
				effects,
			);
			expect("origin" in resolved.evidence).toBe(false);
			expect(resolved.evidence).toEqual({
				kind: "unregistered",
				lineage: "retired-automatic",
			});
			scope.release();
		} finally {
			inputs.clear();
		}
	});

for (const state of ["pending", "rejected", "accepted"] as const)
	test(`missing native input preserves ${state} frontier without granting authority`, async () => {
		const f = fixture();
		try {
			if (state === "accepted")
				await f.inputs.accept(f.admission, f.receipt, async () => f.origin());
			if (state === "rejected")
				f.inputs.reject(f.admission, new Error("rejected receipt"));
			const operation = f.inputs.openSource({
				...context("foreign"),
				messages: [
					...context("user-1").messages,
					...context("foreign").messages,
				],
			});
			await expect(
				operation.resolve(
					[
						{
							type: "synthetic",
							id: "foreign",
							text: "external",
							time: { created: 1 },
						},
					],
					selected,
					effects,
				),
			).rejects.toThrow("native inputs differ");
			operation.release();
			expect(f.admission.state).toBe(state === "pending" ? "pending" : state);
			if (state === "accepted") {
				const old = f.inputs.openSource(context("user-1"));
				const resolved = await old.resolve(
					[
						{
							type: "user",
							id: "user-1",
							text: "Approved task",
							time: { created: 0 },
						},
					],
					selected,
					effects,
				);
				expect(resolved.evidence.kind).toBe("live");
				old.release();
			}
		} finally {
			f.close();
		}
	});

import type { OpenCodeEvent } from "@opencode/client";
import { SessionMessage } from "@opencode/schema/session-message";

type InboxEvent = Extract<
	OpenCodeEvent,
	{
		type:
			| "session.inbox.enqueued"
			| "session.inbox.cancelled"
			| "session.inbox.delivered"
			| "session.inbox.delivery.changed";
	}
>;
function publicLedger(observe?: (id: string) => Promise<void>) {
	const intents: string[] = [];
	const inputs = new InputAdmissions({
		assertOpen: () => {},
		authority: () => null,
		authorityCurrent: () => true,
		observeReal: async (_host, id) => {
			intents.push(id);
			await observe?.(id);
		},
	});
	const prepare = (
		id: string,
		text = id,
		delivery: "queue" | "steer" = "queue",
	) =>
		inputs.observePrompt(
			{
				sessionID: host,
				messageID: SessionMessage.ID.make(id),
				prompt: { text },
				delivery,
			},
			() => inputs.invalidate(host),
		);
	const message = (id: string, text = id): SessionMessageInfo => ({
		type: "user",
		id,
		text,
		time: { created: 1 },
	});
	const input = (ids: string[]) => ({
		...context(ids.at(-1) ?? "empty"),
		messages: ids.map((id) => ({
			id,
			role: "user" as const,
			content: [{ type: "text" as const, text: id }],
		})),
	});
	const consume = async (
		ids: string[],
		native = ids.map((id) => message(id)),
	) => {
		const operation = inputs.openSource(input(ids));
		try {
			return await operation.resolve(native, selected, effects);
		} finally {
			operation.release();
		}
	};
	const event = (
		type: InboxEvent["type"],
		id: string,
		seq: number,
		delivery: "queue" | "steer" = "queue",
		aggregateID = host,
	): InboxEvent => {
		const base = {
			id: `evt_${seq}`,
			created: seq,
			durable: { aggregateID, seq, version: 1 as const },
		};
		if (type === "session.inbox.enqueued")
			return {
				...base,
				type,
				data: {
					sessionID: host,
					inboxID: id,
					item: { type: "user", payload: { text: id }, delivery },
				},
			};
		if (type === "session.inbox.delivery.changed")
			return {
				...base,
				type,
				data: { sessionID: host, inboxID: id, delivery },
			};
		return { ...base, type, data: { sessionID: host, inboxID: id } };
	};
	const reduce = (e: InboxEvent) =>
		inputs.observeInbox(e, (h) => inputs.invalidate(h));
	return { inputs, intents, prepare, message, input, consume, event, reduce };
}
test("duplicate queue hooks, repeated contexts and late negatives observe one real intent", async () => {
	const f = publicLedger();
	try {
		f.prepare("msg_O");
		const original = await f.consume(["msg_O"]);
		f.prepare("msg_A");
		f.prepare("msg_A");
		expect(() => f.prepare("msg_A", "conflicting payload")).toThrow(
			"changed its payload",
		);
		expect(() => original.scope.assertCurrent()).not.toThrow();
		f.reduce(f.event("session.inbox.enqueued", "msg_A", 1));
		const first = await f.consume(["msg_O", "msg_A"]),
			again = await f.consume(["msg_O", "msg_A"]);
		expect(first.evidence.kind === "live" ? first.evidence.origin : null).toBe(
			again.evidence.kind === "live" ? again.evidence.origin : null,
		);
		expect(f.intents).toEqual(["msg_O", "msg_A"]);
		for (const type of [
			"session.inbox.cancelled",
			"session.inbox.delivered",
			"session.inbox.delivery.changed",
			"session.inbox.enqueued",
		] as const)
			f.reduce(f.event(type, "msg_A", 2 + f.intents.length, "steer"));
		expect(f.inputs.automaticBlock(host)).toBeNull();
		expect(() => first.scope.assertCurrent()).not.toThrow();
		expect(() => original.scope.assertCurrent()).toThrow("revoked");
	} finally {
		f.inputs.clear();
	}
});
test("hook-only failed preparation neither replaces O nor vetoes local automatic scheduling", async () => {
	const f = publicLedger();
	try {
		f.prepare("msg_O");
		const old = await f.consume(["msg_O"]);
		f.prepare("msg_A");
		expect(f.inputs.automaticBlock(host)).toBeNull();
		expect(() => old.scope.assertCurrent()).not.toThrow();
		f.prepare("msg_A");
		const next = await f.consume(["msg_O", "msg_A"]);
		expect(next.participation?.kind).toBe("flow");
		expect(f.intents).toEqual(["msg_O", "msg_A"]);
	} finally {
		f.inputs.clear();
	}
});
for (const mismatch of [
	"payload",
	"session",
	"agent",
	"provider",
	"model",
	"variant",
	"prefix",
] as const)
	test(`rejected deferred ${mismatch} preserves O and releases the operation veto`, async () => {
		const f = publicLedger();
		try {
			f.prepare("msg_O");
			const old = await f.consume(["msg_O"]);
			f.prepare("msg_A");
			const operation = f.inputs.openSource(f.input(["msg_O", "msg_A"]));
			const session = structuredClone(selected),
				native = [
					f.message("msg_O"),
					f.message("msg_A", mismatch === "payload" ? "changed" : "msg_A"),
				];
			if (mismatch === "session") session.id = "wrong";
			if (mismatch === "agent") session.agent = Agent.ID.make("wrong");
			if (mismatch === "provider")
				session.model = { ...model, providerID: Provider.ID.make("wrong") };
			if (mismatch === "model")
				session.model = { ...model, id: Model.ID.make("wrong") };
			if (mismatch === "variant")
				session.model = { ...model, variant: Model.VariantID.make("wrong") };
			if (mismatch === "prefix") native.shift();
			expect(f.inputs.automaticBlock(host)).toBe("input-settlement");
			await expect(
				operation.resolve(native, session, effects),
			).rejects.toThrow();
			expect(operation.fail(() => true)).toBe(false);
			operation.release();
			expect(f.inputs.automaticBlock(host)).toBeNull();
			expect(() => old.scope.assertCurrent()).not.toThrow();
			expect(f.intents).toEqual(["msg_O"]);
			expect((await f.consume(["msg_O", "msg_A"])).participation?.kind).toBe(
				"flow",
			);
		} finally {
			f.inputs.clear();
		}
	});
test("one batch consumes new real inputs in native order and grants only its exact final source", async () => {
	const f = publicLedger();
	try {
		f.prepare("msg_O");
		const old = await f.consume(["msg_O"]);
		for (const id of ["msg_B", "msg_S2", "msg_A", "msg_S1"]) f.prepare(id);
		f.reduce(f.event("session.inbox.enqueued", "msg_B", 1));
		const next = await f.consume(["msg_O", "msg_A", "msg_S1", "msg_S2"]);
		expect(f.intents).toEqual(["msg_O", "msg_A", "msg_S1", "msg_S2"]);
		expect(next.evidence.kind === "live" ? next.evidence.origin.id : null).toBe(
			"msg_S2",
		);
		expect(() => old.scope.assertCurrent()).toThrow("revoked");
		expect(f.inputs.automaticBlock(host)).toBe("pending-user");
		expect(
			(await f.consume(["msg_O", "msg_A", "msg_S1", "msg_S2"])).evidence,
		).toBeDefined();
		expect(f.intents).toEqual(["msg_O", "msg_A", "msg_S1", "msg_S2"]);
	} finally {
		f.inputs.clear();
	}
});
test("an intermediate registered source cannot donate its Flow provenance to an unknown suffix", async () => {
	const f = publicLedger();
	try {
		f.prepare("msg_O");
		await f.consume(["msg_O"]);
		f.prepare("msg_A");
		const next = await f.consume(["msg_O", "msg_A", "msg_U"]);
		expect(next.participation).toEqual({ kind: "native-only" });
		expect(next.evidence).toEqual({
			kind: "unregistered",
			lineage: "retired-ordinary",
		});
		expect(f.intents).toEqual(["msg_O", "msg_A"]);
	} finally {
		f.inputs.clear();
	}
});
test("a consumed public batch cannot rebase a private suffix or replay its activation", async () => {
	const f = publicLedger();
	try {
		f.prepare("msg_O");
		const old = await f.consume(["msg_O"]);
		f.prepare("msg_A");
		const reservation = f.inputs.reserve(host, "msg_P"),
			admission = f.inputs.register(reservation, {
				type: "synthetic",
				payload: { text: "private" },
			});
		let activations = 0;
		await f.inputs.accept(
			admission,
			{
				id: "msg_P",
				sessionID: host,
				type: "synthetic",
				payload: { text: "private" },
				delivery: "queue",
				time: { created: 1 },
			},
			async () => {
				activations++;
				return f.inputs.makeOrigin(
					host,
					"msg_P",
					delivery,
					false,
					reservation.epoch,
				);
			},
		);
		const barrier = f.inputs.captureBarrier(host),
			operation = f.inputs.openSource(f.input(["msg_O", "msg_A", "msg_P"]));
		await expect(
			operation.resolve(
				[
					f.message("msg_O"),
					f.message("msg_A"),
					{
						type: "synthetic",
						id: "msg_P",
						text: "private",
						time: { created: 1 },
					},
				],
				selected,
				effects,
			),
		).rejects.toThrow("cannot rebase");
		expect(operation.fail(() => true)).toBe(false);
		operation.release();
		expect(() => barrier.assertCurrent()).not.toThrow();
		expect(f.intents).toEqual(["msg_O"]);
		expect(activations).toBe(1);
		expect(() => old.scope.assertCurrent()).toThrow("revoked");
	} finally {
		f.inputs.clear();
	}
});
test("cancelled ID reuse needs a later hook and a matching observed enqueue generation", async () => {
	const f = publicLedger();
	try {
		f.prepare("msg_O");
		const old = await f.consume(["msg_O"]);
		f.prepare("msg_A");
		f.reduce(f.event("session.inbox.enqueued", "msg_A", 10));
		expect(f.reduce(f.event("session.inbox.cancelled", "msg_A", 11))).toEqual({
			retryHost: host,
		});
		f.reduce(f.event("session.inbox.enqueued", "msg_A", 20));
		f.reduce(f.event("session.inbox.cancelled", "msg_A", 11));
		f.reduce(f.event("session.inbox.delivered", "msg_A", 12));
		expect(f.inputs.automaticBlock(host)).toBe("pending-user");
		await expect(f.consume(["msg_O", "msg_A"])).rejects.toThrow(
			"matching new hook and enqueue",
		);
		expect(() => old.scope.assertCurrent()).not.toThrow();
		f.prepare("msg_A");
		const applied = await f.consume(["msg_O", "msg_A"]);
		f.reduce(f.event("session.inbox.cancelled", "msg_A", 30));
		expect(applied.participation?.kind).toBe("flow");
		expect(f.inputs.automaticBlock(host)).toBeNull();
		expect(f.intents).toEqual(["msg_O", "msg_A"]);
	} finally {
		f.inputs.clear();
	}
});
test("cancellation removes only its matching blocker and a confirmed steer change revokes once", async () => {
	const f = publicLedger();
	try {
		f.prepare("msg_O");
		const old = await f.consume(["msg_O"]);
		f.prepare("msg_A");
		f.prepare("msg_B");
		f.reduce(f.event("session.inbox.enqueued", "msg_A", 1));
		f.reduce(f.event("session.inbox.enqueued", "msg_B", 2));
		const other = Session.ID.make("session-other");
		expect(
			f.reduce(f.event("session.inbox.cancelled", "msg_A", 3, "queue", other)),
		).toEqual({ retryHost: null });
		expect(f.inputs.automaticBlock(host)).toBe("pending-user");
		f.reduce(f.event("session.inbox.cancelled", "msg_A", 4));
		expect(f.inputs.automaticBlock(host)).toBe("pending-user");
		f.reduce(f.event("session.inbox.delivery.changed", "msg_B", 5, "steer"));
		const epoch = f.inputs.epoch(host);
		expect(() => old.scope.assertCurrent()).toThrow("revoked");
		f.reduce(f.event("session.inbox.delivery.changed", "msg_B", 6, "steer"));
		f.reduce(f.event("session.inbox.delivery.changed", "msg_B", 7, "queue"));
		expect(f.inputs.epoch(host)).toBe(epoch);
		expect(f.intents).toEqual(["msg_O"]);
		const applied = await f.consume(["msg_O", "msg_B"]);
		f.reduce(f.event("session.inbox.delivery.changed", "msg_B", 8, "steer"));
		expect(() => applied.scope.assertCurrent()).not.toThrow();
		expect(f.intents).toEqual(["msg_O", "msg_B"]);
	} finally {
		f.inputs.clear();
	}
});
test("host deletion retains its epoch tombstone while another host remains usable", async () => {
	const f = publicLedger();
	try {
		f.prepare("msg_O");
		await f.consume(["msg_O"]);
		const other = Session.ID.make("session-other"),
			reservation = f.inputs.reserve(other, "msg_P");
		f.inputs.invalidate(host);
		const epoch = f.inputs.epoch(host);
		f.inputs.deleteHost(host);
		expect(f.inputs.epoch(host)).toBe(epoch);
		expect(() => f.prepare("msg_late")).toThrow("revoked");
		expect(() => f.inputs.assertReservation(reservation)).not.toThrow();
		f.reduce(f.event("session.inbox.enqueued", "msg_late", 99));
		expect(f.inputs.automaticBlock(host)).toBeNull();
	} finally {
		f.inputs.clear();
	}
});

for (const changed of ["text", "metadata", "file", "agent", "skill"] as const)
	test(`duplicate queued registration rejects changed ${changed} before any intent`, () => {
		const f = publicLedger();
		try {
			const original = {
				sessionID: host,
				messageID: SessionMessage.ID.make("msg_duplicate"),
				delivery: "queue" as const,
				prompt: {
					text: "task",
					files: [{ uri: "file:///tmp/file", name: "one" }],
					agents: [{ name: "build" }],
					skills: [{ id: Skill.ID.make("skill") }],
				},
				metadata: { key: "original" },
			};
			f.inputs.observePrompt(original, () => f.inputs.invalidate(host));
			const next = structuredClone(original);
			if (changed === "text") next.prompt.text = "changed";
			if (changed === "metadata") next.metadata.key = "changed";
			if (changed === "file" && next.prompt.files[0])
				next.prompt.files[0].name = "changed";
			if (changed === "agent" && next.prompt.agents[0])
				next.prompt.agents[0].name = "changed";
			if (changed === "skill" && next.prompt.skills[0])
				next.prompt.skills[0].id = Skill.ID.make("changed");
			expect(() =>
				f.inputs.observePrompt(next, () => f.inputs.invalidate(host)),
			).toThrow("changed its payload");
			expect(f.intents).toEqual([]);
			expect(f.inputs.epoch(host)).toBe(0);
			expect(f.inputs.automaticBlock(host)).toBeNull();
		} finally {
			f.inputs.clear();
		}
	});

test("a consumed batch settles intermediate steer history without rebasing its current frontier", async () => {
	const f = publicLedger();
	try {
		f.prepare("msg_O");
		await f.consume(["msg_O"]);
		f.prepare("msg_A");
		f.prepare("msg_S1", "msg_S1", "steer");
		f.prepare("msg_S2", "msg_S2", "steer");
		f.prepare("msg_B");
		f.reduce(f.event("session.inbox.enqueued", "msg_B", 1));
		const epoch = f.inputs.epoch(host),
			next = await f.consume(["msg_O", "msg_A", "msg_S1", "msg_S2"]);
		expect(f.inputs.epoch(host)).toBe(epoch);
		expect(f.intents).toEqual(["msg_O", "msg_A", "msg_S1", "msg_S2"]);
		expect(next.evidence.kind === "live" ? next.evidence.origin.id : null).toBe(
			"msg_S2",
		);
		await expect(f.consume(["msg_O", "msg_A"])).rejects.toThrow("revoked");
		expect(f.inputs.automaticBlock(host)).toBe("pending-user");
		expect(f.intents).toEqual(["msg_O", "msg_A", "msg_S1", "msg_S2"]);
	} finally {
		f.inputs.clear();
	}
});
test("native-only consumption settles an event observation without creating a Flow origin", async () => {
	const f = publicLedger();
	try {
		f.prepare("msg_O");
		await f.consume(["msg_O"]);
		f.reduce(f.event("session.inbox.enqueued", "msg_unknown", 1));
		expect(f.inputs.automaticBlock(host)).toBe("pending-user");
		const next = await f.consume(["msg_O", "msg_unknown"]);
		expect(next.participation).toEqual({ kind: "native-only" });
		f.reduce(f.event("session.inbox.enqueued", "msg_unknown", 2));
		expect(f.inputs.automaticBlock(host)).toBeNull();
		expect(f.intents).toEqual(["msg_O"]);
	} finally {
		f.inputs.clear();
	}
});

for (const conflict of [
	"user",
	"registered-user",
	"private",
	"reserved",
	"alias",
] as const)
	test(`checkpoint observation transfer preserves actual ${conflict} identity conflicts`, async () => {
		const f = await compactionFixture();
		try {
			const id = "msg_checkpoint_conflict";
			if (conflict === "registered-user")
				f.inputs.observePrompt(
					{
						sessionID: host,
						messageID: SessionMessage.ID.make(id),
						prompt: { text: "registered" },
						delivery: "queue",
					},
					() => {},
				);
			if (conflict === "user")
				f.inputs.observeInbox(
					{
						id: "evt_user",
						created: 1,
						type: "session.inbox.enqueued",
						durable: { aggregateID: host, seq: 1, version: 1 },
						data: {
							sessionID: host,
							inboxID: id,
							item: {
								type: "user",
								payload: { text: "real pending" },
								delivery: "queue",
							},
						},
					},
					() => {},
				);
			if (conflict === "private" || conflict === "reserved") {
				const reservation = f.inputs.reserve(host, id);
				if (conflict === "private")
					f.inputs.register(reservation, {
						type: "synthetic",
						payload: { text: "private" },
					});
			}
			if (conflict === "alias") {
				const operation = f.inputs.openSource(context("user-1"));
				try {
					const resolved = await operation.resolve(
						f.native.filter((message) => message.type !== "compaction"),
						selected,
						effects,
					);
					f.inputs.checkpoint(resolved.scope, id, null);
				} finally {
					operation.release();
				}
			}
			expect(() => f.inputs.assertCheckpointAvailable(host, id)).toThrow(
				"identity conflicts",
			);
		} finally {
			f.close();
		}
	});
for (const changed of ["user-type", "enqueue-generation"] as const)
	test(`checkpoint final installation refuses changed observed ${changed}`, async () => {
		const f = await compactionFixture(),
			id = "msg_control_transfer";
		const operation = f.inputs.openSource(context("user-1"));
		try {
			const resolved = await operation.resolve(
				f.native.filter((message) => message.type !== "compaction"),
				selected,
				effects,
			);
			f.inputs.observeInbox(
				{
					id: "evt_compact1",
					created: 1,
					type: "session.inbox.enqueued",
					durable: { aggregateID: host, seq: 1, version: 1 },
					data: {
						sessionID: host,
						inboxID: id,
						item: { type: "compaction", payload: {}, delivery: "queue" },
					},
				},
				() => {},
			);
			const transfer = f.inputs.assertCheckpointAvailable(host, id);
			await Promise.resolve();
			const base = {
				id: "evt_compact2",
				created: 2,
				durable: { aggregateID: host, seq: 2, version: 1 as const },
			};
			if (changed === "user-type")
				f.inputs.observeInbox(
					{
						...base,
						type: "session.inbox.enqueued",
						data: {
							sessionID: host,
							inboxID: id,
							item: {
								type: "user",
								payload: { text: "new real" },
								delivery: "queue",
							},
						},
					},
					() => {},
				);
			else
				f.inputs.observeInbox(
					{
						...base,
						type: "session.inbox.enqueued",
						data: {
							sessionID: host,
							inboxID: id,
							item: { type: "compaction", payload: {}, delivery: "queue" },
						},
					},
					() => {},
				);
			expect(() =>
				f.inputs.checkpoint(resolved.scope, id, null, transfer),
			).toThrow("identity conflicts");
			expect(() => resolved.scope.assertCurrent()).not.toThrow();
			expect(() => f.inputs.openSource(context(id))).toThrow("revoked");
		} finally {
			operation.release();
			f.close();
		}
	});

test("a matching delivered compaction observation transfers at final alias installation", async () => {
	const f = await compactionFixture(),
		id = "msg_matching_transfer";
	const operation = f.inputs.openSource(context("user-1"));
	try {
		const resolved = await operation.resolve(
			f.native.filter((message) => message.type !== "compaction"),
			selected,
			effects,
		);
		f.inputs.observeInbox(
			{
				id: "evt_matching_enqueued",
				created: 1,
				type: "session.inbox.enqueued",
				durable: { aggregateID: host, seq: 1, version: 1 },
				data: {
					sessionID: host,
					inboxID: id,
					item: { type: "compaction", payload: {}, delivery: "queue" },
				},
			},
			() => {},
		);
		const transfer = f.inputs.assertCheckpointAvailable(host, id);
		await Promise.resolve();
		f.inputs.observeInbox(
			{
				id: "evt_matching_delivered",
				created: 2,
				type: "session.inbox.delivered",
				durable: { aggregateID: host, seq: 2, version: 1 },
				data: { sessionID: host, inboxID: id },
			},
			() => {},
		);
		f.inputs.checkpoint(resolved.scope, id, null, transfer);
		expect(() => f.inputs.assertCheckpointAvailable(host, id)).toThrow(
			"identity conflicts",
		);
		expect(() => f.inputs.openSource(context(id))).not.toThrow();
	} finally {
		operation.release();
		f.close();
	}
});

import { SessionMessage as TriageSessionMessage } from "@opencode/schema/session-message";

test("reservation triage rejected absent private identity cannot veto a new consumed public queue", async () => {
	const f = fixture();
	try {
		f.inputs.reject(
			f.admission,
			new Error("Private RPC failed before history."),
		);
		f.inputs.invalidate(host);
		await expect(f.admission.ready).rejects.toThrow(
			"Private RPC failed before history.",
		);
		f.inputs.observePrompt(
			{
				sessionID: host,
				messageID: TriageSessionMessage.ID.make("msg_candidate_b_fresh"),
				prompt: { text: "Fresh queue" },
				delivery: "queue",
			},
			() => {
				throw new Error("Queue unexpectedly requested immediate revocation.");
			},
		);
		const outcome = await (async () => {
			const operation = f.inputs.openSource(context("msg_candidate_b_fresh"));
			try {
				const result = await operation.resolve(
					[
						{
							type: "user",
							id: "msg_candidate_b_fresh",
							text: "Fresh queue",
							time: { created: 1 },
						},
					],
					selected,
					effects,
				);
				expect(
					result.evidence.kind === "live"
						? result.evidence.origin.id
						: result.evidence.kind,
				).toBe("msg_candidate_b_fresh");
				expect(result.participation?.kind).toBe("flow");
				return "fresh queue accepted";
			} finally {
				operation.release();
			}
		})().catch(String);
		console.log(`TRIAGE ledger rejected-absent-id ${outcome}`);
		expect(outcome).toBe("fresh queue accepted");
	} finally {
		f.close();
	}
});

test("reservation triage exact rejected ledger identity remains negative without granting native-only", async () => {
	const f = fixture();
	try {
		f.inputs.reject(f.admission, new Error("Rejected private dispatch."));
		f.inputs.invalidate(host);
		const operation = f.inputs.openSource(context("user-1"));
		try {
			const result = await operation.resolve(
				[
					{
						type: "user",
						id: "user-1",
						text: "Approved task",
						time: { created: 0 },
					},
				],
				selected,
				effects,
			);
			expect(result.evidence).toEqual({ kind: "rejected" });
			expect(result.participation).toBeNull();
			console.log("TRIAGE ledger exact-rejected-id participation=null");
		} finally {
			operation.release();
		}
	} finally {
		f.close();
	}
});
