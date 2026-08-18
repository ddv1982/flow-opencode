import { describe, expect, test } from "bun:test";
import { assuranceProjection } from "../src/application/delivery.js";
import type {
	EvidenceEntry,
	Session,
	SourceDigest,
} from "../src/domain/session.js";

const SOURCE = `sha256:${"a".repeat(64)}` as SourceDigest;
const OUTPUT = `sha256:${"b".repeat(64)}` as SourceDigest;

function completedSession(
	overrides: Readonly<{
		gate?: string | undefined;
		extraEvidence?: Omit<EvidenceEntry, "scope">[] | undefined;
		includeEvidence?: boolean;
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
	const extras = (overrides.extraEvidence ?? []).map((entry) => ({
		...entry,
		scope: "extra" as const,
	}));
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
			...(overrides.includeEvidence === false
				? {}
				: {
						evidence: [
							{
								scope: "gate" as const,
								requirement: "Repository suite",
								environment: "this host",
								command: gate,
								platform: "other" as const,
								assertions: [],
							},
							...extras,
						],
					}),
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

	test("labels missing declarations instead of inventing them", () => {
		const legacy: Session = completedSession({ includeEvidence: false });

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
					id: "declared-evidence",
					status: "not-applicable",
				}),
			]),
		);
	});

	test("reports named extra evidence as satisfied only on matching evidence", () => {
		const entry = {
			requirement: "Acceptance case passes on Linux",
			environment: "Linux CI",
			platform: "linux" as const,
			command: "bun test",
			assertions: ["acceptance"],
		};
		const supported = assuranceProjection(
			completedSession({ extraEvidence: [entry] }),
		);
		expect(supported.conclusion).toBe("completion-supported");
		expect(supported.checks).toContainEqual(
			expect.objectContaining({
				id: "declared-evidence",
				status: "satisfied",
			}),
		);

		const session = completedSession({ extraEvidence: [entry] });
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
				id: "declared-evidence",
				status: "unsatisfied",
			}),
		);
	});
});
