import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench } from "mitata";
import { saveSession } from "../src/runtime/session";
import { createApprovedSession } from "./fixtures";

const session = createApprovedSession(20);

bench("full saveSession cycle | 20-feature plan", async () => {
	const worktree = mkdtempSync(join(tmpdir(), "flow-bench-save-cycle-"));

	try {
		await saveSession(worktree, session);
	} finally {
		rmSync(worktree, { recursive: true, force: true });
	}
});
