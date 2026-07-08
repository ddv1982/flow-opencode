import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	mkdir,
	readdir,
	readFile,
	stat,
	utimes,
	writeFile,
} from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";
import {
	flowFeatureComplete,
	flowPlanApprove,
	flowPlanSave,
	flowRunStart,
	flowSessionClose,
	flowStatus,
} from "../src/runtime/api";
import {
	assertMutableWorkspaceRoot,
	flowDir,
	flowInstructionPath,
	historyDir,
	loadSession,
	sessionPath,
	withSessionLock,
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
		featureReviewDepth: "standard" as const,
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

	test("loads pre-budget v2 sessions with review-depth defaults", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Load existing v2 session",
			plan: oneFeaturePlan(),
		});
		const raw = JSON.parse(await readFile(sessionPath(workspace), "utf8")) as {
			budget?: unknown;
			plan: { features: Array<{ reviewDepth?: string }> };
		};
		delete raw.budget;
		delete raw.plan.features[0]?.reviewDepth;
		await writeFile(sessionPath(workspace), `${JSON.stringify(raw)}\n`, "utf8");

		const session = await loadSession(workspace);
		expect(session?.budget.tokenTelemetry.source).toBe("host_unavailable");
		expect(session?.budget.orchestration.passCount).toBe(0);
		expect(session?.budget.orchestration.latestPasses).toEqual([]);
		expect(session?.plan?.features[0]?.reviewDepth).toBe("standard");
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

describe("session lock recovery", () => {
	test("breaks a stale lock left by a dead process on this host", async () => {
		const workspace = await tempWorkspace();
		const lockDir = join(flowDir(workspace), "session.lock");
		await mkdir(lockDir, { recursive: true });
		const deadProcess = spawnSync(process.execPath, ["--version"]);
		await writeFile(
			join(lockDir, "owner.json"),
			JSON.stringify({
				pid: deadProcess.pid,
				hostname: hostname(),
				createdAt: new Date().toISOString(),
			}),
			"utf8",
		);

		const result = await withSessionLock(workspace, async () => "acquired", {
			timeoutMs: 2_000,
		});
		expect(result).toBe("acquired");
	});

	test("breaks an unowned lock older than the stale threshold", async () => {
		const workspace = await tempWorkspace();
		const lockDir = join(flowDir(workspace), "session.lock");
		await mkdir(lockDir, { recursive: true });
		const past = new Date(Date.now() - 60_000);
		await utimes(lockDir, past, past);

		const result = await withSessionLock(workspace, async () => "acquired", {
			timeoutMs: 2_000,
			staleMs: 500,
		});
		expect(result).toBe("acquired");
	});

	test("reclaims a foreign-host lock with an implausible far-future timestamp", async () => {
		const workspace = await tempWorkspace();
		const lockDir = join(flowDir(workspace), "session.lock");
		await mkdir(lockDir, { recursive: true });
		// A committed/hostile owner.json dated far in the future must not wedge
		// every call: without the fix its negative age never exceeds staleMs.
		await writeFile(
			join(lockDir, "owner.json"),
			JSON.stringify({
				pid: 999_999,
				hostname: "some-other-host",
				createdAt: "9999-01-01T00:00:00.000Z",
			}),
			"utf8",
		);

		const result = await withSessionLock(workspace, async () => "acquired", {
			timeoutMs: 2_000,
			staleMs: 500,
		});
		expect(result).toBe("acquired");
	});

	test("does not break a fresh lock held by a live process and names the remedy on timeout", async () => {
		const workspace = await tempWorkspace();
		const lockDir = join(flowDir(workspace), "session.lock");
		await mkdir(lockDir, { recursive: true });
		await writeFile(
			join(lockDir, "owner.json"),
			JSON.stringify({
				pid: process.pid,
				hostname: hostname(),
				createdAt: new Date().toISOString(),
			}),
			"utf8",
		);

		const attempt = withSessionLock(workspace, async () => "acquired", {
			timeoutMs: 300,
		});
		await expect(attempt).rejects.toThrow("session.lock");
		await expect(
			withSessionLock(workspace, async () => "acquired", { timeoutMs: 300 }),
		).rejects.toThrow("delete it manually");
	});
});

describe("unreadable session quarantine", () => {
	test("flow_status quarantines a corrupt session file and gives recovery guidance", async () => {
		const workspace = await tempWorkspace();
		await mkdir(flowDir(workspace), { recursive: true });
		await writeFile(sessionPath(workspace), "not json {", "utf8");

		const status = await flowStatus(workspace);
		expect(status.status).toBe("error");
		expect(String(status.summary)).toContain("preserved");
		expect(String(status.recovery)).toContain("/flow-plan");

		await expect(stat(sessionPath(workspace))).rejects.toMatchObject({
			code: "ENOENT",
		});
		const archived = await readdir(historyDir(workspace));
		expect(archived.some((name) => name.startsWith("quarantine-"))).toBe(true);

		const next = await flowPlanSave(workspace, { goal: "Recover cleanly" });
		expect(next.status).toBe("ok");
	});

	test("a session file with an archive-unsafe id is quarantined instead of wedging archive", async () => {
		const workspace = await tempWorkspace();
		await mkdir(flowDir(workspace), { recursive: true });
		// "session/1" is valid against the loose old schema but can never be
		// archived (archivedSessionPath rejects it), so it must fail to load and
		// route through quarantine rather than load and wedge flow_plan_save.
		const now = new Date().toISOString();
		await writeFile(
			sessionPath(workspace),
			`${JSON.stringify({
				version: 2,
				id: "session/1",
				goal: "exotic id",
				status: "planning",
				approval: "pending",
				plan: null,
				activeFeatureId: null,
				history: [],
				closure: null,
				lastError: null,
				timestamps: { createdAt: now, updatedAt: now, completedAt: null },
			})}\n`,
			"utf8",
		);

		const status = await flowStatus(workspace);
		expect(status.status).toBe("error");
		expect(String(status.recovery)).toContain("/flow-plan");
		const archived = await readdir(historyDir(workspace));
		expect(archived.some((name) => name.startsWith("quarantine-"))).toBe(true);

		// Recovery works cleanly afterward.
		const next = await flowPlanSave(workspace, { goal: "Recover cleanly" });
		expect(next.status).toBe("ok");
	});

	test("a session file from an older schema version is quarantined with a curated message", async () => {
		const workspace = await tempWorkspace();
		await mkdir(flowDir(workspace), { recursive: true });
		await writeFile(
			sessionPath(workspace),
			`${JSON.stringify({ version: 1, id: "legacy", goal: "old goal" })}\n`,
			"utf8",
		);

		const status = await flowStatus(workspace);
		expect(status.status).toBe("error");
		expect(String(status.summary)).not.toContain('"code"');
		expect(String(status.summary)).toContain("preserved");
		expect(status.quarantinedSessionPath).toBeString();
	});

	test("mutating tools quarantine an unreadable session instead of dumping raw errors", async () => {
		const workspace = await tempWorkspace();
		await mkdir(flowDir(workspace), { recursive: true });
		await writeFile(sessionPath(workspace), '{"version": 999}', "utf8");

		const result = await flowPlanApprove(workspace);
		expect(result.status).toBe("error");
		expect(String(result.summary)).toContain("preserved");
		expect(String(result.recovery)).toContain("/flow-plan");
		await expect(stat(sessionPath(workspace))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});
});

describe("plan save and completion state invariants", () => {
	test("a failed plan save does not archive the completed session", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "First goal",
			plan: oneFeaturePlan(),
		});
		await flowPlanApprove(workspace);
		await flowRunStart(workspace, {});
		await flowFeatureComplete(workspace, finalPayload());
		expect((await loadSession(workspace))?.status).toBe("completed");

		const invalidPlan = {
			...oneFeaturePlan(),
			features: [
				{
					id: "next-feature",
					title: "Next feature",
					summary: "Depends on a feature that does not exist.",
					dependsOn: ["missing-feature"],
				},
			],
		};
		const result = await flowPlanSave(workspace, {
			goal: "Second goal",
			plan: invalidPlan,
		});
		expect(result.status).toBe("error");
		expect((await loadSession(workspace))?.status).toBe("completed");
		expect((await loadSession(workspace))?.goal).toBe("First goal");
	});

	test("replacing an unapproved draft with a new goal archives the draft", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Draft goal",
			plan: oneFeaturePlan(),
		});

		const replaced = await flowPlanSave(workspace, { goal: "New goal" });
		expect(replaced.status).toBe("ok");
		expect((await loadSession(workspace))?.goal).toBe("New goal");

		const files = await readdir(historyDir(workspace));
		expect(files).toHaveLength(1);
		const archived = JSON.parse(
			await readFile(join(historyDir(workspace), files[0] ?? ""), "utf8"),
		) as { goal: string };
		expect(archived.goal).toBe("Draft goal");
	});

	test("needs_input clears a stale lastError from a prior failed completion", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Clear stale errors",
			plan: oneFeaturePlan(),
		});
		await flowPlanApprove(workspace);
		await flowRunStart(workspace, {});

		const gateFailed = await flowFeatureComplete(workspace, {
			...finalPayload(),
			validationScope: "targeted" as const,
		});
		expect(gateFailed.status).toBe("error");
		expect((await loadSession(workspace))?.lastError).not.toBeNull();

		const blocked = await flowFeatureComplete(workspace, {
			status: "needs_input",
			featureId: "only-feature",
			summary: "Need operator input.",
			outcome: { kind: "needs_input", summary: "Missing credentials." },
		});
		expect(blocked.status).toBe("ok");
		expect((await loadSession(workspace))?.lastError).toBeNull();
	});
});

describe("completion payload contract errors", () => {
	test("flow_feature_complete reports schema violations as curated errors", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Curated contract errors",
			plan: oneFeaturePlan(),
		});
		await flowPlanApprove(workspace);
		await flowRunStart(workspace, {});

		const result = await flowFeatureComplete(workspace, {
			status: "ok",
			featureId: "only-feature",
			summary: "claim done without evidence fields",
		});
		expect(result.status).toBe("error");
		expect(String(result.summary)).toContain(
			"flow_feature_complete payload is invalid",
		);
		expect(String(result.recovery)).toContain("validationScope");
	});
});
