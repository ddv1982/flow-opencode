import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench } from "mitata";
import { loadSession, saveSession } from "../src/runtime/session";
import { createApprovedSession } from "./fixtures";

function withTempDir<T>(
	run: (worktree: string) => Promise<T>,
): () => Promise<T> {
	return async () => {
		const worktree = mkdtempSync(join(tmpdir(), "flow-bench-roundtrip-"));

		try {
			return await run(worktree);
		} finally {
			rmSync(worktree, { recursive: true, force: true });
		}
	};
}

const session = createApprovedSession(5);

bench(
	"session save round-trip",
	withTempDir(async (worktree) => {
		await saveSession(worktree, session);
		await loadSession(worktree);
	}),
);
