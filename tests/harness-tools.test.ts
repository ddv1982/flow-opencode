import { describe, expect, test } from "bun:test";
import { tool } from "@opencode-ai/plugin";
import {
	AUDIT_LEDGER_V1,
	AuditLedgerV1Schema,
	MAX_AUDIT_LEDGER_UTF8_BYTES,
} from "../src/domain/audit-ledger.js";
import type { ValidationReceiptRef } from "../src/domain/validation-receipt.js";
import { createHarnessTools } from "../src/platform/opencode/harness-tools.js";
import {
	OrchestrationAdmissionCoordinator,
	orchestrationPolicy,
} from "../src/platform/opencode/orchestration-admission.js";
import { ValidationCaptureCoordinator } from "../src/platform/opencode/validation-capture.js";

const receiptRef: ValidationReceiptRef = {
	kind: "validation_receipt_ref_v1",
	digest: `sha256:${"b".repeat(64)}`,
	byteLength: 12,
};

function tools(options: { preparedAt?: (workspace: string) => void } = {}) {
	return createHarnessTools({
		orchestration: new OrchestrationAdmissionCoordinator({
			policy: orchestrationPolicy({ profile: "standard", rollout: "observe" }),
		}),
		validation: new ValidationCaptureCoordinator({
			publishReceipt: () => Promise.resolve(receiptRef),
		}),
		prepareValidation: (workspace) => {
			options.preparedAt?.(workspace);
			return Promise.resolve({
				featureRunId: "feature-run:1",
				featureId: "feature-1",
				sourceDigest: `sha256:${"a".repeat(64)}`,
			});
		},
	});
}

const context = {
	sessionID: "session-1",
	// Pinned OpenCode can report `/` as the project worktree while retaining the
	// concrete session directory. Flow must use the first safe non-root value.
	worktree: "/",
	directory: import.meta.dir,
} as never;

function auditFinding(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: "E2E-01",
		title: "End-to-end validation misses a branch",
		summary: "The broad validation command does not exercise the failure path.",
		sourceLocators: [{ file: "src/runner.ts", symbol: "run", line: 20 }],
		proofState: "source_proven",
		reachability: "failure_path",
		deploymentContext: {
			exposure: "deployed",
			description: "Used by the normal validation command.",
		},
		trigger: "The changed source enters the failure branch.",
		guardsAndRecovery: {
			effectiveness: "partial",
			evidence: "Only the targeted test covers this branch.",
		},
		disposition: "confirmed",
		impact: {
			level: "major",
			description: "A release may carry an untested regression.",
		},
		severity: "high",
		actionPriority: "next",
		confidence: "high",
		falsifier: "Show that the broad command asserts this branch.",
		remediation: "Add the branch to the existing broad command.",
		...overrides,
	};
}

function auditLedger(...findings: Array<Record<string, unknown>>) {
	return { version: AUDIT_LEDGER_V1, findings };
}

function auditHostSchema() {
	const render = tools().flow_audit_render;
	if (!render) throw new Error("missing audit tool");
	return tool.schema.object(render.args).strict();
}

async function executeAudit(args: unknown): Promise<Record<string, unknown>> {
	const render = tools().flow_audit_render;
	if (!render) throw new Error("missing audit tool");
	return JSON.parse(String(await render.execute(args as never, context)));
}

describe("Flow harness tools", () => {
	test("exposes bounded orchestration, validation, and audit surfaces", () => {
		expect(Object.keys(tools()).sort()).toEqual([
			"flow_audit_render",
			"flow_orchestration_admit",
			"flow_validation_start",
		]);
	});

	test("evaluates and arms an orchestration proposal", async () => {
		const admit = tools().flow_orchestration_admit;
		if (!admit) throw new Error("missing admission tool");
		const output = JSON.parse(
			String(
				await admit.execute(
					{
						proposal: {
							policyVersion: 1,
							proposalId: "discovery-1",
							passKind: "discovery",
							slices: [{ sliceId: "slice-1", scopeIds: ["scope-1"] }],
							targetClaimIds: [],
							verificationTier: "none",
							workerCount: 1,
							dependsOn: [],
							writeScope: "none",
							implementationAuthorized: false,
							waveIndex: 1,
							scope: "broad",
							reasonCodes: [],
						},
					},
					context,
				),
			),
		);
		expect(output).toMatchObject({
			status: "ok",
			evaluation: { recommendation: "allow" },
		});
		expect(output.admissionId).toBeString();
	});

	test("arms validation without caller-authored result metadata", async () => {
		let preparedAt = "";
		const start = tools({
			preparedAt: (workspace) => {
				preparedAt = workspace;
			},
		}).flow_validation_start;
		if (!start) throw new Error("missing validation tool");
		const output = JSON.parse(
			String(
				await start.execute(
					{
						expectedRevision: 3,
						expectedSnapshotId: `sha256:${"c".repeat(64)}`,
						featureId: "feature-1",
						command: "bun test tests/unit.test.ts",
						coverageScope: "focused",
						environmentKeys: ["CI"],
					},
					context,
				),
			),
		);
		expect(output.status).toBe("ok");
		expect(preparedAt).toBe(import.meta.dir);
		expect(output.capture).not.toHaveProperty("startedAt");
		expect(output.capture).not.toHaveProperty("exitCode");
		expect(output.capture).not.toHaveProperty("outputDigest");
	});

	test("renders a validated empty audit ledger", async () => {
		const render = tools().flow_audit_render;
		if (!render) throw new Error("missing audit tool");
		const output = JSON.parse(
			String(
				await render.execute(
					{ ledger: { version: "audit-ledger/v1", findings: [] } },
					context,
				),
			),
		);
		expect(output.status).toBe("ok");
		expect(output.summary.total).toBe(0);
		expect(output.markdown).toContain("No findings.");
	});

	test("publishes a strict host-native audit construction schema", () => {
		const schema = tool.schema.toJSONSchema(auditHostSchema()) as {
			properties?: Record<string, unknown>;
		};
		const ledgerSchema = schema.properties?.ledger as {
			additionalProperties?: boolean;
			properties?: Record<string, unknown>;
		};

		expect(ledgerSchema.additionalProperties).toBe(false);
		expect(Object.keys(ledgerSchema.properties ?? {}).sort()).toEqual([
			"findings",
			"version",
		]);
		expect(JSON.stringify(ledgerSchema)).toContain("sourceLocators");
		expect(JSON.stringify(ledgerSchema)).toContain("actionPriority");
	});

	test("keeps host and domain audit acceptance in exact parity", () => {
		const oversized = auditLedger(
			...Array.from({ length: 66 }, (_, index) =>
				auditFinding({ id: `BUDGET-${index}`, summary: "x".repeat(3_400) }),
			),
		);
		const cases = [
			{ value: auditLedger(auditFinding()), accepted: true },
			{
				value: auditLedger(
					auditFinding({
						disposition: "refuted",
						impact: { level: "none", description: "The claim is false." },
						severity: "informational",
						actionPriority: "none",
					}),
				),
				accepted: false,
			},
			{
				value: auditLedger(
					auditFinding({ sourceLocators: [{ file: "../private.ts" }] }),
				),
				accepted: false,
			},
			{
				value: auditLedger(
					auditFinding({
						sourceLocators: [
							{ file: "src/runner.ts", line: 20, unexpected: true },
						],
					}),
				),
				accepted: false,
			},
			{ value: oversized, accepted: false },
		];

		for (const candidate of cases) {
			const domainAccepted = AuditLedgerV1Schema.safeParse(
				candidate.value,
			).success;
			const hostAccepted = auditHostSchema().safeParse({
				ledger: candidate.value,
			}).success;
			expect({ domainAccepted, hostAccepted }).toEqual({
				domainAccepted: candidate.accepted,
				hostAccepted: candidate.accepted,
			});
		}
	});

	test("rejects invalid outer envelopes and invalid ledgers", async () => {
		const outer = await executeAudit({
			ledger: auditLedger(),
			unexpected: true,
		});
		const invalidLedger = await executeAudit({
			ledger: auditLedger(
				auditFinding({ sourceLocators: [{ file: "/private/source.ts" }] }),
			),
		});

		expect(outer.status).toBe("error");
		expect(invalidLedger.status).toBe("error");
	});

	test("rejects oversized input and rendered Markdown without emitting it", async () => {
		const oversizedInput = auditLedger(
			...Array.from({ length: 66 }, (_, index) =>
				auditFinding({ id: `INPUT-${index}`, summary: "x".repeat(3_400) }),
			),
		);
		const expandingOutput = auditLedger(
			...Array.from({ length: 50 }, (_, index) =>
				auditFinding({ id: `OUTPUT-${index}`, summary: "*".repeat(4_000) }),
			),
		);

		const inputResult = await executeAudit({ ledger: oversizedInput });
		const outputResult = await executeAudit({ ledger: expandingOutput });

		expect(inputResult).toMatchObject({ status: "error" });
		expect(String(inputResult.summary)).toContain(
			`${MAX_AUDIT_LEDGER_UTF8_BYTES} UTF-8 bytes`,
		);
		expect(outputResult).toMatchObject({ status: "error" });
		expect(String(outputResult.summary)).toContain(
			"Rendered AuditLedgerV1 Markdown cannot exceed",
		);
		expect(outputResult).not.toHaveProperty("markdown");
	});
});
