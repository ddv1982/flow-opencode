import { afterEach, describe, expect, test } from "bun:test";
import { open, readdir, readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import {
	resetSessionWorkspaceFsForTests,
	saveSession,
	setSessionWorkspaceFsForTests,
} from "../src/runtime/lifecycle";
import {
	getActiveSessionsDir,
	getFeatureDocPath,
	getFlowDir,
	getIndexDocPath,
	getSessionDir,
	getSessionPath,
	getStoredSessionsDir,
} from "../src/runtime/paths";
import { renderFeatureDoc, renderIndexDoc } from "../src/runtime/render";
import { SessionSchema } from "../src/runtime/schema";
import { createTempDirRegistry, sampleSession } from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry("flow-atomic-");
const originalOpen = open;
const originalRename = rename;

afterEach(async () => {
	resetSessionWorkspaceFsForTests();
	cleanupTempDirs();
});

describe("atomic writes", () => {
	test("saveSession atomically replaces the active session.json", async () => {
		const worktree = makeTempDir();
		const session = sampleSession("Atomic replacement");

		await saveSession(worktree, session);

		const sessionDir = getSessionDir(worktree, session.id);
		const entries = (await readdir(sessionDir)).sort();
		const saved = JSON.parse(
			await readFile(getSessionPath(worktree, session.id), "utf8"),
		);

		expect(entries).toEqual(["docs", "session.json"]);
		expect(saved.id).toBe(session.id);
		expect(saved.goal).toBe("Atomic replacement");
		expect(entries.some((entry) => entry.includes(".tmp"))).toBe(false);
	});

	test("saveSession rename failure leaves original bytes intact", async () => {
		const worktree = makeTempDir();
		const session = await saveSession(
			worktree,
			sampleSession("Before failure"),
		);
		const sessionPath = getSessionPath(worktree, session.id);
		const originalBytes = await readFile(sessionPath);

		let calls = 0;
		setSessionWorkspaceFsForTests({
			rename: async (from, to) => {
				calls += 1;
				if (to === sessionPath) {
					throw new Error("injected rename failure");
				}
				return originalRename(from, to);
			},
		});

		await expect(
			saveSession(worktree, { ...session, goal: "After failure" }),
		).rejects.toThrow("injected rename failure");

		const currentBytes = await readFile(sessionPath);
		expect(Buffer.compare(currentBytes, originalBytes)).toBe(0);
		expect(calls).toBeGreaterThanOrEqual(1);
	});

	test("16 concurrent saveSession calls resolve without corruption", async () => {
		const worktree = makeTempDir();
		const base = sampleSession("Concurrent writes");
		const winnerTags = new Set<string>();

		const results = await Promise.all(
			Array.from({ length: 16 }, async (_, index) => {
				const tag = `tag-${index}`;
				winnerTags.add(tag);
				return saveSession(worktree, {
					...base,
					goal: `Concurrent writes ${index}`,
					notes: [tag],
				});
			}),
		);

		expect(results).toHaveLength(16);

		const sessionDir = getSessionDir(worktree, base.id);
		const entries = await readdir(sessionDir);
		const parsed = SessionSchema.parse(
			JSON.parse(await readFile(getSessionPath(worktree, base.id), "utf8")),
		);

		expect(entries.some((entry) => entry.includes(".tmp"))).toBe(false);
		expect(parsed.notes[0] && winnerTags.has(parsed.notes[0])).toBe(true);
	});

	test("concurrent saveSession calls keep docs consistent with the final saved session", async () => {
		const worktree = makeTempDir();
		const base = sampleSession("Concurrent docs writes");
		const featureIds = base.plan?.features.map((feature) => feature.id) ?? [];

		await Promise.all(
			Array.from({ length: 16 }, (_, index) =>
				saveSession(worktree, {
					...base,
					goal: `Concurrent docs writes ${index}`,
					notes: [`docs-tag-${index}`],
					plan: base.plan
						? {
								...base.plan,
								overview: `Plan overview ${index}`,
								features: base.plan.features.map((feature, featureIndex) => ({
									...feature,
									summary: `Feature ${featureIndex} summary ${index}`,
								})),
							}
						: base.plan,
				}),
			),
		);

		const saved = SessionSchema.parse(
			JSON.parse(await readFile(getSessionPath(worktree, base.id), "utf8")),
		);
		const indexDoc = await readFile(getIndexDocPath(worktree, base.id), "utf8");

		const rendered = renderSessionDocsForAssertion(saved);
		expect(indexDoc).toBe(rendered.index);

		for (const featureId of featureIds) {
			const featureDoc = await readFile(
				getFeatureDocPath(worktree, base.id, featureId),
				"utf8",
			);
			const expectedFeatureDoc = rendered.features.get(featureId);
			if (!expectedFeatureDoc) {
				throw new Error(`Missing rendered feature doc for ${featureId}`);
			}
			expect(featureDoc).toBe(expectedFeatureDoc);
		}
	});

	test("session save lock releases filesystem lock directory", async () => {
		const worktree = makeTempDir();
		await saveSession(worktree, sampleSession("Lock cleanup"));

		const lockDir = join(getFlowDir(worktree), "session-save.lock");
		try {
			await stat(lockDir);
			throw new Error("Expected session save lock directory to be removed.");
		} catch (error) {
			expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
		}
	});

	test("atomic writer fsyncs staged session files and live-session promotion directories", async () => {
		const worktree = makeTempDir();
		const syncs: string[] = [];

		setSessionWorkspaceFsForTests({
			open: async (...args) => {
				const handle = await originalOpen(...args);
				const originalSync = handle.sync.bind(handle);
				handle.sync = (async () => {
					syncs.push(String(args[0]));
					return originalSync();
				}) as typeof handle.sync;
				return handle;
			},
		});

		const session = sampleSession("Fsync verification");
		await saveSession(worktree, session);

		expect(syncs.some((path) => path.includes(join(".flow", "stored")))).toBe(
			true,
		);
		expect(syncs.some((path) => path.endsWith(".tmp"))).toBe(true);
		expect(syncs).toContain(getSessionDir(worktree, session.id, "stored"));
		expect(syncs).toContain(getActiveSessionsDir(worktree));
		expect(syncs).toContain(getStoredSessionsDir(worktree));
	});
});

function renderSessionDocsForAssertion(
	session: (typeof SessionSchema)["_output"],
): {
	index: string;
	features: Map<string, string>;
} {
	return {
		index: renderIndexDoc(session),
		features: new Map(
			(session.plan?.features ?? []).map((feature) => [
				feature.id,
				renderFeatureDoc(session, feature),
			]),
		),
	};
}
