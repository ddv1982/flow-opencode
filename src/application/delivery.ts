import type {
	FeatureRun,
	ReviewFinding,
	Session,
	SessionClosure,
} from "../domain/session.js";
import { isFeatureComplete } from "../domain/transitions.js";
import {
	isValidationEligible,
	unsatisfiedExternalEvidence,
} from "../domain/validation.js";

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
	goal: string;
	closure: Readonly<{ kind: SessionClosure["kind"]; summary: string }>;
	progress: Readonly<{ completed: number; total: number }>;
	features: ReadonlyArray<DeliveryFeatureProjection>;
	reportedArtifacts: Readonly<{
		latestAttempts: ReadonlyArray<string>;
		supersededAttemptsOnly: ReadonlyArray<string>;
	}>;
	assurance: AssuranceProjection;
	report: ReadonlyArray<string>;
}>;

const LIMITATIONS = [
	"Artifact paths and the canonical gate are caller declarations; Flow validates binding, not completeness or fitness.",
	"Goal alignment, scope discipline, evidence completeness, requirement coverage, test adequacy, and review substance remain model judgments.",
	"Freshness holds when review is accepted; an archive does not attest the current workspace.",
] as const;

function currentRun(
	session: Session,
	featureId: string,
): FeatureRun | undefined {
	return session.runs.findLast(
		(run) => run.featureId === featureId && run.state !== "superseded",
	);
}

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
				ids.has(observation.id) && isValidationEligible(observation),
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
	const gate = session.plan?.gate;
	checks.push(
		gate === undefined
			? {
					id: "canonical-gate",
					label: "Canonical gate",
					tier: "caller-declared",
					status: "not-applicable",
					explanation: "This legacy plan declared no canonical gate.",
				}
			: check(
					"canonical-gate",
					"Canonical gate",
					"host-attested",
					accepted.some(
						(observation) =>
							observation.command === gate && observation.scope === "broad",
					),
					`${JSON.stringify(gate)} must have eligible broad evidence accepted by review.`,
				),
	);
	const declared = session.plan?.externalEvidence;
	const missing = unsatisfiedExternalEvidence(session).length;
	checks.push(
		declared === undefined
			? {
					id: "external-evidence",
					label: "Declared external evidence",
					tier: "caller-declared",
					status: "not-applicable",
					explanation:
						"This legacy plan declared no external-evidence obligations.",
				}
			: check(
					"external-evidence",
					"Declared external evidence",
					declared.length === 0 ? "caller-declared" : "host-attested",
					missing === 0,
					`${declared.length - missing}/${declared.length} declared obligations have eligible evidence on their declared host with named cases passing.`,
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

function formatReport(delivery: Omit<DeliveryProjection, "report">): string[] {
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
		`Goal: ${delivery.goal}`,
		`Closure: ${delivery.closure.kind}${delivery.closure.summary ? ` — ${delivery.closure.summary}` : ""}`,
		`Progress: ${delivery.progress.completed} of ${delivery.progress.total} features complete`,
		"Features:",
		...lines,
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
	const delivery = {
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
				terminalFindings:
					run?.reviews
						.at(-1)
						?.result?.findings.map(({ severity, summary }) => ({
							severity,
							summary,
						})) ?? [],
			};
		}),
		reportedArtifacts: {
			latestAttempts: [...latestArtifacts].sort(),
			supersededAttemptsOnly: [...allArtifacts]
				.filter((path) => !latestArtifacts.has(path))
				.sort(),
		},
		assurance: assuranceProjection(session),
	} satisfies Omit<DeliveryProjection, "report">;
	return { ...delivery, report: formatReport(delivery) };
}
