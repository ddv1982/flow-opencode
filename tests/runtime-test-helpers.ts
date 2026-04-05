import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getActiveSessionPath } from "../src/runtime/paths";
import { createTools } from "../src/tools";

export type TestToolContext = {
  worktree?: string;
  directory?: string;
};

export type TestToolDefinition = {
  args: Record<string, unknown>;
  execute: (args: unknown, context: TestToolContext) => Promise<string>;
};

export type TestTools = Record<string, TestToolDefinition>;

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
        rmSync(tempDirs.pop()!, { recursive: true, force: true });
      }
    },
  };
}

export async function activeSessionId(worktree: string): Promise<string> {
  return (await readFile(getActiveSessionPath(worktree), "utf8")).trim();
}

export function samplePlan() {
  return {
    summary: "Implement a small workflow feature set.",
    overview: "Create one setup feature and one execution feature.",
    requirements: ["Keep state durable", "Keep commands concise"],
    architectureDecisions: ["Persist session history under .flow/sessions/<id>", "Run one feature per worker invocation"],
    features: [
      {
        id: "setup-runtime",
        title: "Create runtime helpers",
        summary: "Add runtime helper files and state persistence.",
        fileTargets: ["src/runtime/session.ts"],
        verification: ["bun test"],
      },
      {
        id: "execute-feature",
        title: "Implement execution flow",
        summary: "Wire runtime tools to feature execution.",
        fileTargets: ["src/tools.ts"],
        verification: ["bun test"],
        dependsOn: ["setup-runtime"],
      },
    ],
  };
}
