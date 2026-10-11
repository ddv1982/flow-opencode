import type {
	EvidenceEntry,
	FeatureRun,
	ReviewFinding,
	Session,
	SessionClosure,
	ValidationObservation,
} from "../domain/session.js";
import { currentRun, planGate } from "../domain/session.js";
import { isFeatureComplete } from "../domain/session-queries.js";
import {
	isAcceptedObservedGate,
	isAcceptedValidation,
	resolveValidationPolicy,
	unsatisfiedEvidence,
} from "../domain/validation.js";
import {
	digestReportLines,
	type FindingsDigest,
	findingsDigest,
} from "./findings-digest.js";

type AssuranceCheck = Readonly<{
	id: string;
	label: string;
	status: "satisfied" | "unsatisfied" | "not-applicable";
	tier: "ts-enforced" | "host-attested" | "caller-declared";
	explanation: string;
}>;

type AssuranceProjection = Readonly<{
	conclusion:
		| "completion-supported"
		| "completion-unsupported"
		| "completion-not-claimed";
	checks: ReadonlyArray<AssuranceCheck>;
	limitations: ReadonlyArray<string>;
}>;

type DeliveryFeatureProjection = Readonly<{
	id: string;
	title: string;
	attempts: number;
	latestState: FeatureRun["state"] | "not-started";
	outcomeSummary: string | null;
	terminalFindings: ReadonlyArray<
		Readonly<Pick<ReviewFinding, "severity" | "summary">>
	>;
}>;

export type DeliveryProjection = Readonly<{
	handoff: Readonly<{
		formatVersion: 1;
		externalActionAuthority: "not-granted";
	}>;
	goal: string;
	closure: Readonly<{ kind: SessionClosure["kind"]; summary: string }>;
	progress: Readonly<{ completed: number; total: number }>;
	features: ReadonlyArray<DeliveryFeatureProjection>;
	reportedArtifacts: Readonly<{
		latestAttempts: ReadonlyArray<string>;
		supersededAttemptsOnly: ReadonlyArray<string>;
	}>;
	assurance: AssuranceProjection;
	findingsDigest: FindingsDigest;
	observations?: readonly ValidationObservation[];
	report: ReadonlyArray<string>;
	summary: Readonly<{
		lines: ReadonlyArray<string>;
		fullReportAvailable: true;
	}>;
}>;

const LIMITATIONS = [
	"Artifact paths and the canonical gate are caller declarations; Flow validates binding, not completeness or fitness.",
	"Goal alignment, scope discipline, evidence completeness, requirement coverage, test adequacy, and review substance remain model judgments.",
	"Freshness holds when review is accepted; an archive does not attest the current workspace.",
] as const;

/** Tiered support for a recorded closure, derived rather than persisted. */
export function assuranceProjection(session: Session): AssuranceProjection {
	if (!session.closure)
		throw new Error("Assurance requires a recorded closure.");
	const complete = session.closure.kind === "completed";
	const features = session.plan?.features ?? [];
	const runs = features.flatMap((feature) => {
		const run = currentRun(session, feature.id);
		return run ? [run] : [];
	});
	const accepted = runs.flatMap((run) => {
		const ids = new Set(
			run.reviews
				.filter((review) => review.result?.verdict === "passed")
				.flatMap((review) => review.validationIds),
		);
		return run.validations.filter(
			(observation) =>
				ids.has(observation.id) && isAcceptedValidation(session, observation),
		);
	});
	const check = (
		id: string,
		label: string,
		tier: AssuranceCheck["tier"],
		satisfied: boolean,
		explanation: string,
	): AssuranceCheck => ({
		id,
		label,
		tier,
		status: complete
			? satisfied
				? "satisfied"
				: "unsatisfied"
			: "not-applicable",
		explanation: complete
			? explanation
			: `${session.closure?.kind} closure makes no completion claim.`,
	});
	const completed = features.filter((feature) =>
		isFeatureComplete(session, feature.id),
	).length;
	const passing = runs.filter((run) =>
		run.reviews.some((review) => review.result?.verdict === "passed"),
	).length;
	const structural =
		session.plan !== null &&
		features.length > 0 &&
		completed === features.length &&
		passing === features.length &&
		runs.some((run) =>
			run.reviews.some(
				(review) =>
					review.kind === "final" && review.result?.verdict === "passed",
			),
		) &&
		!runs.some((run) =>
			(run.reviews.at(-1)?.result?.findings ?? []).some(
				(finding) => finding.severity === "blocking",
			),
		);
	const checks: AssuranceCheck[] = [
		check(
			"recorded-completion",
			"Recorded completion",
			"ts-enforced",
			structural,
			`${completed}/${features.length} features and ${passing}/${features.length} independent reviews pass, including a final review with no terminal blocker.`,
		),
		check(
			"accepted-validation",
			"Accepted validation",
			"host-attested",
			runs.length === features.length &&
				runs.every((run) =>
					accepted.some((observation) => observation.runId === run.id),
				),
			`${runs.filter((run) => accepted.some((item) => item.runId === run.id)).length}/${features.length} terminal runs have eligible host evidence accepted by review.`,
		),
	];
	const gate = planGate(session.plan);
	const observedGate = session.plan?.evidence?.find(
		(entry) => entry.scope === "gate-observe",
	);
	const reviewedGate = runs
		.filter((run) => run.state === "completed" || run.state === "blocked")
		.flatMap((run) =>
			run.reviews.flatMap((review) => {
				const result = review.result;
				if (!result) return [];
				const references = new Set(review.validationIds);
				return run.validations
					.filter(
						(observation) =>
							references.has(observation.id) &&
							observation.command === gate &&
							observation.scope === "broad",
					)
					.map((observation) => ({ observation, verdict: result.verdict }));
			}),
		)
		.toSorted(
			(left, right) =>
				left.observation.recordedRevision - right.observation.recordedRevision,
		)
		.at(-1);
	const acceptedGate = accepted.findLast(
		(observation) =>
			observation.command === gate && observation.scope === "broad",
	);
	checks.push(
		gate === undefined
			? {
					id: "canonical-gate",
					label: "Canonical gate",
					tier: "caller-declared",
					status: "not-applicable",
					explanation: "This plan declared no canonical gate.",
				}
			: check(
					"canonical-gate",
					observedGate ? "Canonical gate observation" : "Canonical gate",
					"host-attested",
					observedGate
						? reviewedGate?.verdict === "passed" &&
								isAcceptedObservedGate(session, reviewedGate.observation)
						: acceptedGate !== undefined,
					observedGate
						? `${JSON.stringify(gate)} was observed with exit ${reviewedGate?.observation.exitCode ?? "unavailable"}; this does not claim the command passed.`
						: `${JSON.stringify(gate)} must have passing broad evidence accepted by review.`,
				),
	);
	const declared = session.plan?.evidence;
	const missing = unsatisfiedEvidence(session).length;
	checks.push(
		declared === undefined
			? {
					id: "declared-evidence",
					label: "Declared evidence",
					tier: "caller-declared",
					status: "not-applicable",
					explanation: "This plan declared no evidence obligations.",
				}
			: check(
					"declared-evidence",
					"Declared evidence",
					declared.length === 0 ? "caller-declared" : "host-attested",
					missing === 0,
					`${declared.length - missing}/${declared.length} declared obligations have accepted evidence on their declared host; observed gates do not claim a pass.`,
				),
	);
	return {
		conclusion: !complete
			? "completion-not-claimed"
			: checks.some((item) => item.status === "unsatisfied")
				? "completion-unsupported"
				: "completion-supported",
		checks,
		limitations: [...LIMITATIONS],
	};
}

const TIER_LABELS = {
	"ts-enforced": "TS-enforced",
	"host-attested": "host-attested",
	"caller-declared": "caller-declared",
} as const;

function formatReport(
	delivery: Omit<DeliveryProjection, "report" | "summary">,
): string[] {
	const lines = delivery.features.flatMap((feature) => [
		`- ${feature.id} — ${feature.title}`,
		`  attempts: ${feature.attempts}; latest state: ${feature.latestState}`,
		`  outcome: ${feature.outcomeSummary ?? "none recorded"}`,
		...(feature.terminalFindings.length === 0
			? ["  terminal findings: none"]
			: [
					"  terminal findings:",
					...feature.terminalFindings.map(
						(finding) => `  - ${finding.severity}: ${finding.summary}`,
					),
				]),
	]);
	return [
		`Handoff format: ${delivery.handoff.formatVersion}`,
		`External action authority: ${delivery.handoff.externalActionAuthority}`,
		`Goal: ${delivery.goal}`,
		`Closure: ${delivery.closure.kind}${delivery.closure.summary ? ` — ${delivery.closure.summary}` : ""}`,
		`Progress: ${delivery.progress.completed} of ${delivery.progress.total} features complete`,
		"Features:",
		...lines,
		...digestReportLines(delivery.findingsDigest),
		...(delivery.observations ?? []).map(
			(observation) =>
				`Observed ${JSON.stringify(observation.command)}: exit ${observation.exitCode ?? "unavailable"}, host ${observation.hostPlatform ?? "unrecorded"}, source ${observation.sourceDigest}, output ${observation.outputDigest}${observation.resultsPath ? `, report ${JSON.stringify(observation.resultsPath)}` : ""}; this does not claim the command passed.`,
		),
		`Assurance: ${delivery.assurance.conclusion.replaceAll("-", " ")}`,
		"Assurance checks:",
		...delivery.assurance.checks.map(
			(item) =>
				`- ${item.status} [${TIER_LABELS[item.tier]}] ${item.label}: ${item.explanation}`,
		),
		"Assurance limitations:",
		...delivery.assurance.limitations.map((item) => `- ${item}`),
		"Artifacts as reported by Flow from caller declarations, not an exact or exhaustive Git delta:",
		`- latest attempts: ${delivery.reportedArtifacts.latestAttempts.join(", ") || "none reported"}`,
		`- superseded attempts only: ${delivery.reportedArtifacts.supersededAttemptsOnly.join(", ") || "none reported"}`,
	];
}

function formatSummary(
	delivery: Omit<DeliveryProjection, "report" | "summary">,
	unfinishedFeatureIds: readonly string[],
	unfulfilledEvidence: readonly EvidenceEntry[],
): string[] {
	const live = delivery.findingsDigest.filter((finding) => finding.live);
	const checks = delivery.assurance.checks;
	return [
		`Handoff format: ${delivery.handoff.formatVersion}`,
		`External action authority: ${delivery.handoff.externalActionAuthority}`,
		`Goal: ${delivery.goal}`,
		`Closure: ${delivery.closure.kind}`,
		`Progress: ${delivery.progress.completed} of ${delivery.progress.total} features complete`,
		`Unfinished features: ${unfinishedFeatureIds.join(", ") || "none"}`,
		...unfulfilledEvidence.map(
			(entry) =>
				`Unfulfilled required evidence: platform ${entry.platform ?? "unrecorded"}, command ${JSON.stringify(entry.command)}`,
		),
		...live
			.filter((finding) => finding.severity === "blocking")
			.map(
				(finding) =>
					`Blocking finding ${finding.featureId} ${finding.findingId}: ${finding.summary}`,
			),
		`Nonblocking live findings: advisory ${live.filter((finding) => finding.severity === "advisory").length}. Historical findings: ${delivery.findingsDigest.length - live.length}.`,
		...(delivery.observations ?? []).map(
			(observation) =>
				`Observed ${JSON.stringify(observation.command)}: exit ${observation.exitCode ?? "unavailable"}, host ${observation.hostPlatform ?? "unrecorded"}; this does not claim the command passed.`,
		),
		`Assurance: ${delivery.assurance.conclusion.replaceAll("-", " ")}`,
		`Assurance checks: ${checks.filter((check) => check.status === "satisfied").length} satisfied, ${checks.filter((check) => check.status === "not-applicable").length} not applicable, ${checks.filter((check) => check.status === "unsatisfied").length} unsatisfied.`,
		...checks
			.filter((check) => check.status === "unsatisfied")
			.map(
				(check) =>
					`- unsatisfied ${check.id} [${TIER_LABELS[check.tier]}] ${check.label}: ${check.explanation}`,
			),
		...delivery.assurance.limitations.map((limitation) => `- ${limitation}`),
		`Reported artifacts: ${delivery.reportedArtifacts.latestAttempts.length} latest, ${delivery.reportedArtifacts.supersededAttemptsOnly.length} superseded only. Caller declarations, not an exact or exhaustive Git delta.`,
		"Full report is included in this close response.",
	];
}

export function deliveryProjection(session: Session): DeliveryProjection {
	if (!session.closure)
		throw new Error("Delivery requires a recorded closure.");
	const features = session.plan?.features ?? [];
	const grouped = features.map((feature) => ({
		feature,
		runs: session.runs.filter((run) => run.featureId === feature.id),
	}));
	const latest = grouped.flatMap(({ runs }) => runs.slice(-1));
	const latestArtifacts = new Set(
		latest.flatMap((run) => run.artifactsChanged.map((item) => item.path)),
	);
	const allArtifacts = new Set(
		session.runs.flatMap((run) =>
			run.artifactsChanged.map((item) => item.path),
		),
	);
	const digest = findingsDigest(session);
	const observations = latest.flatMap((run) => {
		const assigned = new Set(
			run.reviews
				.filter((review) => review.result !== null)
				.flatMap((review) => review.validationIds),
		);
		return run.validations.filter(
			(observation) =>
				assigned.has(observation.id) &&
				resolveValidationPolicy(session, run.featureId, observation.command)
					.intent === "observe",
		);
	});
	const delivery = {
		handoff: { formatVersion: 1, externalActionAuthority: "not-granted" },
		goal: session.goal,
		closure: { kind: session.closure.kind, summary: session.closure.summary },
		progress: {
			completed: features.filter((feature) =>
				isFeatureComplete(session, feature.id),
			).length,
			total: features.length,
		},
		features: grouped.map(({ feature, runs }) => {
			const run = runs.at(-1);
			return {
				id: feature.id,
				title: feature.title,
				attempts: runs.length,
				latestState: run?.state ?? "not-started",
				outcomeSummary: run?.summary ?? null,
				terminalFindings: digest
					.filter((row) => row.featureId === feature.id && row.live)
					.map(({ severity, summary }) => ({ severity, summary })),
			};
		}),
		reportedArtifacts: {
			latestAttempts: [...latestArtifacts].sort(),
			supersededAttemptsOnly: [...allArtifacts]
				.filter((path) => !latestArtifacts.has(path))
				.sort(),
		},
		assurance: assuranceProjection(session),
		findingsDigest: digest,
		...(observations.length > 0 ? { observations } : {}),
	} satisfies Omit<DeliveryProjection, "report" | "summary">;
	return {
		...delivery,
		report: formatReport(delivery),
		summary: {
			lines: formatSummary(
				delivery,
				features
					.filter((feature) => !isFeatureComplete(session, feature.id))
					.map((feature) => feature.id),
				unsatisfiedEvidence(session),
			),
			fullReportAvailable: true,
		},
	};
}
