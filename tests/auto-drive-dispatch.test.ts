import { expect, test } from "bun:test";
import { RecoveryController } from "../src/application/recovery-policy.js";
import { RecoveryProposals } from "../src/application/recovery-proposal.js";
import {
	AutoDriveDispatch,
	type DispatchCapture,
	type SendEffect,
} from "../src/platform/opencode/auto-drive-dispatch.js";

const delivery = {
	agent: "build",
	model: { providerID: "local", modelID: "test" },
};
function fixture() {
	const repairs = new Set<string>(),
		dispatch = new AutoDriveDispatch(repairs);
	dispatch.delivery = delivery;
	dispatch.messageId = "O";
	dispatch.checkpoint = { revision: 4, answered: false, advance: 5 };
	dispatch.pendingReply = true;
	dispatch.ownInspectDraft = {
		sessionId: "flow",
		revision: 5,
		prompted: false,
	};
	let live = true;
	const capture: DispatchCapture = {
		authority: { hostSessionId: "host", token: "token", epoch: 1 },
		source: "O",
		current: () => live && dispatch.messageId === "O",
	};
	return {
		dispatch,
		repairs,
		capture,
		revoke: () => {
			live = false;
			dispatch.invalidate();
		},
	};
}
for (const branch of [
	"initial",
	"continuation",
	"draft",
	"recovery",
	"handback-and-wait",
	"handback-or-deactivate",
] as const)
	test(`withheld ${branch} preserves its exact send opportunity before authenticated acceptance`, async () => {
		const f = fixture(),
			proposals = new RecoveryProposals(),
			proposal = proposals.prepare("flow/5", () => true);
		if (!proposal || !f.dispatch.ownInspectDraft)
			throw new Error("Missing fixture claim.");
		const effect: SendEffect =
			branch === "continuation"
				? {
						kind: branch,
						revision: 5,
						clearCheckpoint: true,
						repairKey: "repair",
					}
				: branch === "draft"
					? { kind: branch, draft: f.dispatch.ownInspectDraft }
					: branch === "recovery"
						? { kind: branch, revision: 5, proposal }
						: branch === "initial"
							? { kind: branch }
							: {
									kind: branch,
									projection: {
										sessionId: "flow",
										revision: 5,
										status: "blocked",
										nextAction: "await-user-direction",
									},
								};
		const before = {
			checkpoint: f.dispatch.checkpoint,
			draft: f.dispatch.ownInspectDraft,
		};
		const result = await f.dispatch.send(
			async () => ({ kind: "withheld", reason: "pending-user" }),
			"host",
			"intended prompt",
			{},
			effect,
			true,
			f.capture,
		);
		expect(result).toEqual({ kind: "withheld", reason: "pending-user" });
		expect(f.dispatch.checkpoint).toBe(before.checkpoint);
		expect(f.dispatch.ownInspectDraft).toBe(before.draft);
		expect(f.dispatch.ownInspectDraft.prompted).toBe(false);
		expect(f.dispatch.pendingReply).toBe(true);
		expect(f.dispatch.lastPromptedRevision).toBeNull();
		expect(f.dispatch.handbackPromptedRevision).toBeNull();
		expect(f.dispatch.messageId).toBe("O");
		expect([...f.repairs]).toEqual([]);
		expect(proposals.prepare("flow/5", () => true)).not.toBeNull();
		const admitted = await f.dispatch.send(
			async (_host, _text, selected, _metadata, intent) => {
				f.dispatch.activate(intent, "S", selected);
				return { kind: "sent", source: "S" };
			},
			"host",
			"intended prompt",
			{},
			effect,
			true,
			f.capture,
		);
		expect(admitted).toEqual({ kind: "sent", source: "S" });
		expect(f.dispatch.messageId).toBe("S");
		expect(f.dispatch.pendingReply).toBe(false);
		if (branch === "continuation") {
			expect(f.dispatch.checkpoint).toEqual({ revision: 5, answered: false });
			expect([...f.repairs]).toEqual(["repair"]);
		}
		if (branch === "initial") expect(f.dispatch.lastPromptedRevision).toBe(0);
		if (branch === "draft")
			expect(f.dispatch.ownInspectDraft.prompted).toBe(true);
		if (branch === "recovery")
			expect(proposals.prepare("flow/5", () => true)).toBeNull();
	});
test("initial authenticated activation creates revision zero before returning and rejects repeated activation", async () => {
	const f = fixture();
	f.dispatch.checkpoint = null;
	await f.dispatch.send(
		async (_host, _text, selected, _metadata, intent) => {
			f.dispatch.activate(intent, "initial", selected);
			expect(f.dispatch.checkpoint).toEqual({ revision: 0, answered: false });
			expect(() => f.dispatch.activate(intent, "duplicate", selected)).toThrow(
				"superseded",
			);
			return { kind: "sent", source: "initial" };
		},
		"host",
		"initial",
		{},
		{ kind: "initial" },
		false,
		f.capture,
	);
	expect(f.dispatch.messageId).toBe("initial");
});
test("stale intent rejects before checkpoint, draft, reply or recovery fields change", async () => {
	const f = fixture(),
		entered = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>();
	const send = f.dispatch.send(
		async (_host, _text, selected, _metadata, intent) => {
			entered.resolve();
			await release.promise;
			f.dispatch.activate(intent, "stale", selected);
			return { kind: "sent", source: "stale" };
		},
		"host",
		"continuation",
		{},
		{
			kind: "continuation",
			revision: 5,
			clearCheckpoint: true,
			repairKey: "repair",
		},
		true,
		f.capture,
	);
	const failed = send.catch((error) => String(error));
	await entered.promise;
	f.revoke();
	release.resolve();
	expect(await failed).toBe(
		"Error: Flow automatic dispatch intent was superseded.",
	);
	expect(f.dispatch.messageId).toBe("O");
	expect(f.dispatch.checkpoint).toEqual({
		revision: 4,
		answered: false,
		advance: 5,
	});
	expect(f.dispatch.pendingReply).toBe(true);
	expect([...f.repairs]).toEqual([]);
});
test("a deferred terminal ticket is consumed once and rechecks before reevaluation", async () => {
	const f = fixture();
	let rechecks = 0;
	const owner = {
		current: () => true,
		recheck: async () => {
			rechecks++;
			return true;
		},
	};
	await f.dispatch.send(
		async () => ({ kind: "withheld", reason: "input-settlement" }),
		"host",
		"continuation",
		{},
		{ kind: "initial" },
		false,
		f.capture,
		owner,
	);
	expect(await f.dispatch.takeDeferred()).toBe(owner);
	expect(await f.dispatch.takeDeferred()).toBeNull();
	expect(rechecks).toBe(1);
});

test("an in-place draft revision change rejects a prepared approval without stamps", async () => {
	const f = fixture(),
		entered = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>();
	const draft = f.dispatch.ownInspectDraft;
	if (!draft) throw new Error("Missing draft.");
	const send = f.dispatch
		.send(
			async (_host, _text, selected, _metadata, intent) => {
				entered.resolve();
				await release.promise;
				f.dispatch.activate(intent, "stale", selected);
				return { kind: "sent", source: "stale" };
			},
			"host",
			"approve",
			{},
			{ kind: "draft", draft },
			true,
			f.capture,
		)
		.catch(String);
	await entered.promise;
	draft.revision = 6;
	release.resolve();
	expect(await send).toBe(
		"Error: Flow inspection draft changed before admission.",
	);
	expect(draft.prompted).toBe(false);
	expect(f.dispatch.pendingReply).toBe(true);
	expect(f.dispatch.messageId).toBe("O");
});

const unavailable = {
	assess: async () => ({
		kind: "unavailable" as const,
		reason: "offline control",
	}),
};
for (const mode of [
	"before-activation",
	"between-assert-and-commit",
] as const) {
	test(`review proposal expiry ${mode}`, async () => {
		const now = 0;
		let activation = false;
		let checks = 0;
		const recovery = new RecoveryController(unavailable, {
			now: () => {
				if (!activation) return now;
				checks++;
				return mode === "before-activation" || checks > 1 ? 3600000 : 3599999;
			},
		});
		recovery.activate("host", { mode: "shadow", maxCalls: 2, maxUsd: 0.01 });
		const proposal = recovery.prepareProposalPrompt(
			"host",
			"flow",
			5,
			"await-user-direction",
		);
		expect(proposal).not.toBeNull();
		if (!proposal) throw new Error("Missing claim");
		const send = new AutoDriveDispatch(new Set());
		send.delivery = delivery;
		send.messageId = "O";
		send.checkpoint = { revision: 4, answered: false, advance: 5 };
		send.pendingReply = true;
		const capture = {
			authority: { hostSessionId: "host", token: "token", epoch: 1 },
			source: "O",
			current: () => send.messageId === "O",
		};
		const failure = await send
			.send(
				async (_host, _text, selected, _metadata, intent) => {
					activation = true;
					send.activate(intent, "S", selected);
					return { kind: "sent", source: "S" };
				},
				"host",
				proposal.text,
				{},
				{ kind: "recovery", revision: 5, proposal },
				true,
				capture,
			)
			.catch(String);
		expect(failure).toBe("Error: Flow recovery proposal was superseded.");
		expect(send.messageId).toBe("O");
		expect(send.checkpoint).toEqual({
			revision: 4,
			answered: false,
			advance: 5,
		});
		expect(send.pendingReply).toBe(true);
	});
}
test("review real recovery claim is invalid after exact lease replacement", () => {
	const recovery = new RecoveryController(unavailable, { now: () => 0 });
	recovery.activate("host", { mode: "shadow", maxCalls: 2, maxUsd: 0.01 });
	const old = recovery.prepareProposalPrompt(
		"host",
		"flow",
		5,
		"await-user-direction",
	);
	recovery.activate("host", { mode: "shadow", maxCalls: 2, maxUsd: 0.01 });
	expect(() => old?.commit()).toThrow("superseded");
	const current = recovery.prepareProposalPrompt(
		"host",
		"flow",
		5,
		"await-user-direction",
	);
	expect(current).not.toBeNull();
	current?.commit();
	expect(
		recovery.prepareProposalPrompt("host", "flow", 5, "await-user-direction"),
	).toBeNull();
});
