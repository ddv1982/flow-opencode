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
	flowDir,
	flowInstructionPath,
	historyDir,
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

	test("rejects malformed session JSON", async () => {
		const workspace = await tempWorkspace();
		await mkdir(join(workspace, ".flow"), { recursive: true });
		await writeFile(sessionPath(workspace), '{"version":2,\n', "utf8");

		await expect(loadSession(workspace)).rejects.toThrow(/not valid JSON/i);
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
		).resolves.toBe(
			"session.json\nopencode-instructions.md\nhistory/\nsession.lock/\n.gitignore\n",
		);
	});

	test("writes and refreshes the generated instruction projection", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Use stable OpenCode instructions",
			plan: oneFeaturePlan(),
		});

		const instructionPath = flowInstructionPath(workspace);
		const initial = await readFile(instructionPath, "utf8");
		expect(initial).toContain("# Flow Runtime Context");
		expect(initial).toContain("Use stable OpenCode instructions");
		expect(initial).toContain('- status: "planning"');
		expect(initial).toContain("- completedFeatures: 0");
		expect(initial).toContain("- totalFeatures: 1");

		await flowPlanApprove(workspace);
		const approved = await readFile(instructionPath, "utf8");
		expect(approved).toContain('- status: "ready"');
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
			await expect(stat(flowInstructionPath(workspace))).rejects.toThrow();
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

	test("deferred and abandoned close preserve running and blocked archive state", async () => {
		for (const kind of ["deferred", "abandoned"] as const) {
			const runningWorkspace = await tempWorkspace();
			await flowPlanSave(runningWorkspace, {
				goal: `Close running as ${kind}`,
				plan: oneFeaturePlan(),
			});
			await flowPlanApprove(runningWorkspace);
			await flowRunStart(runningWorkspace, {});
			expect(
				(
					await flowSessionClose(runningWorkspace, {
						kind,
						summary: `Archived running as ${kind}.`,
					})
				).status,
			).toBe("ok");
			const runningArchive = JSON.parse(
				await readFile(
					join(
						historyDir(runningWorkspace),
						(await readdir(historyDir(runningWorkspace)))[0] ?? "",
					),
					"utf8",
				),
			) as {
				status: string;
				activeFeatureId: string | null;
				plan: { features: Array<{ id: string; status: string }> };
			};
			expect(runningArchive.status).toBe("running");
			expect(runningArchive.activeFeatureId).toBeNull();
			expect(runningArchive.plan.features[0]?.status).toBe("in_progress");

			const blockedWorkspace = await tempWorkspace();
			await flowPlanSave(blockedWorkspace, {
				goal: `Close blocked as ${kind}`,
				plan: oneFeaturePlan(),
			});
			await flowPlanApprove(blockedWorkspace);
			await flowRunStart(blockedWorkspace, {});
			await flowFeatureComplete(blockedWorkspace, {
				status: "needs_input",
				featureId: "only-feature",
				summary: "Need operator input.",
				outcome: {
					kind: "needs_input",
					summary: "Missing credentials.",
				},
			});
			expect(
				(
					await flowSessionClose(blockedWorkspace, {
						kind,
						summary: `Archived blocked as ${kind}.`,
					})
				).status,
			).toBe("ok");
			const blockedArchive = JSON.parse(
				await readFile(
					join(
						historyDir(blockedWorkspace),
						(await readdir(historyDir(blockedWorkspace)))[0] ?? "",
					),
					"utf8",
				),
			) as {
				status: string;
				activeFeatureId: string | null;
				history: Array<{ status: string }>;
				plan: { features: Array<{ id: string; status: string }> };
			};
			expect(blockedArchive.status).toBe("blocked");
			expect(blockedArchive.activeFeatureId).toBeNull();
			expect(blockedArchive.plan.features[0]?.status).toBe("blocked");
			expect(blockedArchive.history.at(-1)?.status).toBe("needs_input");
		}
	});

	test("mutation APIs reject unsafe roots before acquiring a session lock", async () => {
		const previousHome = process.env.HOME;
		const workspace = await tempWorkspace();
		process.env.HOME = workspace;
		try {
			await expect(
				flowPlanSave(workspace, { goal: "Reject unsafe HOME workspace" }),
			).rejects.toThrow(/HOME/);
			await expect(stat(flowDir(workspace))).rejects.toThrow();
		} finally {
			if (previousHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = previousHome;
			}
		}
	});

	test("archive failures keep the active session readable", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Keep active session when archive fails",
			plan: oneFeaturePlan(),
		});
		await flowPlanApprove(workspace);
		await writeFile(historyDir(workspace), "not a directory\n", "utf8");

		await expect(
			flowSessionClose(workspace, {
				kind: "deferred",
				summary: "Archive should fail.",
			}),
		).rejects.toThrow();
		expect((await loadSession(workspace))?.goal).toBe(
			"Keep active session when archive fails",
		);
	});

	test("projection write failures leave session JSON as authoritative state", async () => {
		const workspace = await tempWorkspace();
		await mkdir(flowInstructionPath(workspace), { recursive: true });

		await expect(
			flowPlanSave(workspace, {
				goal: "Projection write fails after session save",
				plan: oneFeaturePlan(),
			}),
		).rejects.toThrow();
		expect((await loadSession(workspace))?.goal).toBe(
			"Projection write fails after session save",
		);
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
		).resolves.toBe(
			"session.json\nopencode-instructions.md\nhistory/\nsession.lock/\n.gitignore\n",
		);
		await expect(stat(flowInstructionPath(workspace))).rejects.toThrow();
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
