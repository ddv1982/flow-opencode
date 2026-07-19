import { findFlowGuidance } from "./guidance/catalog.js";
import { LEGACY_PROMPT_BASELINE } from "./prompt-baseline-fixtures.js";

export type FlowPromptVariant =
	| "baseline"
	| "lexically-deduplicated"
	| "surface-specific"
	| "surface-specific-bookended";

export type FlowPromptSurfaceName =
	| "flow-auto"
	| "flow-plan"
	| "flow-run"
	| "flow-review"
	| "flow-status"
	| "flow-reviewer"
	| "flow-evidence-worker"
	| "flow-validation-worker"
	| "flow-audit-worker"
	| "flow-candidate-worker"
	| "flow-verifier-worker";

export type FlowPromptRole =
	| "manager"
	| "reviewer"
	| "evidence-worker"
	| "validation-worker"
	| "audit-worker"
	| "candidate-worker"
	| "verifier-worker";

export type FlowPromptFragmentKind =
	| "purpose"
	| "invariant"
	| "procedure"
	| "reference"
	| "schema"
	| "checkpoint";

export type FlowPromptFragment = {
	id: string;
	source: string;
	origin: "skill-source" | "compiler";
	kind: FlowPromptFragmentKind;
	text: string;
	roles: readonly FlowPromptRole[];
	conditional?: boolean;
};

export type CompiledFlowPrompt = {
	surface: FlowPromptSurfaceName;
	variant: FlowPromptVariant;
	role: FlowPromptRole;
	text: string;
	fragments: readonly FlowPromptFragment[];
};

export type FlowWorkerHandoffKind =
	| "evidence"
	| "validation"
	| "audit"
	| "review-slice"
	| "verifier"
	| "candidate";

const MANAGER_ROLE = ["manager"] as const;
const REVIEWER_ROLE = ["reviewer"] as const;

const SURFACE_ROLES: Record<FlowPromptSurfaceName, FlowPromptRole> = {
	"flow-auto": "manager",
	"flow-plan": "manager",
	"flow-run": "manager",
	"flow-review": "reviewer",
	"flow-status": "manager",
	"flow-reviewer": "reviewer",
	"flow-evidence-worker": "evidence-worker",
	"flow-validation-worker": "validation-worker",
	"flow-audit-worker": "audit-worker",
	"flow-candidate-worker": "candidate-worker",
	"flow-verifier-worker": "verifier-worker",
};

const COMMAND_ACTIONS = {
	"flow-auto":
		"Drive the Flow loop only within the user's authorized scope; stop after planning when the request says not to implement: $ARGUMENTS",
	"flow-plan": "Create or revise the Flow plan for: $ARGUMENTS",
	"flow-run": "Execute the next approved feature. $ARGUMENTS",
	"flow-review": "Review the assigned work: $ARGUMENTS",
	"flow-status":
		"Call flow_status and report the session state and next action.",
} as const;

function flowGuidanceFileContent(topic: string, relativePath: string): string {
	const document = findFlowGuidance(topic, relativePath);
	if (!document) {
		throw new Error(`Missing bundled Flow guidance ${topic}/${relativePath}.`);
	}
	return document.content;
}

function markdownSection(content: string, heading: string): string {
	const lines = content.replace(/\r\n/g, "\n").split("\n");
	const start = lines.indexOf(`## ${heading}`);
	if (start === -1) throw new Error(`Missing markdown section '${heading}'.`);
	let end = lines.length;
	for (let index = start + 1; index < lines.length; index += 1) {
		if (/^## /.test(lines[index] ?? "")) {
			end = index;
			break;
		}
	}
	return lines.slice(start, end).join("\n").trim();
}

function sourceFragment(options: {
	id: string;
	skill: string;
	path: string;
	headings: readonly string[];
	roles?: readonly FlowPromptRole[];
	kind?: FlowPromptFragmentKind;
	conditional?: boolean;
}): FlowPromptFragment {
	const content = flowGuidanceFileContent(options.skill, options.path);
	const source = `${options.skill}/${options.path}`;
	return {
		id: options.id,
		source: `skills/${source}#${options.headings.join(", #")}`,
		origin: "skill-source",
		kind: options.kind ?? "reference",
		roles: options.roles ?? MANAGER_ROLE,
		...(options.conditional === undefined
			? {}
			: { conditional: options.conditional }),
		text: [
			`## Bundled ${source} (selected sections)`,
			...options.headings.map((heading) => markdownSection(content, heading)),
		].join("\n\n"),
	};
}

function wholeSourceFragment(options: {
	id: string;
	skill: string;
	path: string;
	roles: readonly FlowPromptRole[];
	conditional?: boolean;
}): FlowPromptFragment {
	const source = `${options.skill}/${options.path}`;
	return {
		id: options.id,
		source: `skills/${source}`,
		origin: "skill-source",
		kind: "reference",
		roles: options.roles,
		...(options.conditional === undefined
			? {}
			: { conditional: options.conditional }),
		text: `## Bundled ${source}\n\n${flowGuidanceFileContent(options.skill, options.path)}`,
	};
}

function markedPromptBlock(content: string, marker: string): string {
	const startMarker = `<!-- flow-prompt:${marker}:start -->`;
	const endMarker = `<!-- flow-prompt:${marker}:end -->`;
	const start = content.indexOf(startMarker);
	const end = content.indexOf(endMarker);
	if (start === -1 || end === -1 || end <= start) {
		throw new Error(`Missing or invalid Flow prompt marker '${marker}'.`);
	}
	if (
		content.indexOf(startMarker, start + startMarker.length) !== -1 ||
		content.indexOf(endMarker, end + endMarker.length) !== -1
	) {
		throw new Error(`Duplicate Flow prompt marker '${marker}'.`);
	}
	return content.slice(start + startMarker.length, end).trim();
}

function markedSourceFragment(options: {
	id: string;
	skill: string;
	path: string;
	marker: string;
	roles: readonly FlowPromptRole[];
	kind: FlowPromptFragmentKind;
	conditional?: boolean;
}): FlowPromptFragment {
	return {
		id: options.id,
		source: `skills/${options.skill}/${options.path}#flow-prompt:${options.marker}`,
		origin: "skill-source",
		kind: options.kind,
		roles: options.roles,
		...(options.conditional === undefined
			? {}
			: { conditional: options.conditional }),
		text: markedPromptBlock(
			flowGuidanceFileContent(options.skill, options.path),
			options.marker,
		),
	};
}

function literalFragment(
	options: Omit<FlowPromptFragment, "text" | "origin"> & {
		text: string;
	},
): FlowPromptFragment {
	return { ...options, origin: "compiler" };
}

const BASELINE_COMMAND_SOURCES = {
	"flow-auto": [
		["flow", "SKILL.md"],
		["flow", "references/recovery-playbook.md"],
		["flow", "references/parallel-orchestration.md"],
		["flow", "references/parallel-decision.md"],
		["flow", "references/parallel-manifest.md"],
		["flow", "references/parallel-execution.md"],
		["flow", "references/parallel-synthesis.md"],
		["flow", "references/handoff-format.md"],
		["flow-plan", "SKILL.md"],
		["flow-plan", "references/planning-examples.md"],
		["flow-plan", "references/plan-quality-checklist.md"],
		["flow-plan", "references/parallel-discovery.md"],
		["flow-run", "SKILL.md"],
		["flow-run", "references/validation-rubric.md"],
		["flow-run", "references/audit-rubric.md"],
		["flow-review", "SKILL.md"],
		["flow-review", "references/review-rubric.md"],
	],
	"flow-plan": [
		["flow-plan", "SKILL.md"],
		["flow-plan", "references/planning-examples.md"],
		["flow-plan", "references/plan-quality-checklist.md"],
		["flow-plan", "references/parallel-discovery.md"],
		["flow", "references/parallel-orchestration.md"],
		["flow", "references/parallel-decision.md"],
		["flow", "references/parallel-manifest.md"],
		["flow", "references/parallel-execution.md"],
		["flow", "references/parallel-synthesis.md"],
		["flow", "references/handoff-format.md"],
	],
	"flow-run": [
		["flow-run", "SKILL.md"],
		["flow-run", "references/validation-rubric.md"],
		["flow-run", "references/audit-rubric.md"],
		["flow", "references/parallel-orchestration.md"],
		["flow", "references/parallel-decision.md"],
		["flow", "references/parallel-manifest.md"],
		["flow", "references/parallel-execution.md"],
		["flow", "references/parallel-synthesis.md"],
		["flow", "references/handoff-format.md"],
		["flow-review", "SKILL.md"],
		["flow-review", "references/review-rubric.md"],
	],
	"flow-review": [
		["flow-review", "SKILL.md"],
		["flow-review", "references/review-rubric.md"],
		["flow-run", "references/audit-rubric.md"],
	],
} as const;

const MANAGER_OPENINGS = {
	"flow-auto": [
		"# Flow auto command contract",
		"",
		"Purpose: manage the approved Flow lifecycle from planning through validated, independently reviewed feature outcomes and closure.",
		"",
		"Non-negotiable invariants:",
		'- Call `flow_status { request: { view: "compact" } }` first and trust `workflowData.projection` over conversation memory.',
		"- Only the root manager may call state-changing `flow_*` tools or synthesize final results.",
		"- Approved plans are immutable, only one active execution may exist, and a passing feature outcome requires real validation plus an independent review assignment result.",
		"- A passing final feature outcome leaves closure null; start a guarded completed close. A stored closure is quiescent and retries only with its durable operation id.",
	].join("\n"),
	"flow-plan": [
		"# Flow plan command contract",
		"",
		"Purpose: produce an evidence-backed, executable Flow plan without beginning implementation.",
		"",
		"Non-negotiable invariants:",
		'- Call `flow_status { request: { view: "compact" } }` first and trust `workflowData.projection` over conversation memory.',
		"- Only the root manager may call state-changing `flow_*` tools.",
		"- Inspect environment facts before decomposing; do not invent findings.",
		"- Save a complete draft before approval, and approve only with explicit user approval or prior autonomous authorization.",
	].join("\n"),
	"flow-run": [
		"# Flow run command contract",
		"",
		"Purpose: execute exactly one approved Flow feature and record an honest feature outcome or a real blocker.",
		"",
		"Non-negotiable invariants:",
		'- Call `flow_status { request: { view: "compact" } }` first and trust `workflowData.projection` over conversation memory.',
		"- Only the root manager may call state-changing `flow_*` tools or synthesize final results.",
		"- Keep edits within the active execution and preserve unrelated user changes.",
		"- Create runtime-owned review identity only after passing validation; final assignment start durably binds the passing feature result and broad feature outcome submits only the final result.",
	].join("\n"),
} as const;

const PUBLIC_COMMAND_STARTUP = literalFragment({
	id: "public-command.startup-and-archive-recovery",
	source: "src/prompt-surfaces.ts#PUBLIC_COMMAND_STARTUP",
	kind: "procedure",
	roles: MANAGER_ROLE,
	text: [
		"## Public command startup",
		"",
		"The compiled sections are this public command's core Flow contract: references inside them to loading `flow`, `flow-plan`, `flow-run`, or `flow-review` mean use the matching compiled section or reserved reviewer route, never a native skill call. If an exact guide is already included below as a Bundled section, use it without loading it again. Otherwise call `flow_guidance` with id `flow-test`, `flow-deslop`, `flow-ui-quality`, or the exact reference id requested; `flow-commit` remains user-triggered only.",
		"",
		'Call `flow_status { request: { view: "compact" } }` and read status only from `workflowData.projection`. If compact status is completed with null closure, call `flow_session_close { request: { mode: "start", kind: "completed", ...guards } }`. If `projection.closure.retryOperationId` exists, do not run, reset, approve, or replan; call only `flow_session_close { request: { mode: "retry", operationId } }` with that complete value.',
	].join("\n"),
});

const MANAGER_PARALLEL_CORE = markedSourceFragment({
	id: "manager.parallel-pass-core",
	skill: "flow",
	path: "references/parallel-decision.md",
	marker: "manager-parallel-core",
	kind: "procedure",
	roles: MANAGER_ROLE,
	conditional: true,
});

const PUBLIC_REVIEWER_ROUTE = literalFragment({
	id: "public-command.reviewer-route",
	source: "src/prompt-surfaces.ts#PUBLIC_REVIEWER_ROUTE",
	kind: "procedure",
	roles: MANAGER_ROLE,
	text: [
		"## Public reviewer routing",
		"",
		"When a compiled source section says to load `flow-review`, route the bounded assignment packet to the reserved `flow-reviewer`; do not invoke a native core skill or perform the independent review in manager context.",
	].join("\n"),
});

const SURFACE_SPECIFIC_COMMAND_FRAGMENTS: Record<
	"flow-auto" | "flow-plan" | "flow-run",
	readonly FlowPromptFragment[]
> = {
	"flow-auto": [
		PUBLIC_COMMAND_STARTUP,
		sourceFragment({
			id: "manager.flow-loop",
			skill: "flow",
			path: "SKILL.md",
			headings: [
				"Loop",
				"Guidance Availability",
				"Runtime Surface",
				"Hard Gates",
				"Recovery",
			],
		}),
		sourceFragment({
			id: "manager.plan-core",
			skill: "flow-plan",
			path: "SKILL.md",
			headings: [
				"Planning runtime availability",
				"Inspect first",
				"Delivery intent and assurance profile",
				"Reduce uncertainty before decomposing",
				"Plan shape",
				"Plan quality gate",
				"Feature sizing",
				"Approval",
			],
		}),
		sourceFragment({
			id: "manager.plan-quality-checklist",
			skill: "flow-plan",
			path: "references/plan-quality-checklist.md",
			headings: ["Must pass", "Revise when you see this", "Approval summary"],
		}),
		sourceFragment({
			id: "manager.run-core",
			skill: "flow-run",
			path: "SKILL.md",
			headings: [
				"Execution runtime availability",
				"Start",
				"Implement",
				"Candidate implementation",
				"Validate",
				"Review and record outcome",
			],
		}),
		sourceFragment({
			id: "manager.validation-rubric",
			skill: "flow-run",
			path: "references/validation-rubric.md",
			headings: [
				"Evidence tiers",
				"Recording rules",
				"Scope",
				"Blockers and resets",
			],
		}),
		MANAGER_PARALLEL_CORE,
		PUBLIC_REVIEWER_ROUTE,
	],
	"flow-plan": [
		PUBLIC_COMMAND_STARTUP,
		sourceFragment({
			id: "manager.plan-core",
			skill: "flow-plan",
			path: "SKILL.md",
			headings: [
				"Planning runtime availability",
				"Inspect first",
				"Delivery intent and assurance profile",
				"Reduce uncertainty before decomposing",
				"Plan shape",
				"Plan quality gate",
				"Feature sizing",
				"Approval",
			],
		}),
		sourceFragment({
			id: "manager.plan-quality-checklist",
			skill: "flow-plan",
			path: "references/plan-quality-checklist.md",
			headings: ["Must pass", "Revise when you see this", "Approval summary"],
		}),
		MANAGER_PARALLEL_CORE,
	],
	"flow-run": [
		PUBLIC_COMMAND_STARTUP,
		sourceFragment({
			id: "manager.run-core",
			skill: "flow-run",
			path: "SKILL.md",
			headings: [
				"Execution runtime availability",
				"Start",
				"Implement",
				"Candidate implementation",
				"Validate",
				"Review and record outcome",
			],
		}),
		sourceFragment({
			id: "manager.validation-rubric",
			skill: "flow-run",
			path: "references/validation-rubric.md",
			headings: [
				"Evidence tiers",
				"Recording rules",
				"Scope",
				"Blockers and resets",
			],
		}),
		MANAGER_PARALLEL_CORE,
		PUBLIC_REVIEWER_ROUTE,
	],
};

const MANAGER_CHECKPOINTS = {
	"flow-auto":
		"Before stopping: confirm runtime state matches the report; every delivered feature has accepted validation and a recorded review execution; the final feature has ordered broad validation and a durable bound prerequisite; completed progress is explicitly closed or awaiting archive publication; otherwise report the exact blocker.",
	"flow-plan":
		"Before returning: confirm the plan is evidence-backed, executable by another agent, explicit about requirements/decisions/targets/validation/dependencies/review depth, saved as a draft, and not approved without authorization.",
	"flow-run":
		"Before submitting the feature outcome: confirm scope stayed within the active execution, commands and observed results are exact, runtime-attested receipt chronology and reported review time follow lifecycle order, review is independent and deep enough, no blocking finding remains unresolved, and the runtime—not prose—accepted the request.",
} as const;

const REVIEW_INVOCATION_FRAGMENT = literalFragment({
	id: "reviewer.command-invocation",
	source: "src/prompt-surfaces.ts#REVIEW_INVOCATION_FRAGMENT",
	kind: "purpose",
	roles: REVIEWER_ROLE,
	text: [
		"# Flow review assignment",
		"",
		'Recover the assignment only with `flow_status { request: { view: "reviewer", assignmentId } }` when available, then review its bounded packet context and actual changed artifacts under the `flow-reviewer` contract. Never guess feature, packet, evidence, revision, or snapshot fields. Treat `completedAt` as reported time bounded by assignment start and runtime acceptance. If required evidence is stale or unavailable, return an advisory result and state why it cannot be treated as Flow-gated.',
	].join("\n"),
});

const WORKER_INTEGRITY = markedSourceFragment({
	id: "worker.handoff-integrity",
	skill: "flow",
	path: "references/handoff-format.md",
	marker: "worker-integrity",
	kind: "invariant",
	roles: [
		"reviewer",
		"evidence-worker",
		"validation-worker",
		"audit-worker",
		"candidate-worker",
		"verifier-worker",
	],
});

const EVIDENCE_HANDOFF_SCHEMA = markedSourceFragment({
	id: "handoff.evidence-schema",
	skill: "flow",
	path: "references/handoff-format.md",
	marker: "handoff-evidence",
	kind: "schema",
	roles: ["evidence-worker"],
});

const VALIDATION_HANDOFF_SCHEMA = markedSourceFragment({
	id: "handoff.validation-schema",
	skill: "flow",
	path: "references/handoff-format.md",
	marker: "handoff-validation",
	kind: "schema",
	roles: ["validation-worker"],
});

const AUDIT_HANDOFF_SCHEMA = markedSourceFragment({
	id: "handoff.audit-schema",
	skill: "flow",
	path: "references/handoff-format.md",
	marker: "handoff-audit",
	kind: "schema",
	roles: ["audit-worker"],
});

const REVIEW_SLICE_HANDOFF_SCHEMA = markedSourceFragment({
	id: "handoff.review-slice-schema",
	skill: "flow",
	path: "references/handoff-format.md",
	marker: "handoff-review-slice",
	kind: "schema",
	roles: ["reviewer"],
});

const VERIFIER_HANDOFF_SCHEMA = markedSourceFragment({
	id: "handoff.verifier-schema",
	skill: "flow",
	path: "references/handoff-format.md",
	marker: "handoff-verifier",
	kind: "schema",
	roles: ["verifier-worker"],
});

const AUDIT_LEDGER_CONTRACT = sourceFragment({
	id: "audit.ledger-contract",
	skill: "flow-run",
	path: "references/audit-rubric.md",
	headings: ["Audit ledger fields", "Render and reconcile"],
	roles: ["reviewer", "audit-worker"],
	kind: "reference",
});

const CANDIDATE_HANDOFF_SCHEMA = markedSourceFragment({
	id: "handoff.candidate-schema",
	skill: "flow",
	path: "references/handoff-format.md",
	marker: "handoff-candidate",
	kind: "schema",
	roles: ["candidate-worker"],
});

const REVIEWER_FRAGMENTS: readonly FlowPromptFragment[] = [
	sourceFragment({
		id: "reviewer.hidden-core",
		skill: "flow-review",
		path: "references/hidden-reviewer-contract.md",
		headings: [
			"Role and availability",
			"Feature review depths",
			"Correction review packets",
			"Direct review outputs",
			"Special-case evidence",
			"Completion checkpoint",
		],
		kind: "purpose",
		roles: REVIEWER_ROLE,
	}),
	sourceFragment({
		id: "reviewer.review-rubric",
		skill: "flow-review",
		path: "references/review-rubric.md",
		headings: [
			"Finding classes",
			"Severity",
			"Feature review checklist",
			"Final review checklist",
			"Final convergence scan",
			"Payloads",
			"Audit report reviews",
		],
		roles: REVIEWER_ROLE,
	}),
	AUDIT_LEDGER_CONTRACT,
	REVIEW_SLICE_HANDOFF_SCHEMA,
	WORKER_INTEGRITY,
];

function workerRoleFragment(options: {
	id: string;
	marker: string;
	role: FlowPromptRole;
}): FlowPromptFragment {
	return markedSourceFragment({
		id: options.id,
		skill: "flow",
		path: "references/parallel-execution.md",
		marker: options.marker,
		kind: "purpose",
		roles: [options.role],
	});
}

const EVIDENCE_WORKER_ROLE = workerRoleFragment({
	id: "evidence-worker.role-contract",
	marker: "worker-role-evidence",
	role: "evidence-worker",
});

const VALIDATION_WORKER_ROLE = workerRoleFragment({
	id: "validation-worker.role-contract",
	marker: "worker-role-validation",
	role: "validation-worker",
});

const AUDIT_WORKER_ROLE = workerRoleFragment({
	id: "audit-worker.role-contract",
	marker: "worker-role-audit",
	role: "audit-worker",
});

const CANDIDATE_WORKER_ROLE = workerRoleFragment({
	id: "candidate-worker.role-contract",
	marker: "worker-role-candidate",
	role: "candidate-worker",
});

const VERIFIER_WORKER_ROLE = workerRoleFragment({
	id: "verifier-worker.role-contract",
	marker: "worker-role-verifier",
	role: "verifier-worker",
});

const WORKER_FRAGMENTS: Record<
	Exclude<
		FlowPromptSurfaceName,
		| "flow-auto"
		| "flow-plan"
		| "flow-run"
		| "flow-review"
		| "flow-status"
		| "flow-reviewer"
	>,
	readonly FlowPromptFragment[]
> = {
	"flow-evidence-worker": [
		EVIDENCE_WORKER_ROLE,
		EVIDENCE_HANDOFF_SCHEMA,
		WORKER_INTEGRITY,
	],
	"flow-validation-worker": [
		VALIDATION_WORKER_ROLE,
		VALIDATION_HANDOFF_SCHEMA,
		WORKER_INTEGRITY,
	],
	"flow-audit-worker": [
		AUDIT_WORKER_ROLE,
		AUDIT_LEDGER_CONTRACT,
		AUDIT_HANDOFF_SCHEMA,
		WORKER_INTEGRITY,
	],
	"flow-candidate-worker": [
		CANDIDATE_WORKER_ROLE,
		CANDIDATE_HANDOFF_SCHEMA,
		WORKER_INTEGRITY,
	],
	"flow-verifier-worker": [
		VERIFIER_WORKER_ROLE,
		VERIFIER_HANDOFF_SCHEMA,
		WORKER_INTEGRITY,
	],
};

function assertUniqueFragmentIds(
	surface: FlowPromptSurfaceName,
	fragments: readonly FlowPromptFragment[],
): void {
	const seen = new Set<string>();
	for (const fragment of fragments) {
		if (seen.has(fragment.id)) {
			throw new Error(
				`Prompt surface '${surface}' includes duplicate canonical fragment id '${fragment.id}'.`,
			);
		}
		seen.add(fragment.id);
	}
}

function renderFragments(fragments: readonly FlowPromptFragment[]): string {
	return fragments.map((fragment) => fragment.text.trim()).join("\n\n");
}

function deduplicateExactParagraphs(text: string): string {
	const seen = new Set<string>();
	return text
		.split(/\n{2,}/)
		.filter((paragraph) => {
			const key = paragraph.trim().replace(/\s+/g, " ").toLowerCase();
			if (!key || seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.join("\n\n");
}

function compileBaselineCommand(
	surface: keyof typeof BASELINE_COMMAND_SOURCES,
): CompiledFlowPrompt {
	const role = surface === "flow-review" ? REVIEWER_ROLE : MANAGER_ROLE;
	const fragments = BASELINE_COMMAND_SOURCES[surface].map(
		([skill, path], index) =>
			wholeSourceFragment({
				id: `baseline.${surface}.${index}.${skill}.${path}`,
				skill,
				path,
				roles: role,
				conditional:
					path.includes("parallel") ||
					path.includes("handoff") ||
					path.includes("example") ||
					path.includes("recovery"),
			}),
	);
	const text = [
		LEGACY_PROMPT_BASELINE.publicCommandPreflight,
		`Run the bundled ${surface} instructions below. ${COMMAND_ACTIONS[surface]}`,
		"",
		renderFragments(fragments),
	].join("\n\n");
	return {
		surface,
		variant: "baseline",
		role: role[0],
		text,
		fragments,
	};
}

function compileBaselineWorker(
	surface: FlowPromptSurfaceName,
): CompiledFlowPrompt {
	if (surface === "flow-reviewer") {
		const reviewBundle = BASELINE_COMMAND_SOURCES["flow-review"].map(
			([skill, path], index) =>
				wholeSourceFragment({
					id: `baseline.flow-reviewer.${index}.${skill}.${path}`,
					skill,
					path,
					roles: REVIEWER_ROLE,
				}),
		);
		return {
			surface,
			variant: "baseline",
			role: "reviewer",
			fragments: reviewBundle,
			text: [
				...LEGACY_PROMPT_BASELINE.reviewerSections,
				renderFragments(reviewBundle),
			].join("\n\n"),
		};
	}
	const text =
		LEGACY_PROMPT_BASELINE.workerPrompts[
			surface as keyof typeof LEGACY_PROMPT_BASELINE.workerPrompts
		];
	if (!text) throw new Error(`No baseline worker prompt for '${surface}'.`);
	return {
		surface,
		variant: "baseline",
		role: SURFACE_ROLES[surface],
		text,
		fragments: [],
	};
}

function compileSurfaceSpecific(
	surface: FlowPromptSurfaceName,
	bookended: boolean,
): CompiledFlowPrompt {
	if (surface === "flow-status") {
		return {
			surface,
			variant: bookended ? "surface-specific-bookended" : "surface-specific",
			role: "manager",
			text: COMMAND_ACTIONS["flow-status"],
			fragments: [],
		};
	}
	if (surface === "flow-review") {
		const fragments = [REVIEW_INVOCATION_FRAGMENT];
		return {
			surface,
			variant: bookended ? "surface-specific-bookended" : "surface-specific",
			role: "reviewer",
			text: `${renderFragments(fragments)}\n\n${COMMAND_ACTIONS[surface]}`,
			fragments,
		};
	}
	if (surface === "flow-reviewer") {
		assertUniqueFragmentIds(surface, REVIEWER_FRAGMENTS);
		return {
			surface,
			variant: bookended ? "surface-specific-bookended" : "surface-specific",
			role: "reviewer",
			text: renderFragments(REVIEWER_FRAGMENTS),
			fragments: REVIEWER_FRAGMENTS,
		};
	}
	if (surface in WORKER_FRAGMENTS) {
		const fragments =
			WORKER_FRAGMENTS[surface as keyof typeof WORKER_FRAGMENTS];
		assertUniqueFragmentIds(surface, fragments);
		return {
			surface,
			variant: bookended ? "surface-specific-bookended" : "surface-specific",
			role: SURFACE_ROLES[surface],
			text: renderFragments(fragments),
			fragments,
		};
	}

	const command = surface as keyof typeof SURFACE_SPECIFIC_COMMAND_FRAGMENTS;
	const coreFragments = SURFACE_SPECIFIC_COMMAND_FRAGMENTS[command];
	const action = literalFragment({
		id: `${surface}.action`,
		source: "src/prompt-surfaces.ts#COMMAND_ACTIONS",
		kind: "purpose",
		roles: MANAGER_ROLE,
		text: COMMAND_ACTIONS[command],
	});
	const opening = literalFragment({
		id: `${surface}.critical-opening`,
		source: "src/prompt-surfaces.ts#MANAGER_OPENINGS",
		kind: "invariant",
		roles: MANAGER_ROLE,
		text: MANAGER_OPENINGS[command],
	});
	const checkpoint = literalFragment({
		id: `${surface}.completion-checkpoint`,
		source: "src/prompt-surfaces.ts#MANAGER_CHECKPOINTS",
		kind: "checkpoint",
		roles: MANAGER_ROLE,
		text: `## Completion checkpoint\n\n${MANAGER_CHECKPOINTS[command]}`,
	});
	const fragments = bookended
		? [opening, action, ...coreFragments, checkpoint]
		: [action, ...coreFragments];
	assertUniqueFragmentIds(surface, fragments);
	return {
		surface,
		variant: bookended ? "surface-specific-bookended" : "surface-specific",
		role: "manager",
		text: renderFragments(fragments),
		fragments,
	};
}

export function compileFlowPromptSurface(
	surface: FlowPromptSurfaceName,
	variant: FlowPromptVariant = "surface-specific-bookended",
): CompiledFlowPrompt {
	if (variant === "baseline" || variant === "lexically-deduplicated") {
		let baseline: CompiledFlowPrompt;
		if (surface === "flow-status") {
			baseline = {
				surface,
				variant: "baseline",
				role: "manager",
				text: "Call flow_status and report the session state and next action.",
				fragments: [],
			};
		} else if (surface in BASELINE_COMMAND_SOURCES) {
			baseline = compileBaselineCommand(
				surface as keyof typeof BASELINE_COMMAND_SOURCES,
			);
		} else {
			baseline = compileBaselineWorker(surface);
		}
		if (variant === "baseline") return baseline;
		return {
			...baseline,
			variant,
			text: deduplicateExactParagraphs(baseline.text),
		};
	}
	return compileSurfaceSpecific(
		surface,
		variant === "surface-specific-bookended",
	);
}

export const FLOW_STATIC_PROMPT_SURFACES: readonly FlowPromptSurfaceName[] = [
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
];

export function compiledFlowPromptSurfaces(
	variant: FlowPromptVariant = "surface-specific-bookended",
): Record<FlowPromptSurfaceName, CompiledFlowPrompt> {
	return Object.fromEntries(
		FLOW_STATIC_PROMPT_SURFACES.map((surface) => [
			surface,
			compileFlowPromptSurface(surface, variant),
		]),
	) as Record<FlowPromptSurfaceName, CompiledFlowPrompt>;
}

const HANDOFF_REQUIRED_HEADINGS: Record<
	FlowWorkerHandoffKind,
	readonly string[]
> = {
	evidence: [
		"Status",
		"Scope",
		"Pass metadata",
		"Coverage",
		"Findings or facts",
		"Sources",
		"Confidence and verification",
		"Open questions / gaps",
		"Manager follow-ups",
	],
	validation: [
		"Status",
		"Scope",
		"Pass metadata",
		"Coverage",
		"Commands and outcomes",
		"Confidence and verification",
		"Open questions / gaps",
		"Manager follow-ups",
	],
	audit: [
		"Status",
		"Scope",
		"Pass metadata",
		"Coverage",
		"Findings",
		"Sources",
		"Confidence and verification",
		"Open questions / gaps",
		"Manager follow-ups",
	],
	"review-slice": [
		"Status",
		"Scope",
		"Pass metadata",
		"Coverage",
		"Findings",
		"Sources",
		"Confidence and verification",
		"Open questions / gaps",
		"Manager follow-ups",
	],
	verifier: [
		"Status",
		"Scope",
		"Pass metadata",
		"Verdict per claim",
		"Overall",
		"Gaps",
		"Manager follow-ups",
	],
	candidate: [
		"Status",
		"Scope",
		"Pass metadata",
		"Changed or proposed patch",
		"Coverage",
		"Verification",
		"Confidence and risk",
		"Merge notes",
		"Manager follow-ups",
	],
};

// Placeholder templates are standalone angle-bracket tokens. Requiring a
// boundary before `<` avoids treating ordinary type syntax such as
// `Map<string, number>` as an unfinished handoff.
const UNRESOLVED_HANDOFF_PLACEHOLDER =
	/(?:^|[\s([{=])<[^<>\n]+>(?=$|[\s)\]},.!?:;])/m;

export function validateFlowWorkerHandoff(
	kind: FlowWorkerHandoffKind,
	text: string,
): { ok: boolean; errors: string[] } {
	const normalized = text.replace(/\r\n/g, "\n").trim();
	const errors: string[] = [];
	if (!normalized) errors.push("handoff is empty");
	const headings = [
		...normalized.matchAll(/^## ([^\n—]+?)(?:\s+—[^\n]*)?$/gim),
	];
	const sections = new Map<string, string>();
	const duplicateHeadings = new Set<string>();
	for (let index = 0; index < headings.length; index += 1) {
		const match = headings[index];
		const name = match?.[1]?.trim();
		if (!match || !name) continue;
		const bodyStart = (match.index ?? 0) + match[0].length;
		const bodyEnd = headings[index + 1]?.index ?? normalized.length;
		const normalizedName = name.toLowerCase();
		if (sections.has(normalizedName)) duplicateHeadings.add(name);
		sections.set(normalizedName, normalized.slice(bodyStart, bodyEnd).trim());
	}
	for (const heading of duplicateHeadings) {
		errors.push(`duplicate heading: ${heading}`);
	}
	for (const heading of HANDOFF_REQUIRED_HEADINGS[kind]) {
		const body = sections.get(heading.toLowerCase());
		if (body === undefined) {
			errors.push(`missing heading: ${heading}`);
		} else if (!body) {
			errors.push(`empty section: ${heading}`);
		} else if (UNRESOLVED_HANDOFF_PLACEHOLDER.test(body)) {
			errors.push(`unresolved placeholder in section: ${heading}`);
		}
	}
	const statusBody = sections.get("status") ?? "";
	if (!/^(success|partial|blocked)$/i.test(statusBody)) {
		errors.push("missing valid status: success | partial | blocked");
	}
	return { ok: errors.length === 0, errors };
}
