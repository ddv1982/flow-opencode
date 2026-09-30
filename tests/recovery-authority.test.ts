import { expect, test } from "bun:test";
import { createFlowService } from "../src/application/flow-service.js";
import type {
	DecisionAdvice,
	DecisionProvider,
} from "../src/application/ports/decision-provider.js";
import { RecoveryController } from "../src/application/recovery-policy.js";
import { createJevDecisionProvider } from "../src/infrastructure/jev-decision-provider.js";
import { AutoDriveCoordinator } from "../src/platform/opencode/auto-drive.js";
import { createCommandHook } from "../src/platform/opencode/command-hook.js";
import {
	approveSession,
	deterministicEnvironment,
	FEATURE,
	MemorySessionRepository,
	plan,
	recordObservedValidation,
	resetFeatureRun,
	revision,
	SOURCE_B,
	startReviewedRun,
	submitReview,
} from "./runtime-test-support.js";

async function failedTwice(count = 2, scopeBlocker = false) {
	const repository = new MemorySessionRepository(),
		env = deterministicEnvironment();
	const manual = await approveSession(repository, env);
	let findingId: string | undefined;
	for (let i = 0; i < count; i++) {
		if (i) await resetFeatureRun(manual, repository, FEATURE, "first-retry");
		await startReviewedRun(manual, repository, { suffix: "failure-" + i });
		await submitReview(manual, repository, {
			suffix: "failure-" + i,
			summary: "Guard missing",
			verdict: "failed",
			findings: [
				{
					severity: "blocking",
					summary: "Input guard missing",
					evidence: "fixture.ts:1",
					...(findingId ? { findingId } : {}),
					...(scopeBlocker ? { scopeBlocker: true } : {}),
				},
			],
		});

		findingId =
			repository.session?.runs[0]?.reviews[0]?.result?.findings[0]?.findingId;
	}
	return { repository, env, manual };
}

test.each(["off", "no-key", "shadow"] as const)(
	"%s auto command rejects same-turn retry after two genuine source-owned failed reviews",
	async (mode) => {
		const s = await failedTwice();
		let calls = 0;
		const controller = new RecoveryController({
			async assess() {
				calls++;
				throw new Error("No provider call authorized");
			},
		});
		const auto = new AutoDriveCoordinator({
			recovery: controller,
			readProjection: async () => ({
				sessionId: s.repository.session?.id,
				status: "blocked",
				revision: revision(s.repository),
				nextAction: "await-user-direction",
			}),
			prompt: async () => {},
		});
		const hook = createCommandHook({
			autoDrive: auto,
			recovery: controller,
			flow: s.manual,
			assertOperational() {},
			defaultRecovery: () => null,
		});
		const settings =
			mode === "shadow"
				? "--recovery=shadow --recovery-calls=6 --recovery-usd=0.02 "
				: mode === "off"
					? "--recovery=off "
					: "";
		await hook(
			{
				command: "flow-auto",
				sessionID: "host",
				arguments: settings + "Continue approved goal",
			},
			{ parts: [] },
		);
		controller.observeMessage("host", "original-user", false);
		controller.observeAssistant("host", "manager", "original-user");
		const guarded = createFlowService(
			s.repository,
			s.env,
			controller.guard({
				hostSessionId: "host",
				messageId: "manager",
				agent: "build",
			}),
		);
		const before = revision(s.repository);
		const result = await guarded.featureReset({
			request: {
				operationId: "same-turn-second-retry",
				expectedRevision: before,
				featureId: FEATURE,
			},
		});
		expect(result.status).toBe("error");
		expect(revision(s.repository)).toBe(before);
		expect(calls).toBe(0);
	},
);

function automatic(
	s: Awaited<ReturnType<typeof failedTwice>>,
	mode: "off" | "shadow",
	now = () => 0,
) {
	const controller = new RecoveryController(
		{
			async assess() {
				throw new Error("No paid provider allowed");
			},
		},
		{ now },
	);
	controller.activate(
		"host",
		mode === "off" ? null : { mode: "shadow", maxCalls: 6, maxUsd: 0.02 },
	);
	controller.observeMessage("host", "original", false);
	const service = (id: string, parent: string) => {
		controller.observeAssistant("host", id, parent);
		return createFlowService(
			s.repository,
			s.env,
			controller.guard({
				hostSessionId: "host",
				messageId: id,
				agent: "build",
			}),
		);
	};
	return { controller, service };
}

function proposal(s: Awaited<ReturnType<typeof failedTwice>>) {
	const session = s.repository.session;
	if (!session) throw new Error("Missing checkpoint");
	const findingId =
		session.runs.at(-1)?.reviews[0]?.result?.findings[0]?.findingId;
	if (!findingId) throw new Error("Missing source-owned finding");
	return {
		id: "advice-request",
		sessionId: session.id,
		expectedRevision: session.revision,
		candidates: [
			{
				id: "repair",
				action: "retry" as const,
				featureId: FEATURE,
				remedy: "Guard null before parsing",
				changedFromPreviousAttempt: "Check input before dereferencing",
				findingIds: [findingId],
			},
		],
	};
}

test("configured shadow without key reports unavailable without claiming an attempt", async () => {
	const s = await failedTwice();
	const controller = new RecoveryController(
		createJevDecisionProvider(() => undefined),
	);
	controller.activate("host", { mode: "shadow", maxCalls: 6, maxUsd: 0.02 });
	controller.observeMessage("host", "original", false);
	controller.observeAssistant("host", "manager", "original");
	expect(controller.snapshot()).toMatchObject({
		advice: { configured: true, attempted: false, outcome: "not-attempted" },
	});
	const flow = createFlowService(
		s.repository,
		s.env,
		controller.guard({
			hostSessionId: "host",
			messageId: "manager",
			agent: "build",
		}),
	);
	const result = await flow.status({
		request: { view: "compact" },
		recoveryProposal: proposal(s),
	});
	expect(result.status).toBe("ok");
	expect(controller.snapshot()).toMatchObject({
		automation: { active: true },
		remainingCalls: 6,
		advice: { attempted: false, attemptsReserved: 0, outcome: "unavailable" },
		last: { reason: "missing-key" },
	});
});

test.each(["trusted-continuation", "expiry"] as const)(
	"%s cancels in-flight advice without removing ordinary authority",
	async (boundary) => {
		const s = await failedTwice();
		let now = 0;
		let release!: (advice: DecisionAdvice) => void;
		let started!: () => void;
		const entered = new Promise<void>((resolve) => {
			started = resolve;
		});
		let signal: AbortSignal | undefined;
		const provider: DecisionProvider = {
			assess(_packet, options) {
				if (!options.reserveAttempt()) throw new Error("Missing reservation");
				signal = options.signal;
				started();
				return new Promise((resolve) => {
					release = resolve;
				});
			},
		};
		const controller = new RecoveryController(provider, { now: () => now });
		controller.activate("host", { mode: "shadow", maxCalls: 6, maxUsd: 0.02 });
		controller.observeMessage("host", "original", false);
		controller.observeAssistant("host", "manager", "original");
		const guard = controller.guard({
			hostSessionId: "host",
			messageId: "manager",
			agent: "build",
		});
		const flow = createFlowService(s.repository, s.env, guard);
		const pending = flow.status({
			request: { view: "compact" },
			recoveryProposal: proposal(s),
		});
		await entered;
		expect(controller.snapshot()).toMatchObject({
			advice: { attempted: true, attemptsReserved: 1, outcome: "pending" },
		});
		if (boundary === "expiry") {
			now = 2 * 60 * 60 * 1000;
			controller.snapshot();
		} else controller.observeMessage("host", "authenticated-next", true, true);
		expect(signal?.aborted).toBe(true);
		release({
			kind: "answered",
			model: "jev-1.13.0",
			choice: "repair",
			probabilities: { repair: 1, abstain: 0 },
			confidence: 1,
			assessments: { repair: { goal: 1, suitability: 1 } },
			inputTokens: 1,
			outputTokens: 1,
			latencyMs: 1,
		});
		expect((await pending).status).toBe("error");
		expect(controller.snapshot()).toMatchObject({
			automation: { active: true },
			advice: { attemptsReserved: 1 },
		});
		const parent = boundary === "expiry" ? "original" : "authenticated-next";
		controller.observeAssistant("host", "next-manager", parent);
		const protectedFlow = createFlowService(
			s.repository,
			s.env,
			controller.guard({
				hostSessionId: "host",
				messageId: "next-manager",
				agent: "build",
			}),
		);
		expect(
			(
				await protectedFlow.featureReset({
					request: {
						operationId: "after-advice-cancel",
						expectedRevision: revision(s.repository),
						featureId: FEATURE,
					},
				})
			).status,
		).toBe("error");
	},
);

test.each(["off", "shadow"] as const)(
	"%s first retry and exact start remain available after advice expiry",
	async (mode) => {
		const s = await failedTwice(1);
		let now = 0;
		const a = automatic(s, mode, () => now);
		now = 2 * 60 * 60 * 1000;
		const reset = await a.service("reset", "original").featureReset({
			request: {
				operationId: "first-auto-reset",
				expectedRevision: revision(s.repository),
				featureId: FEATURE,
			},
		});
		expect(reset.status).toBe("ok");
		a.controller.observeMessage("host", "continuation", true, true);
		const started = await a.service("start", "continuation").runStart({
			request: {
				operationId: "first-auto-start",
				expectedRevision: revision(s.repository),
				featureId: FEATURE,
			},
		});
		expect(started.status).toBe("ok");
		expect(a.controller.snapshot()).toMatchObject({
			automation: { active: true },
		});
	},
);

test.each(["off", "shadow"] as const)(
	"%s fresh user authorizes one retry plus its start, not repeated retries in the same turn",
	async (mode) => {
		const s = await failedTwice();
		const a = automatic(s, mode);
		a.controller.observeMessage("host", "fresh-user", false);
		const flow = a.service("fresh-manager", "fresh-user");
		const resetRequest = {
			operationId: "manual-extra-reset",
			expectedRevision: revision(s.repository),
			featureId: FEATURE,
		};
		expect((await flow.featureReset({ request: resetRequest })).status).toBe(
			"ok",
		);
		expect(
			(
				await flow.runStart({
					request: {
						operationId: "manual-extra-start",
						expectedRevision: revision(s.repository),
						featureId: FEATURE,
					},
				})
			).status,
		).toBe("ok");
		await recordObservedValidation(s.repository, { captureId: "third-pass" });
		expect(
			(
				await s.manual.reviewStart({
					request: {
						operationId: "third-review",
						expectedRevision: revision(s.repository),
						featureId: FEATURE,
						artifactsChanged: [],
						packet: { summary: "Review attempted repair", riskLenses: [] },
					},
				})
			).status,
		).toBe("ok");
		const previous =
			s.repository.session?.runs[0]?.reviews[0]?.result?.findings[0]?.findingId;
		await submitReview(s.manual, s.repository, {
			suffix: "third-failure",
			summary: "Still missing guard",
			verdict: "failed",
			findings: [
				{
					findingId: previous,
					severity: "blocking",
					summary: "Input guard missing",
					evidence: "fixture.ts:1",
				},
			],
		});
		const before = revision(s.repository);
		expect(
			(
				await flow.featureReset({
					request: {
						operationId: "same-fresh-turn-again",
						expectedRevision: before,
						featureId: FEATURE,
					},
				})
			).status,
		).toBe("error");
		expect(revision(s.repository)).toBe(before);
		expect((await flow.featureReset({ request: resetRequest })).status).toBe(
			"ok",
		);
		expect(
			(
				await flow.featureReset({
					request: {
						operationId: "after-old-replay",
						expectedRevision: before,
						featureId: FEATURE,
					},
				})
			).status,
		).toBe("error");
	},
);

test.each(["off", "shadow"] as const)(
	"%s duplicate or synthetic messages do not authorize a second retry",
	async (mode) => {
		const s = await failedTwice();
		const a = automatic(s, mode);
		a.controller.observeMessage("host", "original", false);
		const original = a.service("original-manager", "original");
		expect(
			(
				await original.featureReset({
					request: {
						operationId: "duplicate-user-retry",
						expectedRevision: revision(s.repository),
						featureId: FEATURE,
					},
				})
			).status,
		).toBe("error");
		a.controller.observeMessage("host", "untrusted", true);
		expect(
			(
				await a.service("untrusted-manager", "untrusted").featureReset({
					request: {
						operationId: "untrusted-retry",
						expectedRevision: revision(s.repository),
						featureId: FEATURE,
					},
				})
			).status,
		).toBe("error");
		a.controller.observeMessage("host", "trusted-continuation", true, true);
		expect(
			(
				await a
					.service("trusted-manager", "trusted-continuation")
					.featureReset({
						request: {
							operationId: "synthetic-retry",
							expectedRevision: revision(s.repository),
							featureId: FEATURE,
						},
					})
			).status,
		).toBe("error");
		expect(
			a.controller
				.guard({
					hostSessionId: "host",
					messageId: "trusted-manager",
					agent: "build",
				})
				.requiresSource(),
		).toBe(true);
	},
);

test.each(["off", "shadow"] as const)(
	"%s historical scope blocker requires new genuine user direction",
	async (mode) => {
		const s = await failedTwice(1, true);
		const a = automatic(s, mode);
		expect(
			(
				await a.service("manager", "original").featureReset({
					request: {
						operationId: "scope-retry",
						expectedRevision: revision(s.repository),
						featureId: FEATURE,
					},
				})
			).status,
		).toBe("error");
		a.controller.observeMessage("host", "approved-scope-user", false);
		expect(
			(
				await a
					.service("directed-manager", "approved-scope-user")
					.featureReset({
						request: {
							operationId: "directed-scope-retry",
							expectedRevision: revision(s.repository),
							featureId: FEATURE,
						},
					})
			).status,
		).toBe("ok");
	},
);

test.each(["off", "shadow"] as const)(
	"%s stale pending review uses live source and only resets the same feature",
	async (mode) => {
		const repository = new MemorySessionRepository(),
			env = deterministicEnvironment();
		const manual = await approveSession(repository, env);
		await startReviewedRun(manual, repository, { suffix: "stale" });
		const a = automatic({ repository, env, manual }, mode);
		repository.sourceDigest = SOURCE_B;
		const reset = await a.service("manager", "original").featureReset({
			request: {
				operationId: "stale-reset",
				expectedRevision: revision(repository),
				featureId: FEATURE,
				nextFeatureId: FEATURE,
			},
		});
		expect(reset.status).toBe("ok");
		expect(repository.session?.runs.at(-1)?.state).toBe("active");
	},
);

test.each(["off", "shadow"] as const)(
	"%s stop fences old lineage and fresh manual closure remains available",
	async (mode) => {
		const s = await failedTwice();
		const a = automatic(s, mode);
		const old = a.service("old-manager", "original");
		await old.featureReset({
			request: {
				operationId: "bind-before-stop",
				expectedRevision: revision(s.repository),
				featureId: FEATURE,
			},
		});
		a.controller.revoke("host");
		expect(
			(
				await old.sessionClose({
					request: {
						operationId: "old-close",
						expectedRevision: revision(s.repository),
						sessionId: s.repository.session!.id,
						kind: "deferred",
					},
				})
			).status,
		).toBe("error");
		a.controller.observeMessage("host", "fresh-close-user", false);
		expect(
			(
				await a
					.service("fresh-close-manager", "fresh-close-user")
					.sessionClose({
						request: {
							operationId: "fresh-close",
							expectedRevision: revision(s.repository),
							sessionId: s.repository.session!.id,
							kind: "deferred",
						},
					})
			).status,
		).toBe("ok");
	},
);

test.each(["off", "shadow"] as const)(
	"%s changed approved binding revokes automatic authority",
	async (mode) => {
		const s = await failedTwice();
		const a = automatic(s, mode);
		const flow = a.service("manager", "original");
		await flow.featureReset({
			request: {
				operationId: "bind",
				expectedRevision: revision(s.repository),
				featureId: FEATURE,
			},
		});
		s.repository.session = {
			...s.repository.session!,
			goal: "Replacement goal",
		};
		const result = await flow.featureReset({
			request: {
				operationId: "changed-goal",
				expectedRevision: revision(s.repository),
				featureId: FEATURE,
			},
		});
		expect(result.status).toBe("error");
		expect(result.summary).toContain("approved plan changed");
		expect(a.controller.snapshot()).toMatchObject({
			automation: { active: false },
		});
	},
);

test.each(["off", "shadow"] as const)(
	"%s sanctioned prerequisite amendment preserves approved binding through repair and closure",
	async (mode) => {
		const s = await failedTwice(0);
		const a = automatic(s, mode);
		const flow = a.service("manager", "original");
		expect(
			(
				await flow.runStart({
					request: {
						operationId: "start-owned",
						expectedRevision: revision(s.repository),
						featureId: FEATURE,
					},
				})
			).status,
		).toBe("ok");
		const frozen = JSON.stringify(s.repository.session?.plan);
		const failed = await recordObservedValidation(s.repository, {
			captureId: "required-failure",
			exitCode: 1,
		});
		expect(
			(
				await flow.planAmend({
					request: {
						operationId: "own-prerequisite",
						expectedRevision: revision(s.repository),
						featureId: FEATURE,
						validationId: failed.id,
						reason: "Canonical gate exposes setup prerequisite",
						repair: "Repair reversible setup without changing gate",
						targets: ["setup.ts"],
						sameGoal: true,
						reversible: true,
					},
				})
			).status,
		).toBe("ok");
		expect(JSON.stringify(s.repository.session?.plan)).toBe(frozen);
		s.repository.sourceDigest = SOURCE_B;
		await recordObservedValidation(s.repository, {
			captureId: "repaired-required-pass",
		});
		expect(
			(
				await flow.reviewStart({
					request: {
						operationId: "review-repaired",
						expectedRevision: revision(s.repository),
						featureId: FEATURE,
						artifactsChanged: [{ path: "setup.ts" }],
						packet: {
							summary: "Review setup repair and unchanged gate",
							riskLenses: [],
						},
					},
				})
			).status,
		).toBe("ok");
		await submitReview(s.manual, s.repository, {
			suffix: "repaired",
			summary: "Setup fixed",
			verdict: "passed",
		});
		expect(
			(
				await flow.sessionClose({
					request: {
						operationId: "close-repaired",
						expectedRevision: revision(s.repository),
						sessionId: s.repository.session!.id,
						kind: "completed",
					},
				})
			).status,
		).toBe("ok");
		expect(a.controller.snapshot()).toMatchObject({
			automation: { active: false },
			advice: { inactiveReason: "closed" },
		});
	},
);

test("accepted failed inspection completion is not resettable in legacy, off or shadow", async () => {
	for (const mode of ["legacy", "off", "shadow"] as const) {
		const repository = new MemorySessionRepository(),
			env = deterministicEnvironment();
		const manual = await approveSession(repository, env, {
			plan: {
				...plan,
				features: plan.features.map((feature) => ({
					...feature,
					kind: "inspect",
				})),
			},
		});
		await startReviewedRun(manual, repository, { suffix: "inspect" });
		await submitReview(manual, repository, {
			suffix: "inspect",
			summary: "Survey findings",
			verdict: "failed",
			findings: [
				{
					severity: "blocking",
					summary: "Observed product defect",
					evidence: "fixture.ts:1",
				},
			],
		});
		expect(repository.session?.runs[0]?.state).toBe("completed");
		const flow =
			mode === "legacy"
				? manual
				: automatic({ repository, env, manual }, mode).service(
						"manager",
						"original",
					);
		const before = revision(repository);
		const reset = await flow.featureReset({
			request: {
				operationId: "inspect-reset",
				expectedRevision: before,
				featureId: FEATURE,
			},
		});
		expect(reset.status).toBe("error");
		expect(revision(repository)).toBe(before);
		if (mode === "legacy") expect(reset.summary).toContain("active or blocked");
	}
});

test("simulated missing parentage fails closed for auto but fresh manual flow-run still starts", async () => {
	const s = await failedTwice(0);
	const controller = new RecoveryController({
		async assess() {
			throw new Error("No provider allowed");
		},
	});
	const auto = new AutoDriveCoordinator({
		recovery: controller,
		readProjection: async () => ({
			sessionId: s.repository.session?.id,
			status: "ready",
			revision: revision(s.repository),
			nextAction: "flow_run_start",
		}),
		prompt: async () => {},
	});
	const hook = createCommandHook({
		autoDrive: auto,
		recovery: controller,
		flow: s.manual,
		assertOperational() {},
		defaultRecovery: () => null,
	});
	auto.observeHostMessage("host", {
		id: "unsupported-assistant",
		role: "assistant",
	});
	const parts: Parameters<typeof hook>[1] = { parts: [] };
	await hook(
		{
			command: "flow-auto",
			sessionID: "host",
			arguments: "Continue approved goal",
		},
		parts,
	);
	expect(JSON.stringify(parts)).toContain(
		"automatic mutations cannot be attributed",
	);
	controller.observeMessage("host", "auto-user", false);
	const unavailable = createFlowService(
		s.repository,
		s.env,
		controller.guard({
			hostSessionId: "host",
			messageId: "unparented",
			agent: "build",
		}),
	);
	expect(
		(
			await unavailable.runStart({
				request: {
					operationId: "unattributed-start",
					expectedRevision: revision(s.repository),
					featureId: FEATURE,
				},
			})
		).status,
	).toBe("error");
	await hook(
		{
			command: "flow-run",
			sessionID: "host",
			arguments: "Continue approved goal",
		},
		{ parts: [] },
	);
	controller.observeMessage("host", "manual-user", false);
	const manual = createFlowService(
		s.repository,
		s.env,
		controller.guard({
			hostSessionId: "host",
			messageId: "manual-unparented",
			agent: "build",
		}),
	);
	expect(
		(
			await manual.runStart({
				request: {
					operationId: "manual-start",
					expectedRevision: revision(s.repository),
					featureId: FEATURE,
				},
			})
		).status,
	).toBe("ok");
	expect(controller.snapshot()).toMatchObject({
		automation: { active: false },
	});
});

test.each(["success", "failure"] as const)(
	"late handback %s cannot replace fresh retry direction or its exact start",
	async (outcome) => {
		const s = await failedTwice();
		const a = automatic(s, "off");
		const id = s.repository.session!.id,
			current = revision(s.repository);
		let projection = {
			sessionId: id,
			status: "blocked",
			revision: current - 1,
			nextAction: "await-user-direction",
		};
		let count = 0,
			release: () => void = () => {},
			started: () => void = () => {};
		const pending = new Promise<void>((resolve) => {
			started = resolve;
		});
		let lateMetadata: Readonly<Record<string, unknown>> = {};
		const driver = new AutoDriveCoordinator({
			recovery: a.controller,
			createToken: () => "fixed-old-token",
			readProjection: async () => projection,
			prompt: async (host, _text, delivery, metadata) => {
				count++;
				if (count === 1) {
					await driver.observeMessage(
						host,
						delivery,
						[{ type: "text", synthetic: true, metadata }],
						"first-handback",
					);
					a.controller.observeMessage(host, "first-handback", true, true);
					return;
				}
				lateMetadata = metadata;
				started();
				await new Promise<void>((resolve, reject) => {
					release = () =>
						outcome === "failure"
							? reject(new Error("Obsolete prompt failed"))
							: resolve();
				});
			},
		});
		const delivery = {
			agent: "build",
			model: { providerID: "fixture", modelID: "scripted" },
		};
		const initial = await driver.activate("host");
		await driver.observeMessage(
			"host",
			delivery,
			[{ type: "text", synthetic: true, metadata: initial }],
			"original",
		);
		await driver.onIdle("host");
		projection = {
			sessionId: id,
			status: "blocked",
			revision: current,
			nextAction: "await-user-direction",
		};
		const idle = driver.onIdle("host");
		await pending;
		await driver.observeMessage(
			"host",
			delivery,
			[{ type: "text", text: "Retry the approved task once" }],
			"fresh-user",
		);
		a.controller.observeMessage("host", "fresh-user", false);
		const observed = await driver.observeMessage(
			"host",
			delivery,
			[{ type: "text", synthetic: true, metadata: lateMetadata }],
			"late-handback",
		);
		if (observed === "accepted-continuation")
			a.controller.observeMessage("host", "late-handback", true, true);
		release();
		await idle;
		expect(observed).toBe("stale-continuation");
		expect(driver.compactionContext("host")).not.toBeNull();
		const fresh = a.service("fresh-manager", "fresh-user");
		const reset = {
			operationId: "fresh-race-reset",
			expectedRevision: current,
			featureId: FEATURE,
		};
		expect((await fresh.featureReset({ request: reset })).status).toBe("ok");
		expect((await fresh.featureReset({ request: reset })).status).toBe("ok");
		expect(
			(
				await fresh.runStart({
					request: {
						operationId: "fresh-race-start",
						expectedRevision: revision(s.repository),
						featureId: FEATURE,
					},
				})
			).status,
		).toBe("ok");
		expect(s.repository.session!.runs).toHaveLength(3);
		await recordObservedValidation(s.repository, {
			captureId: "race-third-pass",
		});
		await s.manual.reviewStart({
			request: {
				operationId: "race-third-review",
				expectedRevision: revision(s.repository),
				featureId: FEATURE,
				artifactsChanged: [],
				packet: { summary: "Independent retry review", riskLenses: [] },
			},
		});
		const findingId =
			s.repository.session!.runs[0]!.reviews[0]!.result!.findings[0]!.findingId;
		await submitReview(s.manual, s.repository, {
			suffix: "race-third-failed",
			summary: "Guard still missing",
			verdict: "failed",
			findings: [
				{
					findingId,
					severity: "blocking",
					summary: "Input guard missing",
					evidence: "fixture.ts:1",
				},
			],
		});
		expect(
			(
				await fresh.featureReset({
					request: {
						operationId: "race-no-new-credit",
						expectedRevision: revision(s.repository),
						featureId: FEATURE,
					},
				})
			).status,
		).toBe("error");
	},
);

test("obsolete initial prompt failure preserves a renewed checkpoint reply", async () => {
	let release: () => void = () => {},
		started: () => void = () => {};
	const pending = new Promise<void>((resolve) => {
		started = resolve;
	});
	let initialMetadata: Readonly<Record<string, unknown>> = {};
	const driver = new AutoDriveCoordinator({
		readProjection: async () => ({
			status: "idle",
			revision: 0,
			nextAction: "flow_plan_save",
		}),
		prompt: async (host, _text, delivery, metadata) => {
			initialMetadata = metadata;
			await driver.observeMessage(
				host,
				delivery,
				[{ type: "text", synthetic: true, metadata }],
				"initial-route",
			);
			started();
			await new Promise<void>((_resolve, reject) => {
				release = () => reject(new Error("Obsolete initial prompt failed"));
			});
		},
	});
	const delivery = {
		agent: "build",
		model: { providerID: "fixture", modelID: "scripted" },
	};
	const metadata = await driver.activate("host");
	await driver.observeMessage(
		"host",
		delivery,
		[{ type: "text", synthetic: true, metadata }],
		"original",
	);
	const idle = driver.onIdle("host");
	await pending;
	await driver.observeMessage(
		"host",
		delivery,
		[{ type: "text", text: "Use the clarified approved goal" }],
		"fresh-user",
	);
	const observed = await driver.observeMessage(
		"host",
		delivery,
		[{ type: "text", synthetic: true, metadata: initialMetadata }],
		"late-initial",
	);
	release();
	await idle;
	expect(observed).toBe("stale-continuation");
	expect(driver.compactionContext("host")).not.toBeNull();
});

test.each([
	{ mode: "off", failures: 1 },
	{ mode: "off", failures: 2 },
	{ mode: "shadow", failures: 1 },
	{ mode: "shadow", failures: 2 },
] as const)(
	"authenticated compaction keeps $mode retry policy after $failures failed reviews",
	async ({ mode, failures }) => {
		const state = await failedTwice(failures);
		const authority = automatic(state, mode);
		const driver = new AutoDriveCoordinator({
			recovery: authority.controller,
			readProjection: async () => ({
				sessionId: state.repository.session?.id,
				status: "blocked",
				revision: revision(state.repository),
				nextAction:
					failures === 1 ? "flow_feature_reset" : "await-user-direction",
			}),
			prompt: async () => {},
		});
		const delivery = {
			agent: "build",
			model: { providerID: "fixture", modelID: "scripted" },
		};
		const metadata = await driver.activate("host");
		await driver.observeMessage(
			"host",
			delivery,
			[{ type: "text", synthetic: true, metadata }],
			"original",
		);
		driver.observeHostMessage("host", {
			id: "manager",
			role: "assistant",
			parentID: "original",
		});
		driver.observeHostPart("host", {
			type: "compaction",
			messageID: "compaction",
			auto: true,
		});
		const summary = {
			id: "summary",
			role: "assistant",
			parentID: "compaction",
			summary: true,
		};
		driver.observeHostMessage("host", summary);
		driver.observeHostMessage("host", {
			id: "original",
			role: "user",
			summary: { diffs: [] },
		});
		driver.observeHostMessage("host", summary);
		driver.observeHostMessage("host", { id: "successor", role: "user" });
		driver.observeHostMessage("host", {
			id: "original",
			role: "user",
			summary: { diffs: [] },
		});
		driver.observeHostPart("host", {
			type: "text",
			messageID: "successor",
			synthetic: true,
			metadata: { compaction_continue: true },
		});
		driver.observeCompaction("host");
		expect(driver.compactionContext("host")).not.toBeNull();
		const before = revision(state.repository);
		const result = await authority
			.service("successor-manager", "successor")
			.featureReset({
				request: {
					operationId: "after-native-compaction",
					expectedRevision: before,
					featureId: FEATURE,
					nextFeatureId: FEATURE,
				},
			});
		if (failures === 1) {
			expect(result.status).toBe("ok");
			expect(revision(state.repository)).toBe(before + 1);
		} else {
			expect(result.status).toBe("error");
			expect(result.summary).toBe(
				"This checkpoint requires explicit user direction or exact host-authorized recovery.",
			);
			expect(revision(state.repository)).toBe(before);
		}
	},
);
