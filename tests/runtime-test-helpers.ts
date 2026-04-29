import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readActiveSessionId } from "../src/runtime/session";
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

type ToolSurface = ReturnType<typeof createTools>;

export type TestTools = {
	[K in keyof ToolSurface]: TestToolDefinition;
} & Record<string, TestToolDefinition>;

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
	const sessionId = await readActiveSessionId(worktree);
	if (!sessionId) {
		throw new Error("No active session found.");
	}
	return sessionId;
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
