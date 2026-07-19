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

export type LifecycleFlatRequestExample = {
	tool:
		| "flow_status"
		| "flow_review_start"
		| "flow_feature_complete"
		| "flow_session_close";
	line: number;
	topLevelField: string | null;
};

const WORD_PATTERN = /[\p{L}\p{N}_`.-]+/gu;
const ACTION_PATTERN =
	/^(?:[-*]\s+|\d+[.)]\s+|(?:call|use|return|report|record|read|run|inspect|load|keep|preserve|treat|send|include|verify|confirm|stop|fail|approve|complete|work|identify|prefer|classify|write|account|orient|before)\b)/i;
const NEGATIVE_PATTERN =
	/\b(?:do not|don't|never|must not|cannot|can't|only\s+[^.]{0,40}\s+may)\b/i;

const LIFECYCLE_REQUEST_EXAMPLE_START =
	/\b(flow_status|flow_review_start|flow_feature_complete|flow_session_close)\b`?\s*(?:with\s+)?(?:\(\s*)?`?\{/gi;

const CRITICAL_RULES: Record<string, RegExp> = {
	"status-first": /call `?flow_status`? first/i,
	"manager-state-ownership":
		/only the (?:root )?manager may call state-changing `?flow_\*`?/i,
	"approved-plan-immutability": /approved plans? (?:are|is) immutable/i,
	"single-active-feature":
		/only one (?:feature (?:can|may) be active|active execution may exist)/i,
	"validation-required":
		/(?:completion|passing feature outcome) requires[^.]*validation/i,
	"independent-review-required":
		/(?:completion|passing feature outcome) requires[^.]*independent review/i,
	"archive-pending-retry": /closure[^.]*flow_session_close/i,
};

const STRUCTURAL_RULE_PATTERNS: Record<string, RegExp> = {
	"worker state mutation denied by permissions": /state-changing `?flow_/i,
	"approved plan immutability enforced by runtime":
		/approved plans? (?:are|is|cannot be changed) immutable/i,
	"single active execution enforced by runtime":
		/only one (?:feature (?:can|may) be active|active execution may exist)/i,
	"validation gate enforced by feature-outcome schema/runtime":
		/(?:completion|feature outcome) requires[^.]*validation|flow_review_start[^.]*validation/i,
	"review gate enforced by feature-outcome schema/runtime":
		/flow_review_start|independent review/i,
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

function quotedEnd(text: string, start: number): number {
	const quote = text[start];
	for (let index = start + 1; index < text.length; index += 1) {
		if (text[index] === "\\") {
			index += 1;
			continue;
		}
		if (text[index] === quote) return index;
	}
	return text.length - 1;
}

function skipWhitespace(text: string, start: number): number {
	let index = start;
	while (/\s/.test(text[index] ?? "")) index += 1;
	return index;
}

function topLevelObjectFields(payload: string): string[] {
	const fields: string[] = [];
	let objectDepth = 1;
	let arrayDepth = 0;
	let parenthesisDepth = 0;
	let expectsField = true;

	for (let index = 0; index < payload.length; index += 1) {
		const character = payload[index];
		const next = payload[index + 1];
		if (character === "/" && next === "/") {
			index = payload.indexOf("\n", index + 2);
			if (index === -1) break;
			continue;
		}
		if (character === "/" && next === "*") {
			const end = payload.indexOf("*/", index + 2);
			if (end === -1) break;
			index = end + 1;
			continue;
		}
		if (character === '"' || character === "'" || character === "`") {
			const end = quotedEnd(payload, index);
			if (
				expectsField &&
				objectDepth === 1 &&
				arrayDepth === 0 &&
				parenthesisDepth === 0
			) {
				const separator = skipWhitespace(payload, end + 1);
				if (payload[separator] === ":") {
					fields.push(payload.slice(index + 1, end));
					expectsField = false;
				}
			}
			index = end;
			continue;
		}
		if (character === "{") {
			objectDepth += 1;
			continue;
		}
		if (character === "}") {
			if (objectDepth === 1) break;
			objectDepth -= 1;
			continue;
		}
		if (character === "[") {
			arrayDepth += 1;
			continue;
		}
		if (character === "]") {
			arrayDepth = Math.max(0, arrayDepth - 1);
			continue;
		}
		if (character === "(") {
			parenthesisDepth += 1;
			continue;
		}
		if (character === ")") {
			parenthesisDepth = Math.max(0, parenthesisDepth - 1);
			continue;
		}
		if (objectDepth !== 1 || arrayDepth !== 0 || parenthesisDepth !== 0) {
			continue;
		}
		if (character === ",") {
			expectsField = true;
			continue;
		}
		if (!expectsField || /\s/.test(character ?? "")) continue;
		if (payload.startsWith("...", index)) {
			fields.push("...");
			expectsField = false;
			continue;
		}
		const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(
			payload.slice(index),
		)?.[0];
		if (!identifier) continue;
		const separator = skipWhitespace(payload, index + identifier.length);
		if (
			payload[separator] === ":" ||
			payload[separator] === "," ||
			payload[separator] === "}"
		) {
			fields.push(identifier);
			expectsField = false;
		}
		index += identifier.length - 1;
	}
	return fields;
}

/** Finds lifecycle-tool examples that bypass the required `request` envelope. */
export function auditLifecycleFlatRequestExamples(
	text: string,
): LifecycleFlatRequestExample[] {
	const violations: LifecycleFlatRequestExample[] = [];
	for (const match of text.matchAll(LIFECYCLE_REQUEST_EXAMPLE_START)) {
		const tool = match[1] as LifecycleFlatRequestExample["tool"] | undefined;
		if (!tool || match.index === undefined) continue;
		const payloadStart = match.index + match[0].length;
		const payload = text.slice(payloadStart);
		const fields = topLevelObjectFields(payload);
		const topLevelField = fields.find((field) => field !== "request") ?? null;
		if (fields.length > 0 && topLevelField === null) continue;
		violations.push({
			tool,
			line: text.slice(0, match.index).split(/\r?\n/).length,
			topLevelField,
		});
	}
	return violations;
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
	if (/flow_status`?\s+with\s+`?view\s*:/i.test(text)) {
		warnings.push("uses a flat flow_status request instead of request.view");
	}
	if (auditLifecycleFlatRequestExamples(text).length > 0) {
		warnings.push("uses a flat lifecycle tool request instead of request");
	}
	if (
		/original close envelope|reconstruct(?:ed|ing)? close request/i.test(text)
	) {
		warnings.push("asks for caller-retained or reconstructed close state");
	}
	if (
		/carrying that same feature result|resubmit[^.]*feature result/i.test(text)
	) {
		warnings.push("asks final outcome to resubmit the durable prerequisite");
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
				label: "one active execution scope",
				pattern: /sole scope|active execution/i,
			},
			{
				label: "targeted validation",
				pattern: /validationScope: ["`]targeted/i,
			},
			{ label: "review assignment", pattern: /flow_review_start/ },
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
		id: "flow-auto-plan-only",
		name: "Explicit plan-only request through flow-auto",
		input:
			"Using /flow-auto, create a phased migration plan and approval summary, but do not implement anything.",
		expectedRoute: "flow-auto",
		surface: "flow-auto",
		required: [
			{
				label: "plan-only boundary applies to flow-auto",
				pattern: /stop after the saved approval summary[\s\S]*\/flow-auto/i,
			},
			{
				label: "plan-only request does not authorize execution",
				pattern: /does not authorize `flow_run_start`/i,
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
		id: "ambiguous-review-intent",
		name: "Ambiguous broad review defaults to review and plan",
		input:
			"Review this repository for important quality problems; no implementation scope is stated.",
		expectedRoute: "flow-plan",
		surface: "flow-plan",
		required: [
			{
				label: "three delivery intents",
				pattern:
					/deliveryIntent: review_only[\s\S]*deliveryIntent: review_and_plan[\s\S]*deliveryIntent: review_and_implement/i,
			},
			{
				label: "ambiguous broad review defaults to review and plan",
				pattern:
					/default for an[\s\S]{0,60}ambiguous broad request[\s\S]{0,100}review this repository/i,
			},
			{
				label: "audit is evidence boundary",
				pattern: /audit an evidence boundary/i,
			},
		],
	},
	{
		id: "standard-assurance-profile",
		name: "Standard assurance uses a targeted challenge wave",
		input:
			"No trusted runtime-profile footer is present; plan a standard-profile repository audit after a countable discovery pass.",
		expectedRoute: "flow-plan",
		surface: "flow-plan",
		required: [
			{
				label: "standard profile exact name",
				pattern: /assuranceProfile: standard/i,
			},
			{
				label: "standard is only the absent-footer default",
				pattern:
					/Obey the trusted active runtime-profile footer[\s\S]{0,100}default to\s+`standard` only when it is absent/i,
			},
			{
				label: "standard admits bounded discovery and claim verification",
				pattern:
					/`standard` uses admitted bounded discovery\s+and claim verification/i,
			},
			{
				label: "one countable discovery wave",
				pattern: /one countable discovery wave/i,
			},
			{
				label: "targeted second-wave eligibility",
				pattern:
					/claim-targeted second-wave challenge only for surprising, inferred, contested,\s*low-confidence, single-source, cross-layer-incomplete, or high-impact claims/i,
			},
			{
				label: "no blanket reread",
				pattern: /Neither profile[^.]*blanket reread/i,
			},
		],
	},
	{
		id: "assurance-profile",
		name: "Assurance profile challenges actionable candidates",
		input:
			"The trusted runtime-profile footer says assurance; plan a matching security audit with independent challenge of every actionable candidate.",
		expectedRoute: "flow-plan",
		surface: "flow-plan",
		required: [
			{
				label: "assurance profile exact name",
				pattern: /assuranceProfile: assurance/i,
			},
			{
				label: "every actionable candidate challenged",
				pattern:
					/independently challenge every would-be\s+actionable or blocking candidate/i,
			},
			{
				label: "challenge stays claim scoped",
				pattern: /challenge claim-scoped/i,
			},
			{
				label: "assurance permits the larger admitted audit wave",
				pattern: /`assurance` permits the larger admitted audit wave/i,
			},
		],
	},
	{
		id: "targeted-refutation",
		name: "Standard second wave targets uncertain claims",
		input:
			"A standard discovery wave produced one low-confidence single-source cross-layer-incomplete finding; choose the next audit step.",
		expectedRoute: "flow-plan",
		surface: "flow-plan",
		required: [
			{
				label: "uncertain claims receive targeted challenge",
				pattern:
					/claim-targeted second-wave challenge only for[\s\S]{0,160}low-confidence[\s\S]{0,80}single-source[\s\S]{0,80}cross-layer-incomplete/i,
			},
			{
				label: "single-source verification worker",
				pattern: /flow-verifier-worker/i,
			},
		],
	},
	{
		id: "p0-guarded-candidate",
		name: "Guarded speculative candidate is not P0",
		input:
			"As the audit worker, assess a suspected catastrophic path that has no demonstrated reachable trigger and has effective guards and recovery.",
		expectedRoute: "flow-audit-worker",
		surface: "flow-audit-worker",
		required: [
			{
				label: "P0 has a demonstrated reachability threshold",
				pattern:
					/`actionPriority: "fix_now"` \(P0\) requires\s*demonstrated, reachable catastrophic or ship-blocking behavior/i,
			},
			{
				label: "ineffective guards and recovery required",
				pattern: /ineffective\s+or absent guards and recovery/i,
			},
			{
				label: "refuted candidates excluded from remediation",
				pattern:
					/refuted candidates (?:carry none|out of remediation)|refuted finding[\s\S]{0,120}no remediation/i,
			},
		],
	},
	{
		id: "p0-demonstrated-ship-blocker",
		name: "Demonstrated reachable ship blocker may be P0",
		input:
			"As the audit worker, assess a reproduced reachable data-loss path in the actual deployment whose guards and recovery are demonstrably ineffective.",
		expectedRoute: "flow-audit-worker",
		surface: "flow-audit-worker",
		required: [
			{
				label: "P0 allows demonstrated ship blockers",
				pattern:
					/`actionPriority: "fix_now"` \(P0\) requires\s*demonstrated, reachable catastrophic or ship-blocking behavior with ineffective\s+or absent guards and recovery/i,
			},
			{
				label: "audit ledger fields",
				pattern:
					/Each finding uses exactly:[\s\S]{0,1400}`proofState`[\s\S]{0,1400}`actionPriority`[\s\S]{0,120}`falsifier`/i,
			},
			{
				label: "exact audit ledger enum spellings",
				pattern:
					/`proofState`:[\s\S]{0,120}`source_proven`[\s\S]{0,80}`invariant_only`[\s\S]{0,1400}`actionPriority`:[\s\S]{0,80}`fix_now`/i,
			},
			{
				label: "canonical audit renderer",
				pattern: /call `flow_audit_render`[\s\S]{0,220}canonical Markdown/i,
			},
		],
	},
	{
		id: "correction-review-packet",
		name: "Correction review uses a bounded delta or full fallback",
		input:
			"Review a correction whose prior blockers are known but whose changed-artifact accounting is incomplete and touches persistence.",
		expectedRoute: "flow-reviewer",
		surface: "flow-reviewer",
		required: [
			{
				label: "correction packet contents",
				pattern:
					/prior blockers, actual artifacts\s+changed in response, and focused post-change evidence/i,
			},
			{
				label: "full review fallback",
				pattern:
					/Fall back to\s+the full assigned-depth review[\s\S]{0,180}persistence/i,
			},
			{
				label: "correction links the exact predecessor",
				pattern:
					/`correctionOfAssignmentId`[\s\S]{0,180}runtime-returned predecessor id/i,
			},
		],
	},
	{
		id: "record-review-before-edit",
		name: "Failed review is recorded before repair",
		input:
			"A terminal feature review failed and autonomous repair is authorized, but the failed result has not been recorded yet.",
		expectedRoute: "flow-run",
		surface: "flow-run",
		required: [
			{
				label: "record terminal result before edit",
				pattern:
					/Before any repair or edit, submit the terminal failed review result/i,
			},
			{
				label: "refresh compact status",
				pattern:
					/Immediately\s+refresh `flow_status \{ request: \{ view: "compact" \} \}`/i,
			},
			{
				label: "retry exhaustion not inferred from memory",
				pattern:
					/do not assert that retry budget is exhausted from remembered/i,
			},
		],
	},
	{
		id: "validation-schedule",
		name: "Validation follows the staged source-bound schedule",
		input:
			"Schedule validation for a final artifact-only feature from pre-edit diagnosis through final review.",
		expectedRoute: "flow-run",
		surface: "flow-run",
		required: [
			{
				label: "diagnostic baseline advisory",
				pattern: /diagnostic baseline before edits is advisory only/i,
			},
			{
				label: "focused after changes",
				pattern: /After changes, run focused checks/i,
			},
			{
				label: "complete artifact gate",
				pattern:
					/artifact-only work, run the complete applicable artifact gate/i,
			},
			{
				label: "broad once after review and last edit",
				pattern:
					/run the broad gate once, after the feature review has\s+passed and after the final edit/i,
			},
			{
				label: "source and run applicability",
				pattern: /only to the exact feature run and source identity/i,
			},
			{
				label: "targeted not reused as broad",
				pattern:
					/Never reuse\s+or relabel targeted evidence as broad validation/i,
			},
		],
	},
	{
		id: "validation-receipt-capture",
		name: "Bash validation becomes a runtime receipt",
		input:
			"Capture a passing focused Bash check for the active feature and use it to create the next review assignment.",
		expectedRoute: "flow-run",
		surface: "flow-run",
		required: [
			{
				label: "capture is armed immediately before Bash",
				pattern:
					/Immediately before every exact Bash command[\s\S]{0,120}`flow_validation_start`/i,
			},
			{
				label: "exact command runs next",
				pattern:
					/byte-for-byte command[\s\S]{0,100}Run that\s+exact Bash command next/i,
			},
			{
				label: "runtime appends immutable receipt ref",
				pattern: /immutable ref[\s\S]{0,80}\[flow-validation-receipt\]/i,
			},
			{
				label: "review start receives validation refs",
				pattern:
					/`validationRefs` copied exactly from successful capture output/i,
			},
			{
				label: "model does not author validation metadata",
				pattern:
					/Never author or pass validation timestamps, exit status, output digests, or\s+per-command summaries/i,
			},
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
		id: "runtime-profile-control",
		name: "Control profile keeps legacy optional workers",
		input:
			"The trusted runtime-profile footer says control; dispatch one bounded optional discovery worker and plan a later Bash validation check.",
		expectedRoute: "flow-plan",
		surface: "flow-plan",
		required: [
			{
				label: "trusted footer takes precedence",
				pattern:
					/Obey the trusted active runtime-profile footer when it is present/i,
			},
			{
				label: "control has no admission ceremony",
				pattern:
					/`control` preserves legacy optional-worker\s+behavior without admission ceremony/i,
			},
			{
				label: "receipts remain mandatory",
				pattern:
					/Runtime validation receipts remain mandatory in every profile/i,
			},
		],
	},
	{
		id: "orchestration-admission",
		name: "Bounded worker proposal is admitted before dispatch",
		input:
			"The trusted runtime-profile footer says standard; dispatch one bounded discovery proposal with two non-overlapping slices to the hidden evidence workers.",
		expectedRoute: "flow-plan",
		surface: "flow-plan",
		required: [
			{
				label: "one admission call before dispatch",
				pattern:
					/Under `standard` or `assurance`, before dispatch the root manager calls\s+`flow_orchestration_admit` exactly once per bounded discovery/i,
			},
			{
				label: "supported worker mappings are exact",
				pattern:
					/`discovery` ->\s*`flow-evidence-worker`[\s\S]{0,100}`audit` ->\s*`flow-audit-worker`[\s\S]{0,100}`verification` ->\s*`flow-verifier-worker`[\s\S]{0,120}`candidate-implementation` ->\s*`flow-candidate-worker`/i,
			},
			{
				label: "review and validation are excluded",
				pattern:
					/Mandatory `flow-reviewer` assignments are\s+assignment-gated[\s\S]{0,120}`flow-validation-worker` checks are receipt-gated/i,
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
				label: "failed review accepted as blocker",
				pattern: /genuine blocker[^.]*accepted mutation/i,
			},
			{ label: "one repair", pattern: /at most one repair/i },
			{ label: "one retry review", pattern: /one\s+retry\s+review/i },
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
			{ label: "status first", pattern: /Call `flow_status\b/i },
			{
				label: "closure detected",
				pattern: /projection\.closure\.retryOperationId/i,
			},
			{
				label: "retry close",
				pattern: /flow_session_close[^.]*mode: ["`]retry/i,
			},
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
			{
				label: "never starts a third review",
				pattern: /never start a third review/i,
			},
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
				"manager review-and-record-outcome procedure",
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
