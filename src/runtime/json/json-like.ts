import { access, readFile } from "node:fs/promises";

export async function readText(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return null;
	}
}

export async function readJson<T>(path: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as T;
	} catch {
		return null;
	}
}

export async function readJsonLike<T>(path: string): Promise<T | null> {
	const contents = await readText(path);
	if (!contents) {
		return null;
	}
	try {
		return JSON.parse(contents) as T;
	} catch {
		try {
			const stripped = stripJsonCommentsAndTrailingCommas(contents);
			return stripped ? (JSON.parse(stripped) as T) : null;
		} catch {
			return null;
		}
	}
}

export function stripJsonCommentsAndTrailingCommas(
	contents: string,
): string | null {
	let output = "";
	let inString = false;
	let quote: '"' | "'" | null = null;
	let escaped = false;
	let inLineComment = false;
	let inBlockComment = false;
	for (let index = 0; index < contents.length; index += 1) {
		const char = contents[index];
		const next = contents[index + 1];
		if (inLineComment) {
			if (char === "\n" || char === "\r") {
				inLineComment = false;
				output += char;
			}
			continue;
		}
		if (inBlockComment) {
			if (char === "*" && next === "/") {
				inBlockComment = false;
				index += 1;
				continue;
			}
			if (char === "\n" || char === "\r") {
				output += char;
			}
			continue;
		}
		if (inString) {
			output += char;
			if (escaped) {
				escaped = false;
				continue;
			}
			if (char === "\\") {
				escaped = true;
				continue;
			}
			if (char === quote) {
				inString = false;
				quote = null;
			}
			continue;
		}
		if (char === '"' || char === "'") {
			inString = true;
			quote = char;
			output += char;
			continue;
		}
		if (char === "/" && next === "/") {
			inLineComment = true;
			index += 1;
			continue;
		}
		if (char === "/" && next === "*") {
			inBlockComment = true;
			output += " ";
			index += 1;
			continue;
		}
		output += char;
	}
	if (inBlockComment) {
		return null;
	}
	return removeTrailingCommasOutsideStrings(output);
}

function removeTrailingCommasOutsideStrings(contents: string): string {
	let output = "";
	let inString = false;
	let quote: '"' | "'" | null = null;
	let escaped = false;
	for (let index = 0; index < contents.length; index += 1) {
		const char = contents[index];
		if (!char) {
			continue;
		}
		if (inString) {
			output += char;
			if (escaped) {
				escaped = false;
				continue;
			}
			if (char === "\\") {
				escaped = true;
				continue;
			}
			if (char === quote) {
				inString = false;
				quote = null;
			}
			continue;
		}
		if (char === '"' || char === "'") {
			inString = true;
			quote = char;
			output += char;
			continue;
		}
		if (char === ",") {
			let lookahead = index + 1;
			while (/\s/u.test(contents[lookahead] ?? "")) {
				lookahead += 1;
			}
			if (contents[lookahead] === "}" || contents[lookahead] === "]") {
				continue;
			}
		}
		output += char;
	}
	return output;
}

export async function pathExists(target: string): Promise<boolean> {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
}
