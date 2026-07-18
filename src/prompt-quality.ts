import {
	type CompiledFlowPrompt,
	compiledFlowPromptSurfaces,
	type FlowPromptSurfaceName,
	type FlowPromptVariant,
} from "./prompt-surfaces.js";

export type PromptMetric = {
	surface: string;
	variant: FlowPromptVariant | "runtime";
	sources: string[];
	characters: number;
	words: number;
	approximateTokens: number;
	actionableInstructions: number;
	exactDuplicateLines: number;
	repeatedFiveGrams: number;
	nearDuplicateLinePairs: number;
	negativeInstructions: number;
	negativeInstructionDensity: number;
	codeFences: number;
	conditionalFragments: string[];
	roleInapplicableFragments: string[];
	roleInapplicableLines: number;
	criticalRulePositions: Record<string, number | null>;
	structurallyEnforcedRulesPresent: string[];
	terminologyWarnings: string[];
};

export type PromptEvaluationResult = {
	variant: FlowPromptVariant;
	scenariosPassed: number;
	scenariosTotal: number;
	criteriaPassed: number;
	criteriaTotal: number;
	staticApproximateTokens: number;
	roleInapplicableLines: number;
	exactDuplicateLines: number;
	scenarios: Array<{
		id: string;
		name: string;
		passed: boolean;
		passedCriteria: number;
		totalCriteria: number;
		failures: string[];
	}>;
};

export type PromptRepetitionClassification = {
	id: string;
	classification:
		| "keep"
		| "consolidate"
		| "enforce-structurally"
		| "load-conditionally"
		| "remove"
		| "evaluate";
	occurrences: string[];
	rationale: string;
};

const WORD_PATTERN = /[\p{L}\p{N}_`.-]+/gu;
const ACTION_PATTERN =
	/^(?:[-*]\s+|\d+[.)]\s+|(?:call|use|return|report|record|read|run|inspect|load|keep|preserve|treat|send|include|verify|confirm|stop|fail|approve|complete|work|identify|prefer|classify|write|account|orient|before)\b)/i;
const NEGATIVE_PATTERN =
	/\b(?:do not|don't|never|must not|cannot|can't|only\s+[^.]{0,40}\s+may)\b/i;

const CRITICAL_RULES: Record<string, RegExp> = {
	"status-first": /call `?flow_status`? first/i,
	"manager-state-ownership":
		/only the (?:root )?manager may call state-changing `?flow_\*`?/i,
	"approved-plan-immutability": /approved plans? (?:are|is) immutable/i,
	"single-active-feature": /only one feature (?:can|may) be active/i,
	"validation-required": /completion requires[^.]*validation/i,
	"independent-review-required": /completion requires[^.]*independent review/i,
	"archive-pending-retry": /closure[^.]*flow_session_close/i,
};

const STRUCTURAL_RULE_PATTERNS: Record<string, RegExp> = {
	"worker state mutation denied by permissions": /state-changing `?flow_/i,
	"approved plan immutability enforced by runtime":
		/approved plans? (?:are|is|cannot be changed) immutable/i,
	"single active feature enforced by runtime":
		/only one feature (?:can|may) be active/i,
	"validation gate enforced by completion schema/runtime":
		/completion requires[^.]*validation|validationRun/i,
	"review gate enforced by completion schema/runtime":
		/featureReview|independent review/i,
};

const MANAGER_ONLY_CAPABILITY_PATTERNS = [
	/\b(?:you|the worker) (?:may|must|should|can) call `?flow_(?:plan_save|plan_approve|run_start|feature_complete|feature_reset|session_close)`?/i,
	/\b(?:you|the worker) (?:may|must|should|can) (?:approve plans|complete features|close sessions|synthesize final results)/i,
];

const ROLE_INAPPLICABLE_PATTERNS: Record<string, RegExp[]> = {
	manager: [/^Return only this Flow handoff:/i, /^## Verdict per claim$/i],
	reviewer: [
		/\bin manager context\b/i,
		/\bmanager may load\b/i,
		/\bmanager may .*fan out\b/i,
		/\bload `flow-(?:test|deslop|ui-quality)`/i,
		/\bfan out read-only workers\b/i,
		...MANAGER_ONLY_CAPABILITY_PATTERNS,
	],
	"evidence-worker": MANAGER_ONLY_CAPABILITY_PATTERNS,
	"validation-worker": MANAGER_ONLY_CAPABILITY_PATTERNS,
	"audit-worker": MANAGER_ONLY_CAPABILITY_PATTERNS,
	"candidate-worker": MANAGER_ONLY_CAPABILITY_PATTERNS,
	"verifier-worker": MANAGER_ONLY_CAPABILITY_PATTERNS,
};

function normalizedLines(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim().replace(/\s+/g, " "))
		.filter((line) => line.length >= 4);
}

function countExactDuplicateLines(lines: readonly string[]): number {
	const seen = new Set<string>();
	let duplicates = 0;
	for (const line of lines) {
		const key = line.toLowerCase();
		if (seen.has(key)) duplicates += 1;
		else seen.add(key);
	}
	return duplicates;
}

function countRepeatedNgrams(words: readonly string[], size = 5): number {
	const counts = new Map<string, number>();
	for (let index = 0; index <= words.length - size; index += 1) {
		const gram = words
			.slice(index, index + size)
			.join(" ")
			.toLowerCase();
		counts.set(gram, (counts.get(gram) ?? 0) + 1);
	}
	return [...counts.values()].filter((count) => count > 1).length;
}

function jaccard(left: Set<string>, right: Set<string>): number {
	let intersection = 0;
	for (const value of left) if (right.has(value)) intersection += 1;
	return intersection / (left.size + right.size - intersection);
}

function countNearDuplicateLines(lines: readonly string[]): number {
	const candidates = lines
		.map((line) => ({
			line: line.toLowerCase(),
			words: new Set(line.toLowerCase().match(WORD_PATTERN) ?? []),
		}))
		.filter(
			(candidate) => candidate.words.size >= 7 && candidate.line.length >= 45,
		);
	let pairs = 0;
	for (let left = 0; left < candidates.length; left += 1) {
		for (let right = left + 1; right < candidates.length; right += 1) {
			const a = candidates[left];
			const b = candidates[right];
			if (!a || !b || a.line === b.line) continue;
			const sizeRatio =
				Math.min(a.words.size, b.words.size) /
				Math.max(a.words.size, b.words.size);
			if (sizeRatio >= 0.75 && jaccard(a.words, b.words) >= 0.82) pairs += 1;
		}
	}
	return pairs;
}

function rulePositions(text: string): Record<string, number | null> {
	return Object.fromEntries(
		Object.entries(CRITICAL_RULES).map(([name, pattern]) => {
			const index = text.search(pattern);
			return [
				name,
				index === -1 ? null : Number((index / text.length).toFixed(3)),
			];
		}),
	);
}

function terminologyWarnings(text: string): string[] {
	const warnings: string[] = [];
	if (/finalReviewDepth/.test(text)) {
		warnings.push(
			"uses non-canonical finalReviewDepth instead of finalReviewPolicy/reviewDepth",
		);
	}
	if (/finalReviewPolicy:\s*[`"']?(?:quick|standard)/i.test(text)) {
		warnings.push("uses feature-review depth as a finalReviewPolicy value");
	}
	if (/decision:\s*[`"']parallel[`"']/i.test(text)) {
		warnings.push("uses invalid implementation-decision value 'parallel'");
	}
	if (
		/visible tokens|non-cache tokens|session is large enough|long enough to be compacted|request compaction|initiate compaction/i.test(
			text,
		)
	) {
		warnings.push(
			"asks the model to infer context pressure or initiate compaction",
		);
	}
	return warnings;
}

export function measurePromptText(options: {
	surface: string;
	variant: FlowPromptVariant | "runtime";
	text: string;
	compiled?: CompiledFlowPrompt;
}): PromptMetric {
	const words = options.text.match(WORD_PATTERN) ?? [];
	const instructionText = options.text.replace(/```[\s\S]*?```/g, "");
	const instructionWords = instructionText.match(WORD_PATTERN) ?? [];
	const lines = normalizedLines(instructionText);
	const actionable = [
		...new Map(
			lines
				.filter((line) => ACTION_PATTERN.test(line))
				.map((line) => [line.toLowerCase(), line]),
		).values(),
	];
	const negativeInstructions = actionable.filter((line) =>
		NEGATIVE_PATTERN.test(line),
	).length;
	const role = options.compiled?.role;
	const rolePatterns = role ? (ROLE_INAPPLICABLE_PATTERNS[role] ?? []) : [];
	const roleInapplicableLines = lines.filter((line) =>
		rolePatterns.some((pattern) => pattern.test(line)),
	).length;
	return {
		surface: options.surface,
		variant: options.variant,
		sources: [
			...new Set(
				options.compiled?.fragments.map((fragment) => fragment.source) ?? [],
			),
		],
		characters: options.text.length,
		words: words.length,
		approximateTokens: Math.ceil(options.text.length / 4),
		actionableInstructions: actionable.length,
		exactDuplicateLines: countExactDuplicateLines(lines),
		repeatedFiveGrams: countRepeatedNgrams(instructionWords),
		nearDuplicateLinePairs: countNearDuplicateLines(lines),
		negativeInstructions,
		negativeInstructionDensity:
			actionable.length === 0
				? 0
				: Number((negativeInstructions / actionable.length).toFixed(3)),
		codeFences: (options.text.match(/^```/gm) ?? []).length,
		conditionalFragments:
			options.compiled?.fragments
				.filter((fragment) => fragment.conditional)
				.map((fragment) => fragment.id) ?? [],
		roleInapplicableFragments:
			options.compiled?.fragments
				.filter(
					(fragment) =>
						!fragment.roles.includes(options.compiled?.role ?? "manager"),
				)
				.map((fragment) => fragment.id) ?? [],
		roleInapplicableLines,
		criticalRulePositions: rulePositions(options.text),
		structurallyEnforcedRulesPresent: Object.entries(STRUCTURAL_RULE_PATTERNS)
			.filter(([, pattern]) => pattern.test(options.text))
			.map(([name]) => name),
		terminologyWarnings: terminologyWarnings(options.text),
	};
}

export function measureCompiledPrompt(
	compiled: CompiledFlowPrompt,
): PromptMetric {
	return measurePromptText({
		surface: compiled.surface,
		variant: compiled.variant,
		text: compiled.text,
		compiled,
	});
}

type PromptScenario = {
	id: string;
	name: string;
	input: string;
	expectedRoute: FlowPromptSurfaceName;
	surface: FlowPromptSurfaceName;
	required: Array<{ label: string; pattern: RegExp }>;
	forbidden?: Array<{ label: string; pattern: RegExp }>;
};

export const PROMPT_EVALUATION_SCENARIOS: readonly PromptScenario[] = [
	{
		id: "small-serial-bug-fix",
		name: "Small serial bug fix",
		input:
			"Implement the approved off-by-one fix in src/pagination.ts and run its focused tests.",
		expectedRoute: "flow-run",
		surface: "flow-run",
		required: [
			{
				label: "one active feature scope",
				pattern: /sole scope|active feature/i,
			},
			{
				label: "targeted validation",
				pattern: /validationScope: ["`]targeted/i,
			},
			{ label: "feature review", pattern: /featureReviewDepth/ },
			{
				label: "small slice stays serial",
				pattern:
					/small slices? remain serial|slice is so small[^.]*direct work/i,
			},
			{
				label: "direct independent reviewer route",
				pattern: /Public reviewer routing[\s\S]*reserved `flow-reviewer`/i,
			},
		],
	},
	{
		id: "broad-planning-request",
		name: "Broad planning request",
		input:
			"Plan a cross-module authentication migration without implementing it.",
		expectedRoute: "flow-plan",
		surface: "flow-plan",
		required: [
			{ label: "requirements", pattern: /requirements/ },
			{ label: "decisions", pattern: /decisions/ },
			{ label: "dependency order", pattern: /dependsOn/ },
			{ label: "final review policy", pattern: /finalReviewPolicy/ },
			{
				label: "approval gate",
				pattern: /explicit user approval|prior autonomous authorization/i,
			},
		],
	},
	{
		id: "review-first-maintainability",
		name: "Review-first maintainability request",
		input:
			"Review maintainability across the repository and plan only evidence-backed fixes.",
		expectedRoute: "flow-plan",
		surface: "flow-plan",
		required: [
			{ label: "review-first feature", pattern: /review-first feature/i },
			{
				label: "evidence-backed findings",
				pattern: /evidence-backed findings/i,
			},
			{ label: "no invented findings", pattern: /do not invent findings/i },
		],
	},
	{
		id: "runtime-persistence-change",
		name: "Runtime or persistence change",
		input: "Implement the approved atomic session persistence change.",
		expectedRoute: "flow-run",
		surface: "flow-run",
		required: [
			{
				label: "approved review depth is a minimum",
				pattern: /reviewDepth[^.]*minimum|min(?:imum)? feature-review depth/i,
			},
			{ label: "behavioral validation", pattern: /Behavioral automated test/i },
			{ label: "independent review", pattern: /independent review/i },
		],
	},
	{
		id: "ui-special-validation",
		name: "UI task requiring special validation",
		input: "Implement the approved responsive settings panel feature.",
		expectedRoute: "flow-run",
		surface: "flow-run",
		required: [
			{ label: "UI helper routing", pattern: /flow-ui-quality/ },
			{
				label: "browser or screenshot evidence",
				pattern: /browser or screenshot evidence/i,
			},
		],
	},
	{
		id: "parallel-discovery",
		name: "Parallel discovery pass",
		input: "Plan a broad change whose repository surfaces are not yet known.",
		expectedRoute: "flow-plan",
		surface: "flow-plan",
		required: [
			{
				label: "serial orientation",
				pattern: /Orient serially first|serial orientation pass/i,
			},
			{ label: "manifest coverage", pattern: /manifest/i },
			{ label: "evidence worker", pattern: /flow-evidence-worker/ },
			{
				label: "missing handoff is gap",
				pattern: /malformed[^.]*coverage gap|failed handoff/i,
			},
		],
	},
	{
		id: "partial-handoff",
		name: "Worker returning a partial handoff",
		input: "Inspect three runtime files; one assigned file is unavailable.",
		expectedRoute: "flow-evidence-worker",
		surface: "flow-evidence-worker",
		required: [
			{
				label: "partial status supported",
				pattern: /success \| partial \| blocked/i,
			},
			{ label: "coverage fields", pattern: /expected, checked, not checked/i },
		],
	},
	{
		id: "malformed-handoff",
		name: "Worker returning an empty or malformed handoff",
		input:
			"The evidence worker cannot access its slice or produce a complete report.",
		expectedRoute: "flow-evidence-worker",
		surface: "flow-evidence-worker",
		required: [
			{
				label: "empty output fails",
				pattern: /Empty or\s+unstructured output is a failed handoff/i,
			},
			{ label: "blocked fallback", pattern: /## Status` set to `blocked/i },
		],
	},
	{
		id: "failed-review-repair",
		name: "Failed review and bounded repair",
		input:
			"The independent feature review failed after implementation and validation, and the user already authorized autonomous repair.",
		expectedRoute: "flow-run",
		surface: "flow-run",
		required: [
			{
				label: "failed review recorded",
				pattern: /failed attempt[^.]*flow_feature_complete/i,
			},
			{ label: "one repair", pattern: /at most one repair/i },
			{ label: "one retry review", pattern: /one retry\s+review/i },
		],
	},
	{
		id: "archive-pending",
		name: "Retry pending archival",
		input:
			"flow_status reports a stored closure after archive publication failed.",
		expectedRoute: "flow-run",
		surface: "flow-run",
		required: [
			{ label: "status first", pattern: /Call `flow_status`/i },
			{
				label: "closure detected",
				pattern: /projection\.closure(?:\.kind)?/i,
			},
			{ label: "retry close", pattern: /Retry `flow_session_close`/i },
		],
	},
	{
		id: "candidate-safe",
		name: "Candidate implementation is safe",
		input:
			"As the root Flow manager executing an approved feature, use an explicitly authorized isolated candidate worker for an independent documentation generator module.",
		expectedRoute: "flow-run",
		surface: "flow-run",
		required: [
			{
				label: "explicit authorization",
				pattern: /explicit\s+user\s+authorization/i,
			},
			{
				label: "isolated or exact ownership",
				pattern:
					/isolated worktrees?\s+or\s+(?:an\s+)?exact non-overlapping path\s+ownership/i,
			},
			{ label: "independent surface", pattern: /independent[ _]surface/i },
			{
				label: "manager integrates",
				pattern: /manager[\s\S]{0,100}integrates accepted work/i,
			},
		],
	},
	{
		id: "candidate-serial",
		name: "Candidate implementation must remain serial",
		input:
			"Implement a shared persistence contract that all callers edit together.",
		expectedRoute: "flow-run",
		surface: "flow-run",
		required: [
			{
				label: "shared contracts serial",
				pattern:
					/Shared contracts[^.]*remain serial|share the same contracts|shared API contracts/i,
			},
			{
				label: "overlap serial",
				pattern: /overlapping[ _]files|slices overlap/i,
			},
			{
				label: "manager judgment serial",
				pattern: /manager[ _]judgment/i,
			},
		],
	},
	{
		id: "planning-runtime-unavailable",
		name: "Planning runtime unavailable",
		input:
			"Create a Flow plan, but flow_plan_save and flow_plan_approve are unavailable.",
		expectedRoute: "flow-plan",
		surface: "flow-plan",
		required: [
			{
				label: "planning stops without runtime",
				pattern:
					/flow_plan_save` or `flow_plan_approve` is unavailable[\s\S]*stop/i,
			},
			{
				label: "planning requires loaded runtime",
				pattern: /Planning requires the loaded Flow runtime/i,
			},
		],
	},
	{
		id: "execution-runtime-unavailable",
		name: "Execution runtime unavailable",
		input:
			"Execute the approved feature, but flow_run_start is unavailable in this OpenCode process.",
		expectedRoute: "flow-run",
		surface: "flow-run",
		required: [
			{
				label: "execution stops without runtime",
				pattern: /flow_run_start` is unavailable[\s\S]*stop/i,
			},
		],
	},
	{
		id: "detailed-feature-review",
		name: "Detailed feature review",
		input:
			"Perform the required detailed review for a persistence and cross-module feature.",
		expectedRoute: "flow-reviewer",
		surface: "flow-reviewer",
		required: [
			{ label: "detailed depth defined", pattern: /`detailed`:[^\n]*risky/i },
			{
				label: "depth must meet plan",
				pattern: /depth must meet or exceed the approved feature/i,
			},
			{
				label: "persistence risk included",
				pattern: /persistence, security, cross-module/i,
			},
		],
	},
	{
		id: "cleanup-review-missing-helper",
		name: "Cleanup review with missing helper evidence",
		input:
			"Review a cleanup claim when helper evidence is unavailable to the hidden reviewer.",
		expectedRoute: "flow-reviewer",
		surface: "flow-reviewer",
		required: [
			{
				label: "behavior preservation checked",
				pattern: /behavior was preserved/i,
			},
			{
				label: "missing helper becomes gap",
				pattern: /helper evidence is unavailable[\s\S]*coverage gap/i,
			},
		],
	},
	{
		id: "ui-review-missing-visual-evidence",
		name: "UI review without visual evidence",
		input:
			"Review a UI feature whose packet contains no screenshot or browser evidence.",
		expectedRoute: "flow-reviewer",
		surface: "flow-reviewer",
		required: [
			{
				label: "visual evidence required",
				pattern: /verify relevant states and supplied visual evidence/i,
			},
			{
				label: "missing visual evidence becomes gap",
				pattern: /visual\s+evidence\s+is\s+missing[\s\S]*coverage gap/i,
			},
		],
	},
	{
		id: "review-retry-exhausted",
		name: "Review retry budget exhausted",
		input:
			"The second independent review failed and the runtime blocked the feature.",
		expectedRoute: "flow-run",
		surface: "flow-run",
		required: [
			{ label: "stop with blocker", pattern: /stop with the blocker/i },
			{ label: "explicit direction", pattern: /explicit user direction/i },
			{ label: "reset feature", pattern: /flow_feature_reset/i },
		],
	},
] as const;

export function evaluatePromptVariant(
	variant: FlowPromptVariant,
): PromptEvaluationResult {
	const surfaces = compiledFlowPromptSurfaces(variant);
	const metrics = Object.values(surfaces).map(measureCompiledPrompt);
	let criteriaPassed = 0;
	let criteriaTotal = 0;
	const scenarios = PROMPT_EVALUATION_SCENARIOS.map((scenario) => {
		const prompt = surfaces[scenario.surface].text;
		const failures: string[] = [];
		let passedCriteria = 0;
		for (const criterion of scenario.required) {
			criteriaTotal += 1;
			if (criterion.pattern.test(prompt)) {
				criteriaPassed += 1;
				passedCriteria += 1;
			} else {
				failures.push(`missing: ${criterion.label}`);
			}
		}
		for (const criterion of scenario.forbidden ?? []) {
			criteriaTotal += 1;
			if (criterion.pattern.test(prompt)) {
				failures.push(`unexpected: ${criterion.label}`);
			} else {
				criteriaPassed += 1;
				passedCriteria += 1;
			}
		}
		return {
			id: scenario.id,
			name: scenario.name,
			passed: failures.length === 0,
			passedCriteria,
			totalCriteria:
				scenario.required.length + (scenario.forbidden?.length ?? 0),
			failures,
		};
	});
	return {
		variant,
		scenariosPassed: scenarios.filter((scenario) => scenario.passed).length,
		scenariosTotal: scenarios.length,
		criteriaPassed,
		criteriaTotal,
		staticApproximateTokens: metrics.reduce(
			(total, metric) => total + metric.approximateTokens,
			0,
		),
		roleInapplicableLines: metrics.reduce(
			(total, metric) => total + metric.roleInapplicableLines,
			0,
		),
		exactDuplicateLines: metrics.reduce(
			(total, metric) => total + metric.exactDuplicateLines,
			0,
		),
		scenarios,
	};
}

export const PROMPT_REPETITION_CLASSIFICATIONS: readonly PromptRepetitionClassification[] =
	[
		{
			id: "flow-status-before-action",
			classification: "keep",
			occurrences: [
				"public command opening",
				"archive-pending recovery messages",
			],
			rationale:
				"The command opening establishes current state before ordinary work; archive recovery must detect the stored closure before attempting any mutation.",
		},
		{
			id: "manager-state-ownership",
			classification: "keep",
			occurrences: [
				"manager bookends",
				"worker role contracts",
				"OpenCode permission maps",
			],
			rationale:
				"The positive manager rule aids routing while worker prose and permissions defend separate boundaries.",
		},
		{
			id: "full-review-bundle-in-command-and-agent",
			classification: "consolidate",
			occurrences: [
				"baseline /flow-review task prompt",
				"baseline flow-reviewer agent prompt",
			],
			rationale:
				"Both are delivered to the same hidden reviewer; the agent contract is the canonical location.",
		},
		{
			id: "worker-state-prohibitions",
			classification: "enforce-structurally",
			occurrences: ["worker prompts", "OpenCode agent permission maps"],
			rationale:
				"Permission maps remain authoritative; prompt text keeps one positive ownership reminder rather than enumerating every tool denial.",
		},
		{
			id: "parallel-playbook",
			classification: "load-conditionally",
			occurrences: [
				"baseline flow-auto",
				"baseline flow-plan",
				"baseline flow-run",
			],
			rationale:
				"Serial work needs only the short routing index and decision branch; manifest, execution, and synthesis runbooks load after their phase is selected.",
		},
		{
			id: "all-worker-handoff-formats",
			classification: "load-conditionally",
			occurrences: ["baseline manager commands", "worker prompts"],
			rationale:
				"Each hidden worker now receives only its own schema; managers need acceptance rules, not every format.",
		},
		{
			id: "planning-examples",
			classification: "remove",
			occurrences: ["baseline flow-auto", "baseline flow-plan"],
			rationale:
				"The plan schema and quality checklist carry the distinct contract; bundled examples are optional reference material.",
		},
		{
			id: "critical-completion-checkpoint",
			classification: "evaluate",
			occurrences: ["surface-specific-bookended manager commands"],
			rationale:
				"Kept as a bounded variant for comparison; it restates only phase success conditions, not the complete prompt.",
		},
		{
			id: "parallel-decision-and-detailed-playbook",
			classification: "keep",
			occurrences: [
				"canonical bounded parallel decision fragment",
				"progressive-disclosure parallel orchestration reference",
			],
			rationale:
				"The bundled fragment supplies the bounded parallel boundary; sibling references disclose manifest, execution, and synthesis procedures only when needed.",
		},
		{
			id: "manager-and-hidden-review-judgment",
			classification: "keep",
			occurrences: [
				"manager review-and-complete procedure",
				"hidden reviewer role-safe contract",
			],
			rationale:
				"Manager routing and hidden-reviewer judgment cross separate trust boundaries; each is sourced from its role's skill contract.",
		},
	];

export function promptInventoryForVariant(
	variant: FlowPromptVariant,
): PromptMetric[] {
	return Object.values(compiledFlowPromptSurfaces(variant)).map(
		measureCompiledPrompt,
	);
}
