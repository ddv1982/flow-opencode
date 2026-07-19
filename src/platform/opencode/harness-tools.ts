import {
	AUDIT_ACTION_PRIORITIES_V1,
	AUDIT_CONFIDENCE_V1,
	AUDIT_DEPLOYMENT_EXPOSURES_V1,
	AUDIT_DISPOSITIONS_V1,
	AUDIT_GUARD_EFFECTIVENESS_V1,
	AUDIT_IMPACT_LEVELS_V1,
	AUDIT_LEDGER_V1,
	AUDIT_PROOF_STATES_V1,
	AUDIT_REACHABILITY_V1,
	AUDIT_SEVERITIES_V1,
	auditFindingV1PolicyIssues,
	auditLedgerV1ContractIssues,
	auditUtf8Length,
	containsUnsafeAuditText,
	deriveAuditLedgerSummaryV1,
	MAX_AUDIT_FINDINGS,
	MAX_AUDIT_ID_BYTES,
	MAX_AUDIT_PATH_BYTES,
	MAX_AUDIT_PROSE_BYTES,
	MAX_AUDIT_SHORT_PROSE_BYTES,
	MAX_AUDIT_SOURCE_LOCATORS,
	MAX_AUDIT_SYMBOL_BYTES,
	parseAuditLedgerV1,
	renderAuditLedgerMarkdownV1,
} from "../../domain/audit-ledger.js";
import type { OrchestrationProposalV1 } from "../../domain/orchestration-policy.js";
import { ORCHESTRATION_ADMISSION_POLICY_VERSION } from "../../domain/orchestration-policy.js";
import { resolveWorkspaceRoot } from "../../infrastructure/fs/workspace.js";
import type { OrchestrationAdmissionCoordinator } from "./orchestration-admission.js";
import type { Hooks } from "./sdk.js";
import { tool } from "./sdk.js";
import type {
	PreparedValidationCapture,
	ValidationCaptureCoordinator,
} from "./validation-capture.js";

const host = tool.schema;
const identifier = host
	.string()
	.min(1)
	.max(128)
	.regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/);
const digest = host.string().regex(/^sha256:[a-f0-9]{64}$/);

const auditIdPattern = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const auditPathPattern =
	/^[A-Za-z0-9@._+ ()[\]{}$-]+(?:\/[A-Za-z0-9@._+ ()[\]{}$-]+)*$/;

function auditText(maximumBytes: number, label: string) {
	return host
		.string()
		.min(1, `${label} cannot be empty.`)
		.superRefine((value, context) => {
			if (value !== value.trim()) {
				context.addIssue({
					code: "custom",
					message: `${label} cannot start or end with whitespace.`,
				});
			}
			if (containsUnsafeAuditText(value)) {
				context.addIssue({
					code: "custom",
					message: `${label} contains unsafe control or directional characters.`,
				});
			}
			if (auditUtf8Length(value) > maximumBytes) {
				context.addIssue({
					code: "custom",
					message: `${label} cannot exceed ${maximumBytes} UTF-8 bytes.`,
				});
			}
		});
}

const auditShortProse = auditText(MAX_AUDIT_SHORT_PROSE_BYTES, "Audit prose");
const auditProse = auditText(MAX_AUDIT_PROSE_BYTES, "Audit prose");
const auditFindingId = host
	.string()
	.min(1, "A finding id is required.")
	.superRefine((value, context) => {
		if (auditUtf8Length(value) > MAX_AUDIT_ID_BYTES) {
			context.addIssue({
				code: "custom",
				message: `A finding id cannot exceed ${MAX_AUDIT_ID_BYTES} UTF-8 bytes.`,
			});
		}
		if (!auditIdPattern.test(value)) {
			context.addIssue({
				code: "custom",
				message:
					"A finding id must contain alphanumeric segments separated by single hyphens.",
			});
		}
	});
const auditSourceFile = host
	.string()
	.min(1, "A source file is required.")
	.superRefine((value, context) => {
		if (auditUtf8Length(value) > MAX_AUDIT_PATH_BYTES) {
			context.addIssue({
				code: "custom",
				message: `A source file cannot exceed ${MAX_AUDIT_PATH_BYTES} UTF-8 bytes.`,
			});
		}
		if (!auditPathPattern.test(value)) {
			context.addIssue({
				code: "custom",
				message:
					"A source file must be a portable repository-relative path using forward slashes.",
			});
		}
		const segments = value.split("/");
		if (segments.some((segment) => segment === "." || segment === "..")) {
			context.addIssue({
				code: "custom",
				message: "A source file cannot contain relative traversal segments.",
			});
		}
		if (segments.some((segment) => segment !== segment.trim())) {
			context.addIssue({
				code: "custom",
				message: "Source path segments cannot start or end with whitespace.",
			});
		}
	});
const auditSymbol = auditText(
	MAX_AUDIT_SYMBOL_BYTES,
	"A source symbol",
).superRefine((value, context) => {
	if (/[`\r\n]/u.test(value)) {
		context.addIssue({
			code: "custom",
			message: "A source symbol must fit on one Markdown-safe line.",
		});
	}
});
const auditSourceLocator = host
	.object({
		file: auditSourceFile,
		symbol: auditSymbol.optional(),
		line: host.number().int().safe().positive().optional(),
		endLine: host.number().int().safe().positive().optional(),
	})
	.strict()
	.superRefine((value, context) => {
		if (value.endLine !== undefined && value.line === undefined) {
			context.addIssue({
				code: "custom",
				path: ["endLine"],
				message: "endLine requires line.",
			});
		}
		if (
			value.line !== undefined &&
			value.endLine !== undefined &&
			value.endLine < value.line
		) {
			context.addIssue({
				code: "custom",
				path: ["endLine"],
				message: "endLine cannot precede line.",
			});
		}
	});
const auditFinding = host
	.object({
		id: auditFindingId,
		title: auditShortProse,
		summary: auditProse,
		sourceLocators: host
			.array(auditSourceLocator)
			.min(1, "A finding requires at least one source locator.")
			.max(MAX_AUDIT_SOURCE_LOCATORS),
		proofState: host.enum(AUDIT_PROOF_STATES_V1),
		reachability: host.enum(AUDIT_REACHABILITY_V1),
		deploymentContext: host
			.object({
				exposure: host.enum(AUDIT_DEPLOYMENT_EXPOSURES_V1),
				description: auditProse,
			})
			.strict(),
		trigger: auditProse,
		guardsAndRecovery: host
			.object({
				effectiveness: host.enum(AUDIT_GUARD_EFFECTIVENESS_V1),
				evidence: auditProse,
			})
			.strict(),
		disposition: host.enum(AUDIT_DISPOSITIONS_V1),
		impact: host
			.object({
				level: host.enum(AUDIT_IMPACT_LEVELS_V1),
				description: auditProse,
			})
			.strict(),
		severity: host.enum(AUDIT_SEVERITIES_V1),
		actionPriority: host.enum(AUDIT_ACTION_PRIORITIES_V1),
		confidence: host.enum(AUDIT_CONFIDENCE_V1),
		falsifier: auditProse,
		remediation: auditProse.optional(),
	})
	.strict()
	.superRefine((value, context) => {
		for (const issue of auditFindingV1PolicyIssues(value)) {
			context.addIssue({
				code: "custom",
				path: issue.path,
				message: issue.message,
			});
		}
	});
const auditLedger = host
	.object({
		version: host.literal(AUDIT_LEDGER_V1),
		findings: host.array(auditFinding).max(MAX_AUDIT_FINDINGS),
	})
	.strict()
	.superRefine((value, context) => {
		for (const issue of auditLedgerV1ContractIssues(value)) {
			context.addIssue({
				code: "custom",
				path: issue.path,
				message: issue.message,
			});
		}
	});

const orchestrationSlice = host
	.object({
		sliceId: identifier,
		scopeIds: host.array(identifier).min(1).max(16),
	})
	.strict();

const orchestrationProposal = host
	.object({
		policyVersion: host.literal(ORCHESTRATION_ADMISSION_POLICY_VERSION),
		proposalId: identifier,
		passKind: host.enum([
			"discovery",
			"audit",
			"verification",
			"candidate-implementation",
		]),
		slices: host.array(orchestrationSlice).min(1).max(5),
		targetClaimIds: host.array(identifier).max(100),
		verificationTier: host.enum(["none", "claim-scoped", "post-synthesis"]),
		workerCount: host.number().int().safe().positive().max(5),
		dependsOn: host.array(identifier).max(16),
		writeScope: host.enum([
			"none",
			"manager-serial",
			"exact-path",
			"isolated-worktree",
			"mixed",
		]),
		implementationAuthorized: host.boolean(),
		waveIndex: host.number().int().min(1).max(2),
		scope: host.enum(["broad", "targeted"]),
		reasonCodes: host
			.array(
				host.enum([
					"blocking-impact",
					"contested",
					"low-confidence",
					"single-source",
					"cross-layer-gap",
				]),
			)
			.max(5),
	})
	.strict();

const orchestrationAdmitInput = host
	.object({ proposal: orchestrationProposal })
	.strict();

const validationStartInput = host
	.object({
		expectedRevision: host.number().int().safe().nonnegative(),
		expectedSnapshotId: digest,
		featureId: identifier,
		command: host.string().trim().min(1).max(12_000),
		coverageScope: host.enum(["focused", "broad", "artifact"]),
		environmentKeys: host
			.array(host.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/))
			.max(64),
	})
	.strict();

const auditRenderInput = host.object({ ledger: auditLedger }).strict();

export type ValidationPrepareRequest = {
	expectedRevision: number;
	expectedSnapshotId: string;
	featureId: string;
	command: string;
	coverageScope: "focused" | "broad" | "artifact";
	environmentKeys: string[];
};

export type HarnessToolOptions = {
	orchestration: OrchestrationAdmissionCoordinator;
	validation: ValidationCaptureCoordinator;
	prepareValidation: (
		worktree: string,
		request: ValidationPrepareRequest,
	) => Promise<PreparedValidationCapture>;
};

type FlowTools = NonNullable<Hooks["tool"]>;

function errorResult(error: unknown): string {
	return JSON.stringify({
		status: "error",
		summary: error instanceof Error ? error.message : String(error),
	});
}

export function createHarnessTools(options: HarnessToolOptions): FlowTools {
	return {
		flow_orchestration_admit: tool({
			description:
				"Evaluate and arm one bounded Flow worker proposal before dispatching its exact hidden workers.",
			args: orchestrationAdmitInput.shape,
			execute: (args, context) => {
				try {
					const parsed = orchestrationAdmitInput.parse(args);
					return Promise.resolve(
						JSON.stringify({
							status: "ok",
							...options.orchestration.evaluateAndArm(
								context.sessionID,
								parsed.proposal as OrchestrationProposalV1,
							),
						}),
					);
				} catch (error) {
					return Promise.resolve(errorResult(error));
				}
			},
		}),
		flow_validation_start: tool({
			description:
				"Arm runtime-attested validation for the exact next Bash command without accepting caller timestamps, exit status, or output digests.",
			args: validationStartInput.shape,
			execute: async (args, context) => {
				try {
					const request = validationStartInput.parse(args);
					const workspace = resolveWorkspaceRoot(context);
					const prepared = await options.prepareValidation(workspace, request);
					const capture = options.validation.arm({
						...prepared,
						sessionID: context.sessionID,
						worktree: workspace,
						command: request.command,
						coverageScope: request.coverageScope,
						environmentKeys: request.environmentKeys,
					});
					return JSON.stringify({
						status: "ok",
						summary:
							"Validation capture armed for the exact next Bash command in this session.",
						capture,
					});
				} catch (error) {
					return errorResult(error);
				}
			},
		}),
		flow_audit_render: tool({
			description:
				"Validate one AuditLedgerV1 and deterministically render its reconciled Markdown report.",
			args: auditRenderInput.shape,
			execute: (args) => {
				try {
					const ledger = parseAuditLedgerV1(
						auditRenderInput.parse(args).ledger,
					);
					return Promise.resolve(
						JSON.stringify({
							status: "ok",
							summary: deriveAuditLedgerSummaryV1(ledger),
							markdown: renderAuditLedgerMarkdownV1(ledger),
						}),
					);
				} catch (error) {
					return Promise.resolve(errorResult(error));
				}
			},
		}),
	};
}
