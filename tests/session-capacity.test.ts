import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionSchema } from "../src/application/schema.js";
import {
	MAX_SESSION_BYTES,
	MAX_TEXT_BYTES,
	SESSION_CLOSE_RESERVE_BYTES,
} from "../src/domain/limits.js";
import { operationInputDigest } from "../src/domain/operation.js";
import type { Session } from "../src/domain/session.js";
import {
	closeSession,
	recordValidation,
	savePlan,
} from "../src/domain/transitions.js";
import {
	archiveAndClearSession,
	loadArchivedSession,
	loadSession,
	saveSession,
} from "../src/infrastructure/fs/workspace.js";
import { sessionPath } from "../src/infrastructure/fs/workspace-paths.js";
import {
	deterministicEnvironment,
	FEATURE,
	OUTPUT,
	plan,
	SOURCE_A,
} from "./runtime-test-support.js";

function ledgerSession(count: number): Session {
	const goal = "Capacity recovery";
	const savedPlan = structuredClone(plan);
	return {
		version: 5,
		id: "capacity-recovery",
		revision: count,
		goal,
		approval: "pending",
		plan: savedPlan,
		runs: [],
		operations: Array.from({ length: count }, (_, index) => {
			const input = {
				operationId: `save-${index}`,
				expectedRevision: index,
				goal,
				plan: savedPlan,
			};
			return {
				id: input.operationId,
				kind: "plan-save",
				inputDigest: operationInputDigest(input),
				committedRevision: index + 1,
			};
		}),
		closure: null,
	};
}

function byteSession(targetBytes: number): Session {
	const runs: Session["runs"] = Array.from({ length: 23 }, (_, index) => ({
		id: `prior-${index}`,
		featureId: FEATURE,
		attempt: index + 1,
		state: "superseded",
		startedRevision: index + 1,
		summary: "x",
		artifactsChanged: [],
		validations: [],
		reviews: [],
	}));
	const session: Session = { ...ledgerSession(0), revision: 23, runs };
	let remaining = targetBytes - Buffer.byteLength(JSON.stringify(session));
	for (const [index, run] of session.runs.entries()) {
		const escaped = Math.min(Math.floor(remaining / 6), MAX_TEXT_BYTES - 1);
		const plain = Math.min(
			remaining - escaped * 6,
			MAX_TEXT_BYTES - 1 - escaped,
		);
		session.runs[index] = {
			...run,
			summary: `x${"\u0000".repeat(escaped)}${"x".repeat(plain)}`,
		};
		remaining -= escaped * 6 + plain;
	}
	if (remaining !== 0)
		throw new Error("Capacity fixture could not reach target bytes");
	return session;
}

function closeRequest(session: Session) {
	return {
		operationId: "c".repeat(128),
		expectedRevision: session.revision,
		sessionId: session.id,
		kind: "deferred" as const,
		summary: "\u0000".repeat(MAX_TEXT_BYTES),
	};
}

describe("Session terminal capacity", () => {
	test("preserves a full legacy operation ledger through close, disk archive, and exact replay", async () => {
		const session = ledgerSession(4096);
		expect(SessionSchema.parse(session)).toEqual(session);
		const request = closeRequest(session);
		const closed = closeSession(session, request).session;
		expect(SessionSchema.parse(closed)).toEqual(closed);
		expect(closed.operations.slice(0, 4096)).toEqual(session.operations);
		const workspace = await mkdtemp(join(tmpdir(), "flow-terminal-capacity-"));
		try {
			await saveSession(workspace, session);
			expect(await loadSession(workspace)).toEqual(session);
			await saveSession(workspace, closed);
			await archiveAndClearSession(workspace, closed);
			const archived = await loadArchivedSession(workspace, session.id);
			expect(archived).toEqual(closed);
			if (!archived) throw new Error("Archive missing");
			expect(closeSession(archived, request).replayed).toBe(true);
			await archiveAndClearSession(workspace, closed);
			expect(await loadSession(workspace)).toBeNull();
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});

	test("refuses new nonterminal operations at reserved capacity but preserves exact accepted replay", () => {
		const session = ledgerSession(4095);
		expect(() => {
			savePlan(
				session,
				{
					operationId: "new-save",
					expectedRevision: 4095,
					goal: session.goal,
					plan,
				},
				deterministicEnvironment(),
			);
		}).toThrow(/capacity|close|limit/i);
		expect(
			savePlan(
				session,
				{
					operationId: "save-4094",
					expectedRevision: 4094,
					goal: session.goal,
					plan,
				},
				deterministicEnvironment(),
			).replayed,
		).toBe(true);
		expect(
			SessionSchema.safeParse(
				closeSession(session, closeRequest(session)).session,
			).success,
		).toBe(true);
		expect(session.operations).toHaveLength(4095);
	});

	test("recovers a legacy session at the byte limit with a maximum escaped closure", async () => {
		const session = byteSession(MAX_SESSION_BYTES);
		expect(Buffer.byteLength(JSON.stringify(session))).toBe(MAX_SESSION_BYTES);
		expect(SessionSchema.parse(session)).toEqual(session);
		const closed = closeSession(session, closeRequest(session)).session;
		expect(Buffer.byteLength(JSON.stringify(closed))).toBeGreaterThan(
			MAX_SESSION_BYTES,
		);
		expect(SessionSchema.safeParse(closed).success).toBe(true);
		const workspace = await mkdtemp(join(tmpdir(), "flow-terminal-bytes-"));
		try {
			await saveSession(workspace, closed);
			expect(await loadSession(workspace)).toEqual(closed);
			await archiveAndClearSession(workspace, closed);
			expect(await loadArchivedSession(workspace, session.id)).toEqual(closed);
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});

	test("reserves terminal bytes when accepting nonterminal work without tightening legacy hydration", () => {
		const session = byteSession(MAX_SESSION_BYTES - 1024);
		expect(SessionSchema.safeParse(session).success).toBe(true);
		expect(() => {
			savePlan(
				session,
				{
					operationId: "new-save",
					expectedRevision: session.revision,
					goal: session.goal,
					plan,
				},
				deterministicEnvironment(),
			);
		}).toThrow(/capacity|close|limit/i);
	});
	test("accepts the last ordinary operation and reserves the last safe revision for close", () => {
		const session = ledgerSession(4094);
		const next = savePlan(
			session,
			{
				operationId: "last-save",
				expectedRevision: session.revision,
				goal: session.goal,
				plan,
			},
			deterministicEnvironment(),
		).session;
		expect(next.operations).toHaveLength(4095);
		const edge = { ...ledgerSession(0), revision: Number.MAX_SAFE_INTEGER - 1 };
		expect(() => {
			savePlan(
				edge,
				{
					operationId: "no-room",
					expectedRevision: edge.revision,
					goal: edge.goal,
					plan,
				},
				deterministicEnvironment(),
			);
		}).toThrow(/capacity/);
		expect(
			SessionSchema.safeParse(closeSession(edge, closeRequest(edge)).session)
				.success,
		).toBe(true);
		const exhausted = { ...edge, revision: Number.MAX_SAFE_INTEGER };
		expect(SessionSchema.safeParse(exhausted).success).toBe(true);
		expect(() => closeSession(exhausted, closeRequest(exhausted))).toThrow(
			/safe successor/,
		);
	});

	test("bounds terminal growth including escaped summary and superseded active run", () => {
		const session = byteSession(MAX_SESSION_BYTES);
		const final = session.runs.at(-1);
		if (!final) throw new Error("Missing capacity run");
		const active = {
			...session,
			approval: "approved" as const,
			goal: `${session.goal}xx`,
			runs: [
				...session.runs.slice(0, -1),
				{ ...final, state: "active" as const, summary: null },
			],
		};
		expect(Buffer.byteLength(JSON.stringify(active))).toBe(MAX_SESSION_BYTES);
		expect(SessionSchema.safeParse(active).success).toBe(true);
		const closed = closeSession(active, closeRequest(active)).session;
		expect(closed.runs.at(-1)?.state).toBe("superseded");
		expect(
			Buffer.byteLength(JSON.stringify(closed)) -
				Buffer.byteLength(JSON.stringify(active)),
		).toBeLessThanOrEqual(SESSION_CLOSE_RESERVE_BYTES);
		expect(SessionSchema.safeParse(closed).success).toBe(true);
	});

	test("does not grant terminal allowance to an oversized body or a nonfinal close", () => {
		const oversized = byteSession(MAX_SESSION_BYTES + 8);
		const closed = closeSession(oversized, {
			...closeRequest(oversized),
			summary: "Stop",
		}).session;
		expect(SessionSchema.safeParse(closed).success).toBe(false);
		const full = ledgerSession(4096);
		const valid = closeSession(full, closeRequest(full)).session;
		const terminal = valid.operations.at(-1);
		if (!terminal) throw new Error("Missing close operation");
		const reordered = { ...valid, operations: [terminal, ...full.operations] };
		expect(SessionSchema.safeParse(reordered).success).toBe(false);
		const extra = {
			...valid,
			operations: [
				...full.operations,
				{
					...full.operations[0],
					id: "extra",
					kind: "plan-save" as const,
					inputDigest: operationInputDigest({}),
					committedRevision: 1,
				},
				terminal,
			],
		};
		expect(SessionSchema.safeParse(extra).success).toBe(false);
		expect(
			SessionSchema.safeParse({
				...valid,
				closure: { ...valid.closure, summary: "Tampered" },
			}).success,
		).toBe(false);
	});

	test("retains the physical file limit for open documents after enlarging the closed reader", async () => {
		const session = byteSession(MAX_SESSION_BYTES);
		const workspace = await mkdtemp(join(tmpdir(), "flow-open-file-limit-"));
		try {
			await saveSession(workspace, session);
			await writeFile(sessionPath(workspace), `${JSON.stringify(session)} `);
			await expect(loadSession(workspace)).rejects.toThrow(
				/supported session size/,
			);
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});
	test("replays an accepted validation even after its session exceeds new admission headroom", () => {
		const session: Session = {
			...ledgerSession(0),
			revision: 1,
			approval: "approved",
			runs: [
				{
					id: "active",
					featureId: FEATURE,
					attempt: 1,
					state: "active",
					startedRevision: 1,
					summary: null,
					artifactsChanged: [],
					validations: [],
					reviews: [],
				},
			],
		};
		const observation = {
			captureId: "captured",
			featureId: FEATURE,
			runId: "active",
			command: "true",
			scope: "focused" as const,
			sourceDigest: SOURCE_A,
			exitCode: 0,
			outputDigest: OUTPUT,
			outputComplete: true,
		};
		const recorded = recordValidation(session, observation).session;
		const legacy = { ...recorded, revision: Number.MAX_SAFE_INTEGER };
		expect(SessionSchema.safeParse(legacy).success).toBe(true);
		expect(recordValidation(legacy, observation)).toMatchObject({
			session: legacy,
			replayed: true,
		});
		expect(() => {
			recordValidation(legacy, { ...observation, captureId: "new-capture" });
		}).toThrow(/capacity/);
	});
});
