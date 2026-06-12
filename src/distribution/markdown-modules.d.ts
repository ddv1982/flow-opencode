/**
 * Bun text imports (`import doc from "./x.md" with { type: "text" }`) resolve
 * markdown files to their string content; the bundler inlines them into
 * dist/index.js so the published artifact stays self-contained.
 */
declare module "*.md" {
	const text: string;
	export default text;
}
