import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "../src/adapters/opencode/tool-surface/schemas";
import { createTools } from "../src/adapters/opencode/tools";
import { readActiveSessionId } from "../src/runtime/lifecycle";
import {
	sampleSession as canonicalSampleSession,
	cloneSamplePlan,
	createSampleSession,
} from "./fixtures";

type TestToolContext = Partial<ToolContext> & {
	worktree?: string;
	directory?: string;
};

type TestToolDefinition = {
	args: Record<string, unknown>;
	execute: (args: unknown, context: TestToolContext) => Promise<string>;
};

type ToolSurface = ReturnType<typeof createTools>;

type TestTools = {
	[K in keyof ToolSurface]: TestToolDefinition;
} & Record<string, TestToolDefinition>;

export function createTestTools(): TestTools {
	return createTools({}) as unknown as TestTools;
}

export function toolContext(
	worktree: string,
	directory?: string,
	extra?: Record<string, unknown>,
): TestToolContext {
	return directory ? { worktree, directory, ...extra } : { worktree, ...extra };
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
