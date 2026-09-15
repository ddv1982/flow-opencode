import { expect, test } from "bun:test";
import { processVanished } from "../evals/harness.js";

test("teardown enumeration treats every vanished-process code as gone", () => {
	// Observed on CI 2026-09-15: reading /proc/<pid>/stat during EvalHost.stop
	// raised ESRCH, which escaped and failed the test that was tearing down.
	for (const code of ["ENOENT", "ESRCH"]) {
		const error = Object.assign(new Error("read"), { code });
		expect(processVanished(error)).toBe(true);
	}
	// Anything else is a real failure and must still surface.
	for (const code of ["EACCES", "EIO", undefined]) {
		const error = Object.assign(new Error("read"), { code });
		expect(processVanished(error)).toBe(false);
	}
});
