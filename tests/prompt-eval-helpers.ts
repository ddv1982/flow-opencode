import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { FLOW_AUDITOR_AGENT_PROMPT } from "../src/audit/prompts/agents";
import { FLOW_AUDIT_COMMAND_TEMPLATE } from "../src/audit/prompts/commands";
import { FLOW_AUDIT_CONTRACT } from "../src/audit/prompts/contracts";
import { buildFlowAdaptiveSystemContext } from "../src/prompt-system-context";
import {
	FLOW_PLANNER_AGENT_PROMPT,
	FLOW_REVIEWER_AGENT_PROMPT,
	FLOW_WORKER_AGENT_PROMPT,
} from "../src/prompts/agents";
import {
	FLOW_AUTO_COMMAND_TEMPLATE,
	FLOW_PLAN_COMMAND_TEMPLATE,
} from "../src/prompts/commands";
import {
	FLOW_PLAN_CONTRACT,
	FLOW_REVIEWER_CONTRACT,
	FLOW_WORKER_CONTRACT,
} from "../src/prompts/contracts";
import { createSession } from "../src/runtime/session";
import { applyPlan, approvePlan, startRun } from "../src/runtime/transitions";
import { samplePlan } from "./runtime-test-helpers";

export type PromptEvalCaseId =
	| "adaptive-package-manager-ambiguity"
	| "adaptive-decision-gate"
	| "adaptive-retryable-outcome"
	| "adaptive-reviewer-needs-fix"
	| "missing-goal-no-session"
	| "resume-only-no-active-session"
	| "decision-gate-human-required"
	| "final-review-required"
	| "threshold-completion-min-completed-features"
	| "blocked-human"
	| "nonretryable-outcome"
	| "approved-reviewer-clean-state"
	| "planner-agent-package-manager-ambiguity"
	| "worker-contract-replan-required-structure"
	| "worker-contract-final-review-required"
	| "reviewer-contract-needs-fix-gate"
	| "worker-prompt-retryable-blocker-recovery"
	| "reviewer-agent-no-write-and-needs-fix-gate"
	| "plan-command-approve-or-select-routing"
	| "plan-contract-planning-context-separation"
	| "auditor-agent-full-audit-claim-calibration"
	| "auditor-agent-finding-taxonomy"
	| "audit-command-downgrades-incomplete-full-review"
	| "audit-contract-reviewed-unreviewed-surfaces";

export type PromptEvalCategory =
	| "command-entry"
	| "planning-evidence"
	| "decision-gating"
	| "completion-gating"
	| "recovery"
	| "review-gating"
	| "claim-calibration"
	| "finding-taxonomy"
	| "audit-coverage";

export type PromptEvalSurface =
	| "adaptive_system_context"
	| "auto_command_template"
	| "planner_agent_prompt"
	| "worker_agent_prompt"
	| "worker_contract"
	| "reviewer_contract"
	| "reviewer_agent_prompt"
	| "plan_command_template"
	| "plan_contract"
	| "auditor_agent_prompt"
	| "audit_command_template"
	| "audit_contract";

export type PromptEvalRisk = "medium" | "high";

export type PromptEvalCase = {
	id: PromptEvalCaseId;
	title: string;
	category: PromptEvalCategory;
	surface: PromptEvalSurface;
	risk: PromptEvalRisk;
	sourcePaths: string[];
	expectedSnippets: string[];
	forbiddenSnippets?: string[];
};

export type PromptEvalCoverageSummary = {
	totalCases: number;
	byCategory: Record<PromptEvalCategory, number>;
	bySurface: Record<PromptEvalSurface, number>;
	byRisk: Record<PromptEvalRisk, number>;
	report: string;
};

export const PROMPT_EVAL_FIXTURE_DIR = join(
	import.meta.dir,
	"__fixtures__",
	"prompt-evals",
);

export const PROMPT_EVAL_CASE_IDS = [
	"adaptive-package-manager-ambiguity",
	"adaptive-decision-gate",
	"adaptive-retryable-outcome",
	"adaptive-reviewer-needs-fix",
	"missing-goal-no-session",
	"resume-only-no-active-session",
	"decision-gate-human-required",
	"final-review-required",
	"threshold-completion-min-completed-features",
	"blocked-human",
	"nonretryable-outcome",
	"approved-reviewer-clean-state",
	"planner-agent-package-manager-ambiguity",
	"worker-contract-replan-required-structure",
	"worker-contract-final-review-required",
	"reviewer-contract-needs-fix-gate",
	"worker-prompt-retryable-blocker-recovery",
	"reviewer-agent-no-write-and-needs-fix-gate",
	"plan-command-approve-or-select-routing",
	"plan-contract-planning-context-separation",
	"auditor-agent-full-audit-claim-calibration",
	"auditor-agent-finding-taxonomy",
	"audit-command-downgrades-incomplete-full-review",
	"audit-contract-reviewed-unreviewed-surfaces",
] as const satisfies readonly PromptEvalCaseId[];

const KNOWN_CASE_IDS = new Set<PromptEvalCaseId>(PROMPT_EVAL_CASE_IDS);

const PROMPT_EVAL_ALLOWED_ROOTS = ["tests", "docs", "src"] as const;
const PROMPT_EVAL_REPO_ROOT = resolve(import.meta.dir, "..");

export function isFirstPartySourcePath(path: string): boolean {
	if (!path || path.startsWith("/") || path.split("/").includes("..")) {
		return false;
	}

	const allowedRoot = PROMPT_EVAL_ALLOWED_ROOTS.find(
		(root) => path === root || path.startsWith(`${root}/`),
	);
	if (!allowedRoot) {
		return false;
	}

	const resolved = resolve(PROMPT_EVAL_REPO_ROOT, path);
	return (
		resolved === join(PROMPT_EVAL_REPO_ROOT, allowedRoot) ||
		resolved.startsWith(join(PROMPT_EVAL_REPO_ROOT, allowedRoot) + sep)
	);
}

export function validatePromptEvalCorpus(raw: unknown): PromptEvalCase[] {
	if (!Array.isArray(raw)) {
		throw new Error("Prompt eval corpus must be an array.");
	}

	const seenIds = new Set<string>();
	return raw.map((item) => {
		if (!item || typeof item !== "object") {
			throw new Error("Each prompt eval corpus entry must be an object.");
		}
		const candidate = item as Partial<PromptEvalCase>;
		if (!candidate.id || !KNOWN_CASE_IDS.has(candidate.id)) {
			throw new Error(`Unknown prompt eval case id: ${String(candidate.id)}`);
		}
		if (seenIds.has(candidate.id)) {
			throw new Error(`Duplicate prompt eval case id: ${candidate.id}`);
		}
		seenIds.add(candidate.id);
		if (!candidate.category || !candidate.surface || !candidate.risk) {
			throw new Error(
				`Prompt eval case '${candidate.id}' needs category/surface/risk metadata.`,
			);
		}
		if (
			!Array.isArray(candidate.sourcePaths) ||
			candidate.sourcePaths.length === 0
		) {
			throw new Error(`Prompt eval case '${candidate.id}' needs source paths.`);
		}
		if (
			candidate.sourcePaths.some(
				(sourcePath) => !isFirstPartySourcePath(sourcePath),
			)
		) {
			throw new Error(
				`Prompt eval case '${candidate.id}' must use first-party source paths only.`,
			);
		}
		if (
			!Array.isArray(candidate.expectedSnippets) ||
			candidate.expectedSnippets.length === 0
		) {
			throw new Error(
				`Prompt eval case '${candidate.id}' needs expected snippets.`,
			);
		}
		if (
			candidate.forbiddenSnippets &&
			!Array.isArray(candidate.forbiddenSnippets)
		) {
			throw new Error(
				`Prompt eval case '${candidate.id}' forbiddenSnippets must be an array when present.`,
			);
		}
		return candidate as PromptEvalCase;
	});
}

export function readPromptEvalCorpus(): PromptEvalCase[] {
	const fixtureFiles = readdirSync(PROMPT_EVAL_FIXTURE_DIR)
		.filter((entry) => entry.endsWith(".json"))
		.sort();
	const merged = fixtureFiles.flatMap(
		(entry) =>
			JSON.parse(
				readFileSync(join(PROMPT_EVAL_FIXTURE_DIR, entry), "utf8"),
			) as unknown[],
	);
	return validatePromptEvalCorpus(merged);
}

function createRunningSession() {
	const planned = applyPlan(createSession("demo-goal"), samplePlan());
	if (!planned.ok) throw new Error(planned.message);
	const approved = approvePlan(planned.value);
	if (!approved.ok) throw new Error(approved.message);
	const started = startRun(approved.value);
	if (!started.ok) throw new Error(started.message);
	return started.value.session;
}

type AdaptiveScenarioBuilder = ReturnType<typeof createRunningSession>;

function withDecisionGate(session: AdaptiveScenarioBuilder) {
	session.planning.decisionLog = [
		{
			question: "Should Flow rewrite the API surface now?",
			decisionMode: "recommend_confirm",
			decisionDomain: "architecture",
			options: [
				{ label: "Rewrite now", tradeoffs: ["cleaner"] },
				{ label: "Defer", tradeoffs: ["safer"] },
			],
			recommendation: "Defer",
			rationale: ["A breaking rewrite needs confirmation."],
		},
	];
}

function withNeedsFixReviewer(
	session: AdaptiveScenarioBuilder,
	activeFeatureId: string,
) {
	session.execution.lastReviewerDecision = {
		scope: "feature",
		featureId: activeFeatureId,
		reviewPurpose: "execution_gate",
		status: "needs_fix",
		summary: "Need another fix pass.",
		blockingFindings: [{ summary: "Missing targeted validation evidence." }],
		followUps: [],
		suggestedValidation: ["bun test tests/config.test.ts"],
	};
}

function withApprovedReviewer(
	session: AdaptiveScenarioBuilder,
	activeFeatureId: string,
) {
	session.execution.lastReviewerDecision = {
		scope: "feature",
		featureId: activeFeatureId,
		reviewPurpose: "execution_gate",
		status: "approved",
		summary: "Looks good.",
		blockingFindings: [],
		followUps: [],
		suggestedValidation: [],
	};
}

function withRetryableOutcome(session: AdaptiveScenarioBuilder) {
	session.execution.lastOutcome = {
		kind: "contract_error",
		summary: "A recoverable runtime issue needs another iteration.",
		retryable: true,
		autoResolvable: true,
		needsHuman: false,
	};
}

function withBlockedHumanOutcome(session: AdaptiveScenarioBuilder) {
	session.status = "blocked";
	session.execution.lastOutcome = {
		kind: "blocked_external",
		summary: "Waiting on human decision.",
		needsHuman: true,
	};
}

function withBlockedNonretryableOutcome(session: AdaptiveScenarioBuilder) {
	session.status = "blocked";
	session.execution.lastOutcome = {
		kind: "blocked_external",
		summary: "Blocked by external constraint.",
		needsHuman: false,
		retryable: false,
		autoResolvable: false,
	};
}

const ADAPTIVE_SCENARIO_BUILDERS: Partial<
	Record<
		PromptEvalCaseId,
		(session: AdaptiveScenarioBuilder, activeFeatureId: string) => void
	>
> = {
	"adaptive-package-manager-ambiguity": (session) => {
		session.planning.packageManagerAmbiguous = true;
	},
	"adaptive-decision-gate": (session) => {
		withDecisionGate(session);
	},
	"adaptive-retryable-outcome": (session) => {
		withRetryableOutcome(session);
	},
	"adaptive-reviewer-needs-fix": (session, activeFeatureId) => {
		withNeedsFixReviewer(session, activeFeatureId);
	},
	"blocked-human": (session) => {
		withBlockedHumanOutcome(session);
	},
	"nonretryable-outcome": (session) => {
		withBlockedNonretryableOutcome(session);
	},
	"approved-reviewer-clean-state": (session, activeFeatureId) => {
		withApprovedReviewer(session, activeFeatureId);
	},
};

export function renderAdaptiveScenario(caseId: PromptEvalCaseId): string {
	const session = createRunningSession();
	const activeFeatureId = session.execution.activeFeatureId;
	if (!activeFeatureId) {
		throw new Error("Expected an active feature for prompt-eval corpus tests.");
	}

	const builder = ADAPTIVE_SCENARIO_BUILDERS[caseId];
	if (!builder) {
		throw new Error(`Unhandled adaptive prompt eval case: ${caseId}`);
	}
	builder(session, activeFeatureId);
	return buildFlowAdaptiveSystemContext(session).join("\n");
}

export function buildPromptEvalCoverageSummary(
	corpus: PromptEvalCase[],
): PromptEvalCoverageSummary {
	const categories = [...new Set(corpus.map((item) => item.category))].sort();
	const surfaces = [...new Set(corpus.map((item) => item.surface))].sort();
	const risks = [...new Set(corpus.map((item) => item.risk))].sort();

	const byCategory = Object.fromEntries(
		categories.map((category) => [
			category,
			corpus.filter((item) => item.category === category).length,
		]),
	) as Record<PromptEvalCategory, number>;
	const bySurface = Object.fromEntries(
		surfaces.map((surface) => [
			surface,
			corpus.filter((item) => item.surface === surface).length,
		]),
	) as Record<PromptEvalSurface, number>;
	const byRisk = Object.fromEntries(
		risks.map((risk) => [
			risk,
			corpus.filter((item) => item.risk === risk).length,
		]),
	) as Record<PromptEvalRisk, number>;

	return {
		totalCases: corpus.length,
		byCategory,
		bySurface,
		byRisk,
		report: [
			`Prompt eval corpus coverage: ${corpus.length} cases`,
			`Categories: ${Object.entries(byCategory)
				.map(([key, count]) => `${key}=${count}`)
				.join(", ")}`,
			`Surfaces: ${Object.entries(bySurface)
				.map(([key, count]) => `${key}=${count}`)
				.join(", ")}`,
			`Risk: ${Object.entries(byRisk)
				.map(([key, count]) => `${key}=${count}`)
				.join(", ")}`,
		].join("\n"),
	};
}

export function renderPromptEvalCase(item: PromptEvalCase): string {
	switch (item.surface) {
		case "adaptive_system_context":
			return renderAdaptiveScenario(item.id);
		case "auto_command_template":
			return FLOW_AUTO_COMMAND_TEMPLATE;
		case "planner_agent_prompt":
			return FLOW_PLANNER_AGENT_PROMPT;
		case "worker_agent_prompt":
			return FLOW_WORKER_AGENT_PROMPT;
		case "worker_contract":
			return FLOW_WORKER_CONTRACT;
		case "reviewer_contract":
			return FLOW_REVIEWER_CONTRACT;
		case "reviewer_agent_prompt":
			return FLOW_REVIEWER_AGENT_PROMPT;
		case "plan_command_template":
			return FLOW_PLAN_COMMAND_TEMPLATE;
		case "plan_contract":
			return FLOW_PLAN_CONTRACT;
		case "auditor_agent_prompt":
			return FLOW_AUDITOR_AGENT_PROMPT;
		case "audit_command_template":
			return FLOW_AUDIT_COMMAND_TEMPLATE;
		case "audit_contract":
			return FLOW_AUDIT_CONTRACT;
		default:
			throw new Error(`Unhandled prompt eval surface: ${String(item.surface)}`);
	}
}
