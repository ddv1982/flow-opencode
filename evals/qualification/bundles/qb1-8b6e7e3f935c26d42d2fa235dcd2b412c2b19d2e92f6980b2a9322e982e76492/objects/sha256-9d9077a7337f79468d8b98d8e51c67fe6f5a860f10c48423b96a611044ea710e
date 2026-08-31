import { canonicalJson } from "./canonical-json.js";
import type { EvalReportV2 } from "./report.js";

type PairingIssue = {
	readonly path: string;
	readonly code: "pair" | "policy";
	readonly message: string;
};

export function validatePairing(
	report: EvalReportV2,
	primaryCells: readonly EvalReportV2["plan"]["cells"][number][],
	productCells: ReadonlySet<string>,
	activatedReserveCells: ReadonlySet<string>,
): {
	readonly issues: readonly PairingIssue[];
	readonly scoredOutcomes: number;
} {
	const issues: PairingIssue[] = [];
	const paired = report.plan.analysis.kind === "paired";
	const add = (path: string, code: PairingIssue["code"], message: string) =>
		issues.push({ path, code, message });

	if (paired !== (report.plan.stoppingRule.kind === "fixed-complete-pairs")) {
		add(
			"$.plan.stoppingRule.kind",
			"pair",
			"Paired campaigns require fixed-complete-pairs stopping; other campaigns require fixed-attempts.",
		);
	}
	const primaryBlocks = paired
		? new Set(primaryCells.map((cell) => cell.blockId)).size
		: 0;
	if (
		report.plan.stoppingRule.kind === "fixed-complete-pairs" &&
		report.plan.stoppingRule.count !== primaryBlocks
	) {
		add(
			"$.plan.stoppingRule.count",
			"policy",
			"Fixed-complete-pairs count must equal the primary paired block count.",
		);
	}
	if (paired !== (report.allocationCommitmentSha256 !== null)) {
		add(
			"$.allocationCommitmentSha256",
			"pair",
			"Allocation commitment is required exactly for paired campaigns.",
		);
	}
	if (!paired) {
		if (report.plan.cells.some((cell) => cell.armToken !== null)) {
			add(
				"$.plan.cells",
				"pair",
				"Non-paired campaigns cannot declare arm tokens.",
			);
		}
		const replacementReserves = report.plan.cells.some(
			(cell) => cell.schedule === "replacement-reserve",
		);
		const environmentReserves = report.plan.cells.some(
			(cell) => cell.schedule === "environment-reserve",
		);
		const invalidRetry =
			report.plan.abortPolicy.retry === "environment-only"
				? replacementReserves || !environmentReserves
				: report.plan.abortPolicy.retry !== "never" ||
					replacementReserves ||
					environmentReserves;
		if (invalidRetry) {
			add(
				"$.plan.abortPolicy",
				"pair",
				"Non-paired campaigns require either no reserves or environment-only reserves.",
			);
		}
		return { issues, scoredOutcomes: productCells.size };
	}
	if (
		report.plan.cells.some((cell) => cell.schedule === "environment-reserve")
	) {
		add(
			"$.plan.cells",
			"pair",
			"Paired campaigns cannot declare environment reserves.",
		);
	}

	let scoredOutcomes = 0;
	const blocks = new Map<string, EvalReportV2["plan"]["cells"][number][]>();
	for (const cell of report.plan.cells) {
		const block = blocks.get(cell.blockId) ?? [];
		block.push(cell);
		blocks.set(cell.blockId, block);
	}
	for (const [blockId, block] of blocks) {
		const first = block[0];
		const second = block[1];
		if (
			block.length !== 2 ||
			first === undefined ||
			second === undefined ||
			first.armToken === null ||
			second.armToken === null ||
			first.managerModel === null ||
			second.managerModel === null ||
			first.armToken === second.armToken ||
			first.caseId !== second.caseId ||
			first.caseVersion !== second.caseVersion ||
			first.repetition !== second.repetition ||
			first.schedule !== second.schedule ||
			canonicalJson(first.managerModel) !==
				canonicalJson(second.managerModel) ||
			canonicalJson(first.reviewerModel) !== canonicalJson(second.reviewerModel)
		) {
			add("$.plan.cells", "pair", `Invalid paired block ${blockId}.`);
		}
		if (
			block.length === 2 &&
			block.every((cell) => productCells.has(cell.cellId))
		) {
			scoredOutcomes += 1;
		}
		if (
			first?.schedule === "replacement-reserve" &&
			second?.schedule === "replacement-reserve" &&
			activatedReserveCells.has(first.cellId) !==
				activatedReserveCells.has(second.cellId)
		) {
			add(
				"$.completion.activatedReserveCellIds",
				"pair",
				`Replacement block ${blockId} must be activated as a whole pair.`,
			);
		}
	}
	if (report.plan.abortPolicy.retry !== "whole-pair") {
		add(
			"$.plan.abortPolicy.retry",
			"pair",
			"Paired campaigns require whole-pair retries.",
		);
	}
	return { issues, scoredOutcomes };
}
