import { expect, test } from "bun:test";
import { PlanSaveInputSchema } from "../src/application/schema.js";
import { plan } from "./runtime-test-support.js";

test("draft accepts separate exact-command supplemental observation checks without rewriting legacy prose", () => {
	const legacy = ["bun test", "Explain compatibility evidence", "bun test"];
	const input = PlanSaveInputSchema.safeParse({
		request: {
			operationId: "draft-observation-check",
			expectedRevision: 0,
			goal: "Ship the requested CI filter without adopting unrelated suggestions",
			plan: {
				...plan,
				features: plan.features.map((feature) => ({
					...feature,
					validation: legacy,
					checks: [
						{
							command: "uvx zizmor .github",
							intent: "observe",
							platform: "linux",
						},
					],
				})),
			},
		},
	});
	expect(input.success).toBe(true);
	if (!input.success) return;
	expect(input.data.request.plan.features[0]?.validation).toEqual(legacy);
});

import { planIssue } from "../src/domain/plan.js";
import { missingRequestAssertions } from "../src/domain/request-evidence.js";
import { reviewReadiness } from "../src/domain/review-readiness.js";
import type {
	Plan,
	Session,
	ValidationCheck,
	ValidationObservation,
} from "../src/domain/session.js";
import { sessionInvariantIssues } from "../src/domain/session-invariants.js";
import { activeRun } from "../src/domain/session-queries.js";
import { approvePlan, savePlan, startRun } from "../src/domain/transitions.js";
import {
	isAcceptedValidation,
	isValidationEligible,
	type PrerequisiteAmendmentEligibility,
	prerequisiteAmendmentEligibility,
	recordValidation,
	resolveValidationPolicy,
} from "../src/domain/validation.js";
import { OUTPUT, SOURCE_A, SOURCE_B } from "./runtime-test-support.js";

function declared(
	checks: ValidationCheck[],
	validation = ["Legacy prose was never executed"],
): Plan {
	return {
		...plan,
		features: plan.features.map((feature) => ({
			...feature,
			checks,
			validation,
		})),
	};
}
function running(checks: ValidationCheck[] = []): Session {
	let index = 0;
	const environment = { newId: (kind: string) => `${kind}-${++index}` };
	const draft = savePlan(
		null,
		{
			operationId: "save",
			expectedRevision: 0,
			goal: "Verify the declared outcome",
			plan: declared(checks),
		},
		environment,
	).session;
	const approved = approvePlan(draft, {
		operationId: "approve",
		expectedRevision: draft.revision,
	}).session;
	return startRun(
		approved,
		{ operationId: "run", expectedRevision: approved.revision },
		environment,
	).session;
}
function observe(
	session: Session,
	overrides: Partial<ValidationObservation> = {},
): Session {
	const run = activeRun(session);
	if (!run) throw new Error("Active run missing.");
	return recordValidation(session, {
		captureId: `capture-${session.revision}`,
		featureId: run.featureId,
		runId: run.id,
		scope: "broad",
		command: "bun test",
		sourceDigest: SOURCE_A,
		exitCode: 0,
		outputDigest: OUTPUT,
		outputComplete: true,
		hostPlatform: "linux",
		...overrides,
	}).session;
}
const survey: ValidationCheck = {
	command: "uvx zizmor .github",
	intent: "observe",
	platform: "linux",
};

test("supplemental failed observations complete a frozen typed check without replacing required validation", () => {
	let session = running([survey]);
	session = observe(session, {
		scope: "focused",
		command: survey.command,
		intent: "observe",
		exitCode: 12,
	});
	const run = activeRun(session)!;
	expect(isValidationEligible(run.validations[0]!)).toBe(false);
	expect(isAcceptedValidation(session, run.validations[0]!, SOURCE_A)).toBe(
		true,
	);
	expect(reviewReadiness(session, run, SOURCE_A).kind).toBe("needs-validation");
	session = observe(session);
	expect(reviewReadiness(session, activeRun(session)!, SOURCE_A).kind).toBe(
		"ready",
	);
	expect(session.plan?.features[0]?.validation).toEqual([
		"Legacy prose was never executed",
	]);
});

test("missing typed observations and stale, incomplete or wrong-host observations block review", () => {
	const complete = observe(running([survey]));
	expect(reviewReadiness(complete, activeRun(complete)!, SOURCE_A).kind).toBe(
		"checks-unsatisfied",
	);
	for (const overrides of [
		{ hostPlatform: "other" as const },
		{ outputComplete: false },
		{ sourceDigest: SOURCE_B },
		{ exitCode: null, ineligibleReason: "exit-code-unavailable" as const },
	]) {
		const session = observe(complete, {
			scope: "focused",
			command: survey.command,
			intent: "observe",
			exitCode: 3,
			...overrides,
		});
		expect(
			reviewReadiness(session, activeRun(session)!, SOURCE_A).kind,
		).not.toBe("ready");
	}
});

test("typed other requires the actual other host while legacy other remains a wildcard", () => {
	const other = { ...survey, platform: "other" as const };
	const wrong = observe(observe(running([other])), {
		scope: "focused",
		command: survey.command,
		intent: "observe",
		hostPlatform: "linux",
	});
	expect(reviewReadiness(wrong, activeRun(wrong)!, SOURCE_A).kind).not.toBe(
		"ready",
	);
	const right = observe(observe(running([other])), {
		scope: "focused",
		command: survey.command,
		intent: "observe",
		hostPlatform: "other",
	});
	expect(reviewReadiness(right, activeRun(right)!, SOURCE_A).kind).toBe(
		"ready",
	);
});

test("typed armed intent is mandatory and cannot downgrade a passing declaration", () => {
	const session = running([
		{ command: "check required", intent: "pass", platform: "linux" },
	]);
	for (const intent of [undefined, "observe"] as const)
		expect(() =>
			observe(session, { scope: "focused", command: "check required", intent }),
		).toThrow("frozen approved");
	const unhosted = running([survey]);
	expect(() =>
		observe(unhosted, {
			scope: "focused",
			command: survey.command,
			intent: "observe",
			hostPlatform: undefined,
		}),
	).toThrow("actual host");
	const good = observe(session, {
		scope: "focused",
		command: "check required",
		intent: "pass",
	});
	const corrupted = structuredClone(good);
	const { intent: _intent, ...legacyObservation } =
		corrupted.runs[0]!.validations[0]!;
	corrupted.runs[0]!.validations[0] = legacyObservation;
	expect(
		sessionInvariantIssues(corrupted).some((issue) =>
			issue.includes("frozen approved"),
		),
	).toBe(true);
});

test("identical check duplicates resolve once and conflicting intent, host or assertions reject drafts", () => {
	expect(planIssue(declared([survey, { ...survey }]))).toBeNull();
	const session = running([survey, { ...survey }]);
	expect(
		resolveValidationPolicy(
			session,
			activeRun(session)!.featureId,
			survey.command,
		),
	).toEqual({
		intent: "observe",
		platform: "linux",
		assertions: [],
		typed: true,
	});
	for (const check of [
		{ ...survey, intent: "pass" as const },
		{ ...survey, platform: "win32" as const },
		{ ...survey, assertions: ["case"] },
	])
		expect(planIssue(declared([survey, check]))).toContain("Conflicting");
	expect(planIssue(declared([survey], [survey.command]))).toContain(
		"required passing",
	);
	expect(planIssue(declared([{ ...survey, command: "bun test" }]))).toContain(
		"required passing",
	);
	expect(planIssue(declared([{ ...survey, assertions: ["named"] }]))).toContain(
		"named passing",
	);
});

test("legacy exact failures retain their veto and observations cannot retroactively replace them", () => {
	let session = running();
	session = {
		...session,
		plan: {
			...session.plan!,
			features: session.plan!.features.map((feature) => ({
				...feature,
				validation: ["failed legacy", "unexecuted prose", "failed legacy"],
			})),
		},
	};
	session = observe(session, {
		scope: "focused",
		command: "failed legacy",
		exitCode: 1,
	});
	session = observe(session);
	expect(reviewReadiness(session, activeRun(session)!, SOURCE_A)).toEqual({
		kind: "vetoed",
		commands: ["failed legacy"],
	});
	expect(() =>
		observe(session, {
			scope: "focused",
			command: "failed legacy",
			intent: "observe",
			exitCode: 0,
		}),
	).toThrow("frozen approved");
});

test("request assertion coverage and typed passing evidence require the named report result", () => {
	const command =
		"bun test --reporter=junit --reporter-outfile=.flow/results.xml";
	const check: ValidationCheck = {
		command,
		intent: "pass",
		platform: "linux",
		assertions: ["Accepted case"],
	};
	expect(
		missingRequestAssertions(declared([check]), [
			"Accepted case",
			"Missing case",
		]),
	).toEqual(["Missing case"]);
	const initial = observe(running([check]));
	const absent = observe(initial, {
		scope: "focused",
		command,
		intent: "pass",
		resultsPath: ".flow/results.xml",
	});
	expect(reviewReadiness(absent, activeRun(absent)!, SOURCE_A).kind).not.toBe(
		"ready",
	);
	const passed = observe(initial, {
		scope: "focused",
		command,
		intent: "pass",
		resultsPath: ".flow/results.xml",
		observedAssertions: [{ name: "Accepted case", status: "passed" }],
	});
	expect(reviewReadiness(passed, activeRun(passed)!, SOURCE_A).kind).toBe(
		"ready",
	);
});

test("shared prerequisite eligibility preserves current-source canonical failure and gate-observe exclusions", () => {
	const failed = observe(running(), { exitCode: 1 });
	const run = activeRun(failed)!;
	const eligible: PrerequisiteAmendmentEligibility =
		prerequisiteAmendmentEligibility(
			failed,
			run.featureId,
			run.validations[0]!.id,
			SOURCE_A,
		);
	expect(eligible.eligible).toBe(true);
	if (eligible.eligible)
		expect(eligible.observation.id).toBe(run.validations[0]!.id);
	expect(
		prerequisiteAmendmentEligibility(
			failed,
			run.featureId,
			run.validations[0]!.id,
			SOURCE_B,
		).eligible,
	).toBe(false);
	const passed = observe(failed);
	expect(
		prerequisiteAmendmentEligibility(
			passed,
			run.featureId,
			run.validations[0]!.id,
			SOURCE_A,
		).eligible,
	).toBe(false);
	const observed: Session = {
		...failed,
		plan: {
			...failed.plan!,
			features: failed.plan!.features.map((feature) => ({
				...feature,
				kind: "inspect",
			})),
			evidence: failed.plan!.evidence!.map((entry) => ({
				...entry,
				scope: "gate-observe",
			})),
		},
	};
	expect(
		prerequisiteAmendmentEligibility(
			observed,
			run.featureId,
			run.validations[0]!.id,
			SOURCE_A,
		).eligible,
	).toBe(false);
});

import { completeFeature, startReview } from "../src/domain/transitions.js";

test("persisted assignments require their own typed check IDs before completion", () => {
	let session = observe(running([survey]));
	session = observe(session, {
		scope: "focused",
		command: survey.command,
		intent: "observe",
		exitCode: 2,
	});
	const run = activeRun(session)!;
	const review = startReview(
		session,
		{
			operationId: "review",
			expectedRevision: session.revision,
			featureId: run.featureId,
			sourceDigest: SOURCE_A,
			artifactsChanged: [],
			packet: { summary: "Review the declared outcome", riskLenses: [] },
		},
		{ newId: () => "review-id" },
	);
	for (const removeObservation of [false, true]) {
		const corrupted = structuredClone(review.session);
		const assigned = corrupted.runs[0]!.reviews[0]!;
		corrupted.runs[0] = {
			...corrupted.runs[0]!,
			validations: corrupted.runs[0]!.validations.filter(
				(observation) =>
					!removeObservation || observation.command !== survey.command,
			),
			reviews: [
				{
					...assigned,
					validationIds: assigned.validationIds.filter(
						(id) =>
							id !==
							run.validations.find((entry) => entry.command === survey.command)!
								.id,
					),
				},
			],
		};
		expect(
			sessionInvariantIssues(corrupted).some((issue) =>
				issue.includes("lacks referenced typed check"),
			),
		).toBe(true);
		expect(() =>
			completeFeature(corrupted, {
				operationId: "complete",
				expectedRevision: corrupted.revision,
				featureId: run.featureId,
				assignmentId: assigned.id,
				summary: "Done",
				result: {
					verdict: "passed",
					terminalDisposition: "submitted",
					findings: [],
				},
			}),
		).toThrow("lacks referenced typed check");
	}
});

test("check policies are independent by feature and another feature's observation cannot clear a legacy veto", () => {
	let index = 0;
	const environment = { newId: (kind: string) => `${kind}-${++index}` };
	const featureA = declared([survey]).features[0]!;
	const featureB = {
		...featureA,
		id: "second-feature",
		checks: [],
		validation: [survey.command],
		dependsOn: [featureA.id],
	};
	const specification = { ...plan, features: [featureA, featureB] };
	expect(planIssue(specification)).toBeNull();
	let session = savePlan(
		null,
		{
			operationId: "save",
			expectedRevision: 0,
			goal: "Independently validate both features",
			plan: specification,
		},
		environment,
	).session;
	session = approvePlan(session, {
		operationId: "approve",
		expectedRevision: session.revision,
	}).session;
	session = startRun(
		session,
		{ operationId: "run-a", expectedRevision: session.revision },
		environment,
	).session;
	session = observe(session, {
		scope: "focused",
		command: survey.command,
		intent: "observe",
		exitCode: 12,
	});
	session = observe(session);
	const review = startReview(
		session,
		{
			operationId: "review-a",
			expectedRevision: session.revision,
			featureId: featureA.id,
			sourceDigest: SOURCE_A,
			artifactsChanged: [],
			packet: { summary: "First feature", riskLenses: [] },
		},
		environment,
	);
	session = completeFeature(review.session, {
		operationId: "complete-a",
		expectedRevision: review.session.revision,
		featureId: featureA.id,
		assignmentId: review.value.id,
		summary: "First done",
		result: {
			verdict: "passed",
			terminalDisposition: "submitted",
			findings: [],
		},
	}).session;
	session = startRun(
		session,
		{ operationId: "run-b", expectedRevision: session.revision },
		environment,
	).session;
	session = observe(session, {
		scope: "focused",
		command: survey.command,
		exitCode: 12,
	});
	session = observe(session);
	expect(
		resolveValidationPolicy(session, featureA.id, survey.command).intent,
	).toBe("observe");
	expect(
		resolveValidationPolicy(session, featureB.id, survey.command).intent,
	).toBe("pass");
	expect(reviewReadiness(session, activeRun(session)!, SOURCE_A)).toEqual({
		kind: "vetoed",
		commands: [survey.command],
	});
});

test("all-inspection canonical observations retain their legacy exception and refuse typed passing replacements", () => {
	const canonical = { ...survey, command: "bun test" };
	const inspected = {
		...declared([canonical], ["bun test"]),
		features: declared([canonical], ["bun test"]).features.map((feature) => ({
			...feature,
			kind: "inspect" as const,
		})),
		evidence: plan.evidence!.map((entry) => ({
			...entry,
			scope: "gate-observe" as const,
		})),
	};
	expect(planIssue(inspected)).toBeNull();
	expect(
		planIssue({
			...inspected,
			features: inspected.features.map((feature) => ({
				...feature,
				checks: [{ ...canonical, intent: "pass" }],
			})),
		}),
	).toContain("cannot replace");
	let index = 0;
	const environment = { newId: (kind: string) => `${kind}-${++index}` };
	let session = savePlan(
		null,
		{
			operationId: "save",
			expectedRevision: 0,
			goal: "Inspect current repository evidence",
			plan: inspected,
		},
		environment,
	).session;
	session = approvePlan(session, {
		operationId: "approve",
		expectedRevision: session.revision,
	}).session;
	session = startRun(
		session,
		{ operationId: "run", expectedRevision: session.revision },
		environment,
	).session;
	session = observe(session, { intent: "observe", exitCode: 1 });
	expect(reviewReadiness(session, activeRun(session)!, SOURCE_A).kind).toBe(
		"ready",
	);
});

test("assignment freshness sees pre-creation failures without rewriting history from later observations", () => {
	const check: ValidationCheck = {
		command: "typed pass",
		intent: "pass",
		platform: "linux",
	};
	let session = observe(running([check]), {
		scope: "focused",
		command: check.command,
		intent: "pass",
	});
	session = observe(session);
	const run = activeRun(session)!;
	const assigned = startReview(
		session,
		{
			operationId: "review",
			expectedRevision: session.revision,
			featureId: run.featureId,
			sourceDigest: SOURCE_A,
			artifactsChanged: [],
			packet: { summary: "Typed proof", riskLenses: [] },
		},
		{ newId: () => "review-as-of" },
	).session;
	const assignment = assigned.runs[0]!.reviews[0]!;
	for (const recordedRevision of [
		assignment.createdRevision - 1,
		assignment.createdRevision + 1,
	]) {
		const forged: Session = {
			...assigned,
			revision: Math.max(assigned.revision, recordedRevision),
			runs: assigned.runs.map((candidate) => ({
				...candidate,
				validations: [
					...candidate.validations,
					{
						...run.validations[0]!,
						id: "later-failure",
						exitCode: 1,
						recordedRevision,
					},
				],
			})),
		};
		expect(
			sessionInvariantIssues(forged).some((issue) =>
				issue.includes("lacks referenced typed check"),
			),
		).toBe(recordedRevision < assignment.createdRevision);
	}
});

test("legacy observed canonical host policy freezes its OS and preserves other wildcard hydration", () => {
	for (const platform of ["win32", "other"] as const) {
		const session: Session = {
			...running(),
			plan: {
				...plan,
				features: plan.features.map((feature) => ({
					...feature,
					kind: "inspect",
				})),
				evidence: plan.evidence!.map((entry) => ({
					...entry,
					scope: "gate-observe",
					platform,
				})),
			},
		};
		const policy = resolveValidationPolicy(
			session,
			activeRun(session)!.featureId,
			"bun test",
		);
		expect(policy.intent).toBe("observe");
		expect(policy.typed).toBe(false);
		expect(policy.platform).toBe(platform === "other" ? undefined : "win32");
		const captured = observe(session, { exitCode: 1, hostPlatform: "linux" });
		expect(
			isAcceptedValidation(
				captured,
				activeRun(captured)!.validations[0]!,
				SOURCE_A,
			),
		).toBe(platform === "other");
	}
});

test("canonical passing host is frozen and wrong-host failure cannot authorize an amendment", () => {
	const initial: Session = {
		...running(),
		plan: {
			...plan,
			evidence: plan.evidence!.map((entry) => ({
				...entry,
				platform: "win32",
			})),
		},
	};
	const run = activeRun(initial)!;
	expect(
		resolveValidationPolicy(initial, run.featureId, "bun test").platform,
	).toBe("win32");
	const failed = observe(initial, { exitCode: 1, hostPlatform: "linux" });
	const eligibility = prerequisiteAmendmentEligibility(
		failed,
		run.featureId,
		activeRun(failed)!.validations[0]!.id,
		SOURCE_A,
	);
	expect(eligibility.eligible).toBe(false);
	if (!eligibility.eligible)
		expect(eligibility.reason).toContain("declared host");
	const passed = observe(initial, { hostPlatform: "linux" });
	expect(reviewReadiness(passed, activeRun(passed)!, SOURCE_A).kind).not.toBe(
		"ready",
	);
	const extra: Session = {
		...initial,
		plan: {
			...initial.plan!,
			evidence: [
				...initial.plan!.evidence!,
				{
					command: "remote checks",
					requirement: "Both hosts",
					environment: "Remote",
					scope: "extra",
					platform: "linux",
					assertions: [],
				},
				{
					command: "remote checks",
					requirement: "Both hosts",
					environment: "Remote",
					scope: "extra",
					platform: "win32",
					assertions: [],
				},
			],
		},
	};
	expect(
		resolveValidationPolicy(extra, run.featureId, "remote checks").platform,
	).toBeUndefined();
});

test.each([
	[
		"linux",
		"darwin",
		"Typed check 'bun test' on linux conflicts with evidence declared on darwin.",
	],
	[
		"other",
		"linux",
		"Typed check 'bun test' on other conflicts with evidence declared on linux.",
	],
] as const)(
	"typed %s command host conflicting with %s evidence rejects approval",
	(host, evidenceHost, issue) => {
		const check: ValidationCheck = {
			command: "bun test",
			intent: "pass",
			platform: host,
		};
		const conflicting = {
			...declared([check], [check.command]),
			evidence: plan.evidence?.map((entry) => ({
				...entry,
				platform: evidenceHost,
			})),
		};
		expect(planIssue(conflicting)).toBe(issue);
		expect(() =>
			savePlan(
				null,
				{
					operationId: "conflicting-host",
					expectedRevision: 0,
					goal: "Complete the requested change",
					plan: conflicting,
				},
				{ newId: () => "session" },
			),
		).toThrow(issue);
	},
);

test.each(["linux", "other"] as const)(
	"matching or legacy wildcard evidence host %s admits a typed check and passing review",
	(platform) => {
		const check: ValidationCheck = {
			command: "bun test",
			intent: "pass",
			platform: "linux",
		};
		const proposed: Plan = {
			...declared([check], [check.command]),
			evidence: plan.evidence?.map((entry) => ({ ...entry, platform })),
		};
		expect(planIssue(proposed)).toBeNull();
		const environment = { newId: (kind: string) => `${kind}-host` };
		const draft = savePlan(
			null,
			{
				operationId: "save-host",
				expectedRevision: 0,
				goal: "Complete the requested change",
				plan: proposed,
			},
			environment,
		).session;
		const approved = approvePlan(draft, {
			operationId: "approve-host",
			expectedRevision: draft.revision,
		}).session;
		const started = startRun(
			approved,
			{ operationId: "start-host", expectedRevision: approved.revision },
			environment,
		).session;
		const validated = observe(started, {
			command: check.command,
			intent: "pass",
		});
		const run = activeRun(validated);
		if (!run) throw new Error("Active run is missing.");
		expect(reviewReadiness(validated, run, SOURCE_A)).toMatchObject({
			kind: "ready",
		});
	},
);

test("legacy unspecified evidence host remains compatible with an already stored typed policy", () => {
	const check: ValidationCheck = {
		command: "bun test",
		intent: "pass",
		platform: "linux",
	};
	const existing = running([check]);
	if (!existing.plan) throw new Error("Approved plan is missing.");
	const legacy: Session = {
		...existing,
		plan: {
			...existing.plan,
			evidence: existing.plan.evidence?.map((entry) => ({
				...entry,
				platform: undefined,
			})),
		},
	};
	if (!legacy.plan) throw new Error("Legacy plan is missing.");
	expect(planIssue(legacy.plan)).toBeNull();
	const validated = observe(legacy, { intent: "pass" });
	const run = activeRun(validated);
	if (!run) throw new Error("Active run is missing.");
	expect(reviewReadiness(validated, run, SOURCE_A)).toMatchObject({
		kind: "ready",
	});
});

test("an approved named canonical gate failure remains eligible for current-source prerequisite repair", () => {
	const command =
		"bun test --reporter=junit --reporter-outfile=.flow/results.xml";
	const check: ValidationCheck = {
		command,
		intent: "pass",
		platform: "linux",
		assertions: ["required case"],
	};
	const proposed: Plan = {
		...declared([check], [command]),
		evidence: plan.evidence?.map((entry) => ({
			...entry,
			command,
			platform: "linux",
			assertions: check.assertions,
		})),
	};
	const environment = { newId: (kind: string) => `${kind}-named` };
	const draft = savePlan(
		null,
		{
			operationId: "save-named",
			expectedRevision: 0,
			goal: "Complete the requested change",
			plan: proposed,
		},
		environment,
	).session;
	const approved = approvePlan(draft, {
		operationId: "approve-named",
		expectedRevision: draft.revision,
	}).session;
	const started = startRun(
		approved,
		{ operationId: "start-named", expectedRevision: approved.revision },
		environment,
	).session;
	const failed = observe(started, {
		command,
		intent: "pass",
		exitCode: 1,
		resultsPath: ".flow/results.xml",
		observedAssertions: [{ name: "required case", status: "failed" }],
	});
	const run = activeRun(failed),
		validation = run?.validations[0];
	if (!run || !validation) throw new Error("Canonical validation is missing.");
	expect(reviewReadiness(failed, run, SOURCE_A).kind).not.toBe("ready");
	expect(
		prerequisiteAmendmentEligibility(
			failed,
			run.featureId,
			validation.id,
			SOURCE_A,
		).eligible,
	).toBe(true);
	expect(
		prerequisiteAmendmentEligibility(
			failed,
			run.featureId,
			validation.id,
			SOURCE_B,
		).eligible,
	).toBe(false);
});

test("different exact commands may declare different validation hosts", () => {
	const proposed: Plan = {
		...declared([{ command: "cargo test", intent: "pass", platform: "linux" }]),
		evidence: plan.evidence?.map((entry) => ({ ...entry, platform: "darwin" })),
	};
	expect(planIssue(proposed)).toBeNull();
});
