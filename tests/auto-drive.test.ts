import { describe, expect, test } from "bun:test";
import { FLOW_MANAGER_KERNEL } from "../src/guidance/catalog.js";
import {
	AutoDriveCoordinator,
	type AutoDriveDelivery,
	type AutoDriveProjection,
	FLOW_AUTO_METADATA_KEY,
} from "../src/platform/opencode/auto-drive.js";

const DELIVERY: AutoDriveDelivery = {
	agent: "build",
	model: { providerID: "provider", modelID: "model" },
};
let assistantSequence = 0;
function mutate(
	driver: AutoDriveCoordinator,
	host: string,
	revision: number,
	created?: string,
	parent = "command-message",
	reviewerPending = false,
): void {
	const id = `assistant-${++assistantSequence}`;
	driver.observeHostMessage(host, { id, role: "assistant", parentID: parent });
	driver.observeMutation(host, revision, created, id, reviewerPending);
}
function compact(
	driver: AutoDriveCoordinator,
	host: string,
	authority: string,
	successor: string,
): void {
	const trigger = `assistant-${++assistantSequence}`;
	const user = `compaction-${assistantSequence}`;
	driver.observeHostMessage(host, {
		id: trigger,
		role: "assistant",
		parentID: authority,
	});
	driver.observeHostPart(host, {
		type: "compaction",
		messageID: user,
		auto: true,
	});
	driver.observeHostMessage(host, {
		id: `summary-${assistantSequence}`,
		role: "assistant",
		parentID: user,
		summary: true,
	});
	driver.observeHostMessage(host, { id: successor, role: "user" });
	driver.observeCompaction(host);
}

function harness(initial: AutoDriveProjection) {
	let projection = initial;
	let now = 0;
	let token = 0;
	const prompts: Array<{
		text: string;
		delivery: AutoDriveDelivery;
		metadata: Readonly<Record<string, unknown>>;
	}> = [];
	const warnings: string[] = [];
	const driver = new AutoDriveCoordinator({
		readProjection: () => Promise.resolve(projection),
		prompt: (_sessionID, text, delivery, metadata) => {
			prompts.push({ text, delivery, metadata });
			return Promise.resolve();
		},
		onWarning: (message) => warnings.push(message),
		createToken: () => `token-${++token}`,
		now: () => now,
	});
	return {
		driver,
		prompts,
		warnings,
		async activate(
			sessionID = "host-1",
			delivery = DELIVERY,
			messageId = "command-message",
		) {
			const metadata = await driver.activate(sessionID);
			await driver.observeMessage(
				sessionID,
				delivery,
				[{ synthetic: true, metadata }],
				messageId,
			);
			return metadata;
		},
		setProjection(next: AutoDriveProjection) {
			projection = next;
		},
		setNow(next: number) {
			now = next;
		},
	};
}

describe("Flow auto-drive coordinator", () => {
	test("continues ready work once and does not reprompt an unchanged revision", async () => {
		const state = harness({
			sessionId: "flow-1",
			status: "ready",
			revision: 11,
			nextAction: "flow_run_start",
		});
		await state.activate();
		state.setProjection({
			sessionId: "flow-1",
			status: "ready",
			revision: 12,
			nextAction: "flow_run_start",
		});
		mutate(state.driver, "host-1", 12);
		state.setNow(25);

		await state.driver.onIdle("host-1");
		expect(state.prompts).toHaveLength(1);
		expect(state.prompts[0]).toMatchObject({
			delivery: DELIVERY,
			metadata: { [FLOW_AUTO_METADATA_KEY]: "token-1" },
		});
		expect(state.prompts[0]?.text).toContain("revision 12");
		expect(state.prompts[0]?.text).toContain(FLOW_MANAGER_KERNEL);
		expect(state.prompts[0]?.text).toContain(
			"Load flow-run guidance before any feature or closure route",
		);
		expect(state.prompts[0]?.text).toContain("replay archiveRetry exactly");

		await state.driver.onIdle("host-1");
		expect(state.prompts).toHaveLength(1);
		expect(state.warnings.at(-1)).toContain("made no lifecycle progress");
		expect(state.driver.compactionContext("host-1")).not.toBeNull();
		state.setNow(1_000);
		expect(state.driver.timingSnapshot()).toMatchObject({
			state: "paused",
			activeMs: 25,
			waitingForUserMs: 0,
		});
	});

	test("names a host that reports no assistant message parentage", async () => {
		// Continuation anchors on the assistant message that owns the lease, so a
		// host emitting no `parentID` can never continue. It must fail closed, but
		// the warning has to say the host cannot support it: otherwise stopping
		// after every feature is indistinguishable from a Flow defect.
		const state = harness({
			sessionId: "flow-1",
			status: "ready",
			revision: 11,
			nextAction: "flow_run_start",
		});
		await state.activate();
		state.driver.observeMutation("host-1", 12, undefined, "assistant-x", false);

		await state.driver.onIdle("host-1");
		expect(state.prompts).toHaveLength(0);
		expect(state.warnings.at(-1)).toContain(
			"reports no assistant message parentage",
		);
		expect(state.warnings.at(-1)).toContain("/flow-run");

		// A host that does report parentage keeps the precise diagnosis.
		const capable = harness({
			sessionId: "flow-1",
			status: "ready",
			revision: 11,
			nextAction: "flow_run_start",
		});
		await capable.activate();
		mutate(capable.driver, "host-1", 12);
		capable.driver.observeMutation(
			"host-1",
			13,
			undefined,
			"assistant-unknown",
			false,
		);
		expect(capable.warnings.at(-1)).toContain(
			"mutation origin was unavailable",
		);
	});

	test("separates an overnight checkpoint and resumes after durable progress", async () => {
		const state = harness({
			sessionId: "flow-1",
			status: "blocked",
			revision: 20,
			nextAction: "await-user-direction",
		});
		await state.activate();
		state.setNow(10);
		await state.driver.onIdle("host-1");

		state.setNow(21_600_010);
		expect(state.driver.timingSnapshot()).toMatchObject({
			state: "waiting-for-user",
			activeMs: 10,
			waitingForUserMs: 21_600_000,
			pausedTimeExcluded: true,
		});

		const resumedDelivery: AutoDriveDelivery = {
			agent: "build-resumed",
			model: { providerID: "provider", modelID: "new-model" },
		};
		await state.driver.observeMessage(
			"host-1",
			resumedDelivery,
			[{ synthetic: false }],
			"checkpoint-reply",
		);
		state.setProjection({
			sessionId: "flow-1",
			status: "ready",
			revision: 21,
			nextAction: "flow_run_start",
		});
		mutate(state.driver, "host-1", 21, undefined, "checkpoint-reply");
		state.setNow(21_600_015);
		await state.driver.onIdle("host-1");

		expect(state.prompts).toHaveLength(1);
		expect(state.prompts[0]?.delivery).toEqual(resumedDelivery);
		expect(state.driver.timingSnapshot()).toMatchObject({
			state: "active",
			activeMs: 15,
			waitingForUserMs: 21_600_000,
		});
	});

	test("keeps a checkpoint active through clarifications and resumes once after progress", async () => {
		const state = harness({
			sessionId: "flow-1",
			status: "blocked",
			revision: 20,
			nextAction: "await-user-direction",
		});
		await state.activate();
		await state.driver.onIdle("host-1");

		const clarificationDelivery: AutoDriveDelivery = {
			agent: "build-clarification",
			model: { providerID: "provider", modelID: "clarification-model" },
		};
		await state.driver.observeMessage(
			"host-1",
			clarificationDelivery,
			[{ synthetic: false }],
			"clarification-reply",
		);
		await state.driver.onIdle("host-1");

		expect(state.prompts).toHaveLength(0);
		expect(state.driver.compactionContext("host-1")).not.toBeNull();
		expect(state.driver.timingSnapshot()?.state).toBe("waiting-for-user");

		const recommendationDelivery: AutoDriveDelivery = {
			agent: "build-recommendation",
			model: { providerID: "provider", modelID: "recommendation-model" },
		};
		await state.driver.observeMessage(
			"host-1",
			recommendationDelivery,
			[{ synthetic: false }],
			"recommendation-reply",
		);
		await state.driver.onIdle("host-1");

		expect(state.prompts).toHaveLength(0);
		expect(state.driver.compactionContext("host-1")).not.toBeNull();
		expect(state.driver.timingSnapshot()?.state).toBe("waiting-for-user");

		const approvalDelivery: AutoDriveDelivery = {
			agent: "build-approved",
			model: { providerID: "provider", modelID: "approved-model" },
		};
		await state.driver.observeMessage(
			"host-1",
			approvalDelivery,
			[{ synthetic: false }],
			"approval-reply",
		);
		state.setProjection({
			sessionId: "flow-1",
			status: "ready",
			revision: 21,
			nextAction: "flow_run_start",
		});
		mutate(state.driver, "host-1", 21, undefined, "approval-reply");
		await state.driver.onIdle("host-1");
		await state.driver.onIdle("host-1");

		expect(state.prompts).toHaveLength(1);
		expect(state.prompts[0]?.delivery).toEqual(approvalDelivery);
	});

	test("requires lifecycle progress after the checkpoint reply", async () => {
		const state = harness({
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		});
		await state.activate();
		await state.driver.onIdle("host-1");
		state.setProjection({
			sessionId: "flow-1",
			status: "ready",
			revision: 5,
			nextAction: "flow_run_start",
		});
		mutate(state.driver, "host-1", 5);
		await state.driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: false }],
			"late-reply",
		);
		await state.driver.onIdle("host-1");

		expect(state.prompts).toHaveLength(0);
		expect(state.driver.compactionContext("host-1")).toBeNull();
	});

	test("keeps initial command authority when its turn advances a checkpoint", async () => {
		const state = harness({
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		});
		await state.activate();
		state.setProjection({
			sessionId: "flow-1",
			status: "ready",
			revision: 5,
			nextAction: "flow_run_start",
		});
		mutate(state.driver, "host-1", 5);
		await state.driver.onIdle("host-1");

		expect(state.prompts).toHaveLength(1);
		expect(state.driver.compactionContext("host-1")).not.toBeNull();
	});

	test("rejects unowned checkpoint progress before the first idle", async () => {
		const state = harness({
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		});
		await state.activate("host-1", DELIVERY, "command-message");
		state.setProjection({
			sessionId: "flow-1",
			status: "ready",
			revision: 5,
			nextAction: "flow_run_start",
		});
		await state.driver.onIdle("host-1");

		expect(state.prompts).toHaveLength(0);
		expect(state.driver.compactionContext("host-1")).toBeNull();
	});

	test("allows temporal progress only for an already-pending reviewer", async () => {
		const state = harness({
			sessionId: "flow-1",
			status: "running",
			revision: 4,
			nextAction: "dispatch-flow-reviewer",
		});
		await state.activate("host-1", DELIVERY, "command-message");
		state.setProjection({
			sessionId: "flow-1",
			status: "ready",
			revision: 5,
			nextAction: "flow_run_start",
		});
		await state.driver.onIdle("host-1");

		expect(state.prompts).toHaveLength(1);
	});

	test("credits checkpoint mutations only to the replying user message", async () => {
		for (const [parentMessage, expectedPrompts] of [
			["older-message", 0],
			["checkpoint-reply", 1],
		] as const) {
			const state = harness({
				sessionId: "flow-1",
				status: "planning",
				revision: 4,
				nextAction: "flow_plan_approve",
			});
			await state.activate("host-1", DELIVERY, "command-message");
			await state.driver.onIdle("host-1");
			await state.driver.observeMessage(
				"host-1",
				DELIVERY,
				[{ text: "Explain the tradeoff before proceeding." }],
				"checkpoint-reply",
			);
			state.setProjection({
				sessionId: "flow-1",
				status: "ready",
				revision: 5,
				nextAction: "flow_run_start",
			});
			mutate(state.driver, "host-1", 5, undefined, parentMessage);
			await state.driver.onIdle("host-1");

			expect(state.prompts).toHaveLength(expectedPrompts);
			expect(state.driver.compactionContext("host-1") !== null).toBe(
				expectedPrompts === 1,
			);
		}
	});

	test("transfers reply authority once across a host compaction continuation", async () => {
		const state = harness({
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		});
		await state.activate("host-1", DELIVERY, "command-message");
		await state.driver.onIdle("host-1");
		await state.driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ text: "Approve after compaction." }],
			"checkpoint-reply",
		);
		compact(
			state.driver,
			"host-1",
			"checkpoint-reply",
			"compaction-continuation",
		);
		state.setProjection({
			sessionId: "flow-1",
			status: "ready",
			revision: 5,
			nextAction: "flow_run_start",
		});
		mutate(state.driver, "host-1", 5, undefined, "compaction-continuation");
		await state.driver.onIdle("host-1");

		expect(state.prompts).toHaveLength(1);
	});

	test("rejects a pre-compaction mutation after authenticated authority transfer", async () => {
		const state = harness({
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		});
		await state.activate("host-1", DELIVERY, "command-message");
		await state.driver.onIdle("host-1");
		await state.driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ text: "Approve after compaction." }],
			"checkpoint-reply",
		);
		compact(
			state.driver,
			"host-1",
			"checkpoint-reply",
			"compaction-continuation",
		);
		state.setProjection({
			sessionId: "flow-1",
			status: "ready",
			revision: 5,
			nextAction: "flow_run_start",
		});
		mutate(state.driver, "host-1", 5, undefined, "checkpoint-reply");
		await state.driver.onIdle("host-1");

		expect(state.prompts).toHaveLength(0);
		expect(state.driver.compactionContext("host-1")).toBeNull();
	});

	test("rejects compaction triggered by an assistant from older authority", async () => {
		const state = harness({
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		});
		await state.activate("host-1", DELIVERY, "command-message");
		await state.driver.onIdle("host-1");
		await state.driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ text: "This is the current checkpoint reply." }],
			"checkpoint-reply",
		);
		compact(state.driver, "host-1", "older-message", "compaction-continuation");

		expect(state.prompts).toHaveLength(0);
		expect(state.driver.compactionContext("host-1")).toBeNull();
		expect(state.warnings.at(-1)).toContain(
			"compaction origin was unavailable",
		);
	});

	test("rejects manual or unclassified compaction markers", async () => {
		for (const auto of [false, undefined]) {
			const state = harness({
				sessionId: "flow-1",
				status: "planning",
				revision: 4,
				nextAction: "flow_plan_approve",
			});
			await state.activate("host-1", DELIVERY, "command-message");
			await state.driver.onIdle("host-1");
			await state.driver.observeMessage(
				"host-1",
				DELIVERY,
				[{ text: "Approve after compaction." }],
				"checkpoint-reply",
			);
			const trigger = `assistant-${++assistantSequence}`;
			const compaction = `compaction-${assistantSequence}`;
			state.driver.observeHostMessage("host-1", {
				id: trigger,
				role: "assistant",
				parentID: "checkpoint-reply",
			});
			state.driver.observeHostPart(
				"host-1",
				auto === undefined
					? { type: "compaction", messageID: compaction }
					: { type: "compaction", messageID: compaction, auto },
			);
			state.driver.observeHostMessage("host-1", {
				id: `summary-${assistantSequence}`,
				role: "assistant",
				parentID: compaction,
				summary: true,
			});
			state.driver.observeHostMessage("host-1", {
				id: "compaction-continuation",
				role: "user",
			});
			state.driver.observeCompaction("host-1");

			expect(state.prompts).toHaveLength(0);
			expect(state.driver.compactionContext("host-1")).toBeNull();
			expect(state.warnings.at(-1)).toContain(
				"compaction origin was unavailable",
			);
		}
	});

	test("rejects a compaction summary with the wrong parent", async () => {
		const state = harness({
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		});
		await state.activate("host-1", DELIVERY, "command-message");
		await state.driver.onIdle("host-1");
		await state.driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ text: "Approve after compaction." }],
			"checkpoint-reply",
		);
		const trigger = `assistant-${++assistantSequence}`;
		const compaction = `compaction-${assistantSequence}`;
		state.driver.observeHostMessage("host-1", {
			id: trigger,
			role: "assistant",
			parentID: "checkpoint-reply",
		});
		state.driver.observeHostPart("host-1", {
			type: "compaction",
			messageID: compaction,
			auto: true,
		});
		state.driver.observeHostMessage("host-1", {
			id: `summary-${assistantSequence}`,
			role: "assistant",
			parentID: "wrong-compaction-message",
			summary: true,
		});
		state.driver.observeHostMessage("host-1", {
			id: "compaction-continuation",
			role: "user",
		});
		state.driver.observeCompaction("host-1");

		expect(state.prompts).toHaveLength(0);
		expect(state.driver.compactionContext("host-1")).toBeNull();
		expect(state.warnings.at(-1)).toContain(
			"compaction origin was unavailable",
		);
	});

	test("rejects compaction with a missing or non-adjacent successor", async () => {
		for (const successor of ["missing", "non-adjacent"] as const) {
			const state = harness({
				sessionId: "flow-1",
				status: "planning",
				revision: 4,
				nextAction: "flow_plan_approve",
			});
			await state.activate("host-1", DELIVERY, "command-message");
			await state.driver.onIdle("host-1");
			await state.driver.observeMessage(
				"host-1",
				DELIVERY,
				[{ text: "Approve after compaction." }],
				"checkpoint-reply",
			);
			const trigger = `assistant-${++assistantSequence}`;
			const compaction = `compaction-${assistantSequence}`;
			state.driver.observeHostMessage("host-1", {
				id: trigger,
				role: "assistant",
				parentID: "checkpoint-reply",
			});
			state.driver.observeHostPart("host-1", {
				type: "compaction",
				messageID: compaction,
				auto: true,
			});
			state.driver.observeHostMessage("host-1", {
				id: `summary-${assistantSequence}`,
				role: "assistant",
				parentID: compaction,
				summary: true,
			});
			if (successor === "non-adjacent") {
				state.driver.observeHostMessage("host-1", {
					id: `intervening-${assistantSequence}`,
					role: "assistant",
					parentID: "unrelated-message",
				});
				state.driver.observeHostMessage("host-1", {
					id: "compaction-continuation",
					role: "user",
				});
			}
			state.driver.observeCompaction("host-1");

			expect(state.prompts).toHaveLength(0);
			expect(state.driver.compactionContext("host-1")).toBeNull();
			expect(state.warnings.at(-1)).toContain(
				"compaction origin was unavailable",
			);
		}
	});

	test("ignores an unrelated compacted notification without consuming a candidate", async () => {
		const state = harness({
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		});
		await state.activate("host-1", DELIVERY, "command-message");
		await state.driver.onIdle("host-1");
		await state.driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ text: "Approve after compaction." }],
			"checkpoint-reply",
		);
		const trigger = `assistant-${++assistantSequence}`;
		const compaction = `compaction-${assistantSequence}`;
		state.driver.observeHostMessage("host-1", {
			id: trigger,
			role: "assistant",
			parentID: "checkpoint-reply",
		});
		state.driver.observeHostPart("host-1", {
			type: "compaction",
			messageID: compaction,
			auto: true,
		});
		state.driver.observeHostMessage("host-1", {
			id: `summary-${assistantSequence}`,
			role: "assistant",
			parentID: compaction,
			summary: true,
		});
		state.driver.observeHostMessage("host-1", {
			id: "compaction-continuation",
			role: "user",
		});

		state.driver.observeCompaction("host-2");
		expect(state.driver.compactionContext("host-1")).not.toBeNull();

		state.driver.observeCompaction("host-1");
		state.setProjection({
			sessionId: "flow-1",
			status: "ready",
			revision: 5,
			nextAction: "flow_run_start",
		});
		mutate(state.driver, "host-1", 5, undefined, "compaction-continuation");
		await state.driver.onIdle("host-1");

		expect(state.prompts).toHaveLength(1);
	});

	test("accepts a baseline checkpoint reply before the first idle", async () => {
		const state = harness({
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		});
		await state.activate();
		const replyDelivery: AutoDriveDelivery = {
			agent: "build-approved",
			model: { providerID: "provider", modelID: "approved-model" },
		};
		await state.driver.observeMessage(
			"host-1",
			replyDelivery,
			[{ synthetic: false }],
			"baseline-reply",
		);

		state.setProjection({
			sessionId: "flow-1",
			status: "ready",
			revision: 5,
			nextAction: "flow_run_start",
		});
		mutate(state.driver, "host-1", 5, undefined, "baseline-reply");
		await state.driver.onIdle("host-1");

		expect(state.prompts.map(({ delivery }) => delivery)).toEqual([
			replyDelivery,
		]);
		expect(state.driver.compactionContext("host-1")).not.toBeNull();
	});

	test("does not carry a reply across a newer checkpoint", async () => {
		const state = harness({
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		});
		await state.activate();
		await state.driver.onIdle("host-1");
		state.setProjection({
			sessionId: "flow-1",
			status: "blocked",
			revision: 6,
			nextAction: "await-user-direction",
		});
		await state.driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: false }],
			"new-checkpoint-reply",
		);

		expect(state.driver.timingSnapshot()?.state).toBe("waiting-for-user");
		state.setProjection({
			sessionId: "flow-1",
			status: "ready",
			revision: 7,
			nextAction: "flow_run_start",
		});
		mutate(state.driver, "host-1", 7, undefined, "new-checkpoint-reply");
		await state.driver.onIdle("host-1");

		expect(state.prompts).toHaveLength(0);
		expect(state.driver.compactionContext("host-1")).toBeNull();
	});

	test("requires an accepted mutation from the checkpoint replying host", async () => {
		for (const [mutationHost, mutationRevision, projectedRevision, prompts] of [
			["host-2", 5, 5, 0],
			["host-1", 4, 5, 0],
			["host-1", 6, 5, 0],
			["host-1", 5, 5, 1],
			["host-1", 5, 6, 0],
		] as const) {
			const state = harness({
				sessionId: "flow-1",
				status: "planning",
				revision: 4,
				nextAction: "flow_plan_approve",
			});
			await state.activate();
			await state.driver.onIdle("host-1");
			await state.driver.observeMessage(
				"host-1",
				DELIVERY,
				[{ synthetic: false }],
				"checkpoint-reply",
			);
			mutate(
				state.driver,
				mutationHost,
				mutationRevision,
				undefined,
				"checkpoint-reply",
			);
			state.setProjection({
				sessionId: "flow-1",
				status: "ready",
				revision: projectedRevision,
				nextAction: "flow_run_start",
			});
			await state.driver.onIdle("host-1");

			expect(state.prompts).toHaveLength(prompts);
			expect(state.driver.compactionContext("host-1") !== null).toBe(
				prompts === 1,
			);
		}
	});

	test("allows only one mechanical successor after reviewer dispatch", async () => {
		for (const [projectedRevision, prompts] of [
			[6, 1],
			[7, 0],
		] as const) {
			const state = harness({
				sessionId: "flow-1",
				status: "planning",
				revision: 4,
				nextAction: "flow_plan_approve",
			});
			await state.activate();
			await state.driver.onIdle("host-1");
			await state.driver.observeMessage(
				"host-1",
				DELIVERY,
				[{ synthetic: false }],
				"checkpoint-reply",
			);
			mutate(state.driver, "host-1", 5, undefined, "checkpoint-reply", true);
			state.setProjection({
				sessionId: "flow-1",
				status: "ready",
				revision: projectedRevision,
				nextAction: "flow_run_start",
			});
			await state.driver.onIdle("host-1");

			expect(state.prompts).toHaveLength(prompts);
			expect(state.driver.compactionContext("host-1") !== null).toBe(
				prompts === 1,
			);
		}
	});

	test("excludes paused time and resets timing for a new invocation", async () => {
		const state = harness({
			sessionId: "flow-1",
			status: "running",
			revision: 3,
			nextAction: "flow_validation_start",
		});
		await state.activate();
		state.setProjection({
			sessionId: "flow-1",
			status: "running",
			revision: 4,
			nextAction: "flow_validation_start",
		});
		state.setNow(8);
		await state.driver.onIdle("host-1");
		state.setNow(1_000);
		expect(state.driver.timingSnapshot()).toMatchObject({
			state: "inactive",
			activeMs: 8,
			waitingForUserMs: 0,
		});

		await state.activate();
		expect(state.driver.timingSnapshot()).toMatchObject({
			state: "active",
			activeMs: 0,
			waitingForUserMs: 0,
		});
	});

	test("routes only mechanical start and close states", async () => {
		const cases: Array<[AutoDriveProjection, boolean]> = [
			[
				{
					sessionId: "flow-1",
					status: "ready",
					revision: 1,
					nextAction: "flow_run_start",
				},
				true,
			],
			[
				{
					sessionId: "flow-1",
					status: "completed",
					revision: 2,
					nextAction: "flow_session_close",
				},
				true,
			],
			[
				{
					sessionId: "flow-1",
					status: "closed",
					revision: 3,
					nextAction: "flow_session_close",
				},
				true,
			],
			[
				{
					sessionId: "flow-1",
					status: "planning",
					revision: 4,
					nextAction: "flow_plan_approve",
				},
				false,
			],
			[
				{
					sessionId: "flow-1",
					status: "running",
					revision: 5,
					nextAction: "flow_validation_start",
				},
				false,
			],
			[
				{
					sessionId: "flow-1",
					status: "blocked",
					revision: 6,
					nextAction: "await-user-direction",
				},
				false,
			],
			[{ status: "idle", revision: 0, nextAction: "flow_plan_save" }, false],
		];

		for (const [projection, shouldPrompt] of cases) {
			const baseline =
				projection.status === "idle" ||
				projection.nextAction === "flow_plan_approve" ||
				projection.nextAction === "await-user-direction"
					? projection
					: { ...projection, revision: projection.revision - 1 };
			const state = harness(baseline);
			await state.activate();
			state.setProjection(projection);
			if (shouldPrompt) mutate(state.driver, "host-1", projection.revision);
			await state.driver.onIdle("host-1");
			expect(state.prompts.length > 0).toBe(shouldPrompt);
		}
	});

	test("requires initiating progress and rejects a replacement Flow session", async () => {
		const unchanged = harness({
			sessionId: "flow-1",
			status: "ready",
			revision: 1,
			nextAction: "flow_run_start",
		});
		await unchanged.activate();
		await unchanged.driver.onIdle("host-1");
		expect(unchanged.prompts).toHaveLength(0);
		expect(unchanged.driver.compactionContext("host-1")).toBeNull();

		const created = harness({
			status: "idle",
			revision: 0,
			nextAction: "flow_plan_save",
		});
		await created.activate();
		created.setProjection({
			sessionId: "flow-new",
			status: "ready",
			revision: 2,
			nextAction: "flow_run_start",
		});
		mutate(created.driver, "host-1", 2, "flow-new");
		await created.driver.onIdle("host-1");
		expect(created.prompts).toHaveLength(1);

		const rebound = harness({
			status: "idle",
			revision: 0,
			nextAction: "flow_plan_save",
		});
		await rebound.activate();
		mutate(rebound.driver, "host-1", 1, "flow-first");
		mutate(rebound.driver, "host-1", 1, "flow-replacement");
		rebound.setProjection({
			sessionId: "flow-replacement",
			status: "ready",
			revision: 2,
			nextAction: "flow_run_start",
		});
		await rebound.driver.onIdle("host-1");
		expect(rebound.prompts).toHaveLength(0);
		expect(rebound.driver.compactionContext("host-1")).toBeNull();

		const foreignCreated = harness({
			status: "idle",
			revision: 0,
			nextAction: "flow_plan_save",
		});
		await foreignCreated.activate();
		foreignCreated.setProjection({
			sessionId: "flow-foreign",
			status: "ready",
			revision: 2,
			nextAction: "flow_run_start",
		});
		mutate(foreignCreated.driver, "host-2", 1, "flow-foreign");
		mutate(foreignCreated.driver, "host-1", 2);
		await foreignCreated.driver.onIdle("host-1");
		expect(foreignCreated.prompts).toHaveLength(0);
		expect(foreignCreated.driver.compactionContext("host-1")).toBeNull();

		const replaced = harness({
			sessionId: "flow-old",
			status: "ready",
			revision: 1,
			nextAction: "flow_run_start",
		});
		await replaced.activate();
		replaced.setProjection({
			sessionId: "flow-new",
			status: "ready",
			revision: 2,
			nextAction: "flow_run_start",
		});
		await replaced.driver.onIdle("host-1");
		expect(replaced.driver.compactionContext("host-1")).toBeNull();
	});

	test("preserves a fast reply only when the pending read finds a checkpoint", async () => {
		let projection: AutoDriveProjection = {
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		};
		let resolvePending: ((projection: AutoDriveProjection) => void) | undefined;
		let reads = 0;
		const prompts: AutoDriveDelivery[] = [];
		const driver = new AutoDriveCoordinator({
			readProjection: () => {
				if (++reads === 2) {
					return new Promise((resolve) => {
						resolvePending = resolve;
					});
				}
				return Promise.resolve(projection);
			},
			prompt: (_sessionID, _prompt, delivery) => {
				prompts.push(delivery);
				return Promise.resolve();
			},
			createToken: () => "token",
		});
		const metadata = await driver.activate("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: true, metadata }],
			"command-message",
		);

		const idle = driver.onIdle("host-1");
		const replyDelivery = {
			agent: "resumed",
			model: { providerID: "provider", modelID: "new-model" },
		};
		await driver.observeMessage(
			"host-1",
			replyDelivery,
			[{ synthetic: false }],
			"checkpoint-reply",
		);
		resolvePending?.(projection);
		await idle;
		expect(driver.compactionContext("host-1")).not.toBeNull();

		projection = {
			sessionId: "flow-1",
			status: "ready",
			revision: 5,
			nextAction: "flow_run_start",
		};
		mutate(driver, "host-1", 5, undefined, "checkpoint-reply");
		await driver.onIdle("host-1");
		expect(prompts).toEqual([replyDelivery]);
	});

	test("does not replay a queued pre-mutation idle through reply reconciliation", async () => {
		let projection: AutoDriveProjection = {
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		};
		const checkpoint = projection;
		let resolveReply: ((projection: AutoDriveProjection) => void) | undefined;
		let resolveQueued: ((projection: AutoDriveProjection) => void) | undefined;
		let reads = 0;
		const prompts: AutoDriveDelivery[] = [];
		const driver = new AutoDriveCoordinator({
			readProjection: () => {
				reads += 1;
				if (reads === 3)
					return new Promise((resolve) => {
						resolveReply = resolve;
					});
				if (reads === 4)
					return new Promise((resolve) => {
						resolveQueued = resolve;
					});
				return Promise.resolve(projection);
			},
			prompt: (_sessionID, _prompt, delivery) => {
				prompts.push(delivery);
				return Promise.resolve();
			},
		});
		const metadata = await driver.activate("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: true, metadata }],
			"command-message",
		);
		await driver.onIdle("host-1");
		const replyDelivery: AutoDriveDelivery = {
			agent: "resumed",
			model: { providerID: "provider", modelID: "new-model" },
		};
		const reply = driver.observeMessage(
			"host-1",
			replyDelivery,
			[{ synthetic: false }],
			"checkpoint-reply",
		);
		const queuedIdle = driver.onIdle("host-1");

		expect(reads).toBe(3);
		await queuedIdle;
		resolveReply?.(checkpoint);
		await reply;
		expect(reads).toBe(3);

		projection = {
			sessionId: "flow-1",
			status: "ready",
			revision: 5,
			nextAction: "flow_run_start",
		};
		mutate(driver, "host-1", 5, undefined, "checkpoint-reply");
		const finalIdle = driver.onIdle("host-1");
		resolveQueued?.(projection);
		await finalIdle;

		expect(prompts).toEqual([replyDelivery]);
		expect(driver.compactionContext("host-1")).not.toBeNull();
	});

	test("replays a post-reply idle when an older status read is in flight", async () => {
		const checkpoint: AutoDriveProjection = {
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		};
		let resolvePending: ((projection: AutoDriveProjection) => void) | undefined;
		let reads = 0;
		const driver = new AutoDriveCoordinator({
			readProjection: () => {
				if (++reads === 2)
					return new Promise((resolve) => {
						resolvePending = resolve;
					});
				return Promise.resolve(checkpoint);
			},
			prompt: () => Promise.resolve(),
		});
		await driver.activate("host-1");
		const olderIdle = driver.onIdle("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: false }],
			"checkpoint-reply",
		);
		await driver.onIdle("host-1");
		resolvePending?.(checkpoint);
		await olderIdle;

		expect(reads).toBe(3);
		expect(driver.timingSnapshot()?.state).toBe("waiting-for-user");
		expect(driver.compactionContext("host-1")).not.toBeNull();

		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: false }],
			"second-reply",
		);
		expect(driver.compactionContext("host-1")).not.toBeNull();
	});

	test("preserves mutation authority through a stale pending checkpoint read", async () => {
		let projection: AutoDriveProjection = {
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		};
		const staleCheckpoint = projection;
		let resolvePending: ((projection: AutoDriveProjection) => void) | undefined;
		let reads = 0;
		const prompts: AutoDriveDelivery[] = [];
		const driver = new AutoDriveCoordinator({
			readProjection: () => {
				if (++reads === 2) {
					return new Promise((resolve) => {
						resolvePending = resolve;
					});
				}
				return Promise.resolve(projection);
			},
			prompt: (_sessionID, _prompt, delivery) => {
				prompts.push(delivery);
				return Promise.resolve();
			},
			createToken: () => "token",
		});
		const metadata = await driver.activate("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: true, metadata }],
			"command-message",
		);

		const idle = driver.onIdle("host-1");
		const replyDelivery: AutoDriveDelivery = {
			agent: "resumed",
			model: { providerID: "provider", modelID: "new-model" },
		};
		await driver.observeMessage(
			"host-1",
			replyDelivery,
			[{ synthetic: false }],
			"checkpoint-reply",
		);
		projection = {
			sessionId: "flow-1",
			status: "ready",
			revision: 6,
			nextAction: "flow_run_start",
		};
		mutate(driver, "host-1", 6, undefined, "checkpoint-reply");
		resolvePending?.(staleCheckpoint);
		await idle;

		expect(prompts).toEqual([]);
		expect(driver.compactionContext("host-1")).not.toBeNull();
		await driver.onIdle("host-1");
		expect(prompts).toEqual([replyDelivery]);
		expect(driver.compactionContext("host-1")).not.toBeNull();
	});

	test("preserves mutation authority when a pending read sees the mechanical result", async () => {
		let projection: AutoDriveProjection = {
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		};
		let resolvePending: ((projection: AutoDriveProjection) => void) | undefined;
		let reads = 0;
		const prompts: AutoDriveDelivery[] = [];
		const driver = new AutoDriveCoordinator({
			readProjection: () => {
				if (++reads === 2)
					return new Promise((resolve) => {
						resolvePending = resolve;
					});
				return Promise.resolve(projection);
			},
			prompt: (_sessionID, _prompt, delivery) => {
				prompts.push(delivery);
				return Promise.resolve();
			},
		});
		const metadata = await driver.activate("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: true, metadata }],
			"command-message",
		);

		const idle = driver.onIdle("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: false }],
			"checkpoint-reply",
		);
		projection = {
			sessionId: "flow-1",
			status: "ready",
			revision: 5,
			nextAction: "flow_run_start",
		};
		mutate(driver, "host-1", 5, undefined, "checkpoint-reply");
		const finalIdle = driver.onIdle("host-1");
		await finalIdle;
		resolvePending?.(projection);
		await idle;

		expect(prompts).toEqual([DELIVERY]);
		expect(driver.compactionContext("host-1")).not.toBeNull();
	});

	test("re-arms a newer checkpoint without stale mutation authority", async () => {
		let projection: AutoDriveProjection = {
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		};
		let resolvePending: ((projection: AutoDriveProjection) => void) | undefined;
		const prompts: AutoDriveDelivery[] = [];
		let reads = 0;
		const driver = new AutoDriveCoordinator({
			readProjection: () => {
				if (++reads === 2)
					return new Promise((resolve) => {
						resolvePending = resolve;
					});
				return Promise.resolve(projection);
			},
			prompt: (_sessionID, _prompt, delivery) => {
				prompts.push(delivery);
				return Promise.resolve();
			},
		});
		const metadata = await driver.activate("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: true, metadata }],
			"command-message",
		);
		const idle = driver.onIdle("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: false }],
			"checkpoint-reply",
		);
		mutate(driver, "host-1", 5, undefined, "checkpoint-reply");
		resolvePending?.({
			...projection,
			revision: 6,
			nextAction: "await-user-direction",
		});
		await idle;

		mutate(driver, "host-2", 7, undefined, "checkpoint-reply");
		projection = {
			...projection,
			status: "ready",
			revision: 7,
			nextAction: "flow_run_start",
		};
		await driver.onIdle("host-1");

		expect(prompts).toHaveLength(0);
		expect(driver.compactionContext("host-1")).toBeNull();
	});

	test("does not reuse an old baseline checkpoint for later interruptions", async () => {
		let projection: AutoDriveProjection = {
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		};
		let resolvePending: ((projection: AutoDriveProjection) => void) | undefined;
		let reads = 0;
		const prompts: AutoDriveDelivery[] = [];
		const driver = new AutoDriveCoordinator({
			readProjection: () => {
				if (++reads === 5)
					return new Promise((resolve) => {
						resolvePending = resolve;
					});
				return Promise.resolve(projection);
			},
			prompt: (_sessionID, _prompt, delivery) => {
				prompts.push(delivery);
				return Promise.resolve();
			},
		});
		const metadata = await driver.activate("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: true, metadata }],
			"command-message",
		);
		await driver.onIdle("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: false }],
			"checkpoint-reply",
		);
		projection = {
			sessionId: "flow-1",
			status: "ready",
			revision: 5,
			nextAction: "flow_run_start",
		};
		mutate(driver, "host-1", 5, undefined, "checkpoint-reply");
		await driver.onIdle("host-1");
		expect(prompts).toHaveLength(1);

		const laterIdle = driver.onIdle("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ text: "Change direction." }],
			"interrupting-message",
		);
		projection = { ...projection, revision: 6 };
		mutate(driver, "host-1", 6, undefined, "interrupting-message");
		resolvePending?.(projection);
		await laterIdle;
		await driver.onIdle("host-1");

		expect(prompts).toHaveLength(1);
		expect(driver.compactionContext("host-1")).toBeNull();
	});

	test("a second user message interrupts a post-checkpoint status read", async () => {
		let projection: AutoDriveProjection = {
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		};
		let resolvePending: ((projection: AutoDriveProjection) => void) | undefined;
		let reads = 0;
		const prompts: AutoDriveDelivery[] = [];
		const driver = new AutoDriveCoordinator({
			readProjection: () => {
				if (++reads === 4) {
					return new Promise((resolve) => {
						resolvePending = resolve;
					});
				}
				return Promise.resolve(projection);
			},
			prompt: (_sessionID, _prompt, delivery) => {
				prompts.push(delivery);
				return Promise.resolve();
			},
		});
		const metadata = await driver.activate("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: true, metadata }],
			"command-message",
		);
		await driver.onIdle("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: false }],
			"checkpoint-reply",
		);
		projection = {
			sessionId: "flow-1",
			status: "ready",
			revision: 5,
			nextAction: "flow_run_start",
		};

		const idle = driver.onIdle("host-1");
		await driver.observeMessage(
			"host-1",
			{
				agent: "interrupting",
				model: { providerID: "provider", modelID: "interrupting-model" },
			},
			[{ text: "Stop and do something else." }],
			"interrupting-message",
		);
		resolvePending?.(projection);
		await idle;

		expect(prompts).toEqual([]);
		expect(driver.compactionContext("host-1")).toBeNull();
	});

	test("a second user message interrupts the checkpoint reply read", async () => {
		const projection: AutoDriveProjection = {
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		};
		let resolveReply: ((projection: AutoDriveProjection) => void) | undefined;
		let reads = 0;
		const driver = new AutoDriveCoordinator({
			readProjection: () => {
				if (++reads === 3)
					return new Promise((resolve) => {
						resolveReply = resolve;
					});
				return Promise.resolve(projection);
			},
			prompt: () => Promise.resolve(),
		});
		const metadata = await driver.activate("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: true, metadata }],
			"command-message",
		);
		await driver.onIdle("host-1");

		const first = driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: false }],
			"checkpoint-reply",
		);
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ text: "Use a different approach." }],
			"interrupting-message",
		);
		resolveReply?.(projection);
		await first;

		expect(driver.compactionContext("host-1")).toBeNull();
	});

	test("a second message interrupts an already-pending checkpoint reply", async () => {
		let projection: AutoDriveProjection = {
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		};
		let resolvePending: ((projection: AutoDriveProjection) => void) | undefined;
		let reads = 0;
		const prompts: AutoDriveDelivery[] = [];
		const driver = new AutoDriveCoordinator({
			readProjection: () => {
				if (++reads === 3) {
					return new Promise((resolve) => {
						resolvePending = resolve;
					});
				}
				return Promise.resolve(projection);
			},
			prompt: (_sessionID, _prompt, delivery) => {
				prompts.push(delivery);
				return Promise.resolve();
			},
		});
		const metadata = await driver.activate("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: true, metadata }],
			"command-message",
		);
		await driver.onIdle("host-1");

		const idle = driver.onIdle("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: false }],
			"checkpoint-reply",
		);
		await driver.observeMessage(
			"host-1",
			{
				agent: "interrupting",
				model: { providerID: "provider", modelID: "interrupting-model" },
			},
			[{ text: "Stop and do something else." }],
			"interrupting-message",
		);
		projection = {
			sessionId: "flow-1",
			status: "ready",
			revision: 5,
			nextAction: "flow_run_start",
		};
		resolvePending?.(projection);
		await idle;

		expect(prompts).toEqual([]);
		expect(driver.compactionContext("host-1")).toBeNull();
	});

	test("explicit flow-auto stop and cancel deactivate at the same revision", async () => {
		for (const text of [
			"/flow-auto stop",
			"/flow-auto cancel",
			"Stop /flow-auto",
			"Stop   /flow-auto",
			"Cancel /flow-auto",
		]) {
			const state = harness({
				sessionId: "flow-1",
				status: "planning",
				revision: 4,
				nextAction: "flow_plan_approve",
			});
			const metadata = await state.activate();
			await state.driver.onIdle("host-1");
			await state.driver.observeMessage(
				"host-1",
				DELIVERY,
				[{ text }, { synthetic: true, metadata }],
				"stop-message",
			);

			expect(state.prompts).toEqual([]);
			expect(state.driver.compactionContext("host-1")).toBeNull();
		}

		const qualified = harness({
			sessionId: "flow-1",
			status: "planning",
			revision: 4,
			nextAction: "flow_plan_approve",
		});
		await qualified.activate();
		await qualified.driver.onIdle("host-1");
		await qualified.driver.observeMessage(
			"host-1",
			DELIVERY,
			[
				{ text: "Stop /flow-auto" },
				{ text: "only after you explain the blocker." },
			],
			"qualified-stop-message",
		);
		expect(qualified.driver.compactionContext("host-1")).not.toBeNull();
	});

	test("a real user message interrupts, including during a status read", async () => {
		let resolveProjection:
			| ((projection: AutoDriveProjection) => void)
			| undefined;
		const prompts: string[] = [];
		let reads = 0;
		const driver = new AutoDriveCoordinator({
			readProjection: () => {
				if (++reads === 1) {
					return Promise.resolve({
						sessionId: "flow-1",
						status: "ready",
						revision: 1,
						nextAction: "flow_run_start",
					});
				}
				return new Promise((resolve) => {
					resolveProjection = resolve;
				});
			},
			prompt: (_sessionID, prompt) => {
				prompts.push(prompt);
				return Promise.resolve();
			},
			createToken: () => "token",
		});
		await driver.activate("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[
				{
					synthetic: true,
					metadata: { [FLOW_AUTO_METADATA_KEY]: "token" },
				},
			],
			"command-message",
		);

		const idle = driver.onIdle("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: false }],
			"interrupting-message",
		);
		resolveProjection?.({
			sessionId: "flow-1",
			status: "ready",
			revision: 2,
			nextAction: "flow_run_start",
		});
		await idle;

		expect(prompts).toHaveLength(0);
		expect(driver.compactionContext("host-1")).toBeNull();
	});

	test("a user interruption during prompt enqueue cannot answer a future checkpoint", async () => {
		let projection: AutoDriveProjection = {
			sessionId: "flow-1",
			status: "ready",
			revision: 1,
			nextAction: "flow_run_start",
		};
		let promptCount = 0;
		let resolvePrompt: (() => void) | undefined;
		let markPromptStarted: (() => void) | undefined;
		const promptStarted = new Promise<void>((resolve) => {
			markPromptStarted = resolve;
		});
		const driver = new AutoDriveCoordinator({
			readProjection: () => Promise.resolve(projection),
			prompt: () => {
				promptCount += 1;
				markPromptStarted?.();
				return new Promise((resolve) => {
					resolvePrompt = resolve;
				});
			},
		});
		const metadata = await driver.activate("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: true, metadata }],
			"command-message",
		);
		projection = {
			sessionId: "flow-1",
			status: "ready",
			revision: 2,
			nextAction: "flow_run_start",
		};
		mutate(driver, "host-1", 2);
		const idle = driver.onIdle("host-1");
		await promptStarted;
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: false }],
			"interrupting-message",
		);
		projection = {
			sessionId: "flow-1",
			status: "blocked",
			revision: 3,
			nextAction: "await-user-direction",
		};
		resolvePrompt?.();
		await idle;
		await driver.onIdle("host-1");

		expect(promptCount).toBe(1);
		expect(driver.compactionContext("host-1")).toBeNull();
	});

	test("an old rejected read cannot clear a newer same-host lease", async () => {
		let rejectOld: ((error: Error) => void) | undefined;
		let reads = 0;
		const driver = new AutoDriveCoordinator({
			readProjection: () => {
				reads += 1;
				if (reads === 2) {
					return new Promise((_resolve, reject) => {
						rejectOld = reject;
					});
				}
				return Promise.resolve({
					sessionId: `flow-${reads}`,
					status: "ready",
					revision: reads,
					nextAction: "flow_run_start",
				});
			},
			prompt: () => Promise.resolve(),
			createToken: () => `token-${reads}`,
		});
		await driver.activate("host-1");
		const oldIdle = driver.onIdle("host-1");
		const metadata = await driver.activate("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: true, metadata }],
			"replacement-command",
		);
		rejectOld?.(new Error("old status failure"));
		await oldIdle;

		expect(driver.compactionContext("host-1")).not.toBeNull();
	});

	test("overlapping baseline reads cannot revive an older activation", async () => {
		let resolveFirst: ((projection: AutoDriveProjection) => void) | undefined;
		let reads = 0;
		const driver = new AutoDriveCoordinator({
			readProjection: () => {
				if (++reads === 1) {
					return new Promise((resolve) => {
						resolveFirst = resolve;
					});
				}
				return Promise.resolve({
					sessionId: "flow-new",
					status: "ready",
					revision: 2,
					nextAction: "flow_run_start",
				});
			},
			prompt: () => Promise.resolve(),
		});
		const first = driver.activate("host-1");
		const second = await driver.activate("host-1");
		await driver.observeMessage(
			"host-1",
			DELIVERY,
			[{ synthetic: true, metadata: second }],
			"second-command",
		);
		resolveFirst?.({
			sessionId: "flow-old",
			status: "ready",
			revision: 1,
			nextAction: "flow_run_start",
		});

		await expect(first).rejects.toThrow("superseded");
		expect(driver.compactionContext("host-1")).not.toBeNull();
	});

	test("rejects stale internal messages and preserves a live lease through compaction", async () => {
		const state = harness({
			status: "ready",
			revision: 1,
			nextAction: "flow_run_start",
		});
		await state.activate();
		expect(state.driver.compactionContext("host-1")).toContain(
			"/flow-auto continuation",
		);
		expect(state.driver.compactionContext("host-1")).toContain(
			FLOW_MANAGER_KERNEL,
		);
		expect(state.driver.compactionContext("host-1")).toContain(
			"Load flow-run guidance before any feature or closure route",
		);
		expect(state.driver.compactionContext("host-1")).toContain(
			"replay archiveRetry exactly",
		);
		expect(
			await state.driver.observeMessage(
				"host-1",
				DELIVERY,
				[
					{
						synthetic: true,
						metadata: { [FLOW_AUTO_METADATA_KEY]: "stale" },
					},
				],
				"stale-continuation",
			),
		).toBe("stale-continuation");
		expect(state.driver.compactionContext("host-1")).not.toBeNull();
	});

	test("fails closed on replacement state and status or prompt errors", async () => {
		const changed = harness({
			sessionId: "flow-1",
			status: "ready",
			revision: 0,
			nextAction: "flow_run_start",
		});
		await changed.activate();
		changed.setProjection({
			sessionId: "flow-1",
			status: "ready",
			revision: 1,
			nextAction: "flow_run_start",
		});
		await changed.driver.onIdle("host-1");
		changed.setProjection({
			sessionId: "flow-2",
			status: "ready",
			revision: 2,
			nextAction: "flow_run_start",
		});
		await changed.driver.onIdle("host-1");
		expect(changed.driver.compactionContext("host-1")).toBeNull();

		for (const failure of ["status", "prompt"] as const) {
			let reads = 0;
			const driver = new AutoDriveCoordinator({
				readProjection: () =>
					++reads > 1 && failure === "status"
						? Promise.reject(new Error("unavailable"))
						: Promise.resolve({
								sessionId: "flow-1",
								status: "ready",
								revision: reads,
								nextAction: "flow_run_start",
							}),
				prompt: () => Promise.reject(new Error("unavailable")),
				createToken: () => failure,
			});
			await driver.activate("host-1");
			await driver.observeMessage(
				"host-1",
				DELIVERY,
				[
					{
						synthetic: true,
						metadata: { [FLOW_AUTO_METADATA_KEY]: failure },
					},
				],
				`${failure}-command`,
			);
			await driver.onIdle("host-1");
			expect(driver.compactionContext("host-1")).toBeNull();
		}
	});
});
