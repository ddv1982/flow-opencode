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

export function formatFollowUpLines(
	items: Array<{ summary: string; severity?: string | undefined }>,
): string[] {
	return items.map((item) =>
		item.severity ? `${item.summary} (${item.severity})` : item.summary,
	);
}

export function maybeListLine(
	label: string,
	items: string[] | undefined,
): string[] {
	return items && items.length > 0
		? [`${label}: ${items.map(toInlineText).join(", ")}`]
		: [];
}
