import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { canonicalJson, canonicalSha256 } from "../evals/canonical-json.js";
import { nativeAuthSourceSha256 } from "../evals/native-auth/host.js";
import {
	type QualificationBundleInput,
	type QualificationBundleManifest,
	readQualificationBundle,
	writeQualificationBundle,
} from "../evals/qualification-bundle.js";
import { CANARY_PLUGIN_LOADER_SHA256 } from "../scripts/eval-canary.js";

const json = (value: unknown) => Buffer.from(canonicalJson(value));
const digest = (value: Uint8Array) =>
	`sha256:${new Bun.CryptoHasher("sha256").update(value).digest("hex")}`;
const program =
	'const name = configured === undefined ? "SAMPLE_API_KEY" : configured;\nconst readApiKey = disabledMode ? () => undefined : selectedKey;\n';
const sourceMap = (source: string, metadata = {}) =>
	JSON.stringify({
		version: 3,
		sources: ["../src/public.ts"],
		sourcesContent: [source],
		names: [],
		mappings: "",
		...metadata,
	});
function tarball(content: string, name = "package/dist/public.js"): Buffer {
	const body = Buffer.from(content),
		header = Buffer.alloc(512);
	header.write(name, 0, "utf8");
	const octal = (value: number, offset: number, length: number) =>
		header.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset);
	octal(0o644, 100, 8);
	octal(0, 108, 8);
	octal(0, 116, 8);
	octal(body.length, 124, 12);
	octal(0, 136, 12);
	header.fill(32, 148, 156);
	header.write("0", 156);
	header.write("ustar\0", 257);
	header.write("00", 263);
	header.write(
		`${[...header]
			.reduce((a, b) => a + b, 0)
			.toString(8)
			.padStart(6, "0")}\0 `,
		148,
	);
	return gzipSync(
		Buffer.concat([
			header,
			body,
			Buffer.alloc(((512 - (body.length % 512)) % 512) + 1024),
		]),
	);
}
function base(): QualificationBundleInput {
	return {
		reportId: "scanner-boundary",
		packageVersion: "10.0.0",
		verdict: "VERIFIED",
		files: [
			...(
				[
					"report",
					"catalog",
					"policy",
					"plan",
					"completion",
					"expected-provenance",
					"decision",
					"canary-record",
					"canary-installation",
					"canary-session",
					"canary-transcript",
				] as const
			).map((role) => ({
				role,
				mediaType: "application/json" as const,
				bytes: json({ role }),
			})),
			{
				role: "artifact",
				mediaType: "application/gzip",
				bytes: tarball("public package", "package/README.md"),
			},
			{
				role: "attempt",
				id: "attempt-1",
				mediaType: "application/json",
				bytes: json({}),
			},
			{
				role: "transcript",
				id: "attempt-1",
				mediaType: "application/json",
				bytes: json({}),
			},
			{
				role: "authority-source",
				id: "evals/analyzer.ts",
				mediaType: "text/typescript",
				bytes: Buffer.from("export const analyzer = true;"),
			},
			{
				role: "execution-source",
				id: "evals/recorded.ts",
				mediaType: "text/typescript",
				bytes: Buffer.from("export const recorded = true;"),
			},
		],
	};
}
let root: string;
let seed: Awaited<ReturnType<typeof readQualificationBundle>>;
let installation: Record<string, unknown>;
let installationSources: Record<string, string>;
function installed(
	sourceFiles: Record<string, string> = installationSources,
): Buffer {
	const files = Object.fromEntries(
		Object.entries(sourceFiles).map(([name, source]) => [
			name,
			digest(Buffer.from(source)),
		]),
	);
	return json({
		...installation,
		nativeAuth: {
			kind: "native-account-source-v1",
			pluginDirectory: "fixture/.opencode/plugins/native-auth-client",
			files,
			entrySha256: files["index.ts"],
			sourceSha256: nativeAuthSourceSha256(files),
			sourceFiles,
		},
	});
}
beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "flow-qualification-safety-"));
	const sha = `sha256:${"a".repeat(64)}`;
	installation = {
		schemaVersion: 2,
		preparedSha256: sha,
		artifactSha256: sha,
		tarballSha256: sha,
		pluginEntrySha256: sha,
		installedPluginSha256: sha,
		sourcePackageSha256: sha,
		tuiEntrySha256: sha,
		pluginPackageSha256: sha,
		loaderEntrySha256: CANARY_PLUGIN_LOADER_SHA256,
		configSha256: sha,
	};
	installationSources = {
		"index.ts": 'export { default } from "./client-plugin.ts";\n',
		"package.json": JSON.stringify({
			name: "public-native-client",
			private: true,
			type: "module",
			exports: { ".": "./index.ts" },
		}),
		"protocol.ts": await readFile(
			new URL("../evals/native-auth/protocol.ts", import.meta.url),
			"utf8",
		),
		"client-plugin.ts": await readFile(
			new URL("../evals/native-auth/client-plugin.ts", import.meta.url),
			"utf8",
		),
	};
	const written = await writeQualificationBundle({
		input: base(),
		outputRoot: join(root, "seed"),
	});
	seed = await readQualificationBundle(written.path);
});
afterAll(async () => {
	if (root) await rm(root, { recursive: true, force: true });
});
type Role = QualificationBundleInput["files"][number]["role"];
type Contract = {
	name: string;
	role: Role;
	bytes: () => Buffer;
	accept: boolean;
	mediaType?: "text/typescript";
};
const contracts: Contract[] = [];
const add = (name: string, role: Role, bytes: () => Buffer, accept = false) =>
	contracts.push({ name, role, bytes, accept });
add("renamed JavaScript expressions", "artifact", () => tarball(program), true);
add(
	"renamed mapped expressions",
	"artifact",
	() => tarball(sourceMap(program), "package/dist/public.js.map"),
	true,
);
add(
	"TypeScript annotation",
	"artifact",
	() =>
		tarball(
			"export function check(value: unknown, secret: string): boolean { return false; }",
			"package/dist/public.ts",
		),
	true,
);
add(
	"schema validated installation with pinned source",
	"canary-installation",
	() => installed(),
	true,
);
add(
	"static public values below assignment length",
	"authority-source",
	() =>
		Buffer.from(
			`const api_key = "short"; const password = 123; const value = \`public\${"ok"}\`;`,
		),
	true,
);
for (const role of ["authority-source", "execution-source"] as const)
	add(`public ${role}`, role, () => Buffer.from(program), true);
add("source looking transcript stays data", "transcript", () =>
	json({ sourceFiles: { "protocol.ts": "secret: string): boolean" } }),
);
add("ordinary transcript assignment", "transcript", () =>
	json({ output: "api_key=configuredValue" }),
);
add("ordinary README assignment", "artifact", () =>
	tarball("api_key=configuredValue", "package/README.md"),
);
add("generic JSON sourceFiles grants no privilege", "artifact", () =>
	tarball(
		JSON.stringify({ sourceFiles: { "public.ts": program } }),
		"package/config.json",
	),
);
const prohibited = [
	["plain OpenAI", "sk-" + "a".repeat(24)],
	["Anthropic", "sk-ant-" + "a".repeat(24)],
	["project OpenAI", "sk-proj-" + "a".repeat(24)],
	["OpenRouter", "sk-or-" + "a".repeat(24)],
	["xAI", "xai-" + "a".repeat(24)],
	["Groq", "gsk_" + "a".repeat(24)],
	["HuggingFace", "hf_" + "a".repeat(24)],
	["DigitalOcean", "dop_v1_" + "a".repeat(24)],
	["Shopify", "shpat_" + "a".repeat(24)],
	["Google", "AIza" + "a".repeat(24)],
	["JWT", "eyJ" + "a".repeat(12) + "." + "b".repeat(12) + "." + "c".repeat(12)],
	["Bearer", "Bearer " + "a".repeat(24)],
	["long GitHub", "ghp_" + "a".repeat(40)],
	["GitHub PAT", "github_pat_" + "a".repeat(40)],
	["AWS", "AKIA" + "A".repeat(16)],
	["private key", "-----BEGIN PRIVATE KEY-----"],
	["Unix path", "/home/alice/private.txt"],
	["Mac path", "/Users/alice/private.txt"],
	["Windows path", String.raw`C:\Users\alice\private.txt`],
	["raw session", "ses_private123"],
	["raw review", "review:private-123"],
	["raw session colon", "session:private-123"],
] as const;
for (const [name, value] of prohibited) {
	const source = `export const sample = ${JSON.stringify(value)};`;
	for (const role of ["authority-source", "execution-source"] as const)
		add(`${role} ${name}`, role, () => Buffer.from(source));
	add(`JavaScript ${name}`, "artifact", () => tarball(source));
	add(`mapped ${name}`, "artifact", () =>
		tarball(sourceMap(source), "package/dist/public.js.map"),
	);
	add(`map metadata ${name}`, "artifact", () =>
		tarball(
			sourceMap("export {};", { x_metadata: { value } }),
			"package/dist/public.js.map",
		),
	);
	add(`installation source ${name}`, "canary-installation", () =>
		installed({ ...installationSources, "protocol.ts": source }),
	);
	add(`installation data ${name}`, "canary-installation", () =>
		json({ ...JSON.parse(installed().toString()), configSha256: value }),
	);
	add(`JSON key ${name}`, "transcript", () => json({ [value]: "public" }));
	add(`JSON string ${name}`, "transcript", () => json({ output: value }));
	add(`README ${name}`, "artifact", () => tarball(value, "package/README.md"));
	add(`package JSON ${name}`, "artifact", () =>
		tarball(JSON.stringify({ value }), "package/package.json"),
	);
}
const sensitive = [
	"secret",
	"password",
	"passwd",
	"api_key",
	"api-key",
	"access_token",
	"refresh-token",
	"client_secret",
	"authorization",
];
for (const key of sensitive) {
	const source = `const settings = { ${JSON.stringify(key)}: "opaqueLiteralValue987" };`;
	add(`object literal ${key}`, "authority-source", () => Buffer.from(source));
	add(`data binding ${key}`, "transcript", () =>
		json({ [key]: "opaqueLiteralValue987" }),
	);
}
const reviewPrograms = [
	[
		"import attribute",
		'import data from "./public.json" with { password: "opaqueLiteralValue987" };',
	],
	[
		"export attribute",
		'export { default } from "./public.json" with { password: "opaqueLiteralValue987" };',
	],
	[
		"escaped import attribute",
		String.raw`import data from "./public.json" with { "api_\u006bey": "opaqueLiteralValue987" };`,
	],
	[
		"escaped export attribute",
		String.raw`export { default } from "./public.json" with { "api_\u006bey": "opaqueLiteralValue987" };`,
	],
	["negative BigInt", "const password = -123456789012n;"],
	["parenthesized negative BigInt", "const password = -(123456789012n);"],
	["unsupported unary BigInt", "const password = +123456789012n;"],
	["unmatched regex group", "const pattern = /(/;"],
	["invalid regex flags", "const pattern = /hello/zz;"],
	["duplicate regex flags", "const pattern = /hello/gg;"],
	["invalid Unicode regex", String.raw`const pattern = /\u{110000}/u;`],
] as const;
for (const [name, source] of reviewPrograms) {
	add(`review ${name} authority`, "authority-source", () =>
		Buffer.from(source),
	);
	add(`review ${name} JavaScript`, "artifact", () => tarball(source));
	add(`review ${name} mapped`, "artifact", () =>
		tarball(sourceMap(source), "package/dist/public.js.map"),
	);
	add(`review ${name} installed`, "canary-installation", () =>
		installed({ ...installationSources, "protocol.ts": source }),
	);
}
for (const [name, source] of [
	[
		"public import attribute",
		'import data from "./public.json" with { type: "json" };',
	],
	[
		"public export attribute",
		'export { default } from "./public.json" with { type: "json" };',
	],
	["short negative BigInt", "const password = -12n;"],
	["public negative BigInt", "const count = -123456789012n;"],
	["valid regex", String.raw`const pattern = /(?<name>[a-z]+)\s+\k<name>/giu;`],
] as const) {
	add(
		`review control ${name}`,
		"authority-source",
		() => Buffer.from(source),
		true,
	);
}
const programs = [
	[
		"escaped literal",
		String.raw`const api_key = "\u006fpaqueLiteralValue987";`,
	],
	[
		"escaped binding",
		String.raw`const api_\u006bey = "opaqueLiteralValue987";`,
	],
	["template literal", "const password = `opaqueLiteralValue987`;"],
	["static concatenation", 'const api_key = "opaque" + "LiteralValue987";'],
	[
		"template substitutions",
		`const password = \`opaque\${"Literal"}Value987\`;`,
	],
	["numeric literal", "const password = 123456789012;"],
	[
		"computed property",
		'const settings = { ["api_" + "key"]: "opaqueLiteralValue987" };',
	],
	[
		"property assignment",
		'settings["client_" + "secret"] = "opaqueLiteralValue987";',
	],
	["dot assignment", 'settings.password = "opaqueLiteralValue987";'],
	[
		"default parameter",
		'function check(password = "opaqueLiteralValue987") {}',
	],
	["class property", 'class Settings { password = "opaqueLiteralValue987"; }'],
	[
		"destructuring default",
		'const { password = "opaqueLiteralValue987" } = settings;',
	],
	[
		"static token concatenation",
		'const sample = "sk-" + "aaaaaaaaaaaaaaaaaaaaaaaa";',
	],
	["static private path", 'const sample = "/ho" + "me/alice/private.txt";'],
	["comment assignment", "export {}; /* api_key=opaqueLiteralValue987 */"],
	[
		"escaped path",
		String.raw`const value = "\u002fhome\u002falice\u002fprivate.txt";`,
	],
	["malformed program", 'const api_key = "unterminated;'],
	["unsupported JSX", "const sample = <Thing />;"],
	["unsupported tagged template", `const sample = custom\`opaque\${value}\`;`],
] as const;
for (const [name, source] of programs) {
	add(`program ${name}`, "authority-source", () => Buffer.from(source));
	add(`map program ${name}`, "artifact", () =>
		tarball(sourceMap(source), "package/dist/public.js.map"),
	);
	add(`installed program ${name}`, "canary-installation", () =>
		installed({ ...installationSources, "protocol.ts": source }),
	);
}
add("JSON escaped token", "transcript", () =>
	Buffer.from('{"output":"\\u0073k-aaaaaaaaaaaaaaaaaaaaaaaa"}'),
);
add("map JSON escaped token", "artifact", () =>
	tarball(
		sourceMap('const value = "sk-aaaaaaaaaaaaaaaaaaaaaaaa";').replaceAll(
			"sk-",
			String.raw`\u0073k-`,
		),
		"package/dist/public.js.map",
	),
);
add("escaped data binding key", "transcript", () =>
	Buffer.from('{"api_\\u006bey":"opaqueLiteralValue987"}'),
);
for (const metadata of [
	{ names: ["api_key=opaqueLiteralValue987"] },
	{ sourceRoot: "/home/alice/private" },
	{ sources: ["review:private-123.ts"] },
	{ x_extension: { password: "opaqueLiteralValue987" } },
])
	add(`map metadata ${JSON.stringify(metadata)}`, "artifact", () =>
		tarball(sourceMap("export {};", metadata), "package/dist/public.js.map"),
	);
for (const map of [
	"{",
	JSON.stringify({ version: 2 }),
	sourceMap("export {};", { sections: [] }),
	sourceMap("export {};", { sourcesContent: [] }),
	sourceMap("export {};", { sources: ["public.css"] }),
	sourceMap("export {};", { sourcesContent: [null] }),
	sourceMap("export {};", { mappings: "!" }),
])
	add(`invalid map ${map}`, "artifact", () =>
		tarball(map, "package/dist/public.js.map"),
	);
add("invalid installation closure", "canary-installation", () => {
	const value = JSON.parse(installed().toString());
	value.nativeAuth.sourceFiles["protocol.ts"] = program;
	return json(value);
});
add("installation package JSON stays data", "canary-installation", () =>
	installed({
		...installationSources,
		"package.json": JSON.stringify({ sourceFiles: { "protocol.ts": program } }),
	}),
);

for (const [name, content] of [
	["valid raw static template", "const pattern = String.raw`(?:/|\\\\+/)`;"],
	[
		"public privacy regex",
		String.raw`const pattern = /(?:\/Users\/[^/\s]+|\/home\/[^/\s]+)/;`,
	],
] as const)
	add(name, "authority-source", () => Buffer.from(content), true);
for (const mappings of [
	"B",
	"g",
	"AA",
	"AAAAAA",
	"ACAA",
	"AAAAC",
	",",
	"AAAA,",
])
	add(`malformed VLQ ${mappings}`, "artifact", () =>
		tarball(
			sourceMap("export {};", { mappings }),
			"package/dist/public.js.map",
		),
	);
add(
	"historical Markdown source is data",
	"authority-source",
	() => Buffer.from("# Public qualification documentation\n"),
	true,
);

contracts.push({
	name: "source-looking transcript media stays data",
	role: "transcript",
	bytes: () => Buffer.from(program),
	accept: false,
	mediaType: "text/typescript",
});
for (const source of [
	String.raw`const pattern = /\/home\/alice\/private.txt/;`,
	String.raw`const pattern = /\u002fhome\u002falice\u002fprivate.txt/;`,
	"const password = String.raw`opaqueLiteralValue987`;",
	"const password = 0x123456789abc;",
	"const password = 123456789012n;",
	'settings.password ||= "opaqueLiteralValue987";',
])
	add(`additional static refusal ${source}`, "authority-source", () =>
		Buffer.from(source),
	);

async function resealed(
	role: Role,
	bytes: Buffer,
	name: string,
	mediaType?: "text/typescript",
): Promise<string> {
	const { bundleId: _id, bundleSha256: _sha, ...baseManifest } = seed.manifest;
	const sha256 = digest(bytes);
	const object = `objects/sha256-${sha256.slice(7)}`;
	const files = baseManifest.files.map((ref) =>
		ref.role === role
			? {
					...ref,
					sha256,
					object,
					bytes: bytes.length,
					...(mediaType ? { mediaType } : {}),
				}
			: ref,
	);
	const altered = { ...baseManifest, files };
	const bundleSha256 = canonicalSha256("flow-qualification-bundle-v1", altered);
	const manifest: QualificationBundleManifest = {
		...altered,
		bundleId: `qb1-${bundleSha256.slice(7)}`,
		bundleSha256,
	};
	const path = join(root, "mutants", name, manifest.bundleId);
	await mkdir(join(path, "objects"), { recursive: true });
	const objects = new Map(
		seed.files.map((file) => [file.ref.object, file.bytes]),
	);
	objects.set(object, bytes);
	for (const objectName of new Set(files.map((ref) => ref.object))) {
		const content = objects.get(objectName);
		if (!content) throw new Error("Missing test object");
		await writeFile(join(path, objectName), content);
	}
	await writeFile(join(path, "bundle.json"), json(manifest));
	return path;
}
describe("qualification safety public boundary", () => {
	for (const [index, contract] of contracts.entries()) {
		test(contract.name, async () => {
			const bytes = contract.bytes();
			const input = base();
			const changed = {
				...input,
				files: input.files.map((file) =>
					file.role === contract.role
						? {
								...file,
								bytes,
								...(contract.mediaType
									? { mediaType: contract.mediaType }
									: {}),
								...(contract.name === "historical Markdown source is data"
									? { id: "skills/public.md" }
									: {}),
							}
						: file,
				),
			};
			const mutant = contract.accept
				? undefined
				: await resealed(
						contract.role,
						bytes,
						String(index),
						contract.mediaType,
					);
			const write = writeQualificationBundle({
				input: changed,
				outputRoot: join(root, "writes", String(index)),
			});
			if (contract.accept) {
				const written = await write;
				const read = await readQualificationBundle(written.path);
				expect(
					read.files
						.find((file) => file.ref.role === contract.role)
						?.bytes.equals(bytes),
				).toBe(true);
			} else {
				const [writeResult, readResult] = await Promise.allSettled([
					write,
					readQualificationBundle(mutant ?? ""),
				]);
				for (const result of [writeResult, readResult]) {
					expect(result.status).toBe("rejected");
					if (result.status === "rejected")
						expect(String(result.reason)).toMatch(
							/secret-shaped|raw session identifier|absolute user path|Qualification.*(?:program|map|installation|JSON|limit)/,
						);
				}
			}
		}, 30000);
	}
});
