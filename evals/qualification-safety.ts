import * as ts from "typescript/unstable/ast";
import { API, type Snapshot } from "typescript/unstable/async";
import { InstallationEvidenceSchema } from "../scripts/eval-canary.js";
import { scrubSecrets, scrubSecretTokens } from "./cassette.js";
import { assertNoPrivateUserPaths } from "./private-paths.js";

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_NODES = 1_000_000;
const MAX_DEPTH = 512;
const sensitive =
	/api[_-]?key|secret|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|authorization/i;
const acceptedPrograms = new Map<string, number>();
let cachedBytes = 0;
let parserQueue: Promise<void> = Promise.resolve();

function assertRawTokens(text: string): void {
	if (
		scrubSecretTokens(text) !== text ||
		/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)
	)
		throw new Error("Qualification bundle contains secret-shaped evidence.");
	if (/\b(?:ses_[A-Za-z0-9]+|(?:session|review):[A-Za-z0-9-]+)\b/.test(text))
		throw new Error("Qualification bundle contains a raw session identifier.");
}

export function assertQualificationTokens(text: string): void {
	assertRawTokens(text);
	assertNoPrivateUserPaths(text);
}

export function assertQualificationText(text: string): void {
	assertQualificationTokens(text);
	if (scrubSecrets(text) !== text)
		throw new Error("Qualification bundle contains secret-shaped evidence.");
}

export function assertQualificationData(value: unknown): void {
	let count = 0;
	function visit(item: unknown, depth: number): void {
		if (++count > MAX_NODES || depth > MAX_DEPTH)
			throw new Error("Qualification data exceeds its limit.");
		if (typeof item === "string") assertQualificationText(item);
		else if (Array.isArray(item))
			for (const child of item) visit(child, depth + 1);
		else if (item && typeof item === "object") {
			for (const [key, child] of Object.entries(item)) {
				assertQualificationText(key);
				if (typeof child === "string" || typeof child === "number")
					assertQualificationText(`${key}=${child}`);
				visit(child, depth + 1);
			}
		}
	}
	assertQualificationText(JSON.stringify(value));
	visit(value, 0);
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		throw new Error("Qualification bundle JSON is malformed.");
	}
}

type Primitive = string | number | boolean | bigint | null;
function inspectSyntax(source: ts.SourceFile, text: string): void {
	let count = 0;
	const deadline = performance.now() + 10_000;
	const values = new Map<ts.Node, Primitive | undefined>();
	const trivia = new Set<number>();
	const patterns: { start: number; end: number }[] = [];
	function bounded(value: Primitive | undefined): Primitive | undefined {
		if (typeof value === "string" && value.length > MAX_BYTES)
			throw new Error("Qualification program value exceeds its limit.");
		return value;
	}
	function primitive(
		node: ts.Node | undefined,
		depth = 0,
	): Primitive | undefined {
		if (!node) return undefined;
		if (depth > MAX_DEPTH)
			throw new Error("Qualification program exceeds its depth limit.");
		if (values.has(node)) return values.get(node);
		let value: Primitive | undefined;
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
			value = node.text;
		else if (
			ts.isTaggedTemplateExpression(node) &&
			ts.isNoSubstitutionTemplateLiteral(node.template)
		)
			value = node.template.getText(source).slice(1, -1);
		else if (ts.isNumericLiteral(node))
			value = Number(node.text.replaceAll("_", ""));
		else if (ts.isBigIntLiteral(node))
			value = BigInt(node.text.replaceAll("_", "").replace(/n$/, ""));
		else if (node.kind === ts.SyntaxKind.TrueKeyword) value = true;
		else if (node.kind === ts.SyntaxKind.FalseKeyword) value = false;
		else if (node.kind === ts.SyntaxKind.NullKeyword) value = null;
		else if (
			ts.isParenthesizedExpression(node) ||
			ts.isAsExpression(node) ||
			ts.isSatisfiesExpression(node) ||
			ts.isNonNullExpression(node) ||
			ts.isTypeAssertion(node)
		)
			value = primitive(node.expression, depth + 1);
		else if (ts.isPrefixUnaryExpression(node)) {
			const operand = primitive(node.operand, depth + 1);
			if (typeof operand === "number") {
				if (node.operator === ts.SyntaxKind.MinusToken) value = -operand;
				if (node.operator === ts.SyntaxKind.PlusToken) value = operand;
			} else if (typeof operand === "bigint") {
				if (node.operator === ts.SyntaxKind.MinusToken) value = -operand;
				else if (node.operator === ts.SyntaxKind.TildeToken) value = ~operand;
				else throw new Error("Qualification program uses an unsupported form.");
			}
		} else if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.PlusToken
		) {
			const left = primitive(node.left, depth + 1),
				right = primitive(node.right, depth + 1);
			if (left !== undefined && right !== undefined) {
				if (typeof left === "string" || typeof right === "string")
					value = String(left) + String(right);
				else if (typeof left === "number" && typeof right === "number")
					value = left + right;
				else if (typeof left === "bigint" && typeof right === "bigint")
					value = left + right;
			}
		} else if (ts.isTemplateExpression(node)) {
			let result = node.head.text;
			let known = true;
			for (const span of node.templateSpans) {
				const part = primitive(span.expression, depth + 1);
				if (part === undefined) {
					known = false;
					break;
				}
				result += String(part) + span.literal.text;
				bounded(result);
			}
			if (known) value = result;
		}
		value = bounded(value);
		values.set(node, value);
		return value;
	}
	function name(node: ts.Node): string | undefined {
		if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text;
		if (ts.isPropertyAccessExpression(node)) return name(node.name);
		if (ts.isComputedPropertyName(node)) {
			const key = primitive(node.expression);
			return key === undefined ? undefined : String(key);
		}
		if (ts.isElementAccessExpression(node)) {
			const key = primitive(node.argumentExpression);
			return key === undefined ? undefined : String(key);
		}
		const value = primitive(node);
		return value === undefined ? undefined : String(value);
	}
	function binding(keyNode: ts.Node, valueNode: ts.Node | undefined): void {
		const key = name(keyNode),
			value = primitive(valueNode);
		if (key && sensitive.test(key) && value !== undefined)
			assertQualificationText(`${key}=${String(value)}`);
	}
	function comments(pos: number): void {
		if (pos < 0 || trivia.has(pos)) return;
		trivia.add(pos);
		for (const range of [
			...(ts.getLeadingCommentRanges(text, pos) ?? []),
			...(ts.getTrailingCommentRanges(text, pos) ?? []),
		])
			assertQualificationText(text.slice(range.pos, range.end));
	}
	function visit(node: ts.Node, depth: number): void {
		if (
			++count > MAX_NODES ||
			depth > MAX_DEPTH ||
			performance.now() > deadline
		)
			throw new Error("Qualification program exceeds its inspection limit.");
		if (
			(ts.isTaggedTemplateExpression(node) &&
				!ts.isNoSubstitutionTemplateLiteral(node.template)) ||
			ts.isJsxElement(node) ||
			ts.isJsxSelfClosingElement(node) ||
			ts.isJsxFragment(node)
		)
			throw new Error("Qualification program uses an unsupported form.");
		comments(node.pos);
		comments(node.end);
		if (
			ts.isTaggedTemplateExpression(node) &&
			ts.isNoSubstitutionTemplateLiteral(node.template)
		)
			assertQualificationText(node.template.getText(source).slice(1, -1));
		if (ts.isRegularExpressionLiteral(node)) {
			patterns.push({ start: node.getStart(source), end: node.end });
			assertRawTokens(node.text);
			const pattern = node.text.slice(1, node.text.lastIndexOf("/"));
			try {
				new RegExp(pattern, node.text.slice(node.text.lastIndexOf("/") + 1));
			} catch {
				throw new Error(
					"Qualification program has a malformed regular expression.",
				);
			}
			for (const part of pattern.split(
				/\[[^\]]*\]|\\[dDsSwWbBpPkK]|[.*+?^${}()|]/,
			)) {
				assertQualificationText(
					part.replace(
						/\\(?:u\{([a-fA-F0-9]+)\}|u([a-fA-F0-9]{4})|x([a-fA-F0-9]{2})|([^ux]))/g,
						(
							_match,
							wide: string | undefined,
							unicode: string | undefined,
							hex: string | undefined,
							escaped: string | undefined,
						) => {
							const code = wide ?? unicode ?? hex;
							return code === undefined
								? (escaped ?? "")
								: String.fromCodePoint(Number.parseInt(code, 16));
						},
					),
				);
			}
		}
		if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node))
			assertQualificationTokens(node.text);
		if (
			ts.isStringLiteral(node) ||
			ts.isNoSubstitutionTemplateLiteral(node) ||
			ts.isTemplateHead(node) ||
			ts.isTemplateMiddle(node) ||
			ts.isTemplateTail(node)
		)
			assertQualificationText(node.text);
		const value = primitive(node);
		if (value !== undefined && typeof value === "string")
			assertQualificationText(value);
		if (
			ts.isVariableDeclaration(node) ||
			ts.isParameterDeclaration(node) ||
			ts.isPropertyDeclaration(node) ||
			ts.isPropertyAssignment(node) ||
			ts.isBindingElement(node) ||
			ts.isEnumMember(node)
		)
			if (node.name) binding(node.name, node.initializer);
		if (ts.isImportAttribute(node)) binding(node.name, node.value);
		if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
			node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
		)
			binding(node.left, node.right);
		node.forEachChild((child) => {
			visit(child, depth + 1);
		});
	}
	visit(source, 0);
	let start = 0;
	for (const pattern of patterns.sort(
		(left, right) => left.start - right.start,
	)) {
		assertNoPrivateUserPaths(text.slice(start, pattern.start));
		start = pattern.end;
	}
	assertNoPrivateUserPaths(text.slice(start));
}

async function parseProgram(
	text: string,
	language: "js" | "ts",
): Promise<void> {
	const config = "/qualification/tsconfig.json",
		input = `/qualification/input.${language}`;
	const files = new Map([
		[
			config,
			JSON.stringify({
				compilerOptions: {
					noLib: true,
					noResolve: true,
					types: [],
					allowJs: true,
					checkJs: false,
					target: "esnext",
				},
				files: [`input.${language}`],
			}),
		],
		[input, text],
	]);
	const api = new API({
		cwd: "/qualification",
		fs: {
			readFile: (path) => files.get(path) ?? null,
			fileExists: (path) => files.has(path),
			directoryExists: (path) => path === "/qualification",
			getAccessibleEntries: () => ({ files: [], directories: [] }),
			realpath: (path) => path,
		},
	});
	let snapshot: Snapshot | undefined;
	try {
		snapshot = await api.updateSnapshot({ openProjects: [config] });
		const project = snapshot.getProject(config);
		if (!project || (await project.program.getSyntacticDiagnostics()).length)
			throw new Error("Qualification program is malformed.");
		const names = await project.program.getSourceFileNames();
		if (names.length !== 1 || names[0] !== input)
			throw new Error("Qualification program loaded an unsupported input.");
		const source = await project.program.getSourceFile(input);
		if (!source) throw new Error("Qualification program is unavailable.");
		inspectSyntax(source, text);
	} finally {
		try {
			await snapshot?.dispose();
		} finally {
			await api.close();
		}
	}
}

export async function assertQualificationProgram(
	text: string,
	language: "js" | "ts" = "ts",
): Promise<void> {
	if (Buffer.byteLength(text) > MAX_BYTES)
		throw new Error("Qualification program exceeds its byte limit.");
	try {
		assertRawTokens(text);
	} catch (error) {
		if (error instanceof Error && error.message.includes("secret-shaped"))
			throw new Error("Qualification bundle contains secret-shaped source.");
		throw error;
	}
	const key = `${language}:${new Bun.CryptoHasher("sha256").update(text).digest("hex")}`;
	const run = parserQueue.then(async () => {
		if (acceptedPrograms.has(key)) return;
		await parseProgram(text, language);
		while (
			acceptedPrograms.size >= 64 ||
			cachedBytes + text.length > 32 * 1024 * 1024
		) {
			const oldest = acceptedPrograms.entries().next().value;
			if (!oldest) break;
			acceptedPrograms.delete(oldest[0]);
			cachedBytes -= oldest[1];
		}
		acceptedPrograms.set(key, text.length);
		cachedBytes += text.length;
	});
	parserQueue = run.catch(() => {});
	await run;
}

function programLanguage(name: string): "js" | "ts" | undefined {
	if (/\.(?:[cm]?js)$/.test(name)) return "js";
	if (/\.(?:[cm]?ts)$/.test(name)) return "ts";
	return undefined;
}

export async function assertQualificationSource(
	name: string,
	text: string,
): Promise<void> {
	const language = programLanguage(name);
	if (language) await assertQualificationProgram(text, language);
	else if (name.endsWith(".json")) assertQualificationData(parseJson(text));
	else assertQualificationText(text);
}

function assertMappings(
	mappings: string,
	sources: number,
	names: number,
): void {
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	let source = 0,
		line = 0,
		column = 0,
		name = 0;
	for (const row of mappings.split(";")) {
		let generated = 0;
		if (row === "") continue;
		for (const segment of row.split(",")) {
			const fields: number[] = [];
			let value = 0,
				shift = 0;
			for (const character of segment) {
				const digit = alphabet.indexOf(character);
				if (digit < 0 || shift > 30)
					throw new Error("Qualification source map VLQ exceeds its limit.");
				value += (digit & 31) * 2 ** shift;
				if (digit & 32) shift += 5;
				else {
					if (value === 1)
						throw new Error(
							"Qualification source map uses unsupported negative zero VLQ.",
						);
					fields.push((value & 1 ? -1 : 1) * Math.floor(value / 2));
					value = 0;
					shift = 0;
				}
			}
			if (shift || ![1, 4, 5].includes(fields.length))
				throw new Error("Qualification source map segment is malformed.");
			generated += fields[0] ?? 0;
			if (generated < 0)
				throw new Error("Qualification source map column is invalid.");
			if (fields.length > 1) {
				source += fields[1] ?? 0;
				line += fields[2] ?? 0;
				column += fields[3] ?? 0;
				if (source < 0 || source >= sources || line < 0 || column < 0)
					throw new Error("Qualification source map location is invalid.");
			}
			if (fields.length === 5) {
				name += fields[4] ?? 0;
				if (name < 0 || name >= names)
					throw new Error("Qualification source map name is invalid.");
			}
		}
	}
}

async function assertSourceMap(text: string): Promise<void> {
	const parsed = parseJson(text);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throw new Error("Qualification source map is malformed.");
	const map = parsed as Record<string, unknown>;
	if (
		map.version !== 3 ||
		"sections" in map ||
		"url" in map ||
		!Array.isArray(map.sources) ||
		!Array.isArray(map.sourcesContent) ||
		map.sources.length > 1024 ||
		map.sources.length !== map.sourcesContent.length ||
		!Array.isArray(map.names) ||
		!map.names.every((name) => typeof name === "string") ||
		typeof map.mappings !== "string" ||
		!/^[A-Za-z0-9+/;,]*$/.test(map.mappings) ||
		("file" in map && typeof map.file !== "string") ||
		("sourceRoot" in map && typeof map.sourceRoot !== "string")
	)
		throw new Error("Qualification source map uses an unsupported form.");
	const { sourcesContent: _content, ...metadata } = map;
	assertQualificationData(metadata);
	assertMappings(map.mappings, map.sources.length, map.names.length);
	for (const [index, source] of map.sources.entries()) {
		const language =
			typeof source === "string" ? programLanguage(source) : undefined;
		const content = map.sourcesContent[index];
		if (!language || typeof content !== "string")
			throw new Error("Qualification source map program is unsupported.");
		await assertQualificationProgram(content, language);
	}
}

export async function assertQualificationJson(
	role: string,
	parsed: unknown,
): Promise<void> {
	if (
		role !== "canary-installation" ||
		!parsed ||
		typeof parsed !== "object" ||
		!("nativeAuth" in parsed)
	) {
		assertQualificationData(parsed);
		return;
	}
	const result = InstallationEvidenceSchema.safeParse(parsed);
	if (!result.success)
		throw new Error("Qualification installation source envelope is invalid.");
	const installation = result.data;
	if (installation.schemaVersion !== 2 || !installation.nativeAuth) {
		assertQualificationData(parsed);
		return;
	}
	const { nativeAuth, ...data } = installation;
	const { sourceFiles, ...authData } = nativeAuth;
	assertQualificationData(data);
	assertQualificationData(authData);
	for (const [name, text] of Object.entries(sourceFiles)) {
		assertQualificationText(name);
		if (name === "package.json") assertQualificationData(parseJson(text));
		else await assertQualificationProgram(text, "ts");
	}
}

export async function assertQualificationMember(
	name: string,
	bytes: Uint8Array,
): Promise<void> {
	try {
		assertRawTokens(Buffer.from(bytes).toString("utf8"));
	} catch (error) {
		if (error instanceof Error && error.message.includes("secret-shaped"))
			throw new Error("Qualification bundle contains secret-shaped source.");
		throw error;
	}
	const language = programLanguage(name);
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		if (language || name.endsWith(".map") || name.endsWith(".json"))
			throw new Error("Qualification program or JSON is not UTF-8.");
		return;
	}
	if (language) await assertQualificationProgram(text, language);
	else if (name.endsWith(".map")) await assertSourceMap(text);
	else if (name.endsWith(".json")) assertQualificationData(parseJson(text));
	else assertQualificationText(text);
}
