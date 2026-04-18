import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getActiveSessionPath } from "../src/runtime/paths";
import { createTools } from "../src/tools";
import type { ToolContext } from "../src/tools/schemas";
import {
	samplePlan as canonicalSamplePlan,
	sampleSession as canonicalSampleSession,
	cloneSamplePlan,
	createSampleSession,
} from "./fixtures";

export type TestToolContext = Partial<ToolContext> & {
	worktree?: string;
	directory?: string;
};

export type TestToolDefinition = {
	args: Record<string, unknown>;
	execute: (args: unknown, context: TestToolContext) => Promise<string>;
};

export type TestTools = ReturnType<typeof createTools> &
	Record<string, TestToolDefinition>;

export function createTestTools(): TestTools {
	return createTools({}) as unknown as TestTools;
}

export function createTempDirRegistry(prefix = "flow-opencode-") {
	const tempDirs: string[] = [];

	return {
		makeTempDir(): string {
			const dir = mkdtempSync(join(tmpdir(), prefix));
			tempDirs.push(dir);
			return dir;
		},
		cleanupTempDirs(): void {
			while (tempDirs.length > 0) {
				const dir = tempDirs.pop();
				if (!dir) {
					break;
				}
				rmSync(dir, { recursive: true, force: true });
			}
		},
	};
}

export async function activeSessionId(worktree: string): Promise<string> {
	return (await readFile(getActiveSessionPath(worktree), "utf8")).trim();
}

export function samplePlan() {
	return cloneSamplePlan();
}

export function sampleSession(goal?: string) {
	return goal === undefined
		? structuredClone(canonicalSampleSession)
		: createSampleSession(goal);
}

export { canonicalSamplePlan, canonicalSampleSession };
