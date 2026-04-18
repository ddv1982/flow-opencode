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

export function maybeTitledList(title: string, items: string[], level = "##"): string {
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

export function maybeQuotedSection(title: string, value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return `## ${title}\n\n${toQuotedBlock(value)}`;
}

export function formatFollowUpLine(item: { summary: string; severity?: string | undefined }): string {
  return item.severity ? `${item.summary} (${item.severity})` : item.summary;
}

export function formatFollowUpLines(items: Array<{ summary: string; severity?: string | undefined }>): string[] {
  return items.map(formatFollowUpLine);
}

export function renderReviewBlock(
  title: string,
  review:
    | {
        status: string;
        summary: string;
        blockingFindings: Array<{ summary: string }>;
      }
    | undefined,
): string {
  if (!review) {
    return "";
  }

  const lines = [
    `- status: ${review.status}`,
    `- summary: ${toInlineText(review.summary)}`,
    ...(review.blockingFindings.length > 0 ? [bulletList(review.blockingFindings.map((item) => item.summary))] : []),
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
    ...(outcome.category ? [`category: ${toInlineText(outcome.category)}`] : []),
    ...(outcome.summary ? [`summary: ${toInlineText(outcome.summary)}`] : []),
    ...(outcome.resolutionHint ? [`resolution hint: ${toInlineText(outcome.resolutionHint)}`] : []),
    ...(outcome.retryable !== undefined ? [`retryable: ${outcome.retryable ? "yes" : "no"}`] : []),
    ...(outcome.autoResolvable !== undefined ? [`auto resolvable: ${outcome.autoResolvable ? "yes" : "no"}`] : []),
    ...(outcome.needsHuman !== undefined ? [`needs human: ${outcome.needsHuman ? "yes" : "no"}`] : []),
  ];
}
