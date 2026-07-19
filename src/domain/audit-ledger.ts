import { z } from "zod";

export const AUDIT_LEDGER_V1 = "audit-ledger/v1" as const;

export const MAX_AUDIT_FINDINGS = 200;
export const MAX_AUDIT_SOURCE_LOCATORS = 16;
export const MAX_AUDIT_ID_BYTES = 64;
export const MAX_AUDIT_PATH_BYTES = 512;
export const MAX_AUDIT_SYMBOL_BYTES = 256;
export const MAX_AUDIT_SHORT_PROSE_BYTES = 1_000;
export const MAX_AUDIT_PROSE_BYTES = 4_000;

// Audit reports are ephemeral, model-visible artifacts. One 256 KiB ceiling
// leaves room for a substantial review while preventing multi-megabyte tool
// inputs and generated Markdown from entering the conversation.
export const MAX_AUDIT_LEDGER_UTF8_BYTES = 256 * 1024;

const AUDIT_ID_PATTERN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const PORTABLE_RELATIVE_PATH_PATTERN =
	/^[A-Za-z0-9@._+ ()[\]{}$-]+(?:\/[A-Za-z0-9@._+ ()[\]{}$-]+)*$/;

export function auditUtf8Length(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

export function containsUnsafeAuditText(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0);
		if (codePoint === undefined) continue;
		const isForbiddenControl =
			codePoint <= 0x08 ||
			(codePoint >= 0x0b && codePoint <= 0x1f) ||
			codePoint === 0x7f;
		const isDirectionalOverride =
			(codePoint >= 0x202a && codePoint <= 0x202e) ||
			(codePoint >= 0x2066 && codePoint <= 0x2069);
		if (isForbiddenControl || isDirectionalOverride) return true;
	}
	return false;
}

function boundedSafeText(maximumBytes: number, label: string) {
	return z
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

const ShortProseSchema = boundedSafeText(
	MAX_AUDIT_SHORT_PROSE_BYTES,
	"Audit prose",
);
const ProseSchema = boundedSafeText(MAX_AUDIT_PROSE_BYTES, "Audit prose");

export const AuditFindingIdV1Schema = z
	.string()
	.min(1, "A finding id is required.")
	.superRefine((value, context) => {
		if (auditUtf8Length(value) > MAX_AUDIT_ID_BYTES) {
			context.addIssue({
				code: "custom",
				message: `A finding id cannot exceed ${MAX_AUDIT_ID_BYTES} UTF-8 bytes.`,
			});
		}
		if (!AUDIT_ID_PATTERN.test(value)) {
			context.addIssue({
				code: "custom",
				message:
					"A finding id must contain alphanumeric segments separated by single hyphens.",
			});
		}
	});

const AuditSourceFileV1Schema = z
	.string()
	.min(1, "A source file is required.")
	.superRefine((value, context) => {
		if (auditUtf8Length(value) > MAX_AUDIT_PATH_BYTES) {
			context.addIssue({
				code: "custom",
				message: `A source file cannot exceed ${MAX_AUDIT_PATH_BYTES} UTF-8 bytes.`,
			});
		}
		if (!PORTABLE_RELATIVE_PATH_PATTERN.test(value)) {
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

const AuditSymbolV1Schema = boundedSafeText(
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

export const AuditSourceLocatorV1Schema = z
	.object({
		file: AuditSourceFileV1Schema,
		symbol: AuditSymbolV1Schema.optional(),
		line: z.number().int().safe().positive().optional(),
		endLine: z.number().int().safe().positive().optional(),
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

export const AUDIT_PROOF_STATES_V1 = [
	"reproduced",
	"source_proven",
	"invariant_only",
	"external_assumption",
	"unverified",
] as const;
export const AuditProofStateV1Schema = z.enum(AUDIT_PROOF_STATES_V1);

export const AUDIT_REACHABILITY_V1 = [
	"normal_path",
	"failure_path",
	"adversarial_local",
	"external_consumer",
	"unknown",
] as const;
export const AuditReachabilityV1Schema = z.enum(AUDIT_REACHABILITY_V1);

export const AUDIT_DEPLOYMENT_EXPOSURES_V1 = [
	"deployed",
	"distributed",
	"not_deployed",
	"unknown",
] as const;
export const AuditDeploymentExposureV1Schema = z.enum(
	AUDIT_DEPLOYMENT_EXPOSURES_V1,
);

export const AUDIT_GUARD_EFFECTIVENESS_V1 = [
	"effective",
	"partial",
	"ineffective",
	"none",
	"unknown",
] as const;
export const AuditGuardEffectivenessV1Schema = z.enum(
	AUDIT_GUARD_EFFECTIVENESS_V1,
);

export const AUDIT_DISPOSITIONS_V1 = [
	"confirmed",
	"hardening",
	"measure_first",
	"deferred",
	"refuted",
] as const;
export const AuditDispositionV1Schema = z.enum(AUDIT_DISPOSITIONS_V1);

export const AUDIT_IMPACT_LEVELS_V1 = [
	"catastrophic",
	"major",
	"moderate",
	"minor",
	"none",
] as const;
export const AuditImpactLevelV1Schema = z.enum(AUDIT_IMPACT_LEVELS_V1);

export const AUDIT_SEVERITIES_V1 = [
	"critical",
	"high",
	"medium",
	"low",
	"informational",
] as const;
export const AuditSeverityV1Schema = z.enum(AUDIT_SEVERITIES_V1);

export const AUDIT_ACTION_PRIORITIES_V1 = [
	"fix_now",
	"next",
	"backlog",
	"none",
] as const;
export const AuditActionPriorityV1Schema = z.enum(AUDIT_ACTION_PRIORITIES_V1);

export const AUDIT_CONFIDENCE_V1 = ["high", "medium", "low"] as const;
export const AuditConfidenceV1Schema = z.enum(AUDIT_CONFIDENCE_V1);

const UNCERTAIN_PROOF_STATES: ReadonlySet<
	z.infer<typeof AuditProofStateV1Schema>
> = new Set(["invariant_only", "external_assumption", "unverified"]);

export type AuditContractIssue = {
	path: Array<string | number>;
	message: string;
};

export type AuditFindingPolicyInput = {
	proofState: z.infer<typeof AuditProofStateV1Schema>;
	reachability: z.infer<typeof AuditReachabilityV1Schema>;
	deploymentContext: {
		exposure: z.infer<typeof AuditDeploymentExposureV1Schema>;
	};
	guardsAndRecovery: {
		effectiveness: z.infer<typeof AuditGuardEffectivenessV1Schema>;
	};
	disposition: z.infer<typeof AuditDispositionV1Schema>;
	impact: {
		level: z.infer<typeof AuditImpactLevelV1Schema>;
	};
	severity: z.infer<typeof AuditSeverityV1Schema>;
	actionPriority: z.infer<typeof AuditActionPriorityV1Schema>;
	confidence: z.infer<typeof AuditConfidenceV1Schema>;
	remediation?: string | undefined;
};

export function auditFindingV1PolicyIssues(
	value: AuditFindingPolicyInput,
): AuditContractIssue[] {
	const issues: AuditContractIssue[] = [];
	const issue = (path: Array<string | number>, message: string): void => {
		issues.push({ path, message });
	};
	const elevated =
		value.severity === "critical" || value.actionPriority === "fix_now";
	if (elevated && UNCERTAIN_PROOF_STATES.has(value.proofState)) {
		issue(
			[value.severity === "critical" ? "severity" : "actionPriority"],
			"Critical severity and fix-now priority require reproduced or source-proven evidence.",
		);
	}
	if (
		elevated &&
		(value.reachability === "unknown" ||
			value.deploymentContext.exposure === "unknown" ||
			value.deploymentContext.exposure === "not_deployed")
	) {
		issue(
			[value.severity === "critical" ? "severity" : "actionPriority"],
			"Critical severity and fix-now priority require a reachable deployed or distributed context.",
		);
	}
	if (
		value.impact.level === "catastrophic" &&
		value.actionPriority === "fix_now" &&
		value.guardsAndRecovery.effectiveness !== "ineffective" &&
		value.guardsAndRecovery.effectiveness !== "none"
	) {
		issue(
			["guardsAndRecovery", "effectiveness"],
			"Catastrophic fix-now findings require evidence that guards are ineffective or absent.",
		);
	}
	if (value.severity === "critical" && value.impact.level !== "catastrophic") {
		issue(["severity"], "Critical severity requires catastrophic impact.");
	}
	if (
		value.disposition === "confirmed" &&
		value.proofState !== "reproduced" &&
		value.proofState !== "source_proven"
	) {
		issue(
			["disposition"],
			"Confirmed findings require reproduced or source-proven evidence.",
		);
	}
	if (
		value.actionPriority === "fix_now" &&
		(value.disposition === "measure_first" ||
			value.disposition === "deferred" ||
			value.disposition === "refuted")
	) {
		issue(
			["actionPriority"],
			"Fix-now priority requires a confirmed or hardening disposition.",
		);
	}
	if (value.proofState === "unverified" && value.confidence === "high") {
		issue(["confidence"], "Unverified findings cannot claim high confidence.");
	}
	if (value.disposition === "refuted") {
		if (value.severity !== "informational") {
			issue(["severity"], "Refuted findings must use informational severity.");
		}
		if (value.actionPriority !== "none") {
			issue(
				["actionPriority"],
				"Refuted findings cannot carry an action priority.",
			);
		}
		if (value.remediation !== undefined) {
			issue(["remediation"], "Refuted findings cannot carry remediation.");
		}
	}
	if (value.impact.level === "none" && value.severity !== "informational") {
		issue(["severity"], "No-impact findings must use informational severity.");
	}
	if (value.severity === "informational" && value.actionPriority !== "none") {
		issue(
			["actionPriority"],
			"Informational findings cannot carry an action priority.",
		);
	}
	if (value.actionPriority === "none" && value.remediation !== undefined) {
		issue(["remediation"], "Remediation requires a non-none action priority.");
	}
	if (value.actionPriority !== "none" && value.remediation === undefined) {
		issue(["remediation"], "An actionable finding requires remediation.");
	}
	return issues;
}

export const AuditFindingV1Schema = z
	.object({
		id: AuditFindingIdV1Schema,
		title: ShortProseSchema,
		summary: ProseSchema,
		sourceLocators: z
			.array(AuditSourceLocatorV1Schema)
			.min(1, "A finding requires at least one source locator.")
			.max(MAX_AUDIT_SOURCE_LOCATORS),
		proofState: AuditProofStateV1Schema,
		reachability: AuditReachabilityV1Schema,
		deploymentContext: z
			.object({
				exposure: AuditDeploymentExposureV1Schema,
				description: ProseSchema,
			})
			.strict(),
		trigger: ProseSchema,
		guardsAndRecovery: z
			.object({
				effectiveness: AuditGuardEffectivenessV1Schema,
				evidence: ProseSchema,
			})
			.strict(),
		disposition: AuditDispositionV1Schema,
		impact: z
			.object({
				level: AuditImpactLevelV1Schema,
				description: ProseSchema,
			})
			.strict(),
		severity: AuditSeverityV1Schema,
		actionPriority: AuditActionPriorityV1Schema,
		confidence: AuditConfidenceV1Schema,
		falsifier: ProseSchema,
		remediation: ProseSchema.optional(),
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

export const AuditLedgerV1Schema = z
	.object({
		version: z.literal(AUDIT_LEDGER_V1),
		findings: z.array(AuditFindingV1Schema).max(MAX_AUDIT_FINDINGS),
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

export type AuditSourceLocatorV1 = z.infer<typeof AuditSourceLocatorV1Schema>;
export type AuditProofStateV1 = z.infer<typeof AuditProofStateV1Schema>;
export type AuditDispositionV1 = z.infer<typeof AuditDispositionV1Schema>;
export type AuditSeverityV1 = z.infer<typeof AuditSeverityV1Schema>;
export type AuditActionPriorityV1 = z.infer<typeof AuditActionPriorityV1Schema>;
export type AuditFindingV1 = z.infer<typeof AuditFindingV1Schema>;
export type AuditLedgerV1 = z.infer<typeof AuditLedgerV1Schema>;

export function auditLedgerSerializedUtf8Bytes(value: unknown): number {
	const serialized = JSON.stringify(value);
	if (serialized === undefined) return 0;
	return auditUtf8Length(serialized);
}

export function auditLedgerV1ContractIssues(value: {
	findings: readonly { id: string }[];
}): AuditContractIssue[] {
	const issues: AuditContractIssue[] = [];
	const ids = new Map<string, number>();
	for (const [index, finding] of value.findings.entries()) {
		const normalizedId = finding.id.toLocaleUpperCase("en-US");
		const previousIndex = ids.get(normalizedId);
		if (previousIndex !== undefined) {
			issues.push({
				path: ["findings", index, "id"],
				message: `Finding id duplicates findings[${previousIndex}].id (case-insensitive).`,
			});
			continue;
		}
		ids.set(normalizedId, index);
	}
	const byteLength = auditLedgerSerializedUtf8Bytes(value);
	if (byteLength > MAX_AUDIT_LEDGER_UTF8_BYTES) {
		issues.push({
			path: [],
			message: `An AuditLedgerV1 cannot exceed ${MAX_AUDIT_LEDGER_UTF8_BYTES} UTF-8 bytes.`,
		});
	}
	return issues;
}

const DISPOSITIONS = AuditDispositionV1Schema.options;
const SEVERITIES = AuditSeverityV1Schema.options;
const ACTION_PRIORITIES = AuditActionPriorityV1Schema.options;
const PROOF_STATES = AuditProofStateV1Schema.options;

function countBy<T extends string>(
	values: readonly T[],
	keys: readonly T[],
): Record<T, number> {
	const result = Object.fromEntries(keys.map((key) => [key, 0])) as Record<
		T,
		number
	>;
	for (const value of values) result[value] += 1;
	return result;
}

export type AuditLedgerSummaryV1 = {
	total: number;
	actionable: number;
	remediationItems: number;
	byDisposition: Record<AuditDispositionV1, number>;
	bySeverity: Record<AuditSeverityV1, number>;
	byActionPriority: Record<AuditActionPriorityV1, number>;
	byProofState: Record<AuditProofStateV1, number>;
};

function compareText(left: string, right: string): number {
	return left.localeCompare(right, "en-US", { sensitivity: "base" });
}

function compareSourceLocators(
	left: AuditSourceLocatorV1,
	right: AuditSourceLocatorV1,
): number {
	return (
		compareText(left.file, right.file) ||
		(left.line ?? 0) - (right.line ?? 0) ||
		(left.endLine ?? 0) - (right.endLine ?? 0) ||
		compareText(left.symbol ?? "", right.symbol ?? "")
	);
}

export function canonicalizeAuditLedgerV1(
	ledger: AuditLedgerV1,
): AuditLedgerV1 {
	const findings = ledger.findings
		.map((finding) => ({
			...finding,
			sourceLocators: [...finding.sourceLocators].sort(compareSourceLocators),
		}))
		.sort((left, right) => compareText(left.id, right.id));
	return { version: AUDIT_LEDGER_V1, findings };
}

export function parseAuditLedgerV1(input: unknown): AuditLedgerV1 {
	return canonicalizeAuditLedgerV1(AuditLedgerV1Schema.parse(input));
}

export function deriveAuditLedgerSummaryV1(
	ledger: AuditLedgerV1,
): AuditLedgerSummaryV1 {
	const parsed = parseAuditLedgerV1(ledger);
	return {
		total: parsed.findings.length,
		actionable: parsed.findings.filter(
			(finding) => finding.actionPriority !== "none",
		).length,
		remediationItems: parsed.findings.filter(
			(finding) => finding.remediation !== undefined,
		).length,
		byDisposition: countBy(
			parsed.findings.map((finding) => finding.disposition),
			DISPOSITIONS,
		),
		bySeverity: countBy(
			parsed.findings.map((finding) => finding.severity),
			SEVERITIES,
		),
		byActionPriority: countBy(
			parsed.findings.map((finding) => finding.actionPriority),
			ACTION_PRIORITIES,
		),
		byProofState: countBy(
			parsed.findings.map((finding) => finding.proofState),
			PROOF_STATES,
		),
	};
}

function markdownText(value: string): string {
	return value
		.replace(/\s+/gu, " ")
		.replace(/\\/gu, "\\\\")
		.replace(/([`*_[\]{}<>#+.!|])/gu, "\\$1")
		.replace(/(^|\s)-(?=\s)/gu, "$1\\-");
}

function locatorText(locator: AuditSourceLocatorV1): string {
	let source = locator.file;
	if (locator.line !== undefined) {
		source += `:${locator.line}`;
		if (locator.endLine !== undefined && locator.endLine !== locator.line) {
			source += `-${locator.endLine}`;
		}
	}
	if (locator.symbol !== undefined) source += ` — ${locator.symbol}`;
	return source;
}

function summaryLine<T extends string>(
	label: string,
	keys: readonly T[],
	counts: Record<T, number>,
): string {
	return `- ${label}: ${keys.map((key) => `${key}=${counts[key]}`).join(", ")}`;
}

function renderFinding(finding: AuditFindingV1): string[] {
	return [
		`### ${finding.id} — ${markdownText(finding.title)}`,
		"",
		markdownText(finding.summary),
		"",
		`- Proof state: \`${finding.proofState}\``,
		`- Reachability: \`${finding.reachability}\``,
		`- Deployment: \`${finding.deploymentContext.exposure}\` — ${markdownText(finding.deploymentContext.description)}`,
		`- Trigger: ${markdownText(finding.trigger)}`,
		`- Guards and recovery: \`${finding.guardsAndRecovery.effectiveness}\` — ${markdownText(finding.guardsAndRecovery.evidence)}`,
		`- Disposition: \`${finding.disposition}\``,
		`- Impact: \`${finding.impact.level}\` — ${markdownText(finding.impact.description)}`,
		`- Severity: \`${finding.severity}\``,
		`- Action priority: \`${finding.actionPriority}\``,
		`- Confidence: \`${finding.confidence}\``,
		`- Falsifier: ${markdownText(finding.falsifier)}`,
		"- Sources:",
		...finding.sourceLocators.map(
			(locator) => `  - \`${locatorText(locator)}\``,
		),
	];
}

export class AuditLedgerMarkdownBudgetError extends Error {
	override readonly name = "AuditLedgerMarkdownBudgetError";
	readonly byteLength: number;

	constructor(byteLength: number) {
		super(
			`Rendered AuditLedgerV1 Markdown cannot exceed ${MAX_AUDIT_LEDGER_UTF8_BYTES} UTF-8 bytes (received ${byteLength}).`,
		);
		this.byteLength = byteLength;
	}
}

export function renderAuditLedgerMarkdownV1(ledger: AuditLedgerV1): string {
	const parsed = parseAuditLedgerV1(ledger);
	const summary = deriveAuditLedgerSummaryV1(parsed);
	const lines = [
		"# Audit ledger",
		"",
		`<!-- ${AUDIT_LEDGER_V1} -->`,
		"",
		"## Summary",
		"",
		`- Total findings: ${summary.total}`,
		`- Actionable findings: ${summary.actionable}`,
		`- Remediation items: ${summary.remediationItems}`,
		summaryLine("Dispositions", DISPOSITIONS, summary.byDisposition),
		summaryLine("Severities", SEVERITIES, summary.bySeverity),
		summaryLine(
			"Action priorities",
			ACTION_PRIORITIES,
			summary.byActionPriority,
		),
		summaryLine("Proof states", PROOF_STATES, summary.byProofState),
		"",
		"## Findings",
		"",
	];

	if (parsed.findings.length === 0) {
		lines.push("No findings.", "");
	} else {
		for (const finding of parsed.findings) {
			lines.push(...renderFinding(finding), "");
		}
	}

	lines.push("## Remediation", "");
	const remediationItems = parsed.findings.filter(
		(finding) => finding.remediation !== undefined,
	);
	if (remediationItems.length === 0) {
		lines.push("No remediation items.", "");
	} else {
		for (const finding of remediationItems) {
			lines.push(
				`### ${finding.id} — ${markdownText(finding.title)}`,
				"",
				markdownText(finding.remediation ?? ""),
				"",
			);
		}
	}
	const markdown = `${lines.join("\n").trimEnd()}\n`;
	const byteLength = auditUtf8Length(markdown);
	if (byteLength > MAX_AUDIT_LEDGER_UTF8_BYTES) {
		throw new AuditLedgerMarkdownBudgetError(byteLength);
	}
	return markdown;
}

export type AuditMarkdownReconciliationIssueCode =
	| "summary_count_drift"
	| "invalid_finding_heading"
	| "missing_finding_id"
	| "unexpected_finding_id"
	| "refuted_in_remediation"
	| "stale_refuted_remediation"
	| "non_canonical_markdown";

export type AuditMarkdownReconciliationIssue = {
	code: AuditMarkdownReconciliationIssueCode;
	message: string;
	findingId?: string | undefined;
};

export type AuditMarkdownReconciliationV1 = {
	valid: boolean;
	canonicalMarkdown: string;
	issues: AuditMarkdownReconciliationIssue[];
};

function markdownSection(
	markdown: string,
	heading: "Summary" | "Findings" | "Remediation",
): string | undefined {
	const match = new RegExp(
		`(?:^|\\n)## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`,
		"u",
	).exec(markdown);
	return match?.[1]?.trim();
}

function headingIds(section: string): {
	ids: string[];
	invalidHeadings: string[];
} {
	const ids: string[] = [];
	const invalidHeadings: string[] = [];
	for (const line of section.split("\n")) {
		if (!line.startsWith("### ")) continue;
		const match = /^### ([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*) — /u.exec(line);
		if (match?.[1] !== undefined) ids.push(match[1]);
		else invalidHeadings.push(line);
	}
	return { ids, invalidHeadings };
}

function findingBlock(section: string, id: string): string | undefined {
	const escapedId = id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	const match = new RegExp(
		`(?:^|\\n)### ${escapedId} — [^\\n]+\\n([\\s\\S]*?)(?=\\n### |$)`,
		"iu",
	).exec(section);
	return match?.[1];
}

export function reconcileAuditLedgerMarkdownV1(
	ledger: AuditLedgerV1,
	markdown: string,
): AuditMarkdownReconciliationV1 {
	const parsed = parseAuditLedgerV1(ledger);
	const canonicalMarkdown = renderAuditLedgerMarkdownV1(parsed);
	const normalizedMarkdown = markdown.replace(/\r\n?/gu, "\n");
	const issues: AuditMarkdownReconciliationIssue[] = [];
	const actualSummary = markdownSection(normalizedMarkdown, "Summary");
	const expectedSummary = markdownSection(canonicalMarkdown, "Summary");
	if (actualSummary !== expectedSummary) {
		issues.push({
			code: "summary_count_drift",
			message:
				"Markdown summary counts do not match the derived ledger summary.",
		});
	}

	const findingsSection = markdownSection(normalizedMarkdown, "Findings") ?? "";
	const findingHeadings = headingIds(findingsSection);
	for (const invalidHeading of findingHeadings.invalidHeadings) {
		issues.push({
			code: "invalid_finding_heading",
			message: `Finding heading lacks a valid alphanumeric-hyphen id: ${invalidHeading}`,
		});
	}
	const expectedIds = new Map(
		parsed.findings.map((finding) => [
			finding.id.toLocaleUpperCase("en-US"),
			finding.id,
		]),
	);
	const actualIds = new Map(
		findingHeadings.ids.map((id) => [id.toLocaleUpperCase("en-US"), id]),
	);
	for (const [normalizedId, id] of expectedIds) {
		if (actualIds.has(normalizedId)) continue;
		issues.push({
			code: "missing_finding_id",
			findingId: id,
			message: `Markdown is missing finding ${id}.`,
		});
	}
	for (const [normalizedId, id] of actualIds) {
		if (expectedIds.has(normalizedId)) continue;
		issues.push({
			code: "unexpected_finding_id",
			findingId: id,
			message: `Markdown contains finding ${id}, which is absent from the ledger.`,
		});
	}

	const remediationSection =
		markdownSection(normalizedMarkdown, "Remediation") ?? "";
	for (const finding of parsed.findings) {
		if (finding.disposition !== "refuted") continue;
		const escapedId = finding.id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
		if (new RegExp(`\\b${escapedId}\\b`, "iu").test(remediationSection)) {
			issues.push({
				code: "refuted_in_remediation",
				findingId: finding.id,
				message: `Refuted finding ${finding.id} appears in remediation.`,
			});
		}
		const block = findingBlock(findingsSection, finding.id);
		if (block !== undefined && /^\s*- Remediation:/imu.test(block)) {
			issues.push({
				code: "stale_refuted_remediation",
				findingId: finding.id,
				message: `Refuted finding ${finding.id} retains stale remediation language.`,
			});
		}
	}

	if (normalizedMarkdown !== canonicalMarkdown) {
		issues.push({
			code: "non_canonical_markdown",
			message: "Markdown differs from the deterministic ledger rendering.",
		});
	}

	return { valid: issues.length === 0, canonicalMarkdown, issues };
}
