import { z } from "zod";

const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const opaqueFindingID = z.string().regex(/^case-finding-[0-9]{3}$/);
const opaqueRefutedCandidateID = z
	.string()
	.regex(/^case-refuted-candidate-[0-9]{3}$/);

const observedMetricSchema = z
	.object({
		value: z.number().safe().nonnegative().nullable(),
		provenance: z.enum(["host_observed", "fixture_derived", "unavailable"]),
	})
	.strict()
	.superRefine((metric, context) => {
		if (metric.provenance === "unavailable" && metric.value !== null) {
			context.addIssue({
				code: "custom",
				path: ["value"],
				message: "Unavailable harness metrics must use null, never zero.",
			});
		}
		if (metric.provenance !== "unavailable" && metric.value === null) {
			context.addIssue({
				code: "custom",
				path: ["value"],
				message: "Observed harness metrics require a numeric value.",
			});
		}
	});

const findingDecisionSchema = z
	.object({
		findingID: opaqueFindingID,
		decision: z.enum(["fully_supported", "partially_supported"]),
	})
	.strict();

const qualityOracleSchema = z
	.object({
		findingDecisions: z.array(findingDecisionSchema).max(200),
		fullySupportedCount: z.number().int().safe().nonnegative(),
		partiallySupportedCount: z.number().int().safe().nonnegative(),
		refutedCandidateIDs: z.array(opaqueRefutedCandidateID).max(200),
		refutedCandidateCount: z.number().int().safe().nonnegative(),
		remediationContradictionCount: z.number().int().safe().nonnegative(),
		findingDecisionDigest: sha256,
		refutedCandidateDigest: sha256,
		workflowClosedCleanly: z.boolean(),
	})
	.strict()
	.superRefine((quality, context) => {
		const findingIDs = quality.findingDecisions.map(
			(decision) => decision.findingID,
		);
		if (new Set(findingIDs).size !== findingIDs.length) {
			context.addIssue({
				code: "custom",
				path: ["findingDecisions"],
				message: "Finding decisions must use unique opaque IDs.",
			});
		}
		const fullySupported = quality.findingDecisions.filter(
			(decision) => decision.decision === "fully_supported",
		).length;
		const partiallySupported = quality.findingDecisions.length - fullySupported;
		if (
			fullySupported !== quality.fullySupportedCount ||
			partiallySupported !== quality.partiallySupportedCount
		) {
			context.addIssue({
				code: "custom",
				path: ["findingDecisions"],
				message: "Finding decisions must reconcile with support counts.",
			});
		}
		if (
			new Set(quality.refutedCandidateIDs).size !==
			quality.refutedCandidateIDs.length
		) {
			context.addIssue({
				code: "custom",
				path: ["refutedCandidateIDs"],
				message: "Refuted candidate IDs must be unique.",
			});
		}
		if (quality.refutedCandidateIDs.length !== quality.refutedCandidateCount) {
			context.addIssue({
				code: "custom",
				path: ["refutedCandidateIDs"],
				message: "Refuted candidate IDs must reconcile with the count.",
			});
		}
	});

const harnessObservationSchema = z
	.object({
		variant: z.enum(["control", "standard", "assurance"]),
		status: z.enum(["observed", "unavailable"]),
		sourceRevisionKey: sha256,
		modelConfigurationKey: sha256,
		waveCount: observedMetricSchema,
		sessionCount: observedMetricSchema,
		childSessionCount: observedMetricSchema,
		workerCount: observedMetricSchema,
		toolCallCount: observedMetricSchema,
		readCallCount: observedMetricSchema,
		uniqueReadCount: observedMetricSchema,
		sameWaveDuplicateReadCount: observedMetricSchema,
		repeatedResultBytes: observedMetricSchema,
		uncachedInputTokens: observedMetricSchema,
		quality: qualityOracleSchema.nullable(),
	})
	.strict()
	.superRefine((observation, context) => {
		if (observation.status === "observed" && observation.quality === null) {
			context.addIssue({
				code: "custom",
				path: ["quality"],
				message: "Observed harness variants require a quality oracle.",
			});
		}
		if (observation.status === "unavailable" && observation.quality !== null) {
			context.addIssue({
				code: "custom",
				path: ["quality"],
				message: "Unavailable harness variants cannot claim quality results.",
			});
		}
	});

export const HarnessResourceFixtureV1Schema = z
	.object({
		schemaVersion: z.literal(1),
		caseID: z.literal("full-repo-audit-v1"),
		privacy: z
			.object({
				containsRawPrompts: z.literal(false),
				containsRawToolArguments: z.literal(false),
				containsRawToolOutput: z.literal(false),
				containsAbsolutePaths: z.literal(false),
				containsFindingProse: z.literal(false),
			})
			.strict(),
		observations: z
			.array(harnessObservationSchema)
			.length(3)
			.superRefine((observations, context) => {
				const variants = observations.map((entry) => entry.variant);
				if (new Set(variants).size !== variants.length) {
					context.addIssue({
						code: "custom",
						message: "Harness fixture variants must be unique.",
					});
				}
				for (const required of ["control", "standard", "assurance"] as const) {
					if (variants.includes(required)) continue;
					context.addIssue({
						code: "custom",
						message: `Harness fixture is missing ${required}.`,
					});
				}
			}),
	})
	.strict();

export type HarnessResourceFixtureV1 = z.infer<
	typeof HarnessResourceFixtureV1Schema
>;
export type HarnessObservation = z.infer<typeof harnessObservationSchema>;
export type HarnessQualityOracle = z.infer<typeof qualityOracleSchema>;
export type HarnessCandidateVariant = "standard" | "assurance";

export type HarnessPromotionGate = {
	variant: HarnessCandidateVariant;
	status: "pass" | "fail" | "unavailable";
	reasons: string[];
};

export type HarnessResourceReport = {
	schemaVersion: 1;
	caseID: "full-repo-audit-v1";
	controlStatus: "observed" | "unavailable";
	gates: HarnessPromotionGate[];
};

const FORBIDDEN_SERIALIZED_PATTERNS: ReadonlyArray<{
	name: string;
	pattern: RegExp;
}> = [
	{
		name: "absolute Unix path",
		pattern: /(?:^|[\s"'])\/(?:Users|home|tmp|var)\//i,
	},
	{ name: "Windows path", pattern: /[A-Za-z]:\\/ },
	{ name: "URL", pattern: /https?:\/\//i },
	{
		name: "credential-like key",
		pattern: /(?:api[_-]?key|password|secret|token)["'=:\s]/i,
	},
];

export function harnessFixturePrivacyIssues(value: unknown): string[] {
	const serialized = JSON.stringify(value);
	return FORBIDDEN_SERIALIZED_PATTERNS.filter(({ pattern }) =>
		pattern.test(serialized),
	).map(({ name }) => `Harness fixture contains a forbidden ${name}.`);
}

export function parseHarnessResourceFixture(
	value: unknown,
): HarnessResourceFixtureV1 {
	const parsed = HarnessResourceFixtureV1Schema.parse(value);
	const privacyIssues = harnessFixturePrivacyIssues(parsed);
	if (privacyIssues.length > 0) throw new Error(privacyIssues.join(" "));
	return parsed;
}

export function canonicalHarnessFindingDecisions(
	decisions: readonly {
		findingID: string;
		decision: "fully_supported" | "partially_supported";
	}[],
): string {
	const sorted = [...decisions].sort((left, right) => {
		if (left.findingID < right.findingID) return -1;
		if (left.findingID > right.findingID) return 1;
		return 0;
	});
	return JSON.stringify(
		sorted.map((decision) => ({
			findingID: decision.findingID,
			decision: decision.decision,
		})),
	);
}

export function canonicalHarnessRefutedCandidates(
	refutedCandidateIDs: readonly string[],
): string {
	return JSON.stringify([...refutedCandidateIDs].sort());
}

function numeric(
	observation: HarnessObservation,
	key: keyof HarnessObservation,
) {
	const candidate = observation[key];
	if (!candidate || typeof candidate !== "object" || !("value" in candidate)) {
		return null;
	}
	return (candidate as { value: number | null }).value;
}

function evaluateVariant(
	control: HarnessObservation,
	candidate: HarnessObservation,
): HarnessPromotionGate {
	if (
		control.status !== "observed" ||
		!control.quality ||
		candidate.status !== "observed" ||
		!candidate.quality
	) {
		return {
			variant: candidate.variant as HarnessCandidateVariant,
			status: "unavailable",
			reasons: ["A same-corpus observed candidate is not available."],
		};
	}
	const reasons: string[] = [];
	if (candidate.sourceRevisionKey !== control.sourceRevisionKey) {
		reasons.push("Candidate and control source revisions differ.");
	}
	if (candidate.modelConfigurationKey !== control.modelConfigurationKey) {
		reasons.push("Candidate and control model configurations differ.");
	}
	if (
		candidate.quality.findingDecisionDigest !==
			control.quality.findingDecisionDigest ||
		canonicalHarnessFindingDecisions(candidate.quality.findingDecisions) !==
			canonicalHarnessFindingDecisions(control.quality.findingDecisions)
	) {
		reasons.push(
			"Candidate changed the independently labeled finding decisions.",
		);
	}
	if (
		candidate.quality.refutedCandidateDigest !==
			control.quality.refutedCandidateDigest ||
		canonicalHarnessRefutedCandidates(candidate.quality.refutedCandidateIDs) !==
			canonicalHarnessRefutedCandidates(control.quality.refutedCandidateIDs)
	) {
		reasons.push("Candidate changed the independently labeled refutations.");
	}
	if (candidate.quality.remediationContradictionCount !== 0) {
		reasons.push(
			"Candidate retained a contradiction between findings and remediation.",
		);
	}
	if (!candidate.quality.workflowClosedCleanly) {
		reasons.push("Candidate did not reach clean Flow closure.");
	}
	const comparableKeys = [
		"sessionCount",
		"childSessionCount",
		"workerCount",
		"toolCallCount",
		"readCallCount",
		"sameWaveDuplicateReadCount",
		"repeatedResultBytes",
		"uncachedInputTokens",
	] as const;
	let hasComparableReduction = false;
	const regressions: string[] = [];
	for (const key of comparableKeys) {
		const before = numeric(control, key);
		const after = numeric(candidate, key);
		if (before === null || after === null) continue;
		if (after < before) hasComparableReduction = true;
		if (after > before) regressions.push(key);
	}
	if (regressions.length > 0) {
		reasons.push(
			`Candidate increased comparable observed work: ${regressions.join(", ")}.`,
		);
	}
	if (!hasComparableReduction) {
		reasons.push(
			"Candidate did not demonstrate lower observed work on the same corpus.",
		);
	}
	return {
		variant: candidate.variant as HarnessCandidateVariant,
		status: reasons.length === 0 ? "pass" : "fail",
		reasons,
	};
}

export function buildHarnessResourceReport(
	value: unknown,
): HarnessResourceReport {
	const fixture = parseHarnessResourceFixture(value);
	const control = fixture.observations.find(
		(observation) => observation.variant === "control",
	);
	if (!control) throw new Error("Harness fixture has no control observation.");
	const candidates = fixture.observations.filter(
		(
			observation,
		): observation is HarnessObservation & {
			variant: HarnessCandidateVariant;
		} => observation.variant !== "control",
	);
	return {
		schemaVersion: 1,
		caseID: fixture.caseID,
		controlStatus: control.status,
		gates: candidates.map((candidate) => evaluateVariant(control, candidate)),
	};
}

type HostObservedMetric = {
	value: number | null;
	provenance: "host_observed" | "unavailable";
};

export type SanitizedHostObservationProjection = {
	schemaVersion: 1;
	epoch: number;
	children: { count: number; workerRoleCount: number };
	tokens: { input: HostObservedMetric; cacheRead: HostObservedMetric };
	tools: { calls: number; resultBytes: number; repeatedResultCount: number };
	reads: { total: number; unique: number; sameWaveDuplicates: number };
	overflow: {
		childSessions: number;
		workerRoles: number;
		readSignatures: number;
		signatureInputs: number;
		counterSaturations: number;
	};
};

const unavailableMetric = { value: null, provenance: "unavailable" } as const;

function hostMetric(value: number, available = true) {
	return available
		? ({ value, provenance: "host_observed" } as const)
		: unavailableMetric;
}

export function adaptSanitizedHostObservation(input: {
	variant: "control" | HarnessCandidateVariant;
	sourceRevisionKey: string;
	modelConfigurationKey: string;
	report: SanitizedHostObservationProjection;
	quality: HarnessQualityOracle | null;
}): HarnessObservation {
	const { report } = input;
	const countersReliable = report.overflow.counterSaturations === 0;
	const inputTokens = report.tokens.input;
	const cacheReadTokens = report.tokens.cacheRead;
	const uncachedInputTokens =
		countersReliable &&
		inputTokens.provenance === "host_observed" &&
		cacheReadTokens.provenance === "host_observed" &&
		inputTokens.value !== null &&
		cacheReadTokens.value !== null
			? hostMetric(Math.max(0, inputTokens.value - cacheReadTokens.value))
			: unavailableMetric;
	return harnessObservationSchema.parse({
		variant: input.variant,
		status: input.quality ? "observed" : "unavailable",
		sourceRevisionKey: input.sourceRevisionKey,
		modelConfigurationKey: input.modelConfigurationKey,
		waveCount: unavailableMetric,
		sessionCount: hostMetric(
			Math.min(Number.MAX_SAFE_INTEGER, report.children.count + 1),
			countersReliable && report.overflow.childSessions === 0,
		),
		childSessionCount: hostMetric(
			report.children.count,
			countersReliable && report.overflow.childSessions === 0,
		),
		workerCount: hostMetric(
			report.children.workerRoleCount,
			countersReliable && report.overflow.workerRoles === 0,
		),
		toolCallCount: hostMetric(report.tools.calls, countersReliable),
		readCallCount: hostMetric(report.reads.total, countersReliable),
		uniqueReadCount: hostMetric(
			report.reads.unique,
			countersReliable && report.overflow.readSignatures === 0,
		),
		sameWaveDuplicateReadCount: hostMetric(
			report.reads.sameWaveDuplicates,
			countersReliable && report.overflow.readSignatures === 0,
		),
		repeatedResultBytes: unavailableMetric,
		uncachedInputTokens,
		quality: input.quality,
	});
}

export function canEnableHarnessEnforcement(
	report: HarnessResourceReport,
	variant: HarnessCandidateVariant,
): boolean {
	return report.gates.some(
		(gate) => gate.variant === variant && gate.status === "pass",
	);
}

export function resolvePromotedHarnessRollout(input: {
	report: HarnessResourceReport;
	variant: HarnessCandidateVariant;
	requested: "observe" | "enforce";
}): "observe" | "enforce" {
	if (input.requested === "observe") return "observe";
	return canEnableHarnessEnforcement(input.report, input.variant)
		? "enforce"
		: "observe";
}
