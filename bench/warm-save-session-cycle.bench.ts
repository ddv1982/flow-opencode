import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench } from "mitata";
import { saveSession } from "../src/runtime/session";
import { createApprovedSession } from "./fixtures";

const session = createApprovedSession(20);
const worktree = mkdtempSync(join(tmpdir(), "flow-bench-warm-save-"));

await saveSession(worktree, session);

bench("warm saveSession cycle | 20-feature plan (unchanged)", async () => {
	await saveSession(worktree, session);
});

process.on("exit", () => {
	try {
		rmSync(worktree, { recursive: true, force: true });
	} catch {}
});
