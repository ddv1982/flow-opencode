import { afterEach, describe, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import {
	access,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
	UnreadableFlowSessionError,
	UnsupportedFlowSessionVersionError,
} from "../src/application/errors.js";
import type { Session } from "../src/domain/session.js";
import { closeSession } from "../src/domain/transitions.js";
import {
	ArchiveCollisionError,
	archiveAndClearSession,
	archivedSessionPath,
	assertMutableWorkspaceRoot,
	flowDir,
	historyDir,
	loadArchivedSession,
	loadSession,
	quarantineUnreadableSession,
	saveSession,
	sessionPath,
	UnsafeFlowWorkspaceLayoutError,
	withSessionLock,
} from "../src/infrastructure/fs/workspace.js";

const temporaryRoots: string[] = [];
const workspaceModuleUrl = new URL(
	"../src/infrastructure/fs/workspace.ts",
	import.meta.url,
).href;

async function temporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "flow-workspace-"));
	temporaryRoots.push(root);
	return root;
}

function openSession(id = "session-a", goal = "Keep Flow simple"): Session {
	return {
		version: 5,
		id,
		revision: 0,
		goal,
		approval: "pending",
		plan: null,
		runs: [],
		operations: [],
		closure: null,
	};
}

function closedSession(
	id = "session-a",
	summary = "Stopped intentionally.",
): Session {
	const current = openSession(id);
	return closeSession(current, {
		operationId: `close-${id}`,
		expectedRevision: current.revision,
		sessionId: id,
		kind: "abandoned",
		summary,
	}).session;
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function waitForPath(path: string): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (await exists(path)) return;
		await delay(10);
	}
	throw new Error(`Timed out waiting for ${path}.`);
}

async function waitForChild(
	child: ChildProcess,
): Promise<{ code: number | null; stderr: string }> {
	let stderr = "";
	child.stderr?.on("data", (chunk) => {
		stderr += String(chunk);
	});
	if (child.exitCode !== null) return { code: child.exitCode, stderr };
	return new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code) => resolve({ code, stderr }));
	});
}

afterEach(async () => {
	await Promise.all(
		temporaryRoots
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("workspace resolution and schema", () => {
	test("canonicalizes a workspace before reading and writing state", async () => {
		if (process.platform === "win32") return;
		const container = await temporaryRoot();
		const workspace = join(container, "real");
		const alias = join(container, "alias");
		await mkdir(workspace);
		await symlink(workspace, alias, "dir");

		expect(assertMutableWorkspaceRoot(alias)).toBe(await realpath(workspace));
		await saveSession(alias, openSession());
		expect(await loadSession(workspace)).toEqual(openSession());
	});

	test("refuses a symbolic .flow directory", async () => {
		if (process.platform === "win32") return;
		const workspace = await temporaryRoot();
		const redirected = join(workspace, "redirected-state");
		await mkdir(redirected);
		await symlink(redirected, flowDir(workspace), "dir");

		await expect(loadSession(workspace)).rejects.toBeInstanceOf(
			UnsafeFlowWorkspaceLayoutError,
		);
		await expect(saveSession(workspace, openSession())).rejects.toBeInstanceOf(
			UnsafeFlowWorkspaceLayoutError,
		);
	});

	test("round-trips Session v5 and rejects invalid state on save and load", async () => {
		const workspace = await temporaryRoot();
		const session = openSession();
		await saveSession(workspace, session);
		expect(await loadSession(workspace)).toEqual(session);

		const invalidRevision = { ...session, revision: -1 } as Session;
		await expect(saveSession(workspace, invalidRevision)).rejects.toThrow();
		expect(await loadSession(workspace)).toEqual(session);

		await writeFile(
			sessionPath(workspace),
			`${JSON.stringify({ ...session, unexpected: true })}\n`,
		);
		await expect(loadSession(workspace)).rejects.toBeInstanceOf(
			UnreadableFlowSessionError,
		);
	});

	test("rejects duplicate JSON keys and can quarantine the unreadable file", async () => {
		const workspace = await temporaryRoot();
		await mkdir(flowDir(workspace));
		const raw = '{"version":5,"version":5}\n';
		await writeFile(sessionPath(workspace), raw);

		await expect(loadSession(workspace)).rejects.toBeInstanceOf(
			UnreadableFlowSessionError,
		);
		const quarantined = await quarantineUnreadableSession(workspace);
		expect(quarantined).not.toBeNull();
		expect(await readFile(quarantined as string, "utf8")).toBe(raw);
		expect(await loadSession(workspace)).toBeNull();
		expect(await readdir(historyDir(workspace))).toHaveLength(1);
	});

	test("leaves unsupported Session v4 active state byte-for-byte untouched", async () => {
		const workspace = await temporaryRoot();
		await mkdir(flowDir(workspace));
		const raw = '{"version":4,"id":"legacy"}\n';
		await writeFile(sessionPath(workspace), raw);

		await expect(loadSession(workspace)).rejects.toBeInstanceOf(
			UnsupportedFlowSessionVersionError,
		);
		expect(await readFile(sessionPath(workspace), "utf8")).toBe(raw);
		expect(await exists(historyDir(workspace))).toBe(false);
	});
});

describe("atomic persistence and archival", () => {
	test("atomically replaces the active file without exposing partial JSON", async () => {
		const workspace = await temporaryRoot();
		const first = openSession("session-first", "First complete document");
		const second = openSession("session-second", "Second complete document");
		await saveSession(workspace, first);
		let reading = true;
		const observedIds = new Set<string>();
		const reader = (async () => {
			while (reading) {
				const parsed = JSON.parse(
					await readFile(sessionPath(workspace), "utf8"),
				) as { id: string };
				observedIds.add(parsed.id);
				await delay(0);
			}
		})();

		await Promise.all(
			Array.from({ length: 24 }, (_, index) =>
				saveSession(workspace, index % 2 === 0 ? second : first),
			),
		);
		reading = false;
		await reader;

		expect(
			[...observedIds].every((id) => id === first.id || id === second.id),
		).toBe(true);
		const stateEntries = await readdir(flowDir(workspace));
		expect(stateEntries.some((name) => name.endsWith(".tmp"))).toBe(false);
		const persisted = await loadSession(workspace);
		if (!persisted) throw new Error("Expected an atomic replacement document.");
		expect([first.id, second.id]).toContain(persisted.id);
	});

	test("archives directly, clears active state, and refuses an overwrite", async () => {
		const workspace = await temporaryRoot();
		const original = closedSession("same-session", "Original archive");
		await saveSession(workspace, original);
		await archiveAndClearSession(workspace, original);

		expect(await loadSession(workspace)).toBeNull();
		expect(await loadArchivedSession(workspace, original.id)).toEqual(original);
		expect(
			(await readdir(historyDir(workspace))).some((name) =>
				name.endsWith(".tmp"),
			),
		).toBe(false);

		const collision = closedSession("same-session", "Different archive");
		await saveSession(workspace, collision);
		await expect(
			archiveAndClearSession(workspace, collision),
		).rejects.toBeInstanceOf(ArchiveCollisionError);
		expect(await loadArchivedSession(workspace, original.id)).toEqual(original);
		expect(await loadSession(workspace)).toEqual(collision);
	});

	test("converges when an identical archive exists but active cleanup did not finish", async () => {
		const workspace = await temporaryRoot();
		const session = closedSession("crash-session");
		await saveSession(workspace, session);
		await mkdir(historyDir(workspace));
		await writeFile(
			archivedSessionPath(workspace, session.id),
			`${JSON.stringify(session, null, 2)}\n`,
		);

		await archiveAndClearSession(workspace, session);

		expect(await loadSession(workspace)).toBeNull();
		expect(await loadArchivedSession(workspace, session.id)).toEqual(session);
	});
});

describe("session locks", () => {
	test("serializes transactions in one process", async () => {
		const workspace = await temporaryRoot();
		const events: string[] = [];
		let releaseFirst = () => {};
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		let signalEntered = () => {};
		const entered = new Promise<void>((resolve) => {
			signalEntered = resolve;
		});
		const first = withSessionLock(workspace, async () => {
			events.push("first:start");
			signalEntered();
			await firstGate;
			events.push("first:end");
		});
		await entered;
		const second = withSessionLock(workspace, async () => {
			events.push("second:start");
		});

		await delay(50);
		expect(events).toEqual(["first:start"]);
		releaseFirst();
		await Promise.all([first, second]);
		expect(events).toEqual(["first:start", "first:end", "second:start"]);
	});

	test("serializes transactions across processes", async () => {
		const workspace = await temporaryRoot();
		const parentEntered = join(workspace, "parent-entered");
		const childEntered = join(workspace, "child-entered");
		let releaseParent = () => {};
		const parentGate = new Promise<void>((resolve) => {
			releaseParent = resolve;
		});
		const parent = withSessionLock(workspace, async () => {
			await writeFile(parentEntered, "yes");
			await parentGate;
		});
		await waitForPath(parentEntered);

		const script = `
			import { writeFile } from "node:fs/promises";
			import { withSessionLock } from ${JSON.stringify(workspaceModuleUrl)};
			await withSessionLock(process.env.FLOW_TEST_WORKSPACE, async () => {
				await writeFile(process.env.FLOW_TEST_CHILD_ENTERED, "yes");
			});
		`;
		const child = spawn(process.execPath, ["--eval", script], {
			env: {
				...process.env,
				FLOW_TEST_WORKSPACE: workspace,
				FLOW_TEST_CHILD_ENTERED: childEntered,
			},
			stdio: ["ignore", "ignore", "pipe"],
		});

		try {
			await delay(100);
			expect(await exists(childEntered)).toBe(false);
			releaseParent();
			await parent;
			const result = await waitForChild(child);
			expect(result).toEqual({ code: 0, stderr: "" });
			expect(await exists(childEntered)).toBe(true);
		} finally {
			releaseParent();
			await parent;
			if (child.exitCode === null) child.kill();
		}
	});
});
