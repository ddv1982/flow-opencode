import { z } from "zod";
import { PROMPT_EVALUATION_SCENARIOS } from "./prompt-quality";
import {
	compiledFlowPromptSurfaces,
	type FlowPromptVariant,
} from "./prompt-surfaces";

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
	validation: z.array(
		z.enum(["focused", "behavioral", "ui", "browser", "broad"]),
	),
	independentReview: z.boolean(),
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
	phaseBoundaryAction: z.enum(["none", "stop", "resume_with_ack"]),
	sessionContinuation: z.enum([
		"continue",
		"stop_on_runtime_boundary",
		"self_initiated_rollover",
		"not_applicable",
	]),
	candidateDecision: z.enum(["used", "serial_required", "not_applicable"]),
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
			test: (decision) => decision.manifestComplete,
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
	"resume-after-interruption": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-run",
			test: (decision) => decision.route === "flow-run",
		},
		{
			label: "resumes only with a fresh boundary acknowledgement",
			test: (decision) => decision.phaseBoundaryAction === "resume_with_ack",
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
			test: (decision) => decision.manifestComplete,
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
	"no-self-initiated-compaction": [
		...COMMON_MANAGER_CRITERIA,
		{
			label: "routes to flow-run",
			test: (decision) => decision.route === "flow-run",
		},
		{
			label: "does not invent a phase boundary",
			test: (decision) => decision.phaseBoundaryAction === "none",
		},
		{
			label: "continues without self-initiated rollover",
			test: (decision) => decision.sessionContinuation === "continue",
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
      "validation": ["focused | behavioral | ui | browser | broad"],
      "independentReview": false,
      "reviewDepth": "quick | standard | detailed | broad | not_applicable",
      "manifestComplete": false,
      "coverage": "complete | partial | missing | not_applicable",
      "handoffStatus": "success | partial | blocked | not_applicable",
      "handoffHasRequiredSections": false,
      "retryReviews": 0,
      "stopsAfterRetryFailure": false,
      "phaseBoundaryAction": "none | stop | resume_with_ack",
      "sessionContinuation": "continue | stop_on_runtime_boundary | self_initiated_rollover | not_applicable",
      "candidateDecision": "used | serial_required | not_applicable",
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

Use false or zero for non-applicable boolean or numeric fields. Use [] for non-applicable array fields; every validation array item must be one of the five listed evidence categories, and every worker item must be an exact Flow worker id. Use "not_applicable" only for scalar enum fields that list it as an option, never inside an array. The stateOwner field means the actor authorized to mutate durable Flow state, not the actor performing a read-only slice. The validation array lists evidence categories the workflow requires before completion; it does not claim those checks already ran. The reviewDepth field is the depth the decision requires, not a claim that review already ran. The manifestComplete field means the decision requires a complete manifest before any parallel or candidate worker launch, not that the scenario already supplies one. The completionClaimed field means claiming that implementation or the Flow feature is already complete from the scenario alone; choosing a future completion workflow is not a completion claim. The handoffHasRequiredSections field means the worker response required by the decision would contain every heading in its role prompt, even when access or coverage is missing and the status is blocked. The sessionContinuation field distinguishes ordinary continuation from a stop caused by a runtime-issued phase boundary; never infer a rollover from host context size alone.

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
