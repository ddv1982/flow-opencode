export function toInlineText(value: string): string {
	return value.replace(/\r?\n+/g, " / ").trim();
}

export function bulletList(items: string[]): string {
	if (items.length === 0) {
		return "- none";
	}

	return items.map((item) => `- ${toInlineText(item)}`).join("\n");
}

export function joinSections(sections: string[]): string {
	return `${sections.filter(Boolean).join("\n\n")}\n`;
}

export function maybeSection(title: string, items: string[]): string {
	if (items.length === 0) {
		return "";
	}

	return `## ${title}\n\n${bulletList(items)}`;
}

export function maybeTitledList(
	title: string,
	items: string[],
	level = "##",
): string {
	if (items.length === 0) {
		return "";
	}

	return `${level} ${title}\n\n${bulletList(items)}`;
}

export function toQuotedBlock(value: string): string {
	const normalized = value.trim();
	if (!normalized) {
		return "> none";
	}

	return normalized
		.split(/\r?\n/)
		.map((line) => `> ${line}`)
		.join("\n");
}

export function maybeQuotedSection(
	title: string,
	value: string | null | undefined,
): string {
	if (!value) {
		return "";
	}

	return `## ${title}\n\n${toQuotedBlock(value)}`;
}

export function formatFollowUpLine(item: {
	summary: string;
	severity?: string | undefined;
}): string {
	return item.severity ? `${item.summary} (${item.severity})` : item.summary;
}

export function formatFollowUpLines(
	items: Array<{ summary: string; severity?: string | undefined }>,
): string[] {
	return items.map(formatFollowUpLine);
}

export function renderReviewBlock(
	title: string,
	review:
		| {
				status: string;
				summary: string;
				reviewDepth?: string | undefined;
				reviewedSurfaces?: string[] | undefined;
				evidenceSummary?: string | undefined;
				validationAssessment?: string | undefined;
				evidenceRefs?:
					| {
							changedArtifacts: string[];
							validationCommands: string[];
					  }
					| undefined;
				integrationChecks?: string[] | undefined;
				regressionChecks?: string[] | undefined;
				remainingGaps?: string[] | undefined;
				blockingFindings: Array<{ summary: string }>;
		  }
		| undefined,
): string {
	if (!review) {
		return "";
	}

	const lines = [
		`- status: ${review.status}`,
		...(review.reviewDepth ? [`- review depth: ${review.reviewDepth}`] : []),
		...(review.reviewedSurfaces && review.reviewedSurfaces.length > 0
			? [
					`- reviewed surfaces: ${review.reviewedSurfaces.map(toInlineText).join(", ")}`,
				]
			: []),
		...(review.evidenceSummary
			? [`- evidence: ${toInlineText(review.evidenceSummary)}`]
			: []),
		...(review.validationAssessment
			? [
					`- validation assessment: ${toInlineText(review.validationAssessment)}`,
				]
			: []),
		...(review.evidenceRefs && review.evidenceRefs.changedArtifacts.length > 0
			? [
					`- evidence changed artifacts: ${review.evidenceRefs.changedArtifacts.map(toInlineText).join(", ")}`,
				]
			: []),
		...(review.evidenceRefs && review.evidenceRefs.validationCommands.length > 0
			? [
					`- evidence validation commands: ${review.evidenceRefs.validationCommands.map(toInlineText).join(", ")}`,
				]
			: []),
		...(review.integrationChecks && review.integrationChecks.length > 0
			? [
					`- integration checks: ${review.integrationChecks.map(toInlineText).join(", ")}`,
				]
			: []),
		...(review.regressionChecks && review.regressionChecks.length > 0
			? [
					`- regression checks: ${review.regressionChecks.map(toInlineText).join(", ")}`,
				]
			: []),
		...(review.remainingGaps && review.remainingGaps.length > 0
			? [
					`- remaining gaps: ${review.remainingGaps.map(toInlineText).join(", ")}`,
				]
			: []),
		`- summary: ${toInlineText(review.summary)}`,
		...(review.blockingFindings.length > 0
			? [bulletList(review.blockingFindings.map((item) => item.summary))]
			: []),
	];

	return `#### ${title}\n\n${lines.join("\n")}`;
}

export function renderOutcomeLines(
	outcome:
		| {
				kind: string;
				category?: string | undefined;
				summary?: string | undefined;
				resolutionHint?: string | undefined;
				retryable?: boolean | undefined;
				autoResolvable?: boolean | undefined;
				needsHuman?: boolean | undefined;
		  }
		| null
		| undefined,
): string[] {
	if (!outcome) {
		return [];
	}

	return [
		`kind: ${outcome.kind}`,
		...(outcome.category
			? [`category: ${toInlineText(outcome.category)}`]
			: []),
		...(outcome.summary ? [`summary: ${toInlineText(outcome.summary)}`] : []),
		...(outcome.resolutionHint
			? [`resolution hint: ${toInlineText(outcome.resolutionHint)}`]
			: []),
		...(outcome.retryable !== undefined
			? [`retryable: ${outcome.retryable ? "yes" : "no"}`]
			: []),
		...(outcome.autoResolvable !== undefined
			? [`auto resolvable: ${outcome.autoResolvable ? "yes" : "no"}`]
			: []),
		...(outcome.needsHuman !== undefined
			? [`needs human: ${outcome.needsHuman ? "yes" : "no"}`]
			: []),
	];
}
