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
	expect(f.admission.phase.state).toBe("pending");
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

import type {
	SessionInboxUser,
	SessionInfo,
	SessionMessageInfo,
} from "@opencode/client";
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
				f.inputs.finishReservation(
					f.admission.reservation,
					new Error("rejected receipt"),
				);
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
			expect(f.admission.phase.state).toBe(
				state === "pending" ? "pending" : state,
			);
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
		f.inputs.finishReservation(
			f.admission.reservation,
			new Error("Private RPC failed before history."),
		);
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
		f.inputs.finishReservation(
			f.admission.reservation,
			new Error("Rejected private dispatch."),
		);
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

for (const replacement of ["same-epoch", "new-epoch"] as const)
	for (const accepted of [false, true])
		test(`terminal ownership late private finish preserves ${replacement} ${accepted ? "accepted" : "pending"} replacement readiness`, async () => {
			const f = fixture();
			try {
				if (replacement === "new-epoch") f.inputs.invalidate(host);
				const reservation = f.inputs.reserve(host, "msg_ready_successor");
				const next = f.inputs.register(reservation, {
					type: "synthetic",
					payload: { text: "Successor" },
				});
				const origin = f.inputs.makeOrigin(
					host,
					reservation.id,
					delivery,
					false,
					reservation.epoch,
				);
				if (accepted)
					await f.inputs.accept(
						next,
						{
							...f.receipt,
							id: reservation.id,
							type: "synthetic",
							payload: { text: "Successor" },
						},
						async () => origin,
					);
				let settled = false;
				void next.ready.then(() => {
					settled = true;
				});
				expect(
					f.inputs.finishReservation(
						f.reservation,
						new Error("Late old private failure"),
					),
				).toBe(false);
				expect(
					f.inputs.finishReservation(
						f.reservation,
						new Error("Duplicate late failure"),
					),
				).toBe(false);
				await expect(f.admission.ready).rejects.toThrow(
					"Late old private failure",
				);
				await Promise.resolve();
				expect(settled).toBe(accepted);
				expect(next.phase.state).toBe(accepted ? "accepted" : "pending");
				expect(f.inputs.epoch(host)).toBe(reservation.epoch);
				if (!accepted)
					await f.inputs.accept(
						next,
						{
							...f.receipt,
							id: reservation.id,
							type: "synthetic",
							payload: { text: "Successor" },
						},
						async () => origin,
					);
				expect(await next.ready).toBe(origin);
				expect(() => f.inputs.assertLive(origin)).not.toThrow();
			} finally {
				f.close();
			}
		});

test("terminal ownership finish settles once and cannot overwrite acceptance while activation is awaiting", async () => {
	const f = fixture(),
		entered = Promise.withResolvers<void>(),
		resume = Promise.withResolvers<void>();
	try {
		const origin = f.origin();
		const accepting = f.inputs
			.accept(f.admission, f.receipt, async () => {
				entered.resolve();
				await resume.promise;
				return origin;
			})
			.catch(String);
		await entered.promise;
		const old = f.inputs.captureBarrier(host),
			epoch = f.inputs.epoch(host);
		expect(
			f.inputs.finishReservation(
				{ ...f.reservation },
				new Error("Forged reservation"),
			),
		).toBe(false);
		expect(f.admission.phase.state).toBe("pending");
		expect(
			f.inputs.finishReservation(
				f.reservation,
				new Error("Exact terminal failure"),
			),
		).toBe(true);
		expect(f.inputs.epoch(host)).toBe(epoch + 1);
		expect(old.current()).toBe(false);
		const nextClock = f.inputs.captureBarrier(host);
		expect(
			f.inputs.finishReservation(f.reservation, new Error("Duplicate failure")),
		).toBe(false);
		expect(nextClock.current()).toBe(true);
		expect(f.inputs.epoch(host)).toBe(epoch + 1);
		await expect(f.admission.ready).rejects.toThrow("Exact terminal failure");
		resume.resolve();
		expect(await accepting).toBe("Error: Flow execution epoch was revoked.");
		expect(f.admission.phase.state).toBe("rejected");
		await expect(f.admission.ready).rejects.toThrow("Exact terminal failure");
	} finally {
		resume.resolve();
		f.close();
	}
});

test("terminal ownership accepted parent keeps its exact receipt origin and resolved ready after child failure", async () => {
	const f = fixture();
	try {
		const origin = f.origin();
		await f.inputs.accept(f.admission, f.receipt, async () => origin);
		expect(
			f.inputs.finishReservation(
				f.reservation,
				new Error("Review child failed"),
			),
		).toBe(true);
		expect(f.admission.phase.state).toBe("accepted");
		if (f.admission.phase.state !== "accepted")
			throw new Error("Lost accepted phase");
		expect(f.admission.phase.origin).toBe(origin);
		expect(f.admission.phase.acceptedPayload).toEqual({
			text: "Approved task",
		});
		expect(f.admission.phase.failure?.outcome).toBe("after-acceptance");
		expect(await f.admission.ready).toBe(origin);
		expect(
			f.inputs.finishReservation(
				f.reservation,
				new Error("Duplicate child failure"),
			),
		).toBe(false);
		expect(await f.admission.ready).toBe(origin);
	} finally {
		f.close();
	}
});

for (const terminal of ["deleted", "closed"] as const)
	test(`terminal ownership finish cannot reopen a ${terminal} ledger host`, async () => {
		const f = fixture();
		try {
			const epoch = f.inputs.epoch(host),
				old = f.inputs.captureBarrier(host);
			if (terminal === "deleted") f.inputs.deleteHost(host);
			else f.inputs.clear();
			expect(
				f.inputs.finishReservation(f.reservation, new Error("Late failure")),
			).toBe(false);
			expect(f.inputs.epoch(host)).toBe(epoch);
			expect(old.current()).toBe(false);
			expect(() => f.inputs.reserve(host, "msg_reopen")).toThrow("unavailable");
			const operation = f.inputs.openSource(
				context("msg_unknown_after_delete"),
			);
			await expect(operation.scope.ready()).rejects.toThrow(
				"epoch was revoked",
			);
			expect(operation.fail(() => true)).toBe(false);
			operation.release();
		} finally {
			f.close();
		}
	});

for (const failedKind of ["private", "reserved"] as const)
	test(`terminal identity exact failed ${failedKind} stays denied after a checked ordinary queue resets history`, async () => {
		const f = publicLedger();
		let failedMessage: SessionMessageInfo;
		try {
			const reservation = f.inputs.reserve(host, "msg_negative");
			if (failedKind === "private")
				f.inputs.register(reservation, {
					type: "user",
					payload: { text: "msg_negative" },
				});
			expect(
				f.inputs.finishReservation(reservation, new Error("Failed identity")),
			).toBe(true);
			failedMessage = f.message("msg_negative");
			f.prepare("msg_checked_reset");
			const reset = await f.consume(["msg_checked_reset"]);
			expect(reset.participation?.kind).toBe("flow");
			expect(
				reset.evidence.kind === "live"
					? reset.evidence.origin.authority
					: "not-live",
			).toBeNull();
			f.inputs.invalidate(host);
			const replay = f.inputs.openSource(
				f.input(["msg_checked_reset", "msg_negative"]),
			);
			try {
				const result = await replay.resolve(
					[f.message("msg_checked_reset"), failedMessage],
					selected,
					effects,
				);
				expect(result.participation).toBeNull();
				expect(result.evidence.kind).toBe("rejected");
			} finally {
				replay.release();
			}
		} finally {
			f.inputs.clear();
		}
	});

for (const prefix of ["private", "reserved", "real"] as const)
	test(`terminal identity aliased failed ${prefix} final cannot become an unknown native source`, async () => {
		let rejectReal = false;
		const f = publicLedger(async () => {
			if (rejectReal) throw new Error("Real claim failed");
		});
		try {
			let source: ReturnType<InputAdmissions["openSource"]>;
			if (prefix === "real") {
				f.prepare("msg_alias_failed");
				source = f.inputs.openSource(f.input(["msg_alias_failed"]));
				f.inputs.checkpoint(source.scope, "msg_failed_alias", null);
				rejectReal = true;
				await expect(
					source.resolve([f.message("msg_alias_failed")], selected, effects),
				).rejects.toThrow("Real claim failed");
				expect(source.fail(() => true)).toBe(true);
			} else {
				const reservation = f.inputs.reserve(host, "msg_alias_failed");
				if (prefix === "private")
					f.inputs.register(reservation, {
						type: "user",
						payload: { text: "msg_alias_failed" },
					});
				source = f.inputs.openSource(f.input(["msg_alias_failed"]));
				f.inputs.checkpoint(source.scope, "msg_failed_alias", null);
				expect(
					f.inputs.finishReservation(reservation, new Error("Failed source")),
				).toBe(true);
			}
			source.release();
			const attempt = async () => {
				const replay = f.inputs.openSource(f.input(["msg_failed_alias"]));
				try {
					const result = await replay.resolve(
						[f.message("msg_failed_alias")],
						selected,
						effects,
					);
					return result.participation;
				} finally {
					replay.release();
				}
			};
			if (prefix === "real")
				await expect(attempt()).rejects.toThrow("epoch was revoked");
			else expect(await attempt()).toBeNull();
		} finally {
			f.inputs.clear();
		}
	});

test("terminal identity a neverregistered failed prefix has no payload proof for a fresh queue", async () => {
	const f = publicLedger();
	try {
		const reservation = f.inputs.reserve(host, "msg_neverregistered");
		expect(
			f.inputs.finishReservation(
				reservation,
				new Error("Selected read failed"),
			),
		).toBe(true);
		expect(f.inputs.hasPrivate(host, reservation.id)).toBe(true);
		f.reduce(f.event("session.inbox.enqueued", reservation.id, 1));
		f.reduce(
			f.event("session.inbox.delivery.changed", reservation.id, 2, "steer"),
		);
		expect(f.inputs.automaticBlock(host)).toBeNull();
		expect(() => f.prepare(reservation.id)).toThrow("unavailable");
		f.prepare("msg_after_unregistered");
		await expect(
			f.consume([reservation.id, "msg_after_unregistered"]),
		).rejects.toThrow("epoch was revoked");
		expect(f.intents).toEqual([]);
		expect(
			(await f.consume(["msg_after_unregistered"])).participation?.kind,
		).toBe("flow");
	} finally {
		f.inputs.clear();
	}
});

test("terminal identity a failed real final remains denied after checked queue reset and preserves original nonfinal payload", async () => {
	let fail = true;
	const f = publicLedger(async () => {
		if (fail) throw new Error("Real activation failed");
	});
	try {
		f.prepare("msg_failed_real");
		const failed = f.inputs.openSource(f.input(["msg_failed_real"]));
		await expect(
			failed.resolve([f.message("msg_failed_real")], selected, effects),
		).rejects.toThrow("Real activation failed");
		expect(failed.fail(() => true)).toBe(true);
		failed.release();
		fail = false;
		f.prepare("msg_real_reset");
		expect(
			(await f.consume(["msg_failed_real", "msg_real_reset"])).participation
				?.kind,
		).toBe("flow");
		f.inputs.invalidate(host);
		await expect(
			f.consume(["msg_real_reset", "msg_failed_real"]),
		).rejects.toThrow("epoch was revoked");
		f.prepare("msg_later_queue");
		await expect(
			f.consume(
				["msg_real_reset", "msg_failed_real", "msg_later_queue"],
				[
					f.message("msg_real_reset"),
					f.message("msg_failed_real", "Changed old payload"),
					f.message("msg_later_queue"),
				],
			),
		).rejects.toThrow("unknown, synthetic, or stale real input");
		expect(f.intents).toEqual(["msg_failed_real", "msg_real_reset"]);
	} finally {
		f.inputs.clear();
	}
});

test("terminal ownership partial real activation keeps earlier settled members and fails only unfinished claim members", async () => {
	let fail = true;
	const f = publicLedger(async (id) => {
		if (fail && id === "msg_partial_second")
			throw new Error("Second activation failed");
	});
	try {
		for (const id of [
			"msg_partial_first",
			"msg_partial_second",
			"msg_partial_final",
		])
			f.prepare(id);
		const batch = [
				"msg_partial_first",
				"msg_partial_second",
				"msg_partial_final",
			],
			operation = f.inputs.openSource(f.input(batch));
		await expect(
			operation.resolve(
				batch.map((id) => f.message(id)),
				selected,
				effects,
			),
		).rejects.toThrow("Second activation failed");
		const claimedEpoch = f.inputs.epoch(host);
		expect(operation.fail(() => false)).toBe(false);
		expect(f.inputs.epoch(host)).toBe(claimedEpoch);
		expect(operation.fail(() => true)).toBe(true);
		expect(operation.fail(() => true)).toBe(false);
		expect(f.inputs.epoch(host)).toBe(claimedEpoch + 1);
		operation.release();
		expect(f.intents).toEqual(["msg_partial_first", "msg_partial_second"]);
		fail = false;
		f.prepare("msg_after_partial");
		expect(
			(await f.consume([...batch, "msg_after_partial"])).participation?.kind,
		).toBe("flow");
		expect(f.intents).toEqual([
			"msg_partial_first",
			"msg_partial_second",
			"msg_after_partial",
		]);
	} finally {
		f.inputs.clear();
	}
});

for (const replacement of ["same-epoch", "new-epoch"] as const)
	for (const accepted of [false, true])
		test(`terminal ownership late real observer rejection preserves a ${replacement} ${accepted ? "accepted" : "pending"} private replacement`, async () => {
			const entered = Promise.withResolvers<void>(),
				resume = Promise.withResolvers<void>();
			const f = publicLedger(async () => {
				entered.resolve();
				await resume.promise;
				throw new Error("Late observer failure");
			});
			try {
				f.prepare("msg_old_real");
				const operation = f.inputs.openSource(f.input(["msg_old_real"]));
				const pending = operation
					.resolve([f.message("msg_old_real")], selected, effects)
					.catch(String);
				await entered.promise;
				if (replacement === "new-epoch") f.inputs.invalidate(host);
				const reservation = f.inputs.reserve(host, "msg_private_replacement");
				const admission = f.inputs.register(reservation, {
					type: "synthetic",
					payload: { text: "Private replacement" },
				});
				const origin = f.inputs.makeOrigin(
					host,
					reservation.id,
					delivery,
					false,
					reservation.epoch,
				);
				const acceptReplacement = () =>
					f.inputs.accept(
						admission,
						{
							id: reservation.id,
							sessionID: host,
							type: "synthetic",
							payload: { text: "Private replacement" },
							time: { created: 3 },
							delivery: "queue",
						},
						async () => origin,
					);
				if (accepted) await acceptReplacement();
				resume.resolve();
				expect(await pending).toBe("Error: Flow execution epoch was revoked.");
				expect(operation.fail(() => true)).toBe(false);
				operation.release();
				expect(admission.phase.state).toBe(accepted ? "accepted" : "pending");
				expect(f.inputs.epoch(host)).toBe(reservation.epoch);
				if (!accepted) await acceptReplacement();
				expect(await admission.ready).toBe(origin);
				expect(() => f.inputs.assertLive(origin)).not.toThrow();
				expect(f.inputs.automaticBlock(host)).toBeNull();
			} finally {
				resume.resolve();
				f.inputs.clear();
			}
		});

test("terminal ownership a stale activation cannot overwrite a later accepted phase on the stable record", async () => {
	const f = fixture(),
		entered = Promise.withResolvers<void>(),
		resume = Promise.withResolvers<void>();
	try {
		const oldOrigin = f.origin(),
			acceptedOrigin = f.origin();
		const old = f.inputs
			.accept(f.admission, f.receipt, async () => {
				entered.resolve();
				await resume.promise;
				return oldOrigin;
			})
			.catch(String);
		await entered.promise;
		await f.inputs.accept(f.admission, f.receipt, async () => acceptedOrigin);
		expect(await f.admission.ready).toBe(acceptedOrigin);
		resume.resolve();
		expect(await old).toBe("Error: Flow execution epoch was revoked.");
		expect(f.admission.phase.state).toBe("accepted");
		if (f.admission.phase.state !== "accepted")
			throw new Error("Lost accepted phase");
		expect(f.admission.phase.origin).toBe(acceptedOrigin);
		expect(f.admission.phase.acceptedPayload).toEqual({
			text: "Approved task",
		});
		expect(await f.admission.ready).toBe(acceptedOrigin);
	} finally {
		resume.resolve();
		f.close();
	}
});

test("terminal identity a captured unknown final cannot hide a subsequent real registration", async () => {
	const f = publicLedger();
	try {
		const failed = f.inputs.reserve(host, "msg_inspection_failed");
		expect(
			f.inputs.finishReservation(failed, new Error("Pre-registration failed")),
		).toBe(true);
		const operation = f.inputs.openSource(f.input(["msg_captured_unknown"]));
		f.prepare("msg_captured_unknown");
		await expect(
			operation.resolve([f.message("msg_captured_unknown")], selected, effects),
		).rejects.toThrow("epoch was revoked");
		expect(operation.fail(() => true)).toBe(false);
		operation.release();
		expect(f.intents).toEqual([]);
		expect(
			(await f.consume(["msg_captured_unknown"])).participation?.kind,
		).toBe("flow");
	} finally {
		f.inputs.clear();
	}
});

for (const changed of [
	"none",
	"text",
	"metadata",
	"file-count",
	"file-name",
	"file-description",
	"file-mention",
	"file-uri",
	"file-source",
	"agent-count",
	"agent-name",
	"agent-mention",
	"skill-count",
	"skill-id",
	"skill-mention",
	"inline-mime",
	"inline-data",
] as const)
	test(`terminal payload rejected private prefix preserves ${changed} while consuming a checked queue`, async () => {
		const f = publicLedger();
		try {
			const inline = changed === "inline-mime" || changed === "inline-data";
			const mention = { start: 0, end: 4, text: "task" };
			const payload = {
				text: "task",
				metadata: { nested: { value: "original" } },
				files: [
					{
						uri: inline
							? "data:text/plain;base64,eA=="
							: "file:///tmp/flow-evidence.txt",
						name: "evidence",
						description: "Exact file",
						mention,
					},
				],
				agents: [{ name: "build", mention }],
				skills: [{ id: Skill.ID.make("skill-proof"), mention }],
			};
			const reservation = f.inputs.reserve(host, "msg_payload_failed");
			const admission = f.inputs.register(reservation, {
				type: "user",
				payload,
			});
			expect(
				f.inputs.finishReservation(
					reservation,
					new Error("Payload dispatch failed"),
				),
			).toBe(true);
			await expect(admission.ready).rejects.toThrow("Payload dispatch failed");
			const nativePayload = {
				text: "task",
				metadata: { nested: { value: "original" } },
				files: [
					{
						source: inline
							? { type: "inline" as const }
							: { type: "uri" as const, uri: "file:///tmp/flow-evidence.txt" },
						data: "eA==",
						mime: "text/plain",
						name: "evidence",
						description: "Exact file",
						mention: { ...mention },
					},
				],
				agents: [{ name: "build", mention: { ...mention } }],
				skills: [
					{
						id: "skill-proof",
						name: "proof",
						text: "Native skill expansion",
						mention: { ...mention },
					},
				],
			} satisfies SessionInboxUser["payload"];
			if (changed === "text") nativePayload.text = "tampered";
			if (changed === "metadata")
				nativePayload.metadata.nested.value = "tampered";
			if (changed === "file-count") nativePayload.files = [];
			if (changed === "file-name")
				nativePayload.files = nativePayload.files.map((file) => ({
					...file,
					name: "tampered",
				}));
			if (changed === "file-description")
				nativePayload.files = nativePayload.files.map((file) => ({
					...file,
					description: "tampered",
				}));
			if (changed === "file-mention")
				nativePayload.files = nativePayload.files.map((file) => ({
					...file,
					mention: { ...mention, end: 3 },
				}));
			if (changed === "file-uri")
				nativePayload.files = nativePayload.files.map((file) => ({
					...file,
					source: { type: "uri", uri: "file:///tmp/changed" },
				}));
			if (changed === "file-source")
				nativePayload.files = nativePayload.files.map((file) => ({
					...file,
					source: { type: "inline" },
				}));
			if (changed === "inline-mime")
				nativePayload.files = nativePayload.files.map((file) => ({
					...file,
					mime: "text/html",
				}));
			if (changed === "inline-data")
				nativePayload.files = nativePayload.files.map((file) => ({
					...file,
					data: "eQ==",
				}));
			if (changed === "agent-count") nativePayload.agents = [];
			if (changed === "agent-name")
				nativePayload.agents = nativePayload.agents.map((item) => ({
					...item,
					name: "other",
				}));
			if (changed === "agent-mention")
				nativePayload.agents = nativePayload.agents.map((item) => ({
					...item,
					mention: { ...mention, text: "other" },
				}));
			if (changed === "skill-count") nativePayload.skills = [];
			if (changed === "skill-id")
				nativePayload.skills = nativePayload.skills.map((item) => ({
					...item,
					id: "other",
				}));
			if (changed === "skill-mention")
				nativePayload.skills = nativePayload.skills.map((item) => ({
					...item,
					mention: { ...mention, start: 1 },
				}));
			f.prepare("msg_payload_queue");
			const operation = f.inputs.openSource(
				f.input([reservation.id, "msg_payload_queue"]),
			);
			const result = operation.resolve(
				[
					{
						...nativePayload,
						id: reservation.id,
						type: "user",
						time: { created: 0 },
					},
					f.message("msg_payload_queue"),
				],
				selected,
				effects,
			);
			if (changed === "none") {
				expect((await result).participation?.kind).toBe("flow");
				expect(f.intents).toEqual(["msg_payload_queue"]);
			} else {
				await expect(result).rejects.toThrow(
					"payload conflicts with its admitted dispatch",
				);
				expect(f.intents).toEqual([]);
				expect(operation.fail(() => true)).toBe(false);
			}
			operation.release();
		} finally {
			f.inputs.clear();
		}
	});

for (const changed of ["none", "text", "description", "metadata"] as const)
	test(`terminal payload rejected synthetic prefix preserves ${changed} before a registered successor`, async () => {
		const f = publicLedger();
		try {
			const reservation = f.inputs.reserve(host, "msg_synthetic_payload");
			const payload = {
				text: "Notification",
				description: "Exact description",
				metadata: { key: "original" },
			};
			f.inputs.register(reservation, { type: "synthetic", payload });
			expect(
				f.inputs.finishReservation(
					reservation,
					new Error("Synthetic dispatch failed"),
				),
			).toBe(true);
			const actual = structuredClone(payload);
			if (changed === "text") actual.text = "changed";
			if (changed === "description") actual.description = "changed";
			if (changed === "metadata") actual.metadata.key = "changed";
			f.prepare("msg_synthetic_successor");
			const promise = f.consume(
				[reservation.id, "msg_synthetic_successor"],
				[
					{
						...actual,
						type: "synthetic",
						id: reservation.id,
						time: { created: 0 },
					},
					f.message("msg_synthetic_successor"),
				],
			);
			if (changed === "none")
				expect((await promise).participation?.kind).toBe("flow");
			else await expect(promise).rejects.toThrow("payload conflicts");
		} finally {
			f.inputs.clear();
		}
	});

for (const invalid of ["expired-origin", "delivery", "reason"] as const)
	test(`terminal bridge completed checkpoint alone retains its ${invalid} guard`, async () => {
		const f = await compactionFixture();
		try {
			const source = await f.admission.ready;
			const control = f.native[1];
			if (control?.type !== "compaction" || control.status !== "running")
				throw new Error("Missing compaction control");
			expect((await f.boundary.admit(f.input)).kind).toBe("continuation");
			f.native.splice(0, f.native.length, { ...control, status: "completed" });
			const input = { ...f.input, ...context(control.id) };
			if (invalid === "expired-origin") f.inputs.invalidate(host);
			if (invalid === "delivery")
				input.model = {
					...model,
					id: Model.ID.make("different-checkpoint-model"),
				};
			if (invalid === "reason")
				f.native.splice(0, 1, {
					...control,
					status: "completed",
					reason: "manual",
				});
			expect(() => f.boundary.completed(input, f.native)).toThrow(
				invalid === "expired-origin"
					? "epoch was revoked"
					: invalid === "delivery"
						? "admitted agent or model differs"
						: "control identity changed",
			);
			if (invalid === "expired-origin")
				expect(() => f.boundary.prefixBridge(input, f.native, source)).toThrow(
					"epoch was revoked",
				);
		} finally {
			f.close();
		}
	});

test("terminal payload failed real metadata remains exact nonfinal history before a fresh queue", async () => {
	let fail = true;
	const f = publicLedger(async () => {
		if (fail) throw new Error("Real metadata activation failed");
	});
	try {
		f.inputs.observePrompt(
			{
				sessionID: host,
				messageID: SessionMessage.ID.make("msg_real_metadata_failed"),
				prompt: { text: "Real payload" },
				metadata: { key: "original" },
				delivery: "queue",
			},
			() => {
				throw new Error("Unexpected immediate reservation");
			},
		);
		const native: SessionMessageInfo = {
			type: "user",
			id: "msg_real_metadata_failed",
			text: "Real payload",
			metadata: { key: "original" },
			time: { created: 0 },
		};
		const operation = f.inputs.openSource(f.input([native.id]));
		await expect(
			operation.resolve([native], selected, effects),
		).rejects.toThrow("Real metadata activation failed");
		expect(operation.fail(() => true)).toBe(true);
		operation.release();
		fail = false;
		f.prepare("msg_real_metadata_successor");
		await expect(
			f.consume(
				[native.id, "msg_real_metadata_successor"],
				[
					{ ...native, metadata: { key: "tampered" } },
					f.message("msg_real_metadata_successor"),
				],
			),
		).rejects.toThrow("unknown, synthetic, or stale real input");
		expect(f.intents).toEqual(["msg_real_metadata_failed"]);
		expect(
			(
				await f.consume(
					[native.id, "msg_real_metadata_successor"],
					[native, f.message("msg_real_metadata_successor")],
				)
			).participation?.kind,
		).toBe("flow");
		expect(f.intents).toEqual([
			"msg_real_metadata_failed",
			"msg_real_metadata_successor",
		]);
	} finally {
		f.inputs.clear();
	}
});

import { CallID } from "@opencode/plugin/promise/tool";
import { ExecutionAttribution } from "../src/platform/opencode/execution-attribution.js";

function terminalRegistrationFixture(
	observed: boolean,
	type: "user" | "synthetic",
) {
	const f = publicLedger(),
		source = "msg_terminal_registration",
		text = "Native payload";
	const failed = f.inputs.reserve(host, "msg_registration_failed");
	expect(
		f.inputs.finishReservation(failed, new Error("Local terminal failure")),
	).toBe(true);
	if (observed) {
		const event = f.event("session.inbox.enqueued", source, 1);
		if (event.type !== "session.inbox.enqueued")
			throw new Error("Expected enqueue observation");
		event.data.item = { type, payload: { text }, delivery: "queue" };
		f.reduce(event);
	}
	const input: SessionContext = {
		...context(source),
		system: [],
		options: {},
		tools: {},
		messages: [{ role: "user", id: source, content: [{ type: "text", text }] }],
	};
	const native: SessionMessageInfo[] = [
		{ type, id: source, text, time: { created: 1 } },
	];
	const operation = f.inputs.openSource(input);
	const attribution = new ExecutionAttribution((origin) =>
		f.inputs.assertLive(origin),
	);
	const register = (samePayload: boolean, id = source, sessionID = host) =>
		f.inputs.observePrompt(
			{
				sessionID,
				messageID: SessionMessage.ID.make(id),
				prompt: { text: samePayload ? text : "Different registered payload" },
				delivery: "queue",
			},
			() => {
				throw new Error("Queue must remain deferred");
			},
		);
	const execution = {
		sessionID: host,
		agent,
		messageID: SessionMessage.ID.make("msg_registration_assistant"),
		id: CallID.make("call_registration_shell"),
	};
	const addCall = () =>
		native.push({
			type: "assistant",
			id: execution.messageID,
			agent,
			model,
			time: { created: 2 },
			content: [
				{
					type: "tool",
					id: execution.id,
					name: "shell",
					state: { status: "running", input: {}, metadata: {} },
					time: { created: 2 },
				},
			],
		});
	return {
		...f,
		source,
		input,
		native,
		operation,
		attribution,
		register,
		execution,
		addCall,
	};
}

for (const observed of [false, true])
	for (const type of ["user", "synthetic"] as const)
		for (const samePayload of [false, true])
			for (const when of [
				"before-resolve",
				"before-freeze",
				"before-http",
				"before-tool",
			] as const)
				test(`captured registration clock refuses ${type} observed ${observed} matching ${samePayload} ${when}`, async () => {
					const f = terminalRegistrationFixture(observed, type);
					const barrier = f.inputs.captureBarrier(host),
						epoch = f.inputs.epoch(host);
					let httpEffects = 0,
						toolEffects = 0;
					try {
						expect(f.operation.scope.current()).toBe(true);
						if (when === "before-resolve") {
							f.register(samePayload);
							expect(f.operation.scope.current()).toBe(false);
							expect(() => f.operation.scope.assertCurrent()).toThrow(
								"epoch was revoked",
							);
							await expect(
								f.operation.resolve(f.native, selected, effects),
							).rejects.toThrow("epoch was revoked");
						} else {
							const resolved = await f.operation.resolve(
								f.native,
								selected,
								effects,
							);
							expect(resolved.participation).toEqual({ kind: "native-only" });
							if (!resolved.participation)
								throw new Error("Missing ordinary participation");
							if (when === "before-freeze") {
								f.register(samePayload);
								expect(resolved.scope.current()).toBe(false);
								expect(() =>
									f.attribution.freeze(
										f.input,
										f.native,
										resolved.participation ?? { kind: "native-only" },
										resolved.scope,
									),
								).toThrow("epoch was revoked");
							} else {
								const primary = f.attribution.freeze(
									f.input,
									f.native,
									resolved.participation,
									resolved.scope,
								);
								f.operation.release();
								expect(primary.participation).toEqual({ kind: "native-only" });
								if (when === "before-tool")
									f.attribution.request({
										sessionID: host,
										agent,
										model,
										kind: "primary",
										request: new Request(
											"http://localhost/registration-before-change",
										),
									});
								f.addCall();
								f.register(samePayload);
								expect(resolved.scope.current()).toBe(false);
								expect(() => resolved.scope.assertCurrent()).toThrow(
									"epoch was revoked",
								);
								if (when === "before-http")
									expect(() => {
										f.attribution.request({
											sessionID: host,
											agent,
											model,
											kind: "primary",
											request: new Request(
												"http://localhost/registration-denied",
											),
										});
										httpEffects++;
									}).toThrow("epoch was revoked");
								if (when === "before-tool")
									expect(() => {
										f.attribution.verify(
											f.execution,
											f.native,
											selected,
											process.cwd(),
											"shell",
										);
										toolEffects++;
									}).toThrow("epoch was revoked");
							}
						}
						expect(f.inputs.epoch(host)).toBe(epoch);
						expect(barrier.current()).toBe(true);
						expect(f.operation.current()).toBe(false);
						expect(f.operation.fail(() => true)).toBe(false);
						expect(httpEffects).toBe(0);
						expect(toolEffects).toBe(0);
						expect(f.intents).toEqual([]);
					} finally {
						f.operation.release();
						f.inputs.clear();
						f.attribution.clear();
					}
				});

for (const observed of [false, true])
	test(`captured registration cancels only the exact terminal scope held read, observed ${observed}`, async () => {
		const f = terminalRegistrationFixture(observed, "user"),
			hold = Promise.withResolvers<void>();
		try {
			const wait = f.operation.scope
				.wait(hold.promise)
				.then(() => "unexpected read", String);
			f.register(false, "msg_unrelated_same_host");
			f.register(
				false,
				f.source,
				Session.ID.make("session-other-registration"),
			);
			expect(f.operation.scope.current()).toBe(true);
			const other = f.inputs.openSource({
				...f.input,
				messages: [{ role: "user", id: "msg_held_other_source", content: [] }],
			});
			const otherWait = other.scope
				.wait(hold.promise)
				.then(() => "other read completed", String);
			f.register(false);
			for (let turn = 0; turn < 20; turn++) await Promise.resolve();
			expect(await Promise.race([wait, Promise.resolve("still pending")])).toBe(
				"Error: Flow execution epoch was revoked.",
			);
			expect(other.scope.current()).toBe(true);
			hold.resolve();
			expect(await otherWait).toBe("other read completed");
			other.release();
		} finally {
			hold.resolve();
			f.operation.release();
			f.inputs.clear();
			f.attribution.clear();
		}
	});

for (const queuedHost of ["same-host", "other-host"] as const)
	test(`captured registration unrelated ${queuedHost} queue preserves resolved ordinary scope and tool`, async () => {
		const f = terminalRegistrationFixture(false, "user");
		try {
			const resolved = await f.operation.resolve(f.native, selected, effects);
			if (!resolved.participation)
				throw new Error("Missing ordinary participation");
			const primary = f.attribution.freeze(
				f.input,
				f.native,
				resolved.participation,
				resolved.scope,
			);
			f.operation.release();
			f.attribution.request({
				sessionID: host,
				agent,
				model,
				kind: "primary",
				request: new Request("http://localhost/unrelated-registration"),
			});
			f.addCall();
			f.register(
				false,
				"msg_unrelated_registration",
				queuedHost === "same-host"
					? host
					: Session.ID.make("session-other-registration"),
			);
			expect(resolved.scope.current()).toBe(true);
			expect(() => resolved.scope.assertCurrent()).not.toThrow();
			expect(
				f.attribution.verify(
					f.execution,
					f.native,
					selected,
					process.cwd(),
					"shell",
				).primary,
			).toBe(primary);
			expect(primary.participation).toEqual({ kind: "native-only" });
			expect(f.intents).toEqual([]);
			const target =
				queuedHost === "same-host"
					? host
					: Session.ID.make("session-other-registration");
			const queued = "msg_unrelated_registration",
				text = "Different registered payload";
			const nextInput: SessionContext = {
				...f.input,
				sessionID: target,
				messages: [
					...(queuedHost === "same-host" ? f.input.messages : []),
					{ role: "user", id: queued, content: [{ type: "text", text }] },
				],
			};
			const nextNative: SessionMessageInfo[] = [
				...(queuedHost === "same-host" ? f.native : []),
				{ type: "user", id: queued, text, time: { created: 3 } },
			];
			const next = f.inputs.openSource(nextInput);
			const consumed = await next.resolve(
				nextNative,
				{ ...selected, id: target },
				effects,
			);
			expect(consumed.participation?.kind).toBe("flow");
			if (!consumed.participation)
				throw new Error("Missing checked queue participation");
			f.attribution.end(primary);
			const checked = f.attribution.freeze(
				nextInput,
				nextNative,
				consumed.participation,
				consumed.scope,
			);
			next.release();
			f.attribution.request({
				sessionID: target,
				agent,
				model,
				kind: "primary",
				request: new Request("http://localhost/checked-unrelated-queue"),
			});
			const execution = {
				...f.execution,
				sessionID: target,
				messageID: SessionMessage.ID.make("msg_unrelated_queued_assistant"),
				id: CallID.make("call_unrelated_queued_shell"),
			};
			nextNative.push({
				type: "assistant",
				id: execution.messageID,
				agent,
				model,
				time: { created: 4 },
				content: [
					{
						type: "tool",
						id: execution.id,
						name: "shell",
						state: { status: "running", input: {}, metadata: {} },
						time: { created: 4 },
					},
				],
			});
			expect(
				f.attribution.verify(
					execution,
					nextNative,
					{ ...selected, id: target },
					process.cwd(),
					"shell",
				).primary,
			).toBe(checked);
			expect(f.intents).toEqual([queued]);
			expect(resolved.scope.current()).toBe(queuedHost === "other-host");
		} finally {
			f.operation.release();
			f.inputs.clear();
			f.attribution.clear();
		}
	});

for (const mutation of ["observation", "checkpoint"] as const)
	test(`captured registration exact ${mutation} entry replacement wakes its held read only`, async () => {
		const f = terminalRegistrationFixture(false, "user"),
			hold = Promise.withResolvers<void>();
		try {
			const other = f.inputs.openSource({
				...f.input,
				messages: [{ role: "user", id: "msg_other_held_entry", content: [] }],
			});
			const waiting = f.operation.scope
				.wait(hold.promise)
				.then(() => "unexpected completion", String);
			const otherWait = other.scope
				.wait(hold.promise)
				.then(() => "other completion", String);
			const epoch = f.inputs.epoch(host);
			if (mutation === "observation")
				f.reduce(f.event("session.inbox.enqueued", f.source, 2));
			else f.inputs.checkpoint(f.operation.scope, f.source, null);
			for (let turn = 0; turn < 20; turn++) await Promise.resolve();
			expect(
				await Promise.race([waiting, Promise.resolve("still pending")]),
			).toBe("Error: Flow execution epoch was revoked.");
			expect(f.operation.scope.current()).toBe(false);
			expect(other.scope.current()).toBe(true);
			expect(f.inputs.epoch(host)).toBe(epoch);
			hold.resolve();
			expect(await otherWait).toBe("other completion");
			other.release();
		} finally {
			hold.resolve();
			f.operation.release();
			f.inputs.clear();
			f.attribution.clear();
		}
	});

test("captured registration retained real entry still invalidates on its exact registration generation change", async () => {
	const f = publicLedger(),
		hold = Promise.withResolvers<void>();
	try {
		const failed = f.inputs.reserve(host, "msg_registration_generation_failed");
		expect(
			f.inputs.finishReservation(failed, new Error("Terminal predecessor")),
		).toBe(true);
		f.prepare("msg_registration_generation");
		f.reduce(
			f.event("session.inbox.enqueued", "msg_registration_generation", 1),
		);
		const operation = f.inputs.openSource(
			f.input(["msg_registration_generation"]),
		);
		const waiting = operation.scope
			.wait(hold.promise)
			.then(() => "unexpected completion", String);
		const epoch = f.inputs.epoch(host);
		f.reduce(
			f.event("session.inbox.cancelled", "msg_registration_generation", 2),
		);
		expect(operation.scope.current()).toBe(true);
		f.prepare("msg_registration_generation");
		expect(operation.scope.current()).toBe(false);
		for (let turn = 0; turn < 20; turn++) await Promise.resolve();
		expect(
			await Promise.race([waiting, Promise.resolve("still pending")]),
		).toBe("Error: Flow execution epoch was revoked.");
		expect(f.inputs.epoch(host)).toBe(epoch);
		expect(operation.fail(() => true)).toBe(false);
		operation.release();
		f.reduce(
			f.event("session.inbox.enqueued", "msg_registration_generation", 3),
		);
		expect(
			(await f.consume(["msg_registration_generation"])).participation?.kind,
		).toBe("flow");
		expect(f.intents).toEqual(["msg_registration_generation"]);
	} finally {
		hold.resolve();
		f.inputs.clear();
	}
});
