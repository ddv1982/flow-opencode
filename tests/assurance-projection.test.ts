import { describe, expect, test } from "bun:test";
import { assuranceProjection } from "../src/application/delivery.js";
import type {
	ExternalEvidence,
	Session,
	SourceDigest,
} from "../src/domain/session.js";

const SOURCE = `sha256:${"a".repeat(64)}` as SourceDigest;
const OUTPUT = `sha256:${"b".repeat(64)}` as SourceDigest;

function completedSession(
	overrides: Readonly<{
		gate?: string | undefined;
		externalEvidence?: ExternalEvidence[] | undefined;
		includeGate?: boolean;
	}> = {},
): Session {
	const gate = overrides.gate ?? "bun test";
	const observation = {
		id: "validation-1",
		featureId: "delivery",
		runId: "run-1",
		scope: "broad" as const,
		command: gate,
		sourceDigest: SOURCE,
		exitCode: 0,
		outputDigest: OUTPUT,
		outputComplete: true,
		recordedRevision: 4,
		hostPlatform: "linux" as const,
		observedAssertions: [{ name: "acceptance", status: "passed" as const }],
	};
	return {
		version: 5,
		id: "session-1",
		revision: 7,
		goal: "Ship delivery",
		approval: "approved",
		plan: {
			summary: "Ship delivery.",
			overview: "Exercise assurance.",
			requirements: ["Acceptance passes."],
			decisions: ["Use the canonical gate."],
			...(overrides.includeGate === false ? {} : { gate }),
			...(overrides.externalEvidence === undefined
				? { externalEvidence: [] }
				: { externalEvidence: overrides.externalEvidence }),
			features: [
				{
					id: "delivery",
					title: "Delivery",
					summary: "Implement delivery.",
					targets: ["src"],
					validation: [gate],
					dependsOn: [],
				},
			],
		},
		runs: [
			{
				id: "run-1",
				featureId: "delivery",
				attempt: 1,
				state: "completed",
				startedRevision: 3,
				summary: "Delivered.",
				artifactsChanged: [{ path: "src/delivery.ts" }],
				validations: [observation],
				reviews: [
					{
						id: "review-1",
						operationId: "review-start-1",
						featureId: "delivery",
						runId: "run-1",
						kind: "final",
						sourceDigest: SOURCE,
						validationIds: [observation.id],
						packet: { summary: "Review.", riskLenses: ["correctness"] },
						createdRevision: 5,
						result: {
							verdict: "passed",
							findings: [],
							terminalDisposition: "submitted",
							recordedRevision: 6,
						},
					},
				],
			},
		],
		operations: [],
		closure: {
			kind: "completed",
			summary: "Shipped.",
			operationId: "close-1",
			recordedRevision: 7,
		},
	};
}

describe("assurance projection", () => {
	test("supports a completion with accepted gate, review, and feature evidence", () => {
		const assurance = assuranceProjection(completedSession());

		expect(assurance.conclusion).toBe("completion-supported");
		expect(assurance.checks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "recorded-completion",
					status: "satisfied",
					tier: "ts-enforced",
				}),
				expect.objectContaining({
					id: "accepted-validation",
					status: "satisfied",
					tier: "host-attested",
				}),
				expect.objectContaining({
					id: "canonical-gate",
					status: "satisfied",
				}),
			]),
		);
		expect(assurance.limitations).toContain(
			"Goal alignment, scope discipline, evidence completeness, requirement coverage, test adequacy, and review substance remain model judgments.",
		);
	});

	test("reports a contradictory completed document without throwing", () => {
		const session = completedSession();
		const contradictory: Session = {
			...session,
			runs: session.runs.map((run) => ({
				...run,
				validations: [],
				reviews: [],
			})),
		};

		const assurance = assuranceProjection(contradictory);

		expect(assurance.conclusion).toBe("completion-unsupported");
		expect(
			assurance.checks
				.filter((check) => check.status === "unsatisfied")
				.map((check) => check.id),
		).toEqual(
			expect.arrayContaining([
				"recorded-completion",
				"accepted-validation",
				"canonical-gate",
			]),
		);
	});

	test("does not claim completion for deferred or abandoned closure", () => {
		for (const kind of ["deferred", "abandoned"] as const) {
			const completed = completedSession();
			const closure = completed.closure;
			if (!closure) throw new Error("fixture must be closed");
			const session: Session = {
				...completed,
				closure: { ...closure, kind },
			};

			const assurance = assuranceProjection(session);
			expect(assurance.conclusion).toBe("completion-not-claimed");
			expect(
				assurance.checks.every((check) => check.status === "not-applicable"),
			).toBe(true);
		}
	});

	test("labels legacy declarations instead of inventing them", () => {
		const withPlan = completedSession({ includeGate: false });
		const legacy: Session = {
			...withPlan,
			plan: withPlan.plan
				? {
						...withPlan.plan,
						gate: undefined,
						externalEvidence: undefined,
					}
				: null,
		};

		const assurance = assuranceProjection(legacy);
		expect(assurance.conclusion).toBe("completion-supported");
		expect(assurance.checks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "canonical-gate",
					status: "not-applicable",
					tier: "caller-declared",
				}),
				expect.objectContaining({
					id: "external-evidence",
					status: "not-applicable",
				}),
			]),
		);
	});

	test("reports named external evidence as satisfied only on matching evidence", () => {
		const entry: ExternalEvidence = {
			requirement: "Acceptance case passes on Linux",
			environment: "Linux CI",
			platform: "linux",
			command: "bun test",
			assertions: ["acceptance"],
		};
		const supported = assuranceProjection(
			completedSession({ externalEvidence: [entry] }),
		);
		expect(supported.conclusion).toBe("completion-supported");
		expect(supported.checks).toContainEqual(
			expect.objectContaining({
				id: "external-evidence",
				status: "satisfied",
			}),
		);

		const session = completedSession({ externalEvidence: [entry] });
		const wrongHost: Session = {
			...session,
			runs: session.runs.map((run) => ({
				...run,
				validations: run.validations.map((validation) => ({
					...validation,
					hostPlatform: "darwin",
				})),
			})),
		};
		const unsupported = assuranceProjection(wrongHost);
		expect(unsupported.conclusion).toBe("completion-unsupported");
		expect(unsupported.checks).toContainEqual(
			expect.objectContaining({
				id: "external-evidence",
				status: "unsatisfied",
			}),
		);
	});
});
