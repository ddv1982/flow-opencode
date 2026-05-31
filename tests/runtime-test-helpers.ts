import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "../src/adapters/opencode/tool-surface/schemas";
import { createTools } from "../src/adapters/opencode/tools";
import type { ReviewReport } from "../src/audit/report-schema";
import { readActiveSessionId } from "../src/runtime/session";
import {
	sampleSession as canonicalSampleSession,
	cloneSamplePlan,
	createSampleSession,
} from "./fixtures";

export type TestToolContext = Partial<ToolContext> & {
	worktree?: string;
	directory?: string;
};

type TestToolDefinition = {
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

export function reviewSurface(
	overrides: Partial<ReviewReport["discoveredSurfaces"][number]> = {},
): ReviewReport["discoveredSurfaces"][number] {
	return {
		name: "Surface",
		category: "source_runtime",
		reviewStatus: "directly_reviewed",
		evidence: ["src/runtime/session.ts:1"],
		...overrides,
	};
}

export function validationEntry(
	overrides: Partial<ReviewReport["validationRun"][number]> = {},
): ReviewReport["validationRun"][number] {
	return {
		command: "cargo test",
		status: "not_run",
		summary: "Not run during this read-only review.",
		...overrides,
	};
}

export function reviewFinding(
	overrides: Partial<ReviewReport["findings"][number]> = {},
): ReviewReport["findings"][number] {
	return {
		title: "Finding",
		category: "risk",
		confidence: "likely",
		evidence: ["src/runtime/session.ts:1"],
		impact: "Finding impact.",
		...overrides,
	};
}

export function sampleReviewReport(
	overrides: Partial<ReviewReport> = {},
): ReviewReport {
	return {
		requestedDepth: "deep_audit",
		achievedDepth: "deep_audit",
		repoSummary: "Repo summary.",
		overallVerdict: "Review summary.",
		discoveredSurfaces: [],
		coverageNotes: [],
		validationRun: [],
		findings: [],
		...overrides,
	};
}
