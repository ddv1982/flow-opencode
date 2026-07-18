import { describe, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SessionSchema } from "../src/application/schema.js";
import {
	ArchiveCollisionError,
	archiveAndClearSession,
	archivedSessionPath,
	assertMutableWorkspaceRoot,
	flowDir,
	historyDir,
	loadSession,
	saveSession,
	sessionPath,
	UnsafeFlowWorkspaceLayoutError,
	withSessionLock,
} from "../src/infrastructure/fs/workspace.js";
import {
	flowFeatureComplete as executeFlowFeatureComplete,
	flowFeatureReset as executeFlowFeatureReset,
	flowSessionClose as executeFlowSessionClose,
	flowStatus as executeFlowStatus,
	flowPlanApprove,
	flowPlanSave,
	flowRunStart,
} from "../src/infrastructure/fs/workspace-flow-service.js";

const SOURCE_DIGEST = `sha256:${"c".repeat(64)}`;
const OUTPUT_DIGEST = `sha256:${"d".repeat(64)}`;
let operationSequence = 0;

function completionValidations(payload: Record<string, unknown>) {
	const validationRun = Array.isArray(payload.validationRun)
		? payload.validationRun
		: [];
	return validationRun.flatMap((run) => {
		if (
			typeof run !== "object" ||
			run === null ||
			!("command" in run) ||
			typeof run.command !== "string"
		) {
			return [];
		}
		return [
			{
				command: run.command,
				summary:
					"summary" in run && typeof run.summary === "string"
						? run.summary
						: "Validation result.",
				startedAt: "2026-07-18T08:58:00.000Z",
				completedAt: "2026-07-18T08:59:00.000Z",
				exitCode: "status" in run && run.status === "passed" ? 0 : 1,
				outputDigest: OUTPUT_DIGEST,
				environmentKeys: [],
			},
		];
	});
}

async function flowFeatureComplete(workspace: string, input: unknown) {
	const session = await loadSession(workspace);
	if (!session) return executeFlowFeatureComplete(workspace, input);
	const payload =
		typeof input === "object" && input !== null
			? (input as Record<string, unknown>)
			: {};
	const { validationRun: _validationRun, ...publicPayload } = payload;
	return executeFlowFeatureComplete(workspace, {
		operationId: `persistence-operation-${++operationSequence}`,
		expectedRevision: session.causal.revision,
		expectedSnapshotId: session.causal.snapshotId,
		...(Array.isArray(payload.validationRun)
			? { validations: completionValidations(payload) }
			: {}),
		...publicPayload,
	});
}

async function flowFeatureReset(workspace: string, input: unknown) {
	const session = await loadSession(workspace);
	const payload =
		typeof input === "object" && input !== null
			? (input as Record<string, unknown>)
			: {};
	return executeFlowFeatureReset(workspace, {
		operationId: `persistence-operation-${++operationSequence}`,
		expectedRevision: session?.causal.revision ?? 0,
		expectedSnapshotId: session?.causal.snapshotId ?? SOURCE_DIGEST,
		...payload,
	});
}

async function flowSessionClose(workspace: string, input: unknown) {
	const session = await loadSession(workspace);
	const payload =
		typeof input === "object" && input !== null
			? (input as Record<string, unknown>)
			: {};
	return executeFlowSessionClose(workspace, {
		operationId: `persistence-operation-${++operationSequence}`,
		expectedRevision: session?.causal.revision ?? 0,
		expectedSnapshotId: session?.causal.snapshotId ?? SOURCE_DIGEST,
		...payload,
	});
}

async function flowStatus(workspace: string, input: unknown = {}) {
	const response = await executeFlowStatus(workspace, input);
	const session = await loadSession(workspace);
	return session?.closure
		? {
				...response,
				statusSummary: `Session closed as ${session.closure.kind}; archival is pending.`,
			}
		: response;
}

async function tempWorkspace(): Promise<string> {
	const root = join(tmpdir(), `flow-workspace-${crypto.randomUUID()}`);
	await mkdir(root, { recursive: true });
	return root;
}

async function waitForPath(path: string, timeoutMs = 2_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			await stat(path);
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Timed out waiting for test path: ${path}`);
}

async function waitForChild(child: ChildProcess): Promise<{
	code: number | null;
	stderr: string;
}> {
	let stderr = "";
	child.stderr?.setEncoding("utf8");
	child.stderr?.on("data", (chunk: string) => {
		stderr += chunk;
	});
	return await new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code) => resolve({ code, stderr }));
	});
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
		reviewExecutions: [
			{
				attemptId: "only-feature-review-1",
				logicalPassId: "only-feature-review",
				featureId: "only-feature",
				reviewKind: "feature" as const,
				reviewSnapshotId: `sha256:${"a".repeat(64)}`,
				verdict: "passed" as const,
				findings: [],
				startedAt: "2026-07-18T09:00:00.000Z",
				completedAt: "2026-07-18T09:01:00.000Z",
				terminalDisposition: "submitted" as const,
			},
			{
				attemptId: "only-final-review-1",
				logicalPassId: "only-final-review",
				featureId: "only-feature",
				reviewKind: "final" as const,
				reviewSnapshotId: `sha256:${"b".repeat(64)}`,
				verdict: "passed" as const,
				findings: [],
				startedAt: "2026-07-18T09:02:00.000Z",
				completedAt: "2026-07-18T09:03:00.000Z",
				terminalDisposition: "submitted" as const,
			},
		],
	};
}

describe("Flow workspace persistence", () => {
	test("rejects unsafe workspace roots", () => {
		expect(() => assertMutableWorkspaceRoot("/")).toThrow();
		expect(() => assertMutableWorkspaceRoot(homedir())).toThrow();
	});

	test("canonicalizes workspace aliases and still rejects aliases to HOME", async () => {
		const workspace = await tempWorkspace();
		const alias = join(tmpdir(), `flow-workspace-alias-${crypto.randomUUID()}`);
		await symlink(workspace, alias, "dir");
		expect(assertMutableWorkspaceRoot(alias)).toBe(
			assertMutableWorkspaceRoot(workspace),
		);

		const previousHome = process.env.HOME;
		process.env.HOME = workspace;
		try {
			expect(() => assertMutableWorkspaceRoot(alias)).toThrow(/HOME/);
		} finally {
			if (previousHome === undefined) delete process.env.HOME;
			else process.env.HOME = previousHome;
		}
	});

	test("refuses a symlinked Flow directory without touching its target", async () => {
		const workspace = await tempWorkspace();
		const outside = await tempWorkspace();
		const marker = join(outside, "outside-marker");
		await writeFile(marker, "outside marker\n", "utf8");
		await symlink(outside, flowDir(workspace), "dir");

		await expect(
			flowPlanSave(workspace, { goal: "Never escape the workspace" }),
		).rejects.toBeInstanceOf(UnsafeFlowWorkspaceLayoutError);
		expect(await readFile(marker, "utf8")).toBe("outside marker\n");
		expect(await readdir(outside)).toEqual(["outside-marker"]);
	});

	test("refuses symlinked managed files before writing session state", async () => {
		const workspace = await tempWorkspace();
		const outside = await tempWorkspace();
		const outsideIgnore = join(outside, "outside-ignore");
		await mkdir(flowDir(workspace), { recursive: true });
		await writeFile(outsideIgnore, "outside marker\n", "utf8");
		await symlink(outsideIgnore, join(flowDir(workspace), ".gitignore"));

		await expect(
			flowPlanSave(workspace, { goal: "Keep managed files contained" }),
		).rejects.toBeInstanceOf(UnsafeFlowWorkspaceLayoutError);
		expect(await readFile(outsideIgnore, "utf8")).toBe("outside marker\n");
		await expect(stat(sessionPath(workspace))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	test("refuses a non-file ignore path before publishing session state", async () => {
		const workspace = await tempWorkspace();
		await mkdir(join(flowDir(workspace), ".gitignore"), { recursive: true });

		await expect(
			flowPlanSave(workspace, { goal: "Protect state before publication" }),
		).rejects.toBeInstanceOf(UnsafeFlowWorkspaceLayoutError);
		await expect(stat(sessionPath(workspace))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	test("refuses symlinked lock and history directories", async () => {
		const lockWorkspace = await tempWorkspace();
		const outsideLock = await tempWorkspace();
		await mkdir(flowDir(lockWorkspace), { recursive: true });
		await symlink(
			outsideLock,
			join(flowDir(lockWorkspace), "session.lock"),
			"dir",
		);
		await expect(
			withSessionLock(lockWorkspace, async () => "unreachable"),
		).rejects.toBeInstanceOf(UnsafeFlowWorkspaceLayoutError);
		expect(await readdir(outsideLock)).toEqual([]);

		const historyWorkspace = await tempWorkspace();
		const outsideHistory = await tempWorkspace();
		await flowPlanSave(historyWorkspace, {
			goal: "Keep archives contained",
			plan: oneFeaturePlan(),
		});
		await symlink(outsideHistory, historyDir(historyWorkspace), "dir");
		await expect(
			flowSessionClose(historyWorkspace, {
				kind: "deferred",
				summary: "Archive safely.",
			}),
		).rejects.toBeInstanceOf(UnsafeFlowWorkspaceLayoutError);
		expect(await readdir(outsideHistory)).toEqual([]);
		expect((await loadSession(historyWorkspace))?.goal).toBe(
			"Keep archives contained",
		);
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
			"session.json\nhistory/\nevidence/\nsession.lock/\n.gitignore\n",
		);
	});

	test("applies version 3 defaults to omitted telemetry and review depth", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Load a sparse version 3 session",
			plan: oneFeaturePlan(),
		});
		const raw = JSON.parse(await readFile(sessionPath(workspace), "utf8")) as {
			budget?: unknown;
			causal?: unknown;
			plan: { features: Array<{ reviewDepth?: string }> };
		};
		delete raw.budget;
		delete raw.causal;
		delete raw.plan.features[0]?.reviewDepth;
		await writeFile(sessionPath(workspace), `${JSON.stringify(raw)}\n`, "utf8");

		const session = await loadSession(workspace);
		expect(session?.budget.reviewCount).toBe(0);
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
			expect(close.workflowData?.archive?.closure?.kind).toBe(kind);
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

	test("replays an exact archived close without writing or advancing revision", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Replay one archived close",
			plan: oneFeaturePlan(),
		});
		const active = await loadSession(workspace);
		if (!active) throw new Error("Expected an active session.");
		const request = {
			operationId: "archived-close-replay",
			expectedRevision: active.causal.revision,
			expectedSnapshotId: active.causal.snapshotId,
			kind: "deferred" as const,
			summary: "Archive exactly once.",
		};
		const first = await executeFlowSessionClose(workspace, request);
		expect(first.status).toBe("ok");
		const [filename] = await readdir(historyDir(workspace));
		if (!filename) throw new Error("Expected one canonical archive.");
		const archivePath = join(historyDir(workspace), filename);
		const beforeBytes = await readFile(archivePath, "utf8");
		const before = SessionSchema.parse(JSON.parse(beforeBytes));

		const replay = await executeFlowSessionClose(workspace, request);

		expect(replay).toEqual(first);
		expect(await readFile(archivePath, "utf8")).toBe(beforeBytes);
		expect(await readdir(historyDir(workspace))).toEqual([filename]);
		await expect(stat(sessionPath(workspace))).rejects.toThrow();
		const after = SessionSchema.parse(
			JSON.parse(await readFile(archivePath, "utf8")),
		);
		expect(after.causal.revision).toBe(before.causal.revision);

		for (const changed of [
			{ ...request, summary: "Changed close intent." },
			{ ...request, expectedRevision: request.expectedRevision + 1 },
			{ ...request, kind: "abandoned" as const },
		]) {
			const conflict = await executeFlowSessionClose(workspace, changed);
			expect(conflict.status).toBe("error");
			expect(conflict.workflowData?.failure?.summary).toContain(
				"different request",
			);
		}
		const crossKindOperation = before.causal.mutations.find(
			(mutation) => mutation.operationKind === "plan_save",
		)?.operationId;
		if (!crossKindOperation) throw new Error("Expected a plan-save operation.");
		const crossKind = await executeFlowSessionClose(workspace, {
			...request,
			operationId: crossKindOperation,
		});
		expect(crossKind.status).toBe("error");
		expect(crossKind.workflowData?.failure?.summary).toContain(
			"different request",
		);
	});

	test("fails closed on corrupt, ambiguous, and filename-mismatched canonical archives", async () => {
		const corruptWorkspace = await tempWorkspace();
		await flowPlanSave(corruptWorkspace, {
			goal: "Reject corrupt archive history",
			plan: oneFeaturePlan(),
		});
		const corruptActive = await loadSession(corruptWorkspace);
		if (!corruptActive) throw new Error("Expected an active session.");
		const corruptRequest = {
			operationId: "corrupt-archive-close",
			expectedRevision: corruptActive.causal.revision,
			expectedSnapshotId: corruptActive.causal.snapshotId,
			kind: "deferred" as const,
			summary: "Publish before corruption.",
		};
		await executeFlowSessionClose(corruptWorkspace, corruptRequest);
		await writeFile(
			join(historyDir(corruptWorkspace), "corrupt.json"),
			"{bad\n",
		);
		const corrupt = await executeFlowSessionClose(
			corruptWorkspace,
			corruptRequest,
		);
		expect(corrupt.status).toBe("error");
		expect(JSON.stringify(corrupt)).not.toContain(corruptWorkspace);

		const mismatchWorkspace = await tempWorkspace();
		await flowPlanSave(mismatchWorkspace, {
			goal: "Reject mismatched archive filename",
			plan: oneFeaturePlan(),
		});
		const mismatchActive = await loadSession(mismatchWorkspace);
		if (!mismatchActive) throw new Error("Expected an active session.");
		const mismatchRequest = {
			operationId: "mismatch-archive-close",
			expectedRevision: mismatchActive.causal.revision,
			expectedSnapshotId: mismatchActive.causal.snapshotId,
			kind: "deferred" as const,
		};
		await executeFlowSessionClose(mismatchWorkspace, mismatchRequest);
		const [mismatchFilename] = await readdir(historyDir(mismatchWorkspace));
		if (!mismatchFilename) throw new Error("Expected a canonical archive.");
		await rename(
			join(historyDir(mismatchWorkspace), mismatchFilename),
			join(historyDir(mismatchWorkspace), "different-session.json"),
		);
		expect(
			(await executeFlowSessionClose(mismatchWorkspace, mismatchRequest))
				.status,
		).toBe("error");

		const ambiguousWorkspace = await tempWorkspace();
		const secondWorkspace = await tempWorkspace();
		for (const workspace of [ambiguousWorkspace, secondWorkspace]) {
			await flowPlanSave(workspace, {
				goal: `Ambiguous archive ${workspace}`,
				plan: oneFeaturePlan(),
			});
			const active = await loadSession(workspace);
			if (!active) throw new Error("Expected an active session.");
			await executeFlowSessionClose(workspace, {
				operationId: "ambiguous-archive-close",
				expectedRevision: active.causal.revision,
				expectedSnapshotId: active.causal.snapshotId,
				kind: "deferred",
			});
		}
		const [secondFilename] = await readdir(historyDir(secondWorkspace));
		if (!secondFilename) throw new Error("Expected a second archive.");
		await writeFile(
			join(historyDir(ambiguousWorkspace), secondFilename),
			await readFile(join(historyDir(secondWorkspace), secondFilename), "utf8"),
		);
		const ambiguous = await executeFlowSessionClose(ambiguousWorkspace, {
			operationId: "ambiguous-archive-close",
			expectedRevision: 0,
			expectedSnapshotId: SOURCE_DIGEST,
			kind: "deferred",
		});
		expect(ambiguous.status).toBe("error");
		expect(ambiguous.workflowData?.failure?.summary).toContain("ambiguous");
		expect(JSON.stringify(ambiguous)).not.toContain(ambiguousWorkspace);
	});

	test("never treats quarantine archives as replay sources", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Ignore quarantine replay data",
			plan: oneFeaturePlan(),
		});
		const active = await loadSession(workspace);
		if (!active) throw new Error("Expected an active session.");
		const request = {
			operationId: "quarantined-close",
			expectedRevision: active.causal.revision,
			expectedSnapshotId: active.causal.snapshotId,
			kind: "deferred" as const,
		};
		await executeFlowSessionClose(workspace, request);
		const [filename] = await readdir(historyDir(workspace));
		if (!filename) throw new Error("Expected a canonical archive.");
		await rename(
			join(historyDir(workspace), filename),
			join(historyDir(workspace), `quarantine-${filename}`),
		);

		const retry = await executeFlowSessionClose(workspace, request);

		expect(retry.status).toBe("missing_session");
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

	test("never overwrites an existing archive on session-id collision", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Preserve an older colliding archive",
			plan: oneFeaturePlan(),
		});
		await flowPlanApprove(workspace);
		await flowRunStart(workspace, {});
		const active = await loadSession(workspace);
		if (!active) throw new Error("Expected an active session.");
		await mkdir(historyDir(workspace), { recursive: true });
		const archivePath = archivedSessionPath(workspace, active.id);
		await writeFile(archivePath, "OLDER ARCHIVE\n", "utf8");

		await expect(
			flowSessionClose(workspace, {
				kind: "deferred",
				summary: "New close must not replace old bytes.",
			}),
		).rejects.toBeInstanceOf(ArchiveCollisionError);
		expect(await readFile(archivePath, "utf8")).toBe("OLDER ARCHIVE\n");
		expect((await loadSession(workspace))?.closure?.summary).toBe(
			"New close must not replace old bytes.",
		);
		expect(await readdir(historyDir(workspace))).toEqual([`${active.id}.json`]);

		const status = await flowStatus(workspace);
		expect(String(status.statusSummary)).toContain("archival is pending");
		expect(String(status.nextAction)).toContain("flow_session_close");
		expect((await flowRunStart(workspace, {})).status).toBe("error");
		expect(
			(
				await flowFeatureReset(workspace, {
					featureId: "only-feature",
				})
			).status,
		).toBe("error");
		expect(
			(
				await flowPlanSave(workspace, {
					goal: "Preserve an older colliding archive",
				})
			).status,
		).toBe("error");

		await rm(archivePath);
		const retry = await flowSessionClose(workspace, {
			kind: "abandoned",
			summary: "This retry must not replace the stored closure.",
		});
		expect(retry.status).toBe("ok");
		expect(retry.workflowData?.archive?.closure?.kind).toBe("deferred");
		expect(retry.workflowData?.archive?.closure?.summary).toBe(
			"New close must not replace old bytes.",
		);
		await expect(stat(sessionPath(workspace))).rejects.toThrow();
	});

	test("resumes cleanup when the same archive was already published", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Resume an interrupted close",
			plan: oneFeaturePlan(),
		});
		const active = await loadSession(workspace);
		if (!active) throw new Error("Expected an active session.");
		const recordedAt = "2026-07-17T12:00:00.000Z";
		const { causal: _legacyCausal, ...sparseActive } = active;
		const closed = await saveSession(
			workspace,
			SessionSchema.parse({
				...sparseActive,
				activeFeatureId: null,
				closure: {
					kind: "deferred",
					summary: "Retry the same close.",
					recordedAt,
				},
				timestamps: {
					...active.timestamps,
					updatedAt: recordedAt,
				},
			}),
		);
		await mkdir(historyDir(workspace), { recursive: true });
		const archivePath = archivedSessionPath(workspace, active.id);
		const publishedContents = await readFile(sessionPath(workspace), "utf8");
		await writeFile(archivePath, publishedContents, "utf8");

		const close = await flowSessionClose(workspace, {
			kind: "deferred",
			summary: "Retry the same close.",
		});
		expect(close.status).toBe("ok");
		expect(close.workflowData?.archive?.closure?.recordedAt).toBe(recordedAt);
		expect(await readFile(archivePath, "utf8")).toBe(publishedContents);
		await expect(stat(sessionPath(workspace))).rejects.toThrow();
		expect(closed.closure?.recordedAt).toBe(recordedAt);
	});

	test("archiveAndClear rejects a session that differs from active state", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Reject stale archive input",
			plan: oneFeaturePlan(),
		});
		const active = await loadSession(workspace);
		if (!active) throw new Error("Expected an active session.");
		const { causal: _legacyCausal, ...sparseActive } = active;
		const different = SessionSchema.parse({
			...sparseActive,
			goal: "A different snapshot",
		});

		await expect(
			archiveAndClearSession(workspace, different),
		).rejects.toBeInstanceOf(ArchiveCollisionError);
		expect((await loadSession(workspace))?.goal).toBe(
			"Reject stale archive input",
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
			"session.json\nhistory/\nevidence/\nsession.lock/\n.gitignore\n",
		);
	});

	test("a completed session must be archived before starting a new goal", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Complete first goal",
			plan: oneFeaturePlan(),
		});
		await flowPlanApprove(workspace);
		await flowRunStart(workspace, {});
		await flowFeatureComplete(workspace, finalPayload());

		const pending = await flowPlanSave(workspace, {
			goal: "Start next goal",
			plan: {
				...oneFeaturePlan(),
				summary: "Deliver the next goal.",
			},
		});
		expect(pending.status).toBe("error");
		expect(String(pending.nextAction)).toContain("flow_session_close");

		expect(
			(await flowSessionClose(workspace, { kind: "completed" })).status,
		).toBe("ok");
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

describe("session lock ownership", () => {
	test("serializes independent processes without stale-lock stealing", async () => {
		const workspace = await tempWorkspace();
		const firstEntered = join(workspace, "first-entered");
		const releaseFirst = join(workspace, "release-first");
		const secondEntered = join(workspace, "second-entered");
		const workspaceModule = pathToFileURL(
			join(process.cwd(), "src/infrastructure/fs/workspace.ts"),
		).href;
		const childEnv = {
			...process.env,
			FLOW_TEST_WORKSPACE: workspace,
			FLOW_TEST_FIRST_ENTERED: firstEntered,
			FLOW_TEST_RELEASE_FIRST: releaseFirst,
			FLOW_TEST_SECOND_ENTERED: secondEntered,
		};
		const first = spawn(
			process.execPath,
			[
				"--eval",
				`import { stat, writeFile } from "node:fs/promises";
import { withSessionLock } from ${JSON.stringify(workspaceModule)};
await withSessionLock(process.env.FLOW_TEST_WORKSPACE, async () => {
  await writeFile(process.env.FLOW_TEST_FIRST_ENTERED, "entered\\n");
  while (true) {
    try { await stat(process.env.FLOW_TEST_RELEASE_FIRST); break; }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
});`,
			],
			{
				cwd: process.cwd(),
				env: childEnv,
				stdio: ["ignore", "ignore", "pipe"],
			},
		);
		const firstDone = waitForChild(first);
		let firstResult: Awaited<ReturnType<typeof waitForChild>>;
		try {
			await waitForPath(firstEntered);

			const second = spawn(
				process.execPath,
				[
					"--eval",
					`import { writeFile } from "node:fs/promises";
import { withSessionLock } from ${JSON.stringify(workspaceModule)};
let timedOut = false;
try {
  await withSessionLock(process.env.FLOW_TEST_WORKSPACE, async () => {
    await writeFile(process.env.FLOW_TEST_SECOND_ENTERED, "entered\\n");
  }, { timeoutMs: 150 });
} catch (error) {
  if (String(error).includes("Timed out waiting for Flow session lock")) timedOut = true;
  else throw error;
}
if (!timedOut) process.exitCode = 2;`,
				],
				{
					cwd: process.cwd(),
					env: childEnv,
					stdio: ["ignore", "ignore", "pipe"],
				},
			);
			const secondResult = await waitForChild(second);
			expect(secondResult).toEqual({ code: 0, stderr: "" });
			await expect(stat(secondEntered)).rejects.toMatchObject({
				code: "ENOENT",
			});
		} finally {
			await writeFile(releaseFirst, "release\n");
			firstResult = await firstDone;
		}
		expect(firstResult).toEqual({ code: 0, stderr: "" });
	});

	test("never steals a lock based on its age or owner liveness", async () => {
		const workspace = await tempWorkspace();
		const lockDir = join(flowDir(workspace), "session.lock");
		await mkdir(lockDir, { recursive: true });
		await writeFile(
			join(lockDir, "owner.json"),
			JSON.stringify({
				token: crypto.randomUUID(),
				pid: 999_999,
				hostname: hostname(),
				createdAt: "2000-01-01T00:00:00.000Z",
			}),
			"utf8",
		);

		await expect(
			withSessionLock(workspace, async () => "unreachable", { timeoutMs: 100 }),
		).rejects.toThrow("inspect");
		expect(await stat(lockDir)).toBeDefined();
	});

	test("fails closed when owner metadata is invalid", async () => {
		const workspace = await tempWorkspace();
		const lockDir = join(flowDir(workspace), "session.lock");
		await mkdir(lockDir, { recursive: true });
		await writeFile(join(lockDir, "owner.json"), "not-json", "utf8");

		await expect(
			withSessionLock(workspace, async () => "unreachable", { timeoutMs: 100 }),
		).rejects.toThrow("metadata is missing or invalid");
		expect(await readFile(join(lockDir, "owner.json"), "utf8")).toBe(
			"not-json",
		);
	});

	test("an old owner cannot release a replacement lock", async () => {
		const workspace = await tempWorkspace();
		const lockDir = join(flowDir(workspace), "session.lock");
		const replacementToken = crypto.randomUUID();

		await withSessionLock(workspace, async () => {
			await rm(lockDir, { recursive: true });
			await mkdir(lockDir);
			await writeFile(
				join(lockDir, "owner.json"),
				JSON.stringify({
					token: replacementToken,
					pid: process.pid,
					hostname: hostname(),
					createdAt: new Date().toISOString(),
				}),
				"utf8",
			);
		});

		const owner = JSON.parse(
			await readFile(join(lockDir, "owner.json"), "utf8"),
		);
		expect(owner.token).toBe(replacementToken);
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
		await expect(
			readFile(join(flowDir(workspace), ".gitignore"), "utf8"),
		).resolves.toBe(
			"session.json\nhistory/\nevidence/\nsession.lock/\n.gitignore\n",
		);

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
				version: 3,
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

	test("preserves but never migrates a version 2 session", async () => {
		const workspace = await tempWorkspace();
		await mkdir(flowDir(workspace), { recursive: true });
		const legacySession = {
			version: 2,
			id: "legacy-v2",
			goal: "Do not migrate this session",
			status: "planning",
			approval: "pending",
			plan: null,
			activeFeatureId: null,
			history: [],
			closure: null,
			lastError: null,
			timestamps: {
				createdAt: "2026-07-01T00:00:00.000Z",
				updatedAt: "2026-07-01T00:00:00.000Z",
				completedAt: null,
			},
		};
		const rawLegacySession = `${JSON.stringify(legacySession)}\n`;
		await writeFile(sessionPath(workspace), rawLegacySession, "utf8");

		const status = await flowStatus(workspace);
		expect(status.status).toBe("error");
		expect(String(status.workflowData?.quarantine?.reason)).toContain(
			"session schema version 2",
		);
		expect(String(status.workflowData?.quarantine?.reason)).toContain(
			"requires version 3",
		);
		expect(String(status.summary)).toContain("preserved");
		const quarantinedSessionPath = status.workflowData?.quarantine?.preservedAt;
		expect(quarantinedSessionPath).toBeString();
		if (!quarantinedSessionPath) {
			throw new Error("Expected the version 2 session to be quarantined.");
		}
		expect(await readFile(quarantinedSessionPath, "utf8")).toBe(
			rawLegacySession,
		);
		await expect(stat(sessionPath(workspace))).rejects.toMatchObject({
			code: "ENOENT",
		});
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
	test("plan save cannot bypass a completed session pending archival", async () => {
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
		expect(String(result.summary)).toContain("archival is pending");
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
