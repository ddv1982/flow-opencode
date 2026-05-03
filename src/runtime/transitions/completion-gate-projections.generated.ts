import {
	COMPLETION_GATE_DESCRIPTORS,
	COMPLETION_GATE_ORDER,
	type CompletionGateDescriptor,
	type CompletionGateId,
	type CompletionGatePath,
	REVIEW_AND_FIX_COMPLETION_GATE_ORDER,
	requiredArtifactForCompletionGate,
} from "./completion-gates";

type CompletionGateProjectionMode = "default" | "review_and_fix";

type CompletionGateProjectionOrder = readonly CompletionGateId[];

export type CompletionGateProjectionRow = {
	mode: CompletionGateProjectionMode;
	path: CompletionGatePath;
	step: number;
	gateId: CompletionGateId;
	recoveryKind: CompletionGateDescriptor["recoveryKind"];
	predicateOwner: CompletionGateDescriptor["predicateOwner"];
	invariantIds: CompletionGateDescriptor["invariantIds"];
	requiredArtifact?: string;
	renderableText: string;
	operatorHint: string;
};

const COMPLETION_GATE_PROJECTION_ORDERS = {
	default: COMPLETION_GATE_ORDER,
	review_and_fix: REVIEW_AND_FIX_COMPLETION_GATE_ORDER,
} as const satisfies Record<
	CompletionGateProjectionMode,
	Record<CompletionGatePath, CompletionGateProjectionOrder>
>;

function rowsForOrder(
	mode: CompletionGateProjectionMode,
	path: CompletionGatePath,
	order: CompletionGateProjectionOrder,
): CompletionGateProjectionRow[] {
	return order.map((gateId, index) => {
		const gate = COMPLETION_GATE_DESCRIPTORS[gateId];
		const requiredArtifact = requiredArtifactForCompletionGate(gate, path);
		return {
			mode,
			path,
			step: index + 1,
			gateId,
			recoveryKind: gate.recoveryKind,
			predicateOwner: gate.predicateOwner,
			invariantIds: gate.invariantIds,
			...(requiredArtifact ? { requiredArtifact } : {}),
			renderableText: gate.renderableText,
			operatorHint: gate.operatorHint,
		};
	});
}

const ALL_GATE_ROWS: CompletionGateProjectionRow[] = (
	Object.entries(COMPLETION_GATE_PROJECTION_ORDERS) as [
		CompletionGateProjectionMode,
		Record<CompletionGatePath, CompletionGateProjectionOrder>,
	][]
).flatMap(([mode, orders]) =>
	(["feature", "final"] as const).flatMap((path) =>
		rowsForOrder(mode, path, orders[path]),
	),
);

export const COMPLETION_GATE_DOC_ROWS = ALL_GATE_ROWS;

const COMPLETION_GATE_DOC_TABLE_HEADERS = [
	"Mode",
	"Path",
	"Step",
	"Gate ID",
	"Required Artifact",
	"Recovery Kind",
	"Predicate Owner",
	"Invariant IDs",
] as const;

function escapeTableCell(value: string): string {
	return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function formatDocRowsAsMarkdownTable(
	rows: readonly CompletionGateProjectionRow[],
): string {
	const header = `| ${COMPLETION_GATE_DOC_TABLE_HEADERS.join(" | ")} |`;
	const divider = `| ${COMPLETION_GATE_DOC_TABLE_HEADERS.map(() => "---").join(" | ")} |`;
	const body = rows.map((row) => {
		const requiredArtifact = row.requiredArtifact ?? "-";
		return `| ${row.mode} | ${row.path} | ${row.step} | ${row.gateId} | ${requiredArtifact} | ${row.recoveryKind} | ${row.predicateOwner} | ${escapeTableCell(row.invariantIds.join(", "))} |`;
	});
	return [header, divider, ...body].join("\n");
}

export const COMPLETION_GATE_DOC_MARKDOWN_TABLE = formatDocRowsAsMarkdownTable(
	COMPLETION_GATE_DOC_ROWS,
);

function formatGuidanceRows(
	rows: readonly CompletionGateProjectionRow[],
): string {
	return rows
		.map((row) => {
			const artifactText = row.requiredArtifact
				? ` | requiredArtifact: ${row.requiredArtifact}`
				: "";
			return `- ${row.step}. ${row.gateId} (${row.recoveryKind}) — ${row.renderableText}${artifactText}`;
		})
		.join("\n");
}

function guidanceBlock(
	title: string,
	path: CompletionGatePath,
	mode: CompletionGateProjectionMode,
): string {
	const rows = ALL_GATE_ROWS.filter(
		(row) => row.path === path && row.mode === mode,
	);
	return `${title}\n${formatGuidanceRows(rows)}`;
}

export const COMPLETION_GATE_PROMPT_GUIDANCE = [
	guidanceBlock("Feature completion gates (default):", "feature", "default"),
	guidanceBlock("Final completion gates (default):", "final", "default"),
	guidanceBlock(
		"Feature completion gates (review_and_fix):",
		"feature",
		"review_and_fix",
	),
	guidanceBlock(
		"Final completion gates (review_and_fix):",
		"final",
		"review_and_fix",
	),
].join("\n\n");

export const COMPLETION_GATE_AUDIT_GUIDANCE = [
	"Use completion gate evidence as a parity lens when evaluating workflow completion claims.",
	guidanceBlock(
		"Audit parity lens — feature path (default):",
		"feature",
		"default",
	),
	guidanceBlock(
		"Audit parity lens — final path (default):",
		"final",
		"default",
	),
	guidanceBlock(
		"Audit parity lens — feature path (review_and_fix):",
		"feature",
		"review_and_fix",
	),
	guidanceBlock(
		"Audit parity lens — final path (review_and_fix):",
		"final",
		"review_and_fix",
	),
].join("\n\n");
