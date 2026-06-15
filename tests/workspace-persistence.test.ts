import { describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
	flowFeatureComplete,
	flowPlanApprove,
	flowPlanSave,
	flowRunStart,
	flowSessionClose,
} from "../src/runtime/api";
import {
	assertMutableWorkspaceRoot,
	loadSession,
	sessionPath,
} from "../src/runtime/workspace";

async function tempWorkspace(): Promise<string> {
	const root = join(tmpdir(), `flow-workspace-${crypto.randomUUID()}`);
	await mkdir(root, { recursive: true });
	return root;
}

function oneFeaturePlan() {
	return {
		summary: "Deliver one feature.",
		overview: "Single feature session.",
		requirements: [],
		decisions: [],
		finalReviewPolicy: "broad" as const,
		features: [
			{
				id: "only-feature",
				title: "Only feature",
				summary: "Complete the goal.",
				targets: ["src/only.ts"],
				validation: ["full check"],
				dependsOn: [],
			},
		],
	};
}

function finalPayload() {
	return {
		status: "ok" as const,
		featureId: "only-feature",
		summary: "Completed the goal.",
		artifactsChanged: [{ path: "src/only.ts" }],
		validationRun: [
			{
				command: "bun run check",
				status: "passed" as const,
				summary: "Full check passed.",
			},
		],
		validationScope: "broad" as const,
		featureReview: {
			status: "passed" as const,
			summary: "Feature review passed.",
			blockingFindings: [],
		},
		finalReview: {
			status: "passed" as const,
			summary: "Final review passed.",
			blockingFindings: [],
			reviewDepth: "broad" as const,
		},
	};
}

describe("Flow workspace persistence", () => {
	test("rejects unsafe workspace roots", () => {
		expect(() => assertMutableWorkspaceRoot("/")).toThrow();
		expect(() => assertMutableWorkspaceRoot(homedir())).toThrow();
	});

	test("rejects duplicate keys in session JSON", async () => {
		const workspace = await tempWorkspace();
		await mkdir(join(workspace, ".flow"), { recursive: true });
		await writeFile(
			sessionPath(workspace),
			'{"version":2,"version":2}\n',
			"utf8",
		);

		await expect(loadSession(workspace)).rejects.toThrow(/duplicate/i);
	});

	test("rejects nested duplicate keys in session JSON", async () => {
		const workspace = await tempWorkspace();
		await mkdir(join(workspace, ".flow"), { recursive: true });
		await writeFile(
			sessionPath(workspace),
			'{"version":2,"timestamps":{"createdAt":"now","createdAt":"later"}}\n',
			"utf8",
		);

		await expect(loadSession(workspace)).rejects.toThrow(/duplicate/i);
	});

	test("upgrades generated Flow gitignore to ignore runtime state", async () => {
		const workspace = await tempWorkspace();
		await mkdir(join(workspace, ".flow"), { recursive: true });
		await writeFile(join(workspace, ".flow", ".gitignore"), "session.lock/\n");

		await flowPlanSave(workspace, { goal: "Use the new ignore defaults" });

		await expect(
			readFile(join(workspace, ".flow", ".gitignore"), "utf8"),
		).resolves.toBe("session.json\nhistory/\nsession.lock/\n.gitignore\n");
	});

	test("deferred and abandoned close archives and clears the active session", async () => {
		for (const kind of ["deferred", "abandoned"] as const) {
			const workspace = await tempWorkspace();
			await flowPlanSave(workspace, {
				goal: `Close ${kind} without completing`,
				plan: oneFeaturePlan(),
			});

			const close = await flowSessionClose(workspace, {
				kind,
				summary: `Archived as ${kind}.`,
			});
			expect(close.status).toBe("ok");
			expect((close.closure as { kind: string }).kind).toBe(kind);
			await expect(stat(sessionPath(workspace))).rejects.toThrow();
			expect(await loadSession(workspace)).toBeNull();

			const historyFiles = await readdir(join(workspace, ".flow", "history"));
			expect(historyFiles).toHaveLength(1);
			const archived = JSON.parse(
				await readFile(
					join(workspace, ".flow", "history", historyFiles[0] ?? ""),
					"utf8",
				),
			) as { closure: { kind: string; summary: string }; status: string };
			expect(archived.closure.kind).toBe(kind);
			expect(archived.closure.summary).toBe(`Archived as ${kind}.`);
			expect(archived.status).toBe("planning");
		}
	});

	test("archives and clears completed sessions", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Complete and archive one feature",
			plan: oneFeaturePlan(),
		});
		await flowPlanApprove(workspace);
		await flowRunStart(workspace, {});
		await flowFeatureComplete(workspace, finalPayload());

		const close = await flowSessionClose(workspace, {
			kind: "completed",
			summary: "Archived.",
		});
		expect(close.status).toBe("ok");
		await expect(stat(sessionPath(workspace))).rejects.toThrow();
		expect(await loadSession(workspace)).toBeNull();

		const historyFiles = await readdir(join(workspace, ".flow", "history"));
		expect(historyFiles).toHaveLength(1);
		expect(historyFiles[0]?.endsWith(".json")).toBe(true);
		await expect(
			readFile(join(workspace, ".flow", ".gitignore"), "utf8"),
		).resolves.toBe("session.json\nhistory/\nsession.lock/\n.gitignore\n");
	});

	test("starting a new goal archives an active completed session", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Complete first goal",
			plan: oneFeaturePlan(),
		});
		await flowPlanApprove(workspace);
		await flowRunStart(workspace, {});
		await flowFeatureComplete(workspace, finalPayload());

		const next = await flowPlanSave(workspace, {
			goal: "Start next goal",
			plan: {
				...oneFeaturePlan(),
				summary: "Deliver the next goal.",
			},
		});

		expect(next.status).toBe("ok");
		expect((await loadSession(workspace))?.goal).toBe("Start next goal");
		expect(await readdir(join(workspace, ".flow", "history"))).toHaveLength(1);
	});
});
