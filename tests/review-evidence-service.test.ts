import { expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFlowService } from "../src/application/flow-service.js";
import type {
	ReviewEvidencePacket,
	ReviewEvidencePort,
} from "../src/application/ports/review-evidence.js";
import {
	persistObservedValidation,
	prepareValidation,
} from "../src/application/prepare-validation.js";
import {
	ReviewStartInputSchema,
	RunStartInputSchema,
	SessionSchema,
	StatusInputSchema,
} from "../src/application/schema.js";
import { activeRun } from "../src/domain/session-queries.js";
import { createFileReviewEvidenceProvider } from "../src/infrastructure/fs/review-evidence.js";
import { createFileSessionRepository } from "../src/infrastructure/fs/session-repository.js";
import { createFileSourceIdentityProvider } from "../src/infrastructure/fs/source-identity.js";
import { createWorkspaceFlowService } from "../src/infrastructure/fs/workspace-flow-service.js";
import {
	approveSession,
	deterministicEnvironment,
	expectOk,
	FEATURE,
	MemorySessionRepository,
	recordObservedValidation,
	revision,
	SOURCE_A,
	SOURCE_B,
} from "./runtime-test-support.js";

function currentRun(repository: MemorySessionRepository) {
	const session = repository.session;
	if (!session) throw new Error("Expected an active session.");
	const run = activeRun(session);
	if (!run) throw new Error("Expected an active feature run.");
	return run;
}

async function fixture() {
	const repository = new MemorySessionRepository();
	const environment = deterministicEnvironment();
	await approveSession(repository, environment);
	let packet: ReviewEvidencePacket | undefined;
	let unavailable = false;
	let requiredTarget: string | null = null;
	const baseline = { version: 1 as const, sha256: SOURCE_A };
	const evidence = { version: 1 as const, sha256: SOURCE_B };
	const provider: ReviewEvidencePort = {
		captureBaseline: async () => baseline,
		prepare: async (input) => {
			if (unavailable) throw new Error("Original baseline is unavailable.");
			if (requiredTarget && !input.authorizedTargets.includes(requiredTarget))
				throw new Error(
					"An accepted prerequisite target was lost across retry.",
				);
			packet = {
				version: 1,
				sessionId: input.sessionId,
				featureId: input.featureId,
				runId: input.runId,
				baseline: input.baseline,
				sourceDigest: input.sourceDigest,
				provenance: "captured-before-run",
				complete: true,
				preservedPreexisting: {
					count: 1,
					digest: SOURCE_A,
					entries: [
						{
							path: "unrelated.txt",
							state: { kind: "file", mode: 0, digest: SOURCE_A },
						},
					],
				},
				changes: [
					{
						path: "src/value.ts",
						binary: false,
						preexistingDirty: false,
						before: { kind: "file", mode: 0, digest: SOURCE_A },
						after: { kind: "file", mode: 0, digest: SOURCE_B },
						diff: `-return 1;\n+return 2;\n${"😃 evidence\n".repeat(2000)}`,
					},
				],
			};
			return evidence;
		},
		read: async () => {
			if (unavailable || !packet)
				throw new Error("Assigned evidence is unavailable.");
			return packet;
		},
	};
	const flow = createFlowService(repository, environment, undefined, provider);
	const start = {
		request: {
			operationId: "start-evidence",
			expectedRevision: revision(repository),
			featureId: FEATURE,
		},
	};
	expectOk(await flow.runStart(start));
	await recordObservedValidation(repository, {
		captureId: "validation-evidence",
	});
	const request = {
		operationId: "review-evidence",
		expectedRevision: revision(repository),
		featureId: FEATURE,
		artifactsChanged: [{ path: "src/value.ts" }],
		packet: { summary: "Review changed behavior.", riskLenses: [] },
	};
	return {
		flow,
		repository,
		baseline,
		start,
		request,
		unavailable: (value: boolean) => {
			unavailable = value;
		},
		packet: () => packet,
		requireTarget: (target: string) => {
			requiredTarget = target;
		},
	};
}

test("missing evidence stops before a durable assignment or failed review", async () => {
	const f = await fixture();
	const before = JSON.stringify(f.repository.session);
	f.unavailable(true);
	const rejected = await f.flow.reviewStart({ request: f.request });
	expect(rejected.status).toBe("error");
	expect(rejected.summary).toBe("Original baseline is unavailable.");
	expect(JSON.stringify(f.repository.session)).toBe(before);
	expect(currentRun(f.repository)?.reviews).toEqual([]);
	f.unavailable(false);
	expectOk(await f.flow.reviewStart({ request: f.request }));
	expect(currentRun(f.repository)?.reviews[0]?.result).toBeNull();
});

test("the reviewer recovers every UTF-8 page with the immutable assignment binding", async () => {
	const f = await fixture();
	expectOk(await f.flow.reviewStart({ request: f.request }));
	const assignment = currentRun(f.repository)?.reviews[0];
	if (!assignment) throw new Error("Missing assignment.");
	const initial = await f.flow.status({
		request: { view: "reviewer", assignmentId: assignment.id },
	});
	expectOk(initial);
	if (
		!("reviewerPager" in initial.workflowData) ||
		!initial.workflowData.reviewerPager
	)
		throw new Error("Missing pager.");
	let text = "";
	for (
		let page = 0;
		page < initial.workflowData.reviewerPager.diffPages;
		page++
	) {
		const response = await f.flow.status({
			request: {
				view: "reviewer-evidence",
				assignmentId: assignment.id,
				part: "diff",
				page,
			},
		});
		expectOk(response);
		const projection = response.workflowData.projection;
		if (projection.view !== "reviewer-evidence" || !("text" in projection))
			throw new Error("Missing page.");
		expect(Buffer.byteLength(projection.text)).toBeLessThanOrEqual(8192);
		expect(projection.sourceDigest).toBe(SOURCE_A);
		text += projection.text;
	}
	expect(JSON.parse(text)).toEqual(f.packet());
	expect(
		(
			await f.flow.status({
				request: {
					view: "reviewer-evidence",
					assignmentId: assignment.id,
					page: 999999,
				},
			})
		).status,
	).toBe("error");
	f.unavailable(true);
	expect(
		(
			await f.flow.status({
				request: { view: "reviewer", assignmentId: assignment.id },
			})
		).status,
	).toBe("error");
});

test("exact run and review replays never recreate the original feature baseline", async () => {
	const f = await fixture();
	expectOk(await f.flow.runStart(f.start));
	expect(currentRun(f.repository)?.baseline).toEqual(f.baseline);
	expectOk(await f.flow.reviewStart({ request: f.request }));
	const accepted = JSON.stringify(f.repository.session);
	f.unavailable(true);
	expectOk(await f.flow.reviewStart({ request: f.request }));
	expect(JSON.stringify(f.repository.session)).toBe(accepted);
});

test("atomic retries preserve the original feature baseline", async () => {
	const f = await fixture();
	expectOk(
		await f.flow.featureReset({
			request: {
				operationId: "reset-evidence",
				expectedRevision: revision(f.repository),
				featureId: FEATURE,
				nextFeatureId: FEATURE,
			},
		}),
	);
	expect(f.repository.session?.runs.map((run) => run.baseline)).toEqual([
		f.baseline,
		f.baseline,
	]);
	expect(f.repository.session?.runs.map((run) => run.state)).toEqual([
		"superseded",
		"active",
	]);
	expect(SessionSchema.safeParse(f.repository.session).success).toBe(true);
});

test("retry review retains accepted same-feature amendments and their original gate observation", async () => {
	const f = await fixture();
	const failed = await recordObservedValidation(f.repository, {
		captureId: "prerequisite-failure",
		exitCode: 1,
	});
	expectOk(
		await f.flow.planAmend({
			request: {
				operationId: "prerequisite-amendment",
				expectedRevision: revision(f.repository),
				featureId: FEATURE,
				validationId: failed.id,
				reason: "Same-goal prerequisite",
				repair: "Repair setup",
				targets: ["tests/setup.ts"],
				sameGoal: true,
				reversible: true,
			},
		}),
	);
	expectOk(
		await f.flow.featureReset({
			request: {
				operationId: "retry-prerequisite",
				expectedRevision: revision(f.repository),
				featureId: FEATURE,
				nextFeatureId: FEATURE,
			},
		}),
	);
	await recordObservedValidation(f.repository, {
		captureId: "prerequisite-repaired",
	});
	f.requireTarget("tests/setup.ts");
	const reviewed = await f.flow.reviewStart({
		request: {
			...f.request,
			operationId: "review-retried-prerequisite",
			expectedRevision: revision(f.repository),
		},
	});
	expectOk(reviewed);
	const projection = reviewed.workflowData.projection;
	if (projection.view !== "reviewer")
		throw new Error("Missing reviewer context.");
	expect(projection.amendments.map((amendment) => amendment.targets)).toEqual([
		["tests/setup.ts"],
	]);
	expect(
		projection.amendmentEvidence.map((observation) => observation.id),
	).toEqual([failed.id]);
	expect(currentRun(f.repository).baseline).toEqual(f.baseline);
});

test("public schemas accept pinned existing ownership and refuse host evidence references", () => {
	const request = {
		operationId: "existing",
		expectedRevision: 2,
		featureId: FEATURE,
		existingWork: { baseCommit: "a".repeat(40), ownedPaths: ["src/value.ts"] },
	};
	expect(RunStartInputSchema.parse({ request }).request.existingWork).toEqual(
		request.existingWork,
	);
	for (const existingWork of [
		{ baseCommit: "HEAD", ownedPaths: ["src/value.ts"] },
		{ baseCommit: "a".repeat(40), ownedPaths: ["../outside"] },
		{
			baseCommit: "a".repeat(40),
			ownedPaths: ["src/value.ts", "src/value.ts"],
		},
	])
		expect(
			RunStartInputSchema.safeParse({ request: { ...request, existingWork } })
				.success,
		).toBe(false);
	expect(
		RunStartInputSchema.safeParse({
			request: { ...request, baseline: { version: 1, sha256: SOURCE_A } },
		}).success,
	).toBe(false);
	expect(
		ReviewStartInputSchema.safeParse({
			request: {
				operationId: "review",
				expectedRevision: 3,
				featureId: FEATURE,
				artifactsChanged: [],
				packet: { summary: "Review", riskLenses: [] },
				evidence: { version: 1, sha256: SOURCE_A },
			},
		}).success,
	).toBe(false);
	expect(
		StatusInputSchema.parse({
			request: { view: "reviewer-evidence", assignmentId: "review-1" },
		}).request,
	).toEqual({
		view: "reviewer-evidence",
		assignmentId: "review-1",
		part: "diff",
		page: 0,
	});
});

test("large inline context becomes a bounded header and remains complete in context pages", async () => {
	const f = await fixture();
	const summary = "review-context ".repeat(1800);
	expectOk(
		await f.flow.reviewStart({
			request: { ...f.request, packet: { ...f.request.packet, summary } },
		}),
	);
	const assignmentId = currentRun(f.repository)?.reviews[0]?.id;
	const initial = await f.flow.status({
		request: { view: "reviewer", assignmentId },
	});
	expectOk(initial);
	expect(Buffer.byteLength(JSON.stringify(initial))).toBeLessThan(8192);
	expect(initial.workflowData.projection).toHaveProperty(
		"inlineContext",
		"paged",
	);
	if (!initial.workflowData.reviewerPager)
		throw new Error("Missing bounded context metadata.");
	let text = "";
	for (
		let page = 0;
		page < initial.workflowData.reviewerPager.contextPages;
		page++
	) {
		const result = await f.flow.status({
			request: {
				view: "reviewer-evidence",
				assignmentId,
				part: "context",
				page,
			},
		});
		expectOk(result);
		if (!("text" in result.workflowData.projection))
			throw new Error("Missing context chunk.");
		text += result.workflowData.projection.text;
	}
	expect(JSON.parse(text).assignment.packet.summary).toBe(summary.trim());
});

test("a failed session save leaves prepared evidence orphaned without accepting a review", async () => {
	const f = await fixture();
	const before = JSON.stringify(f.repository.session);
	f.repository.saveFailure = new Error("simulated session publication failure");
	expect((await f.flow.reviewStart({ request: f.request })).status).toBe(
		"error",
	);
	expect(f.packet()?.complete).toBe(true);
	expect(JSON.stringify(f.repository.session)).toBe(before);
	expect(currentRun(f.repository)?.reviews).toEqual([]);
	f.repository.saveFailure = null;
	expectOk(await f.flow.reviewStart({ request: f.request }));
	expect(currentRun(f.repository)?.reviews).toHaveLength(1);
});

test("file-backed legacy inspection retains current-source assurance without inventing a baseline", async () => {
	const workspace = await mkdtemp(join(tmpdir(), "flow-legacy-evidence-"));
	try {
		await mkdir(join(workspace, "src"));
		await writeFile(
			join(workspace, "src/value.ts"),
			"export const value = 1;\n",
		);
		const git = Bun.spawn(["git", "init", "--quiet"], {
			cwd: workspace,
			stdout: "ignore",
			stderr: "pipe",
		});
		if ((await git.exited) !== 0)
			throw new Error(await new Response(git.stderr).text());
		const repository = createFileSessionRepository(workspace);
		const legacy = createFlowService(repository, deterministicEnvironment());
		const { plan } = await import("./runtime-test-support.js");
		expectOk(
			await legacy.planSave({
				request: {
					operationId: "legacy-plan",
					expectedRevision: 0,
					goal: "Inspect existing code",
					plan: {
						...plan,
						features: plan.features.map((feature) => ({
							...feature,
							kind: "inspect",
						})),
					},
				},
			}),
		);
		expectOk(
			await legacy.planApprove({
				request: { operationId: "legacy-approve", expectedRevision: 1 },
			}),
		);
		expectOk(
			await legacy.runStart({
				request: {
					operationId: "legacy-run",
					expectedRevision: 2,
					featureId: FEATURE,
				},
			}),
		);
		const prepared = await prepareValidation(
			repository,
			{
				expectedRevision: 3,
				featureId: FEATURE,
				command: "bun test",
				scope: "broad",
			},
			"linux",
		);
		await persistObservedValidation(repository, {
			...prepared,
			captureId: "legacy-observation",
			exitCode: 0,
			outputDigest: SOURCE_A,
			outputComplete: true,
		});
		const flow = createWorkspaceFlowService(workspace);
		const result = await flow.reviewStart({
			request: {
				operationId: "legacy-review",
				expectedRevision: 4,
				featureId: FEATURE,
				artifactsChanged: [],
				packet: { summary: "Inspect the current source.", riskLenses: [] },
			},
		});
		expectOk(result);
		const stored = await repository.read();
		const assignment = stored?.runs[0]?.reviews[0];
		expect(stored?.runs[0]?.baseline).toBeUndefined();
		expect(assignment?.evidence).toBeUndefined();
		const status = await flow.status({
			request: { view: "reviewer", assignmentId: assignment?.id },
		});
		expectOk(status);
		expect(status.workflowData.reviewerPager).toMatchObject({
			assurance: "legacy-no-baseline",
			diffPages: 0,
		});
		expect(await readFile(join(workspace, "src/value.ts"), "utf8")).toBe(
			"export const value = 1;\n",
		);
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
});

test("aggregate moderate diffs fail before a durable assignment or failed review", async () => {
	const workspace = await mkdtemp(join(tmpdir(), "flow-review-capacity-"));
	const git = async (args: string[]) => {
		const child = Bun.spawn(["git", "-C", workspace, ...args], {
			stdout: "ignore",
			stderr: "pipe",
		});
		if (await child.exited)
			throw new Error(await new Response(child.stderr).text());
	};
	try {
		await mkdir(join(workspace, "src"));
		for (let index = 0; index < 40; index += 1)
			await writeFile(
				join(workspace, "src", `file-${index}.txt`),
				"before line\n".repeat(7000),
			);
		for (const args of [
			["init", "--quiet"],
			["config", "user.name", "Fixture"],
			["config", "user.email", "fixture@example.invalid"],
			["add", "src"],
			["commit", "--quiet", "-m", "baseline"],
		])
			await git(args);
		const repository = new MemorySessionRepository();
		const environment = deterministicEnvironment();
		const identity = createFileSourceIdentityProvider(workspace);
		repository.sourceDigest = await identity.computeSourceDigest();
		await approveSession(repository, environment);
		const flow = createFlowService(
			repository,
			environment,
			undefined,
			createFileReviewEvidenceProvider(workspace),
		);
		expectOk(
			await flow.runStart({
				request: {
					operationId: "capacity-run",
					expectedRevision: revision(repository),
					featureId: FEATURE,
				},
			}),
		);
		for (let index = 0; index < 40; index += 1)
			await writeFile(
				join(workspace, "src", `file-${index}.txt`),
				"after! line\n".repeat(7000),
			);
		repository.sourceDigest = await identity.computeSourceDigest();
		await recordObservedValidation(repository, { captureId: "capacity-broad" });
		const before = JSON.stringify(repository.session);
		const objectsBefore = (
			await readdir(join(workspace, ".flow", "evidence"))
		).sort();
		const response = await flow.reviewStart({
			request: {
				operationId: "capacity-review",
				expectedRevision: revision(repository),
				featureId: FEATURE,
				artifactsChanged: [],
				packet: { summary: "Review moderate source edits.", riskLenses: [] },
			},
		});
		expect(response.status).toBe("error");
		expect(response.summary).toContain("aggregate capacity");
		expect(JSON.stringify(repository.session)).toBe(before);
		expect(currentRun(repository).reviews).toEqual([]);
		expect(
			(await readdir(join(workspace, ".flow", "evidence"))).sort(),
		).toEqual(objectsBefore);
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
});
