type PromptSection = {
	title: string;
	body: string;
};

type PromptExample = {
	name: string;
	body: string;
};

function trimSectionBody(body: string): string {
	return body.trim();
}

export function renderPromptSections(sections: PromptSection[]): string {
	return sections
		.map(({ title, body }) => `## ${title}\n${trimSectionBody(body)}`)
		.join("\n\n");
}

export function renderExampleBlocks(examples: PromptExample[]): string {
	return examples
		.map(
			({ name, body }) =>
				`<example name="${name}">\n${trimSectionBody(body)}\n</example>`,
		)
		.join("\n\n");
}

export function renderTaggedBlock(tag: string, content: string): string {
	return `<${tag}>\n${trimSectionBody(content)}\n</${tag}>`;
}
