import { describe, expect, test } from "bun:test";
import { SessionSchema } from "../src/application/schema.js";
import { extractExplicitRequestAssertions } from "../src/domain/request-evidence.js";
import type { Plan, SourceDigest } from "../src/domain/session.js";
import {
	anchorRequest,
	approvePlan,
	savePlan,
	type TransitionEnvironment,
} from "../src/domain/transitions.js";

const sha = (value: string) => `sha256:${value.repeat(64)}` as SourceDigest;
const hostA = { hostSessionSha256: sha("a") };
const hostB = { hostSessionSha256: sha("b") };
const environment: TransitionEnvironment = {
	newId: (kind) => `${kind}-request-anchor`,
};
const plan = (assertions: string[]): Plan => ({
	summary: "Honor named acceptance.",
	overview: "Bind the requested case to evidence.",
	requirements: ["Run the named case."],
	decisions: [],
	features: [
		{
			id: "named-case",
			title: "Named case",
			summary: "Keep the exact acceptance name.",
			targets: ["src/value.ts"],
			validation: ["Run the gate."],
			dependsOn: [],
		},
	],
	evidence: [
		{
			requirement: "Repository gate",
			environment: "Linux",
			command: "bun test --reporter=junit --reporter-outfile=.flow/results.xml",
			scope: "gate",
			platform: "linux",
			assertions,
		},
	],
});

describe("authoritative request evidence", () => {
	test("extracts only explicitly named acceptance assertions", () => {
		expect(
			extractExplicitRequestAssertions(
				'Acceptance has a case named `linux-skipped observation` and test named "writes the file". Edit `src/platform.ts`.',
			),
		).toEqual(["linux-skipped observation", "writes the file"]);
		expect(
			extractExplicitRequestAssertions(
				"Use `bun test`; the acceptance behavior is creatability.",
			),
		).toEqual([]);
	});

	test("deduplicates exact names but preserves distinct spelling", () => {
		expect(
			extractExplicitRequestAssertions(
				"case named 'one'; assertion named 'one'; test case named 'One'",
			),
		).toEqual(["one", "One"]);
	});

	test("anchors the request before planning and binds pending mutations to its host", () => {
		const anchored = anchorRequest(
			null,
			{
				goal: "Original host request",
				evidence: {
					requestSha256: sha("c"),
					hostSessionSha256: hostA.hostSessionSha256,
					assertions: ["linux-skipped observation"],
				},
			},
			environment,
		);
		expect(anchored).toMatchObject({ revision: 0, plan: null });
		expect(SessionSchema.parse(anchored).requestEvidence?.assertions).toEqual([
			"linux-skipped observation",
		]);
		expect(() =>
			savePlan(
				anchored,
				{
					operationId: "save-wrong-host",
					expectedRevision: 0,
					goal: "Concise goal",
					plan: plan([]),
				},
				environment,
				hostB,
			),
		).toThrow("originating OpenCode session");
	});

	test("allows draft repair but refuses approval until exact evidence is declared", () => {
		const anchored = anchorRequest(
			null,
			{
				goal: "Original request",
				evidence: {
					requestSha256: sha("d"),
					hostSessionSha256: hostA.hostSessionSha256,
					assertions: ["linux-skipped observation"],
				},
			},
			environment,
		);
		const saved = savePlan(
			anchored,
			{
				operationId: "save-incomplete",
				expectedRevision: 0,
				goal: "Concise goal",
				plan: plan([]),
			},
			environment,
			hostA,
		).session;
		expect(() =>
			approvePlan(
				saved,
				{ operationId: "approve-incomplete", expectedRevision: 1 },
				hostA,
			),
		).toThrow("linux-skipped observation");
		const repaired = savePlan(
			saved,
			{
				operationId: "save-repaired",
				expectedRevision: 1,
				goal: "Concise goal",
				plan: plan(["linux-skipped observation"]),
			},
			environment,
			hostA,
		).session;
		expect(
			approvePlan(
				repaired,
				{ operationId: "approve-repaired", expectedRevision: 2 },
				hostA,
			).session.approval,
		).toBe("approved");
	});

	test("rejects a named request while another plan owns the workspace", () => {
		const existing = savePlan(
			null,
			{
				operationId: "legacy-save",
				expectedRevision: 0,
				goal: "Existing work",
				plan: plan([]),
			},
			environment,
		).session;
		expect(() =>
			anchorRequest(
				existing,
				{
					goal: "New named work",
					evidence: {
						requestSha256: sha("e"),
						hostSessionSha256: hostA.hostSessionSha256,
						assertions: ["must-run"],
					},
				},
				environment,
			),
		).toThrow("already owns this workspace");
	});
});
