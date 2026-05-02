#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_SOURCE_ROOTS = ["src"];
const DEFAULT_ARTIFACTS = ["dist/index.js"];
const FORBIDDEN_PATTERNS = [
	{
		label: "console.*",
		rationale:
			"Remove temporary debug output; replace intentional operator/observability signals with equivalent injected loggers, telemetry, or explicit stdout/stderr stream writes that preserve severity, message intent, and key context.",
	},
	{
		label: "debugger",
		rationale: "Debugger statements must not ship in release-bound code.",
	},
];

const NORMAL = "normal";
const SINGLE_QUOTE = "single_quote";
const DOUBLE_QUOTE = "double_quote";
const TEMPLATE = "template";
const LINE_COMMENT = "line_comment";
const BLOCK_COMMENT = "block_comment";
const REGEX_LITERAL = "regex_literal";

function isIdentifierCharacter(character) {
	return /[A-Za-z0-9_$]/.test(character);
}

function isWordBoundary(text, start, length) {
	const before = start > 0 ? text[start - 1] : "";
	const after = text[start + length] ?? "";
	return !isIdentifierCharacter(before) && !isIdentifierCharacter(after);
}

function skipWhitespace(text, start) {
	let cursor = start;
	while (/\s/.test(text[cursor] ?? "")) {
		cursor += 1;
	}
	return cursor;
}

function previousSignificantCharacter(text, start) {
	let cursor = start - 1;
	while (cursor >= 0 && /\s/.test(text[cursor] ?? "")) {
		cursor -= 1;
	}
	return cursor >= 0 ? text[cursor] : "";
}

function matchConsoleMember(text, start) {
	if (!text.startsWith("console", start) || !isWordBoundary(text, start, 7)) {
		return false;
	}

	let cursor = skipWhitespace(text, start + 7);
	while (text[cursor] === ")") {
		cursor = skipWhitespace(text, cursor + 1);
	}

	if (text[cursor] === "." || text[cursor] === "[") {
		return true;
	}

	return text[cursor] === "?" && text[cursor + 1] === ".";
}

function matchDebuggerStatement(text, start) {
	if (!text.startsWith("debugger", start) || !isWordBoundary(text, start, 8)) {
		return false;
	}

	if (previousSignificantCharacter(text, start) === ".") {
		return false;
	}

	const cursor = skipWhitespace(text, start + 8);
	const next = text[cursor] ?? "";
	return next === "" || next === ";" || next === "\n" || next === "\r" || next === "}";
}

function isRegexLiteralStart(previousSignificant) {
	return (
		previousSignificant === "" ||
		"([{=,:;!&|?+-*~^<>".includes(previousSignificant)
	);
}

function findForbiddenExecutableTokens(text) {
	const findings = [];
	const templateExpressionBraceDepths = [];
	let state = NORMAL;
	let escaped = false;
	let inRegexCharacterClass = false;

	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];
		const next = text[index + 1];

		if (state === NORMAL) {
			if (templateExpressionBraceDepths.length > 0) {
				const lastDepthIndex = templateExpressionBraceDepths.length - 1;
				if (character === "{") {
					templateExpressionBraceDepths[lastDepthIndex] += 1;
				} else if (character === "}") {
					templateExpressionBraceDepths[lastDepthIndex] -= 1;
					if (templateExpressionBraceDepths[lastDepthIndex] === 0) {
						templateExpressionBraceDepths.pop();
						state = TEMPLATE;
						escaped = false;
						continue;
					}
				}
			}

			if (character === "/" && next === "/") {
				state = LINE_COMMENT;
				index += 1;
				continue;
			}
			if (character === "/" && next === "*") {
				state = BLOCK_COMMENT;
				index += 1;
				continue;
			}
			if (
				character === "/" &&
				next !== "/" &&
				next !== "*" &&
				isRegexLiteralStart(previousSignificantCharacter(text, index))
			) {
				state = REGEX_LITERAL;
				escaped = false;
				inRegexCharacterClass = false;
				continue;
			}
			if (character === "'") {
				state = SINGLE_QUOTE;
				escaped = false;
				continue;
			}
			if (character === '"') {
				state = DOUBLE_QUOTE;
				escaped = false;
				continue;
			}
			if (character === "`") {
				state = TEMPLATE;
				escaped = false;
				continue;
			}

			if (matchConsoleMember(text, index)) {
				findings.push({ label: "console.*", index });
			}
			if (matchDebuggerStatement(text, index)) {
				findings.push({ label: "debugger", index });
			}
			continue;
		}

		if (state === LINE_COMMENT) {
			if (character === "\n") {
				state = NORMAL;
			}
			continue;
		}

		if (state === BLOCK_COMMENT) {
			if (character === "*" && next === "/") {
				state = NORMAL;
				index += 1;
			}
			continue;
		}

		if (state === REGEX_LITERAL) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (character === "\\") {
				escaped = true;
				continue;
			}
			if (character === "[") {
				inRegexCharacterClass = true;
				continue;
			}
			if (character === "]") {
				inRegexCharacterClass = false;
				continue;
			}
			if (character === "/" && !inRegexCharacterClass) {
				state = NORMAL;
			}
			continue;
		}

		if (state === TEMPLATE) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (character === "\\") {
				escaped = true;
				continue;
			}
			if (character === "$" && next === "{") {
				templateExpressionBraceDepths.push(1);
				state = NORMAL;
				index += 1;
				continue;
			}
			if (character === "`") {
				state = NORMAL;
			}
			continue;
		}

		if (state === SINGLE_QUOTE || state === DOUBLE_QUOTE) {
			const terminal = state === SINGLE_QUOTE ? "'" : '"';
			if (escaped) {
				escaped = false;
				continue;
			}
			if (character === "\\") {
				escaped = true;
				continue;
			}
			if (character === terminal) {
				state = NORMAL;
			}
		}
	}

	return findings;
}

function resolveRepoPath(filePath) {
	return path.resolve(import.meta.dirname, "..", "..", filePath);
}

function splitEnvList(envName, fallback) {
	const value = process.env[envName];
	if (!value) {
		return fallback;
	}

	return value
		.split(path.delimiter)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function listFiles(rootPath) {
	if (!existsSync(rootPath)) {
		return [];
	}

	const stats = statSync(rootPath);
	if (stats.isFile()) {
		return [rootPath];
	}
	if (!stats.isDirectory()) {
		return [];
	}

	return readdirSync(rootPath, { withFileTypes: true }).flatMap((entry) => {
		const entryPath = path.join(rootPath, entry.name);
		if (entry.isDirectory()) {
			return listFiles(entryPath);
		}
		return entry.isFile() ? [entryPath] : [];
	});
}

function isScannableFile(filePath) {
	return /\.(?:[cm]?[jt]sx?)$/.test(filePath);
}

function lineAndColumn(text, index) {
	const prefix = text.slice(0, index);
	const lines = prefix.split("\n");
	return {
		line: lines.length,
		column: (lines.at(-1)?.length ?? 0) + 1,
	};
}

function scanFile(filePath, repoRoot) {
	const text = readFileSync(filePath, "utf8");
	return findForbiddenExecutableTokens(text).map((finding) => {
		const forbidden = FORBIDDEN_PATTERNS.find(
			(pattern) => pattern.label === finding.label,
		);
		return {
			path: path.relative(repoRoot, filePath),
			label: finding.label,
			rationale: forbidden?.rationale ?? "Forbidden release artifact.",
			...lineAndColumn(text, finding.index),
		};
	});
}

function fail(lines) {
	process.stderr.write(`${lines.join("\n")}\n`);
	process.exit(1);
}

function main() {
	const repoRoot = resolveRepoPath(".");
	const roots = splitEnvList(
		"FLOW_RELEASE_HYGIENE_SOURCE_ROOTS",
		DEFAULT_SOURCE_ROOTS,
	).map((entry) => path.resolve(repoRoot, entry));
	const artifacts = splitEnvList(
		"FLOW_RELEASE_HYGIENE_ARTIFACTS",
		DEFAULT_ARTIFACTS,
	).map((entry) => path.resolve(repoRoot, entry));

	const files = [...roots.flatMap(listFiles), ...artifacts]
		.filter(isScannableFile)
		.filter((filePath, index, all) => all.indexOf(filePath) === index)
		.sort();

	const findings = files.flatMap((filePath) => scanFile(filePath, repoRoot));

	if (findings.length > 0) {
		fail([
			"Release hygiene failed: debug-only artifacts are present in release-bound code.",
			...findings.map(
				(finding) =>
					`- ${finding.path}:${finding.line}:${finding.column} ${finding.label} — ${finding.rationale}`,
			),
		]);
	}

	process.stdout.write(
		`Release hygiene OK: scanned ${files.length} release-bound files for console/debugger artifacts.\n`,
	);
}

try {
	main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	fail(["Release hygiene failed.", message]);
}
