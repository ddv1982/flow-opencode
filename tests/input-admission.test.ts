import { expect, test } from "bun:test";
import { Agent, Model, Provider } from "@opencode/plugin";
import type { SessionContext } from "@opencode/plugin/promise/session";
import { Session } from "@opencode/schema/session";
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
): Pick<SessionContext, "sessionID" | "messages"> => ({
	sessionID: host,
	messages: [
		{ role: "user", id, content: [{ type: "text", text: "Approved task" }] },
	],
});
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
	const scope = f.inputs.capture(context("user-1"));
	const ready = scope.ready();
	expect(f.inputs.positive(scope)).toBeUndefined();
	await f.inputs.accept(f.admission, f.receipt, async () => f.origin());
	await ready;
	expect(f.inputs.positive(scope)?.id).toBe("user-1");
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
		const scope = f.inputs.capture(context("user-1"));
		let settled = false;
		void f.admission.ready.then(
			() => {
				settled = true;
			},
			() => {
				settled = true;
			},
		);
		const wait = scope.ready();
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
	expect(() => f.inputs.capture(context("user-1"))).toThrow(
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
	const old = f.inputs.capture(context("user-1"));
	const oldWait = old.ready().catch((error) => String(error));
	const reservation = f.inputs.reserve(host, "fresh");
	const admission = f.inputs.register(reservation, {
		type: "synthetic",
		payload: { text: "Fresh" },
	});
	const fresh = f.inputs.capture(context("fresh"));
	let settled = false;
	const ready = fresh.ready().then(() => {
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
	expect(f.inputs.positive(fresh)?.id).toBe("fresh");
	fresh.release();
	f.close();
});

import type { SessionMessageInfo } from "@opencode/client";
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
		const scope = f.inputs.capture(completedInput);
		expect(f.inputs.positive(scope)).toBeUndefined();
		expect(await f.inputs.evidence(scope, f.native, delivery)).toEqual({
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
			const scope = inputs.capture(input);
			expect(inputs.positive(scope)).toBeUndefined();
			expect(await inputs.evidence(scope, native, delivery)).toEqual({
				kind: "retired-automatic",
			});
			scope.release();
		} finally {
			inputs.clear();
		}
	});
