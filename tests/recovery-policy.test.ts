import { describe, expect, test } from "bun:test";
import { createFlowService } from "../src/application/flow-service.js";
import type { DecisionProvider } from "../src/application/ports/decision-provider.js";
import {
	RecoveryController,
	type RecoveryMutation,
	type RecoveryProfile,
} from "../src/application/recovery-policy.js";
import { parseRecoveryCommand } from "../src/platform/opencode/command-hook.js";
import {
	approveSession,
	deterministicEnvironment,
	FEATURE,
	MemorySessionRepository,
	plan,
	resetFeatureRun,
	revision,
	SOURCE_B,
	startReviewedRun,
	submitReview,
} from "./runtime-test-support.js";

const profile: RecoveryProfile = {
	id: "simulation-only",
	model: "jev-1.13.0",
	rubric: "recovery-v1",
	policy: "bounded-recovery-v1",
	choice: 0.9,
	goal: 0.95,
	suitability: 0.95,
};
const context = {
	hostSessionId: "host",
	messageId: "assistant",
	agent: "build",
};
const provider: DecisionProvider = {
	async assess(packet, options) {
		if (!options.reserveAttempt())
			return { kind: "unavailable", reason: "budget" };
		const candidate = packet.candidates[0];
		if (!candidate) throw new Error("fixture");
		return {
			kind: "answered",
			model: "jev-1.13.0",
			choice: candidate.id,
			probabilities: { [candidate.id]: 1, abstain: 0 },
			confidence: 1,
			assessments: { [candidate.id]: { goal: 1, suitability: 1 } },
			inputTokens: 100,
			outputTokens: 10,
			latencyMs: 1,
		};
	},
};
async function setup(
	mode: "shadow" | "delegated" = "delegated",
	custom: DecisionProvider = provider,
	independent = false,
	findingEvidence = "parser.ts",
	initialFindingEvidence = "parser.ts",
	extraLiveFinding = false,
) {
	const repository = new MemorySessionRepository(),
		env = deterministicEnvironment();
	const legacy = await approveSession(
		repository,
		env,
		independent
			? {
					plan: {
						...plan,
						features: [
							...plan.features,
							{
								id: "independent",
								title: "Docs",
								summary: "Approved docs",
								targets: ["docs"],
								validation: ["bun test"],
								dependsOn: [],
							},
						],
					},
				}
			: {},
	);
	for (let i = 0; i < 2; i++) {
		if (i) await resetFeatureRun(legacy, repository, FEATURE, `reset-${i}`);
		await startReviewedRun(legacy, repository, { suffix: `failed-${i}` });
		await submitReview(legacy, repository, {
			suffix: `failed-${i}`,
			summary: "Missing guard",
			verdict: "failed",
			findings: [
				{
					severity: "blocking",
					summary: "Null input crashes",
					evidence: i ? findingEvidence : initialFindingEvidence,
					...(i
						? {
								findingId:
									repository.session?.runs[0]?.reviews[0]?.result?.findings[0]
										?.findingId,
							}
						: {}),
				},
				...(i && extraLiveFinding
					? [
							{
								severity: "blocking" as const,
								summary: "Second live blocker",
								evidence: "second.ts",
							},
						]
					: []),
			],
		});
	}
	const controller = new RecoveryController(custom, { profiles: [profile] });
	controller.activate("host", { mode, maxCalls: 6, maxUsd: 0.05 });
	controller.observeMessage("host", "user", false);
	controller.observeAssistant("host", "assistant", "user");
	const flow = createFlowService(repository, env, controller.guard(context));
	const proposal = () => ({
		id: "proposal",
		sessionId: repository.session?.id,
		expectedRevision: revision(repository),
		candidates: [
			{
				id: "repair",
				action: "retry",
				featureId: FEATURE,
				remedy: "Guard null before parsing",
				changedFromPreviousAttempt: "Handle absent values instead of coercion",
				findingIds: [
					repository.session?.runs.at(-1)?.reviews.at(-1)?.result?.findings[0]
						?.findingId,
				],
			},
		],
	});
	return { repository, env, controller, flow, legacy, proposal };
}
async function recommend(
	s: Awaited<ReturnType<typeof setup>>,
): Promise<RecoveryMutation> {
	const response = await s.flow.status({
		request: { view: "compact" },
		recoveryProposal: s.proposal(),
	});
	expect(response.status).toBe("ok");
	if (response.status !== "ok" || !("recovery" in response.workflowData))
		throw new Error(response.summary);
	const advice = response.workflowData.recovery as {
		recommended: RecoveryMutation;
	};
	if (!advice.recommended) throw new Error(JSON.stringify(advice));
	return advice.recommended;
}
const apply = (
	s: Awaited<ReturnType<typeof setup>>,
	mutation: RecoveryMutation,
) =>
	mutation.kind === "feature-reset"
		? s.flow.featureReset({ request: mutation.request })
		: s.flow.runStart({ request: mutation.request });
describe("process-local recovery", () => {
	test("production rejects delegated activation and command parsing strips only explicit options", () => {
		expect(() =>
			new RecoveryController(provider).activate("host", {
				mode: "delegated",
				maxCalls: 3,
				maxUsd: 0.01,
			}),
		).toThrow("No release-owned live qualification");
		expect(
			parseRecoveryCommand(
				"--recovery=shadow --recovery-calls=3 --recovery-usd=0.01 Repair parser",
			),
		).toEqual({
			goal: "Repair parser",
			settings: { mode: "shadow", maxCalls: 3, maxUsd: 0.01 },
		});
		expect(() =>
			parseRecoveryCommand("--recovery=shadow Repair parser"),
		).toThrow();
	});
	test("bare status never calls provider; proposal grants exact reset without mutating", async () => {
		let calls = 0;
		const s = await setup("delegated", {
			assess: (p, o) => {
				calls++;
				return provider.assess(p, o);
			},
		});
		const before = revision(s.repository);
		await s.flow.status({ request: { view: "compact" } });
		expect(calls).toBe(0);
		const mutation = await recommend(s);
		expect(revision(s.repository)).toBe(before);
		expect(calls).toBe(1);
		expect(
			(
				await s.flow.featureReset({
					request: { ...mutation.request, operationId: "forged" },
				})
			).status,
		).toBe("error");
		expect((await apply(s, mutation)).status).toBe("ok");
		expect(revision(s.repository)).toBe(before + 1);
		expect(
			(
				await s.flow.reviewStart({
					request: {
						operationId: "premature-review",
						expectedRevision: revision(s.repository),
						featureId: FEATURE,
						artifactsChanged: [],
						packet: { summary: "Review", riskLenses: ["null"] },
					},
				})
			).status,
		).toBe("error");
		expect(
			(
				await s.flow.featureReset({
					request: {
						operationId: "extra-reset",
						expectedRevision: revision(s.repository),
						featureId: FEATURE,
					},
				})
			).status,
		).toBe("error");
	});
	test("shadow advice does not mint a pending mutation and repeated packets spend once", async () => {
		let calls = 0;
		const s = await setup("shadow", {
			assess: (p, o) => {
				calls++;
				return provider.assess(p, o);
			},
		});
		const before = revision(s.repository);
		const input = {
			request: { view: "compact" },
			recoveryProposal: s.proposal(),
		};
		const response = await s.flow.status(input);
		expect(response.status).toBe("ok");
		expect(JSON.stringify(response)).not.toContain('"recommended"');
		expect((await s.flow.status(input)).status).toBe("error");
		expect(calls).toBe(1);
		expect(revision(s.repository)).toBe(before);
		expect(
			(
				await s.flow.featureReset({
					request: {
						operationId: "shadow-reset",
						expectedRevision: before,
						featureId: FEATURE,
					},
				})
			).status,
		).toBe("error");
	});
	test("cancellation fences original manager lineage including changed operation ids", async () => {
		const s = await setup();
		const mutation = await recommend(s);
		s.controller.revoke("host");
		expect((await apply(s, mutation)).status).toBe("error");
		expect(
			(
				await s.flow.featureReset({
					request: { ...mutation.request, operationId: "new-id" },
				})
			).status,
		).toBe("error");
		s.controller.observeMessage("host", "new-user", false);
		s.controller.observeAssistant("host", "new-assistant", "new-user");
		const manual = createFlowService(
			s.repository,
			s.env,
			s.controller.guard({ ...context, messageId: "new-assistant" }),
		);
		expect(
			(
				await manual.featureReset({
					request: { ...mutation.request, operationId: "manual-id" },
				})
			).status,
		).toBe("ok");
	});
	test("revoked recovery turn cannot abandon a session before fresh direction", async () => {
		const s = await setup("shadow");
		const session = s.repository.session;
		if (!session) throw new Error("fixture session missing");
		await s.flow.status({
			request: { view: "compact" },
			recoveryProposal: s.proposal(),
		});
		s.controller.revoke("host");
		const request = {
			request: {
				operationId: "abandon-after-stop",
				expectedRevision: session.revision,
				sessionId: session.id,
				kind: "abandoned" as const,
				summary: "Stop this work",
			},
		};
		expect((await s.flow.sessionClose(request)).status).toBe("error");
		expect(s.repository.session?.id).toBe(session.id);
		expect(s.repository.archives.size).toBe(0);
		s.controller.observeMessage("host", "fresh-user", false);
		s.controller.observeAssistant("host", "fresh-assistant", "fresh-user");
		const directed = createFlowService(
			s.repository,
			s.env,
			s.controller.guard({ ...context, messageId: "fresh-assistant" }),
		);
		expect((await directed.sessionClose(request)).status).toBe("ok");
	});
	test("closed protected sessions free capacity without bypassing failed binds", async () => {
		const s = await setup("shadow");
		const base = s.repository.session;
		if (!base) throw new Error("fixture session missing");
		const controller = new RecoveryController(provider, {
			profiles: [profile],
		});
		for (let index = 0; index <= 128; index++) {
			s.repository.session = { ...base, id: `protected-${index}` };
			const host = `protected-host-${index}`;
			controller.activate(host, { mode: "shadow", maxCalls: 1, maxUsd: 0.01 });
			controller.observeMessage(host, `user-${index}`, false);
			controller.observeAssistant(host, `assistant-${index}`, `user-${index}`);
			const flow = createFlowService(
				s.repository,
				s.env,
				controller.guard({
					hostSessionId: host,
					messageId: `assistant-${index}`,
					agent: "build",
				}),
			);
			const result = await flow.status({
				request: { view: "compact" },
				recoveryProposal: s.proposal(),
			});
			expect(result.status).toBe(index === 128 ? "error" : "ok");
		}
		s.repository.session = { ...base, id: "protected-127" };
		controller.observeMessage("protected-host-127", "fresh-user", false);
		controller.observeAssistant(
			"protected-host-127",
			"fresh-assistant",
			"fresh-user",
		);
		const directed = createFlowService(
			s.repository,
			s.env,
			controller.guard({
				hostSessionId: "protected-host-127",
				messageId: "fresh-assistant",
				agent: "build",
			}),
		);
		expect(
			(
				await directed.sessionClose({
					request: {
						operationId: "close-protected-127",
						expectedRevision: base.revision,
						sessionId: "protected-127",
						kind: "abandoned",
						summary: "Explicitly stop",
					},
				})
			).status,
		).toBe("ok");
		s.repository.session = { ...base, id: "protected-128" };
		const last = controller.guard({
			hostSessionId: "protected-host-128",
			messageId: "assistant-128",
			agent: "build",
		});
		expect(
			(
				await createFlowService(s.repository, s.env, last).status({
					request: { view: "compact" },
					recoveryProposal: s.proposal(),
				})
			).status,
		).toBe("ok");
		const lastSession = s.repository.session;
		if (!lastSession) throw new Error("fixture session missing");
		expect(() =>
			controller
				.guard({
					hostSessionId: "unobserved-host",
					messageId: "unobserved-assistant",
					agent: "build",
				})
				.check(lastSession, null, {
					kind: "feature-reset",
					request: {
						operationId: "cross-host",
						expectedRevision: base.revision,
						featureId: FEATURE,
					},
				}),
		).toThrow("different host session");
	});
	test("wrong host and worker cannot consume the pending operation", async () => {
		const s = await setup(),
			mutation = await recommend(s);
		for (const ctx of [
			{ ...context, hostSessionId: "other" },
			{ ...context, agent: "flow-worker" },
			{ ...context, agent: "flow-reviewer" },
		]) {
			const flow = createFlowService(
				s.repository,
				s.env,
				s.controller.guard(ctx),
			);
			expect(
				(await flow.featureReset({ request: mutation.request })).status,
			).toBe("error");
		}
	});
	test("ordinary host churn cannot stop a protected recovery or restore evicted lineage", async () => {
		const s = await setup();
		const mutation = await recommend(s);
		for (let i = 0; i < 129; i++) {
			s.controller.observeMessage(`ordinary-${i}`, `user-${i}`, false);
			s.controller.observeAssistant(
				`ordinary-${i}`,
				`assistant-${i}`,
				`user-${i}`,
			);
		}
		const evicted = createFlowService(
			s.repository,
			s.env,
			s.controller.guard({
				hostSessionId: "ordinary-0",
				messageId: "assistant-0",
				agent: "build",
			}),
		);
		expect(
			(
				await evicted.featureReset({
					request: { ...mutation.request, operationId: "stale-host" },
				})
			).status,
		).toBe("error");
		expect((await apply(s, mutation)).status).toBe("ok");
	});
	test("source drift after advice refuses the existing grant", async () => {
		const s = await setup(),
			mutation = await recommend(s);
		s.repository.sourceDigest = SOURCE_B;
		expect((await apply(s, mutation)).status).toBe("error");
	});
	test("ambiguous save replays exact accepted operation without another run or spend", async () => {
		const s = await setup(),
			mutation = await recommend(s);
		s.repository.saveFailureAfterMutation = new Error("fsync uncertain");
		expect((await apply(s, mutation)).status).toBe("error");
		const count = s.repository.session?.runs.length;
		s.repository.saveFailureAfterMutation = null;
		expect((await apply(s, mutation)).status).toBe("ok");
		expect(s.repository.session?.runs).toHaveLength(count ?? 0);
		expect(s.controller.snapshot()).toMatchObject({ remainingCalls: 5 });
		s.controller.revoke();
		expect((await apply(s, mutation)).status).toBe("ok");
	});
	test("cancel while source digest is awaited prevents commit", async () => {
		const s = await setup(),
			mutation = await recommend(s);
		const before = revision(s.repository);
		const repo = {
			read: () => s.repository.read(),
			transact: <T>(task: Parameters<typeof s.repository.transact<T>>[0]) =>
				s.repository.transact((tx) =>
					task({
						...tx,
						computeSourceDigest: async () => {
							s.controller.revoke();
							return tx.computeSourceDigest();
						},
					}),
				),
		};
		const flow = createFlowService(repo, s.env, s.controller.guard(context));
		expect(
			(await flow.featureReset({ request: mutation.request })).status,
		).toBe("error");
		expect(revision(s.repository)).toBe(before);
	});
	test("provider cancellation and stale source never produce usable advice", async () => {
		for (const action of ["cancel", "source"]) {
			let trigger: () => void = () => {};
			const s = await setup("delegated", {
				async assess(p, o) {
					trigger();
					return provider.assess(p, o);
				},
			});
			trigger = () => {
				if (action === "cancel") s.controller.revoke();
				else s.repository.sourceDigest = SOURCE_B;
			};
			expect(
				(
					await s.flow.status({
						request: { view: "compact" },
						recoveryProposal: s.proposal(),
					})
				).status,
			).toBe("error");
		}
	});
	test("disabled service preserves legacy recovery even without source hashing", async () => {
		const s = await setup();
		const off = new RecoveryController(provider);
		s.repository.sourceDigestFailure = new Error("not available");
		const flow = createFlowService(s.repository, s.env, off.guard(context));
		expect(
			(
				await flow.featureReset({
					request: {
						operationId: "legacy",
						expectedRevision: revision(s.repository),
						featureId: FEATURE,
					},
				})
			).status,
		).toBe("ok");
	});
});

test("oversized advice does not consume a checkpoint decision slot", async () => {
	let calls = 0;
	const s = await setup(
		"shadow",
		{
			async assess() {
				calls++;
				return { kind: "unavailable", reason: "oversize" };
			},
		},
		false,
		"x".repeat(32000),
	);
	for (let index = 0; index < 3; index++) {
		const proposal = s.proposal();
		const response = await s.flow.status({
			request: { view: "compact" },
			recoveryProposal: {
				...proposal,
				id: `oversize-${index}`,
				candidates: proposal.candidates.map((candidate) => ({
					...candidate,
					remedy: `Guard null before parsing ${index}`,
				})),
			},
		});
		expect(response.status).toBe("error");
		if (index === 0)
			expect(
				(
					await s.flow.status({
						request: { view: "compact" },
						recoveryProposal: {
							...proposal,
							id: "oversize-repeat",
							candidates: proposal.candidates.map((candidate) => ({
								...candidate,
								remedy: "Guard null before parsing 0",
							})),
						},
					})
				).status,
			).toBe("error");
	}
	expect(calls).toBe(0);
	expect(s.controller.snapshot()).toMatchObject({ remainingCalls: 6 });
});

test("packet uses current live finding wording instead of oversized history", async () => {
	const s = await setup(
		"shadow",
		{
			async assess(packet, options) {
				expect(packet.findings).toHaveLength(1);
				expect(packet.findings[0]?.evidence).toBe("parser.ts");
				expect(Buffer.byteLength(JSON.stringify(packet))).toBeLessThan(32000);
				return provider.assess(packet, options);
			},
		},
		false,
		"parser.ts",
		"x".repeat(32000),
	);
	const response = await s.flow.status({
		request: { view: "compact" },
		recoveryProposal: s.proposal(),
	});
	expect(response.status).toBe("ok");
	if (response.status !== "ok") throw new Error(response.summary);
	expect(JSON.stringify(response)).toContain('"kind":"selected"');
});

test("candidate must cite the target's live blockers", async () => {
	const incomplete = await setup(
		"shadow",
		provider,
		false,
		"parser.ts",
		"parser.ts",
		true,
	);
	expect(
		(
			await incomplete.flow.status({
				request: { view: "compact" },
				recoveryProposal: incomplete.proposal(),
			})
		).status,
	).toBe("error");
	const unrelated = await setup("shadow", provider, true);
	const session = unrelated.repository.session;
	if (!session) throw new Error("fixture session missing");
	const historical = session.runs[0];
	if (!historical) throw new Error("fixture run missing");
	const foreignId = "independent.R1-01";
	unrelated.repository.session = {
		...session,
		runs: [
			{
				...historical,
				id: "independent-history",
				featureId: "independent",
				state: "superseded",
				reviews: historical.reviews.map((review) => ({
					...review,
					result: review.result
						? {
								...review.result,
								findings: review.result.findings.map((finding) => ({
									...finding,
									findingId: foreignId,
								})),
							}
						: null,
				})),
			},
			...session.runs,
		],
	};
	const proposal = unrelated.proposal();
	expect(
		(
			await unrelated.flow.status({
				request: { view: "compact" },
				recoveryProposal: {
					...proposal,
					candidates: proposal.candidates.map((candidate) => ({
						...candidate,
						findingIds: [foreignId],
					})),
				},
			})
		).status,
	).toBe("error");
});

test("provider retries reserve each paid attempt but count as one checkpoint decision", async () => {
	let assessments = 0;
	const advice = (id: string) => ({
		kind: "answered" as const,
		model: "jev-1.13.0" as const,
		choice: id,
		probabilities: { [id]: 1, abstain: 0 },
		confidence: 1,
		assessments: { [id]: { goal: 1, suitability: 1 } },
		inputTokens: 100,
		outputTokens: 10,
		latencyMs: 1,
	});
	const s = await setup("shadow", {
		async assess(packet, options) {
			assessments++;
			expect(options.reserveAttempt()).toBe(true);
			expect(options.reserveAttempt()).toBe(true);
			return advice(packet.candidates[0]?.id ?? "missing");
		},
	});
	for (let index = 0; index < 2; index++) {
		const proposal = s.proposal();
		expect(
			(
				await s.flow.status({
					request: { view: "compact" },
					recoveryProposal: {
						...proposal,
						id: `retry-${index}`,
						candidates: proposal.candidates.map((candidate) => ({
							...candidate,
							remedy: `Guard null before parsing ${index}`,
						})),
					},
				})
			).status,
		).toBe("ok");
	}
	const proposal = s.proposal();
	expect(
		(
			await s.flow.status({
				request: { view: "compact" },
				recoveryProposal: {
					...proposal,
					id: "retry-third",
					candidates: proposal.candidates.map((candidate) => ({
						...candidate,
						remedy: "Guard null before parsing third",
					})),
				},
			})
		).status,
	).toBe("error");
	expect(assessments).toBe(2);
	expect(s.controller.snapshot()).toMatchObject({ remainingCalls: 2 });
	const unreserved = await setup("delegated", {
		async assess(packet) {
			return advice(packet.candidates[0]?.id ?? "missing");
		},
	});
	const response = await unreserved.flow.status({
		request: { view: "compact" },
		recoveryProposal: unreserved.proposal(),
	});
	expect(response.status).toBe("ok");
	expect(JSON.stringify(response)).toContain('"kind":"abstain"');
	expect(JSON.stringify(response)).not.toContain('"recommended"');
	expect(unreserved.controller.snapshot()).toMatchObject({ remainingCalls: 6 });
});

test("expired recovery lease stops prompting and clears authority", async () => {
	let now = 0;
	const s = await setup();
	const controller = new RecoveryController(provider, {
		profiles: [profile],
		now: () => now,
	});
	controller.activate("host", { mode: "shadow", maxCalls: 2, maxUsd: 0.01 });
	controller.observeMessage("host", "old-user", false);
	controller.observeAssistant("host", "old-assistant", "old-user");
	expect(
		controller.proposalPrompt("host", "flow", 10, "await-user-direction"),
	).not.toBeNull();
	now = 60 * 60 * 1000;
	expect(
		controller.proposalPrompt("host", "flow", 11, "await-user-direction"),
	).toBeNull();
	expect(controller.snapshot()).toEqual({ mode: "off" });
	const mutation: RecoveryMutation = {
		kind: "feature-reset",
		request: {
			operationId: "manual-after-expiry",
			expectedRevision: revision(s.repository),
			featureId: FEATURE,
		},
	};
	const session = s.repository.session;
	if (!session) throw new Error("fixture session missing");
	expect(() =>
		controller
			.guard({ ...context, messageId: "old-assistant" })
			.check(session, null, mutation),
	).toThrow("fresh real user direction");
	controller.observeMessage("host", "new-user", false);
	controller.observeAssistant("host", "new-assistant", "new-user");
	const flow = createFlowService(
		s.repository,
		s.env,
		controller.guard({ ...context, messageId: "new-assistant" }),
	);
	expect((await flow.featureReset({ request: mutation.request })).status).toBe(
		"ok",
	);
});

test("concurrent identical proposals buy one assessment and duplicate mutation replays", async () => {
	let release: () => void = () => {};
	const barrier = new Promise<void>((resolve) => {
		release = resolve;
	});
	let entered: () => void = () => {};
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const s = await setup("delegated", {
		async assess(p, o) {
			entered();
			await barrier;
			return provider.assess(p, o);
		},
	});
	const first = recommend(s);
	await started;
	expect(
		(
			await s.flow.status({
				request: { view: "compact" },
				recoveryProposal: s.proposal(),
			})
		).status,
	).toBe("error");
	release();
	const mutation = await first;
	const results = await Promise.all([apply(s, mutation), apply(s, mutation)]);
	expect(results.map((result) => result.status)).toEqual(["ok", "ok"]);
	expect(
		s.repository.session?.runs.filter((run) => run.state === "active"),
	).toHaveLength(1);
	expect(s.controller.snapshot()).toMatchObject({ remainingCalls: 5 });
});

test("a new invocation cannot erase the third failed-review limit", async () => {
	const s = await setup();
	const mutation = await recommend(s);
	await apply(s, mutation);
	await s.legacy.featureReset({
		request: {
			operationId: "test-only-reset",
			expectedRevision: revision(s.repository),
			featureId: FEATURE,
		},
	});
	await startReviewedRun(s.legacy, s.repository, { suffix: "third" });
	const finding =
		s.repository.session?.runs[0]?.reviews[0]?.result?.findings[0];
	await submitReview(s.legacy, s.repository, {
		suffix: "third",
		summary: "Still failed",
		verdict: "failed",
		findings: finding ? [finding] : [],
	});
	s.controller.activate("host", {
		mode: "delegated",
		maxCalls: 6,
		maxUsd: 0.05,
	});
	s.controller.observeMessage("host", "new-user", false);
	s.controller.observeAssistant("host", "assistant", "new-user");
	expect(
		(
			await s.flow.status({
				request: { view: "compact" },
				recoveryProposal: s.proposal(),
			})
		).status,
	).toBe("error");
});

test("registered tools share the controller across file-backed service instances", async () => {
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { saveSession, loadSession } = await import(
		"../src/infrastructure/fs/workspace.js"
	);
	const { createTools } = await import("../src/platform/opencode/tools.js");
	const directory = await mkdtemp(join(tmpdir(), "flow-recovery-tools-"));
	let release = () => {};
	try {
		await promisify(execFile)("git", ["-C", directory, "init", "--quiet"]);
		await writeFile(
			join(directory, "parser.ts"),
			"export const parser = true;\n",
		);
		const s = await setup("delegated", provider, true);
		if (!s.repository.session) throw new Error("fixture");
		await saveSession(directory, s.repository.session);
		const { AutoDriveCoordinator } = await import(
			"../src/platform/opencode/auto-drive.js"
		);
		const { guardTools } = await import(
			"../src/platform/opencode/tool-guard.js"
		);
		const { registerFlowPluginInstance, FLOW_LEADERSHIP_PROTOCOL_VERSION } =
			await import("../src/platform/opencode/leadership.js");
		const { createWorkspaceFlowService } = await import(
			"../src/infrastructure/fs/workspace-flow-service.js"
		);
		const { prepareWorkspaceValidation, persistWorkspaceValidation } =
			await import("../src/infrastructure/fs/workspace-validation.js");
		let prompts = 0;
		const auto = new AutoDriveCoordinator({
			recovery: s.controller,
			readProjection: async () => {
				const status = await createWorkspaceFlowService(directory).status({
					request: { view: "compact" },
				});
				if (
					status.status !== "ok" ||
					status.workflowData.projection.view !== "compact"
				)
					throw new Error("projection");
				return status.workflowData.projection;
			},
			prompt: async (host, _text, delivery, metadata) => {
				prompts++;
				const user = `recovery-turn-${prompts}`;
				ctx.messageID = `assistant-${prompts}`;
				await auto.observeMessage(
					host,
					delivery,
					[{ type: "text", synthetic: true, metadata }],
					user,
				);
				auto.observeHostMessage(host, {
					id: ctx.messageID,
					role: "assistant",
					parentID: user,
				});
				s.controller.observeMessage(host, user, true);
				s.controller.observeAssistant(host, ctx.messageID, user);
			},
		});
		const leadership = registerFlowPluginInstance(directory, {
			packageName: "opencode-plugin-flow",
			version: "test",
			protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION,
			instanceId: "recovery-integration",
		});
		release = () => leadership.release();
		const tools = guardTools(
			createTools({
				recovery: s.controller,
				validation: {
					cancel() {
						return true;
					},
				} as never,
				prepareValidation: async () => {
					throw new Error("not used");
				},
			}),
			leadership,
			auto,
		);
		const ctx = {
			sessionID: "host",
			messageID: "assistant",
			agent: "build",
			directory,
			worktree: directory,
			abort: new AbortController().signal,
			metadata() {},
			async ask() {},
		};
		const metadata = await auto.activate("host");
		await auto.observeMessage(
			"host",
			{ agent: "build", model: { providerID: "test", modelID: "manager" } },
			[{ type: "text", synthetic: true, metadata }],
			"user",
		);
		auto.observeHostMessage("host", {
			id: "assistant",
			role: "assistant",
			parentID: "user",
		});
		await auto.onIdle("host");
		expect(prompts).toBe(1);
		const status = tools.flow_status,
			reset = tools.flow_feature_reset,
			complete = tools.flow_feature_complete;
		if (!status || !reset || !complete) throw new Error("tools");
		const before = (await loadSession(directory))?.revision;
		const advice = JSON.parse(
			String(
				await status.execute(
					{ request: { view: "compact" }, recoveryProposal: s.proposal() },
					ctx,
				),
			),
		);
		expect(advice.status).toBe("ok");
		expect((await loadSession(directory))?.revision).toBe(before);
		const mutation = advice.workflowData.recovery.recommended;
		expect(
			JSON.parse(
				String(
					await reset.execute(
						{ request: mutation.request },
						{ ...ctx, sessionID: "other" },
					),
				),
			).status,
		).toBe("error");
		expect(
			JSON.parse(
				String(await reset.execute({ request: mutation.request }, ctx)),
			).status,
		).toBe("ok");
		const after = await loadSession(directory);
		expect(after?.runs.filter((run) => run.state === "active")).toHaveLength(1);
		expect(
			JSON.parse(
				String(
					await complete.execute(
						{
							request: {
								operationId: "manager-complete",
								expectedRevision: after?.revision,
								featureId: FEATURE,
								assignmentId: "fake",
								summary: "done",
								result: {
									verdict: "passed",
									findings: [],
									terminalDisposition: "submitted",
								},
							},
						},
						ctx,
					),
				),
			).status,
		).toBe("error");
		const reviewTool = tools.flow_review_start;
		if (!reviewTool || !after) throw new Error("review tool");
		const reviewInput = {
			request: {
				operationId: "repair-review",
				expectedRevision: after.revision,
				featureId: FEATURE,
				artifactsChanged: [],
				packet: { summary: "Null guard fixed", riskLenses: ["null inputs"] },
			},
		};
		expect(
			JSON.parse(String(await reviewTool.execute(reviewInput, ctx))).status,
		).toBe("error");
		const prepared = await prepareWorkspaceValidation(directory, {
			expectedRevision: after.revision,
			featureId: FEATURE,
			command: "bun test",
			scope: "broad",
		});
		const validation = await persistWorkspaceValidation(directory, {
			...prepared,
			captureId: "fresh-repair-validation",
			exitCode: 0,
			outputDigest: `sha256:${"d".repeat(64)}`,
			outputComplete: true,
		});
		const reviewed = JSON.parse(
			String(
				await reviewTool.execute(
					{
						request: {
							...reviewInput.request,
							expectedRevision: validation.recordedRevision,
						},
					},
					ctx,
				),
			),
		);
		expect(reviewed.status).toBe("ok");
		const completion = {
			request: {
				operationId: "independent-reviewer-completion",
				expectedRevision: reviewed.workflowData.projection.revision,
				featureId: FEATURE,
				assignmentId: reviewed.workflowData.projection.assignment.id,
				summary: "Verified null guard",
				result: {
					verdict: "passed",
					findings: [],
					terminalDisposition: "submitted",
				},
			},
		};
		expect(
			JSON.parse(String(await complete.execute(completion, ctx))).status,
		).toBe("error");
		const reviewer = {
			...ctx,
			agent: "flow-reviewer",
			messageID: "reviewer-result",
		};
		auto.observeHostMessage("host", {
			id: reviewer.messageID,
			role: "assistant",
			parentID: "recovery-turn-1",
		});
		const result = JSON.parse(
			String(await complete.execute(completion, reviewer)),
		);
		expect(result.status).toBe("ok");
		expect(result.workflowData.projection.nextAction).toBe("flow_run_start");
		await auto.onIdle("host");
		expect(prompts).toBe(2);
		expect(
			(await loadSession(directory))?.runs.findLast(
				(run) => run.featureId === FEATURE,
			)?.state,
		).toBe("completed");
	} finally {
		release();
		await rm(directory, { recursive: true, force: true });
	}
});

test("first automatic reset followed by exact start remains available with shadow enabled", async () => {
	const s = await setup("shadow");
	const first = s.repository.session?.runs[0];
	if (!first || !s.repository.session) throw new Error("fixture");
	s.repository.session = {
		...s.repository.session,
		runs: [{ ...first, state: "blocked" }],
	};
	const reset = await s.flow.featureReset({
		request: {
			operationId: "first-reset",
			expectedRevision: revision(s.repository),
			featureId: FEATURE,
		},
	});
	expect(reset.status).toBe("ok");
	expect(
		(
			await s.flow.runStart({
				request: {
					operationId: "first-start",
					expectedRevision: revision(s.repository),
					featureId: FEATURE,
				},
			})
		).status,
	).toBe("ok");
});

test("restart refuses unconsumed recovery operations while new-host manual direction works", async () => {
	const s = await setup(),
		mutation = await recommend(s);
	const restarted = new RecoveryController(provider);
	expect(
		(
			await createFlowService(
				s.repository,
				s.env,
				restarted.guard(context),
			).featureReset({ request: mutation.request })
		).status,
	).toBe("error");
	s.controller.revoke();
	s.controller.observeMessage("new-host", "real-user", false);
	s.controller.observeAssistant("new-host", "new-assistant", "real-user");
	const manual = createFlowService(
		s.repository,
		s.env,
		s.controller.guard({
			hostSessionId: "new-host",
			messageId: "new-assistant",
			agent: "build",
		}),
	);
	expect(
		(
			await manual.featureReset({
				request: { ...mutation.request, operationId: "manual-other-host" },
			})
		).status,
	).toBe("ok");
});

test("independent work preserves historical scope blockade when returning to ready retry", async () => {
	const s = await setup("delegated", provider, true);
	const old = s.repository.session;
	if (!old?.plan) throw new Error("fixture");
	s.repository.session = {
		...old,
		runs: old.runs.map((run) => ({
			...run,
			reviews: run.reviews.map((review) => ({
				...review,
				result: review.result
					? {
							...review.result,
							findings: review.result.findings.map((finding) => ({
								...finding,
								scopeBlocker: true,
							})),
						}
					: null,
			})),
		})),
	};
	const proposal = s.proposal();
	const proposed = proposal.candidates[0];
	if (!proposed) throw new Error("fixture");
	proposal.candidates[0] = {
		...proposed,
		id: "docs",
		action: "independent-feature",
		featureId: "independent",
	};
	const response = await s.flow.status({
		request: { view: "compact" },
		recoveryProposal: proposal,
	});
	expect(response.status).toBe("ok");
	if (response.status !== "ok" || !("recovery" in response.workflowData))
		throw new Error("advice");
	const mutation = (
		response.workflowData.recovery as { recommended: RecoveryMutation }
	).recommended;
	const applied = await apply(s, mutation);
	if (applied.status !== "ok") throw new Error(applied.summary);
	const { recordObservedValidation } = await import(
		"./runtime-test-support.js"
	);
	await recordObservedValidation(s.repository, {
		featureId: "independent",
		captureId: "independent-validation",
	});
	expect(
		(
			await s.legacy.reviewStart({
				request: {
					operationId: "independent-review",
					expectedRevision: revision(s.repository),
					featureId: "independent",
					artifactsChanged: [],
					packet: { summary: "Docs done", riskLenses: ["scope"] },
				},
			})
		).status,
	).toBe("ok");
	await submitReview(s.legacy, s.repository, {
		featureId: "independent",
		suffix: "independent",
		summary: "Passed",
		verdict: "passed",
	});
	const retry = s.proposal();
	const retried = retry.candidates[0];
	if (!retried) throw new Error("fixture");
	retry.candidates[0] = {
		...retried,
		findingIds: [old.runs[0]?.reviews[0]?.result?.findings[0]?.findingId],
	};
	expect(
		(
			await s.flow.status({
				request: { view: "compact" },
				recoveryProposal: retry,
			})
		).status,
	).toBe("error");
});

test("stale pending advice can be replaced once by a changed packet", async () => {
	const s = await setup();
	const old = await recommend(s);
	s.repository.sourceDigest = SOURCE_B;
	expect((await apply(s, old)).status).toBe("error");
	const proposal = s.proposal();
	const candidate = proposal.candidates[0];
	if (!candidate) throw new Error("fixture");
	candidate.remedy = "Use explicit null and undefined guards";
	const response = await s.flow.status({
		request: { view: "compact" },
		recoveryProposal: proposal,
	});
	expect(response.status).toBe("ok");
	if (response.status !== "ok" || !("recovery" in response.workflowData))
		throw new Error("advice");
	const fresh = (
		response.workflowData.recovery as { recommended: RecoveryMutation }
	).recommended;
	expect(fresh.request.operationId).not.toBe(old.request.operationId);
	expect((await apply(s, fresh)).status).toBe("ok");
	expect(s.controller.snapshot()).toMatchObject({ remainingCalls: 4 });
});

test("source-stale review reset cannot select a previously failed different feature", async () => {
	const s = await setup("shadow", provider, true);
	await resetFeatureRun(s.legacy, s.repository, FEATURE, "before-independent");
	await startReviewedRun(s.legacy, s.repository, {
		featureId: "independent",
		suffix: "pending-independent",
	});
	s.repository.sourceDigest = SOURCE_B;
	const request = {
		operationId: "stale-cross-feature",
		expectedRevision: revision(s.repository),
		featureId: "independent",
		nextFeatureId: FEATURE,
	};
	expect((await s.flow.featureReset({ request })).status).toBe("error");
	expect(s.controller.snapshot()).toMatchObject({ remainingCalls: 6 });
	expect(
		(
			await s.flow.featureReset({
				request: {
					...request,
					operationId: "stale-same-feature",
					nextFeatureId: "independent",
				},
			})
		).status,
	).toBe("ok");
});

test("old reset replay cannot mint fresh first-retry permission at a later revision", async () => {
	const s = await setup("shadow", provider, true);
	const current = s.repository.session,
		first = current?.runs[0];
	if (!current || !first) throw new Error("fixture");
	s.repository.session = { ...current, runs: [{ ...first, state: "blocked" }] };
	const request = {
		operationId: "original-first-reset",
		expectedRevision: revision(s.repository),
		featureId: FEATURE,
	};
	expect((await s.flow.featureReset({ request })).status).toBe("ok");
	await startReviewedRun(s.legacy, s.repository, {
		featureId: "independent",
		suffix: "replay-independent",
	});
	await submitReview(s.legacy, s.repository, {
		featureId: "independent",
		suffix: "replay-independent",
		summary: "Docs passed",
		verdict: "passed",
	});
	const retry = {
		request: {
			operationId: "forbidden-later-retry",
			expectedRevision: revision(s.repository),
			featureId: FEATURE,
		},
	};
	expect((await s.flow.runStart(retry)).status).toBe("error");
	expect((await s.flow.featureReset({ request })).status).toBe("ok");
	expect((await s.flow.runStart(retry)).status).toBe("error");
});

test("plain auto in another host rejects the previous host's pending grant", async () => {
	const s = await setup();
	const mutation = await recommend(s);
	const { AutoDriveCoordinator } = await import(
		"../src/platform/opencode/auto-drive.js"
	);
	const { createCommandHook } = await import(
		"../src/platform/opencode/command-hook.js"
	);
	const auto = new AutoDriveCoordinator({
		recovery: s.controller,
		readProjection: async () => ({
			sessionId: s.repository.session?.id,
			status: "blocked",
			revision: revision(s.repository),
			nextAction: "await-user-direction",
		}),
		prompt: async () => {},
	});
	await auto.activate("host");
	const hook = createCommandHook({
		autoDrive: auto,
		recovery: s.controller,
		flow: s.flow,
		assertOperational() {},
	});
	const replacement = hook(
		{
			command: "flow-auto",
			sessionID: "other-host",
			arguments: "Continue goal",
		},
		{ parts: [] } as Parameters<typeof hook>[1],
	);
	expect(s.controller.snapshot()).toEqual({ mode: "off" });
	expect((await apply(s, mutation)).status).toBe("error");
	await replacement;
});
