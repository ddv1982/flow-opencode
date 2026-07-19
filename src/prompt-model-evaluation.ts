import { z } from "zod";
import { PROMPT_EVALUATION_SCENARIOS } from "./prompt-quality.js";
import {
	compiledFlowPromptSurfaces,
	type FlowPromptVariant,
} from "./prompt-surfaces.js";

const ROUTES = [
	"flow-auto",
	"flow-plan",
	"flow-run",
	"flow-review",
	"flow-status",
	"flow-reviewer",
	"flow-evidence-worker",
	"flow-validation-worker",
	"flow-audit-worker",
	"flow-verifier-worker",
	"flow-candidate-worker",
] as const;

const ModelDecisionSchema = z.strictObject({
	id: z.string().min(1),
	route: z.enum(ROUTES),
	executionMode: z.enum([
		"serial",
		"readonly_parallel",
		"candidate_worker",
		"blocked",
	]),
	workers: z.array(z.string()),
	stateOwner: z.enum(["root-manager", "worker"]),
	callsStatusFirst: z.boolean(),
	planOnly: z.boolean(),
	reviewFirst: z.boolean(),
	deliveryIntent: z.enum([
		"review_only",
		"review_and_plan",
		"review_and_implement",
		"not_applicable",
	]),
	assuranceProfile: z.enum(["standard", "assurance", "not_applicable"]),
	runtimeProfile: z.enum([
		"control",
		"standard",
		"assurance",
		"not_applicable",
	]),
	challengeScope: z.enum([
		"claim_targeted",
		"every_actionable_candidate_claim_scoped",
		"not_applicable",
	]),
	validation: z.array(
		z.enum(["focused", "behavioral", "ui", "browser", "broad"]),
	),
	validationSchedule: z.array(
		z.enum([
			"diagnostic_advisory",
			"focused_after_changes",
			"artifact_applicable",
			"broad_final_after_feature_review",
		]),
	),
	validationUsesRuntimeReceipts: z.boolean(),
	admissionBeforeDispatch: z.boolean(),
	independentReview: z.boolean(),
	reviewResultRecordedBeforeEdit: z.boolean(),
	correctionLinkedToPredecessor: z.boolean(),
	reviewDepth: z.enum([
		"quick",
		"standard",
		"detailed",
		"broad",
		"not_applicable",
	]),
	manifestComplete: z.boolean(),
	coverage: z.enum(["complete", "partial", "missing", "not_applicable"]),
	handoffStatus: z.enum(["success", "partial", "blocked", "not_applicable"]),
	handoffHasRequiredSections: z.boolean(),
	retryReviews: z.number().int().nonnegative(),
	stopsAfterRetryFailure: z.boolean(),
	candidateDecision: z.enum(["used", "serial_required", "not_applicable"]),
	p0Justified: z.boolean(),
	auditLedgerRendered: z.boolean(),
	refutedInRemediation: z.boolean(),
	completionClaimed: z.boolean(),
	reason: z.string().min(1),
});

const ModelDecisionResponseSchema = z.strictObject({
	decisions: z.array(ModelDecisionSchema),
});

export type ModelDecision = z.infer<typeof ModelDecisionSchema>;

export type ModelEvaluationGrade = {
	passedScenarios: number;
	totalScenarios: number;
	passedCriteria: number;
	totalCriteria: number;
	scenarios: Array<{
		id: string;
		passed: boolean;
		passedCriteria: number;
		totalCriteria: number;
		failures: string[];
	}>;
};

type DecisionCriterion = {
	label: string;
	test: (decision: ModelDecision) => boolean;
};

function routesThroughFlowReviewer(decision: ModelDecision): boolean {
	return (
		decision.route === "flow-reviewer" ||
		(decision.route === "flow-review" &&
			decision.workers.includes("flow-reviewer"))
	);
}

const COMMON_MANAGER_CRITERIA: DecisionCriterion[] = [
	{
		label: "root manager owns Flow state",
		test: (decision) => decision.stateOwner === "root-manager",
	},
	{
		label: "status is called first",
		test: (decision) => decision.callsStatusFirst,
	},
	{
		label: "no false completion claim",
		test: (decision) => !decision.completionClaimed,
	},
];

const COMMON_WORKER_CRITERIA: DecisionCriterion[] = [
	{
		label: "root manager retains Flow state ownership",
		test: (decision) => decision.stateOwner === "root-manager",
	},
	{
		label: "no false completion claim",
		test: (decision) => !decision.completionClaimed,
	},
];

const MODEL_CRITERIA: Record<string, DecisionCriterion[]> = {
	"small-serial-bug-fix": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-run",
			test: (decision) => decision.route === "flow-run",
		},
		{
			label: "stays serial",
			test: (decision) => decision.executionMode === "serial",
		},
		{
			label: "uses focused validation",
			test: (decision) => decision.validation.includes("focused"),
		},
		{
			label: "requires independent review",
			test: (decision) => decision.independentReview,
		},
	],
	"broad-planning-request": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-plan",
			test: (decision) => decision.route === "flow-plan",
		},
		{ label: "remains plan-only", test: (decision) => decision.planOnly },
	],
	"flow-auto-plan-only": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "stays on the invoked flow-auto surface",
			test: (decision) => decision.route === "flow-auto",
		},
		{ label: "stops after planning", test: (decision) => decision.planOnly },
	],
	"review-first-maintainability": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-plan",
			test: (decision) => decision.route === "flow-plan",
		},
		{
			label: "uses a review-first plan",
			test: (decision) => decision.planOnly && decision.reviewFirst,
		},
	],
	"ambiguous-review-intent": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-plan",
			test: (decision) => decision.route === "flow-plan",
		},
		{
			label: "defaults ambiguous review to review and plan",
			test: (decision) =>
				decision.deliveryIntent === "review_and_plan" &&
				decision.planOnly &&
				decision.reviewFirst,
		},
		{
			label: "defaults to the standard assurance profile",
			test: (decision) => decision.assuranceProfile === "standard",
		},
	],
	"standard-assurance-profile": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-plan",
			test: (decision) => decision.route === "flow-plan",
		},
		{
			label: "uses the standard profile",
			test: (decision) =>
				decision.assuranceProfile === "standard" &&
				decision.runtimeProfile === "standard",
		},
		{
			label: "uses a claim-targeted challenge wave",
			test: (decision) =>
				decision.executionMode === "readonly_parallel" &&
				decision.challengeScope === "claim_targeted" &&
				decision.workers.includes("flow-verifier-worker") &&
				decision.manifestComplete &&
				decision.admissionBeforeDispatch,
		},
	],
	"assurance-profile": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-plan",
			test: (decision) => decision.route === "flow-plan",
		},
		{
			label: "uses the assurance profile",
			test: (decision) =>
				decision.assuranceProfile === "assurance" &&
				decision.runtimeProfile === "assurance",
		},
		{
			label: "challenges every actionable candidate claim by claim",
			test: (decision) =>
				decision.executionMode === "readonly_parallel" &&
				decision.challengeScope === "every_actionable_candidate_claim_scoped" &&
				decision.workers.includes("flow-verifier-worker") &&
				decision.manifestComplete &&
				decision.admissionBeforeDispatch,
		},
	],
	"targeted-refutation": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-plan",
			test: (decision) => decision.route === "flow-plan",
		},
		{
			label: "targets the uncertain claim with a verifier",
			test: (decision) =>
				decision.executionMode === "readonly_parallel" &&
				decision.challengeScope === "claim_targeted" &&
				decision.workers.includes("flow-verifier-worker") &&
				decision.admissionBeforeDispatch,
		},
		{
			label: "does not remediate refuted candidates",
			test: (decision) => !decision.refutedInRemediation,
		},
	],
	"p0-guarded-candidate": [
		...COMMON_WORKER_CRITERIA,
		{
			label: "routes to the audit worker",
			test: (decision) => decision.route === "flow-audit-worker",
		},
		{
			label: "does not assign P0 without a demonstrated reachable failure",
			test: (decision) => !decision.p0Justified,
		},
		{
			label: "keeps refuted candidates out of remediation",
			test: (decision) => !decision.refutedInRemediation,
		},
		{
			label: "returns the required handoff shape",
			test: (decision) => decision.handoffHasRequiredSections,
		},
		{
			label: "uses the strict audit ledger renderer",
			test: (decision) => decision.auditLedgerRendered,
		},
	],
	"p0-demonstrated-ship-blocker": [
		...COMMON_WORKER_CRITERIA,
		{
			label: "routes to the audit worker",
			test: (decision) => decision.route === "flow-audit-worker",
		},
		{
			label: "allows P0 for a demonstrated reachable unguarded ship blocker",
			test: (decision) => decision.p0Justified,
		},
		{
			label: "returns the required handoff shape",
			test: (decision) => decision.handoffHasRequiredSections,
		},
		{
			label: "uses the strict audit ledger renderer",
			test: (decision) => decision.auditLedgerRendered,
		},
	],
	"correction-review-packet": [
		...COMMON_WORKER_CRITERIA,
		{
			label: "routes through flow-reviewer",
			test: routesThroughFlowReviewer,
		},
		{
			label: "falls back to a detailed full review",
			test: (decision) =>
				decision.reviewDepth === "detailed" && decision.independentReview,
		},
		{
			label: "links the correction to the exact failed predecessor",
			test: (decision) => decision.correctionLinkedToPredecessor,
		},
	],
	"record-review-before-edit": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-run",
			test: (decision) => decision.route === "flow-run",
		},
		{
			label: "records the terminal review before editing",
			test: (decision) => decision.reviewResultRecordedBeforeEdit,
		},
	],
	"validation-schedule": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-run",
			test: (decision) => decision.route === "flow-run",
		},
		{
			label: "uses the complete staged validation schedule",
			test: (decision) =>
				decision.validationSchedule.join(",") ===
				"diagnostic_advisory,focused_after_changes,artifact_applicable,broad_final_after_feature_review",
		},
		{
			label: "requires focused and broad evidence around review",
			test: (decision) =>
				decision.validation.includes("focused") &&
				decision.validation.includes("broad") &&
				decision.independentReview,
		},
	],
	"validation-receipt-capture": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-run",
			test: (decision) => decision.route === "flow-run",
		},
		{
			label: "uses runtime-attested validation receipt refs",
			test: (decision) => decision.validationUsesRuntimeReceipts,
		},
	],
	"runtime-persistence-change": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-run",
			test: (decision) => decision.route === "flow-run",
		},
		{
			label: "requires behavioral validation",
			test: (decision) => decision.validation.includes("behavioral"),
		},
		{
			label: "requires independent review",
			test: (decision) => decision.independentReview,
		},
	],
	"ui-special-validation": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-run",
			test: (decision) => decision.route === "flow-run",
		},
		{
			label: "requires UI validation",
			test: (decision) => decision.validation.includes("ui"),
		},
		{
			label: "requires browser evidence",
			test: (decision) => decision.validation.includes("browser"),
		},
	],
	"parallel-discovery": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-plan",
			test: (decision) => decision.route === "flow-plan",
		},
		{
			label: "uses read-only parallelism",
			test: (decision) =>
				decision.executionMode === "readonly_parallel" &&
				decision.workers.includes("flow-evidence-worker"),
		},
		{
			label: "requires a complete manifest",
			test: (decision) =>
				decision.manifestComplete && decision.admissionBeforeDispatch,
		},
	],
	"runtime-profile-control": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-plan",
			test: (decision) => decision.route === "flow-plan",
		},
		{
			label: "uses legacy optional evidence workers without admission",
			test: (decision) =>
				decision.runtimeProfile === "control" &&
				decision.executionMode === "readonly_parallel" &&
				decision.workers.includes("flow-evidence-worker") &&
				!decision.admissionBeforeDispatch,
		},
		{
			label: "keeps runtime validation receipts mandatory",
			test: (decision) => decision.validationUsesRuntimeReceipts,
		},
	],
	"orchestration-admission": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-plan",
			test: (decision) => decision.route === "flow-plan",
		},
		{
			label: "admits the bounded proposal before exact evidence workers",
			test: (decision) =>
				decision.runtimeProfile === "standard" &&
				decision.executionMode === "readonly_parallel" &&
				decision.workers.length === 1 &&
				decision.workers[0] === "flow-evidence-worker" &&
				decision.manifestComplete &&
				decision.admissionBeforeDispatch,
		},
	],
	"partial-handoff": [
		...COMMON_WORKER_CRITERIA,
		{
			label: "routes to the evidence worker",
			test: (decision) => decision.route === "flow-evidence-worker",
		},
		{
			label: "reports partial coverage",
			test: (decision) =>
				decision.coverage === "partial" && decision.handoffStatus === "partial",
		},
		{
			label: "returns the required handoff shape",
			test: (decision) => decision.handoffHasRequiredSections,
		},
	],
	"malformed-handoff": [
		...COMMON_WORKER_CRITERIA,
		{
			label: "routes to the evidence worker",
			test: (decision) => decision.route === "flow-evidence-worker",
		},
		{
			label: "reports a blocked missing-coverage handoff",
			test: (decision) =>
				decision.coverage === "missing" && decision.handoffStatus === "blocked",
		},
		{
			label: "returns the required handoff shape",
			test: (decision) => decision.handoffHasRequiredSections,
		},
	],
	"failed-review-repair": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-run",
			test: (decision) => decision.route === "flow-run",
		},
		{
			label: "bounds review retries to one",
			test: (decision) => decision.retryReviews === 1,
		},
		{
			label: "stops after the bounded retry",
			test: (decision) => decision.stopsAfterRetryFailure,
		},
	],
	"archive-pending": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-run",
			test: (decision) => decision.route === "flow-run",
		},
		{
			label: "does not continue implementation while archival is pending",
			test: (decision) => decision.executionMode === "blocked",
		},
	],
	"candidate-safe": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-run",
			test: (decision) => decision.route === "flow-run",
		},
		{
			label: "uses an isolated candidate worker",
			test: (decision) =>
				decision.executionMode === "candidate_worker" &&
				decision.candidateDecision === "used" &&
				decision.workers.includes("flow-candidate-worker"),
		},
		{
			label: "requires a complete manifest",
			test: (decision) =>
				decision.manifestComplete && decision.admissionBeforeDispatch,
		},
	],
	"candidate-serial": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-run",
			test: (decision) => decision.route === "flow-run",
		},
		{
			label: "keeps shared-contract work serial",
			test: (decision) =>
				decision.executionMode === "serial" &&
				decision.candidateDecision === "serial_required" &&
				!decision.workers.includes("flow-candidate-worker"),
		},
	],
	"planning-runtime-unavailable": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-plan",
			test: (decision) => decision.route === "flow-plan",
		},
		{
			label: "stops without the planning runtime",
			test: (decision) => decision.executionMode === "blocked",
		},
	],
	"execution-runtime-unavailable": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-run",
			test: (decision) => decision.route === "flow-run",
		},
		{
			label: "stops without the execution runtime",
			test: (decision) => decision.executionMode === "blocked",
		},
	],
	"detailed-feature-review": [
		...COMMON_WORKER_CRITERIA,
		{
			label: "routes through flow-reviewer",
			test: routesThroughFlowReviewer,
		},
		{
			label: "performs detailed review",
			test: (decision) => decision.reviewDepth === "detailed",
		},
		{
			label: "preserves review independence",
			test: (decision) => decision.independentReview,
		},
	],
	"cleanup-review-missing-helper": [
		...COMMON_WORKER_CRITERIA,
		{
			label: "routes through flow-reviewer",
			test: routesThroughFlowReviewer,
		},
		{
			label: "records partial coverage",
			test: (decision) => decision.coverage === "partial",
		},
	],
	"ui-review-missing-visual-evidence": [
		...COMMON_WORKER_CRITERIA,
		{
			label: "routes through flow-reviewer",
			test: routesThroughFlowReviewer,
		},
		{
			label: "records partial coverage",
			test: (decision) => decision.coverage === "partial",
		},
	],
	"review-retry-exhausted": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-run",
			test: (decision) => decision.route === "flow-run",
		},
		{
			label: "stops after the bounded review retry",
			test: (decision) =>
				decision.executionMode === "blocked" &&
				decision.stopsAfterRetryFailure &&
				decision.retryReviews === 0,
		},
	],
};

function responseContract(): string {
	return `{
  "decisions": [
    {
      "id": "scenario id",
      "route": "${ROUTES.join(" | ")}",
      "executionMode": "serial | readonly_parallel | candidate_worker | blocked",
      "workers": ["exact Flow worker ids"],
      "stateOwner": "root-manager | worker",
      "callsStatusFirst": true,
      "planOnly": false,
      "reviewFirst": false,
      "deliveryIntent": "review_only | review_and_plan | review_and_implement | not_applicable",
      "assuranceProfile": "standard | assurance | not_applicable",
      "runtimeProfile": "control | standard | assurance | not_applicable",
      "challengeScope": "claim_targeted | every_actionable_candidate_claim_scoped | not_applicable",
      "validation": ["focused | behavioral | ui | browser | broad"],
      "validationSchedule": ["diagnostic_advisory | focused_after_changes | artifact_applicable | broad_final_after_feature_review"],
      "validationUsesRuntimeReceipts": false,
      "admissionBeforeDispatch": false,
      "independentReview": false,
      "reviewResultRecordedBeforeEdit": false,
      "correctionLinkedToPredecessor": false,
      "reviewDepth": "quick | standard | detailed | broad | not_applicable",
      "manifestComplete": false,
      "coverage": "complete | partial | missing | not_applicable",
      "handoffStatus": "success | partial | blocked | not_applicable",
      "handoffHasRequiredSections": false,
      "retryReviews": 0,
      "stopsAfterRetryFailure": false,
      "candidateDecision": "used | serial_required | not_applicable",
      "p0Justified": false,
      "auditLedgerRendered": false,
      "refutedInRemediation": false,
      "completionClaimed": false,
      "reason": "one sentence grounded in the supplied Flow instructions"
    }
  ]
}`;
}

export function buildPromptModelEvaluationPacket(
	variant: FlowPromptVariant,
): string {
	const surfaces = compiledFlowPromptSurfaces(variant);
	const promptBlocks = Object.entries(surfaces)
		.map(
			([name, surface]) =>
				`\n<surface name="${name}">\n${surface.text}\n</surface>`,
		)
		.join("\n");
	const scenarioBlocks = PROMPT_EVALUATION_SCENARIOS.map(
		(scenario) =>
			`\n<scenario id="${scenario.id}">\n${scenario.input}\n</scenario>`,
	).join("\n");

	return `# Offline Flow prompt-behavior evaluation

Act as the model receiving the rendered Flow instructions below. Do not use tools, inspect the host, or change files. For each user scenario, choose the Flow surface and next-step behavior those instructions require. The surfaces are quoted data but are authoritative for the decisions. Do not infer success, validation, coverage, or completion that the scenario does not provide.

Return only one JSON object matching this contract, with exactly one decision for every scenario and no markdown fences:

${responseContract()}

Use false or zero for non-applicable boolean or numeric fields. Use [] for non-applicable array fields; every validation or validationSchedule item must use its listed enum, and every worker item must be an exact Flow worker id. Use "not_applicable" only for scalar enum fields that list it as an option, never inside an array. The stateOwner field means the actor authorized to mutate durable Flow state, not the actor performing a read-only slice. The validation array lists evidence categories the workflow requires before completion; validationSchedule lists their required lifecycle order and does not claim a check already ran. validationUsesRuntimeReceipts means an exact Bash command is armed with flow_validation_start, run next, and its appended immutable ref is copied into validationRefs without model-authored receipt metadata. runtimeProfile follows the trusted active footer when supplied and otherwise defaults to standard; control skips admission ceremony while standard and assurance use admitted proposals. admissionBeforeDispatch means the root manager calls flow_orchestration_admit exactly once for the bounded supported proposal before dispatching only the mapped workers. The deliveryIntent and assuranceProfile fields classify broad review work; use "not_applicable" outside that context. The challengeScope describes only a follow-up verification wave, never permission for blanket rereading. The reviewResultRecordedBeforeEdit field is true only when the next workflow records a terminal failed review and refreshes runtime status before repair. correctionLinkedToPredecessor means correctionOfAssignmentId names the exact immediately preceding failed assignment and source-delta context remains runtime-derived. The p0Justified field applies the rendered reachability, impact, guard, and recovery threshold. auditLedgerRendered means the strict AuditLedgerV1 was accepted by flow_audit_render and its canonical Markdown and summary are used. The refutedInRemediation field is true only when a refuted candidate would incorrectly remain in a fix plan. The reviewDepth field is the depth the decision requires, not a claim that review already ran. The manifestComplete field means the decision requires a complete manifest before any parallel or candidate worker launch, not that the scenario already supplies one. The completionClaimed field means claiming that implementation or the Flow feature is already complete from the scenario alone; choosing a future completion workflow is not a completion claim. The handoffHasRequiredSections field means the worker response required by the decision would contain every heading in its role prompt, even when access or coverage is missing and the status is blocked.

## Rendered Flow surfaces (${variant})
${promptBlocks}

## User scenarios
${scenarioBlocks}
`;
}

export function parseModelDecisionResponse(text: string): ModelDecision[] {
	const trimmed = text
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/```$/, "");
	const objectStart = trimmed.indexOf("{");
	const objectEnd = trimmed.lastIndexOf("}");
	if (objectStart === -1 || objectEnd < objectStart) {
		throw new Error("Model response did not contain a JSON object.");
	}
	const decisions = ModelDecisionResponseSchema.parse(
		JSON.parse(trimmed.slice(objectStart, objectEnd + 1)),
	).decisions;
	assertCompleteDecisionSet(decisions);
	return decisions;
}

function assertCompleteDecisionSet(decisions: readonly ModelDecision[]): void {
	const expected = new Set(PROMPT_EVALUATION_SCENARIOS.map(({ id }) => id));
	const seen = new Set<string>();
	const errors: string[] = [];
	for (const decision of decisions) {
		if (!expected.has(decision.id)) {
			errors.push(`unknown scenario decision: ${decision.id}`);
		} else if (seen.has(decision.id)) {
			errors.push(`duplicate scenario decision: ${decision.id}`);
		}
		seen.add(decision.id);
	}
	for (const id of expected) {
		if (!seen.has(id)) errors.push(`missing scenario decision: ${id}`);
	}
	if (errors.length > 0) throw new Error(errors.join("; "));
}

export function gradeModelDecisions(
	decisions: readonly ModelDecision[],
): ModelEvaluationGrade {
	assertCompleteDecisionSet(decisions);
	const byId = new Map(decisions.map((decision) => [decision.id, decision]));
	let passedCriteria = 0;
	let totalCriteria = 0;
	const scenarios = PROMPT_EVALUATION_SCENARIOS.map((scenario) => {
		const criteria = MODEL_CRITERIA[scenario.id] ?? [];
		const decision = byId.get(scenario.id);
		const failures: string[] = [];
		for (const criterion of criteria) {
			totalCriteria += 1;
			if (decision && criterion.test(decision)) passedCriteria += 1;
			else failures.push(criterion.label);
		}
		if (!decision) failures.unshift("missing scenario decision");
		return {
			id: scenario.id,
			passed: failures.length === 0,
			passedCriteria:
				criteria.length - (decision ? failures.length : criteria.length),
			totalCriteria: criteria.length,
			failures,
		};
	});
	return {
		passedScenarios: scenarios.filter((scenario) => scenario.passed).length,
		totalScenarios: scenarios.length,
		passedCriteria,
		totalCriteria,
		scenarios,
	};
}
