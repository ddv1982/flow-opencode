import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
	lstat,
	mkdir,
	open,
	readdir,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	normalize,
	relative,
	resolve,
	sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { resolveFlowPluginVersion } from "../version.js";

const FLOW_PACKAGE_NAME = "opencode-plugin-flow";
const OWNED_WRAPPER_MARKER = "// @opencode-plugin-flow-owned-wrapper v1";
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const MAX_LOCAL_PLUGIN_BYTES = 1024 * 1024;
const EXACT_VERSION_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const FLOW_NPM_SPECIFIER_PATTERN = /^opencode-plugin-flow(?:@(.+))?$/;
// OpenCode's plugin-directory glob is {plugin,plugins}/*.{js,ts}.
const LOCAL_PLUGIN_EXTENSION_PATTERN = /\.(?:js|ts)$/i;

export type ActivationScope = "global" | "project";
export type ActivationRecordScope =
	| ActivationScope
	| "custom"
	| "inline"
	| "managed";
export type ActivationSource =
	| "global-config"
	| "project-config"
	| "project-directory-config"
	| "custom-config"
	| "custom-directory-config"
	| "inline-config"
	| "managed-config"
	| "global-plugin-directory"
	| "home-plugin-directory"
	| "project-plugin-directory"
	| "custom-plugin-directory";

export type ActivationOwnership =
	| "flow-npm"
	| "marker-owned-wrapper"
	| "unknown-flow-like";

export type ActivationRecord = {
	source: ActivationSource;
	scope: ActivationRecordScope;
	path: string;
	specifier: string;
	resolvedVersion: string | null;
	ownership: ActivationOwnership;
	status: "target" | "conflict" | "refused";
	reason?: string;
};

export type ActivationIssue = {
	source: ActivationSource | "project" | "cache" | "environment";
	path: string;
	code:
		| "invalid-project"
		| "invalid-config"
		| "invalid-plugin-directory"
		| "ambiguous-cache-artifact"
		| "unsafe-symlink";
	message: string;
};

export type ActivationLimitation = {
	source: "remote-config" | "managed-preferences";
	coverage: "runtime-leadership";
	blocking: false;
	detail: string;
};

export type FlowCacheArtifact = {
	path: string;
	specifier: string;
	resolvedVersion: string | null;
	status: "target" | "inactive" | "ambiguous";
	reason?: string;
};

export type ActivationPaths = {
	project: string;
	home: string;
	configRoot: string;
	cacheRoot: string;
	globalConfig: string;
	projectConfig: string;
	globalPluginDirectory: string;
	projectPluginDirectory: string;
	globalConfigFiles: string[];
	projectConfigFiles: string[];
	projectDirectoryConfigFiles: string[];
	customConfigFile: string | null;
	customConfigDirectory: string | null;
	customDirectoryConfigFiles: string[];
	managedConfigRoot: string;
	managedConfigFiles: string[];
	pluginDirectories: Array<{
		source: Extract<
			ActivationSource,
			| "global-plugin-directory"
			| "home-plugin-directory"
			| "project-plugin-directory"
			| "custom-plugin-directory"
		>;
		scope: ActivationRecordScope;
		path: string;
		safetyRoot: string;
	}>;
	managedPreferencePaths: string[];
	hasInlineConfig: boolean;
	packageCacheRoot: string;
	journalRoot: string;
	globalWrapperRecoveryRoot: string;
	projectWrapperRecoveryRoot: string;
	cacheRecoveryRoot: string;
};

export type ActivationPathOptions = {
	home?: string;
	configRoot?: string;
	cacheRoot?: string;
	managedConfigRoot?: string;
	managedPreferencePaths?: string[];
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
};

export type ActivationCheckReport = {
	mode: "check";
	project: string;
	target: string;
	paths: ActivationPaths;
	records: ActivationRecord[];
	cacheArtifacts: FlowCacheArtifact[];
	issues: ActivationIssue[];
	limitations: ActivationLimitation[];
	singleVersionSatisfied: boolean;
	reasons: string[];
};

export type ActivationPlanOperation = {
	action:
		| "rewrite-config"
		| "quarantine-wrapper"
		| "quarantine-cache"
		| "manual-remediation";
	scope?: ActivationRecordScope;
	path: string;
	detail: string;
};

export type ActivationApplyReport = {
	mode: "dry-run" | "apply";
	project: string;
	target: string;
	scope: ActivationScope;
	status: "ready" | "applied" | "refused";
	before: ActivationCheckReport;
	plan: ActivationPlanOperation[];
	refusals: string[];
	recovery?: {
		runId: string;
		journalPath: string;
	};
	failure?: {
		message: string;
		recoveryState: "rolled-back" | "rollback-failed";
		guidance: string[];
	};
	after?: ActivationCheckReport;
};

type PluginOptions = Record<string, unknown>;
type PluginSpec = string | [string, PluginOptions];

type ConfigDescriptor = {
	source: Extract<
		ActivationSource,
		| "global-config"
		| "project-config"
		| "project-directory-config"
		| "custom-config"
		| "custom-directory-config"
		| "managed-config"
	>;
	scope: ActivationRecordScope;
	path: string;
	mutable: boolean;
	safetyRoot: string;
	manualRemediation: string;
};

type PluginDirectoryDescriptor = {
	source: Extract<
		ActivationSource,
		| "global-plugin-directory"
		| "home-plugin-directory"
		| "project-plugin-directory"
		| "custom-plugin-directory"
	>;
	scope: ActivationRecordScope;
	path: string;
	safetyRoot: string;
};

type StrictConfigSnapshot = {
	descriptor: ConfigDescriptor;
	exists: boolean;
	content: string | null;
	digest: string | null;
	value: Record<string, unknown>;
	plugin: PluginSpec[];
	format: "strict-json" | "jsonc";
	indent: string;
	newline: "\n" | "\r\n";
	finalNewline: boolean;
	mode: number;
};

type OwnedWrapper = {
	path: string;
	scope: ActivationRecordScope;
	source: ActivationSource;
	version: string;
};

type JournalAction = {
	action: ActivationPlanOperation["action"];
	path: string;
	recoveryPath?: string;
	backupPath?: string;
	originalAbsent?: boolean;
	originalMode?: number;
	appliedDigest?: string;
	state: "pending" | "complete" | "rolled-back" | "rollback-failed";
	error?: string;
};

type ActivationJournal = {
	format: "flow-activation-journal-v1";
	runId: string;
	createdAt: string;
	project: string;
	target: string;
	scope: ActivationScope;
	state:
		| "prepared"
		| "applying"
		| "complete"
		| "failed"
		| "rolled-back"
		| "rollback-failed";
	error?: string;
	actions: JournalAction[];
};

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function configuredHome(env: NodeJS.ProcessEnv): string {
	return env.HOME?.trim() || env.USERPROFILE?.trim() || homedir();
}

function normalizedInjectedRoot(path: string): string {
	return normalize(resolve(path));
}

function resolveEnvironmentPath(value: string, project: string): string {
	return normalize(isAbsolute(value) ? value : resolve(project, value));
}

function systemManagedConfigRoot(
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
): string {
	if (platform === "darwin") return "/Library/Application Support/opencode";
	if (platform === "win32") {
		return join(env.ProgramData?.trim() || "C:\\ProgramData", "opencode");
	}
	return "/etc/opencode";
}

function systemManagedPreferencePaths(
	platform: NodeJS.Platform,
	home: string,
): string[] {
	if (platform !== "darwin") return [];
	const username = basename(home) || "user";
	return [
		join("/Library/Managed Preferences", username, "ai.opencode.managed.plist"),
		join("/Library/Managed Preferences", "ai.opencode.managed.plist"),
	];
}

export function isExactFlowVersion(value: string): boolean {
	return EXACT_VERSION_PATTERN.test(value);
}

export function resolveActivationTarget(target?: string): string {
	const resolved = target ?? resolveFlowPluginVersion();
	if (!isExactFlowVersion(resolved)) {
		throw new Error(
			`Flow activation target '${resolved}' must be an exact semantic version; tags and ranges are not resolved.`,
		);
	}
	return resolved;
}

export function resolveActivationPaths(
	project: string,
	options: ActivationPathOptions = {},
): ActivationPaths {
	if (!isAbsolute(project)) {
		throw new Error(
			`Flow activation project path must be absolute: ${project}`,
		);
	}
	const env = options.env ?? process.env;
	const home = normalizedInjectedRoot(options.home ?? configuredHome(env));
	const configRoot = normalizedInjectedRoot(
		options.configRoot ??
			(options.home
				? join(home, ".config", "opencode")
				: env.XDG_CONFIG_HOME
					? join(env.XDG_CONFIG_HOME, "opencode")
					: join(home, ".config", "opencode")),
	);
	const cacheRoot = normalizedInjectedRoot(
		options.cacheRoot ??
			(options.home
				? join(home, ".cache", "opencode")
				: env.XDG_CACHE_HOME
					? join(env.XDG_CACHE_HOME, "opencode")
					: join(home, ".cache", "opencode")),
	);
	const absoluteProject = normalizedInjectedRoot(project);
	const platform = options.platform ?? process.platform;
	const customConfigFile = env.OPENCODE_CONFIG?.trim()
		? resolveEnvironmentPath(env.OPENCODE_CONFIG.trim(), absoluteProject)
		: null;
	const customConfigDirectory = env.OPENCODE_CONFIG_DIR?.trim()
		? resolveEnvironmentPath(env.OPENCODE_CONFIG_DIR.trim(), absoluteProject)
		: null;
	const managedConfigRoot = normalizedInjectedRoot(
		options.managedConfigRoot ??
			env.OPENCODE_TEST_MANAGED_CONFIG_DIR ??
			systemManagedConfigRoot(platform, env),
	);
	const globalConfigFiles = [
		join(configRoot, "config.json"),
		join(configRoot, "opencode.json"),
		join(configRoot, "opencode.jsonc"),
	];
	const projectConfigFiles = [
		join(absoluteProject, "opencode.jsonc"),
		join(absoluteProject, "opencode.json"),
	];
	const projectDirectoryRoot = join(absoluteProject, ".opencode");
	const projectDirectoryConfigFiles = [
		join(projectDirectoryRoot, "opencode.json"),
		join(projectDirectoryRoot, "opencode.jsonc"),
	];
	const customDirectoryConfigFiles = customConfigDirectory
		? [
				join(customConfigDirectory, "opencode.json"),
				join(customConfigDirectory, "opencode.jsonc"),
			]
		: [];
	const managedConfigFiles = [
		join(managedConfigRoot, "opencode.json"),
		join(managedConfigRoot, "opencode.jsonc"),
	];
	const pluginDirectories: ActivationPaths["pluginDirectories"] = [
		...(["plugin", "plugins"] as const).map((name) => ({
			source: "global-plugin-directory" as const,
			scope: "global" as const,
			path: join(configRoot, name),
			safetyRoot: dirname(configRoot),
		})),
		...(["plugin", "plugins"] as const).map((name) => ({
			source: "home-plugin-directory" as const,
			scope: "global" as const,
			path: join(home, ".opencode", name),
			safetyRoot: home,
		})),
		...(["plugin", "plugins"] as const).map((name) => ({
			source: "project-plugin-directory" as const,
			scope: "project" as const,
			path: join(projectDirectoryRoot, name),
			safetyRoot: absoluteProject,
		})),
		...(customConfigDirectory
			? (["plugin", "plugins"] as const).map((name) => ({
					source: "custom-plugin-directory" as const,
					scope: "custom" as const,
					path: join(customConfigDirectory, name),
					safetyRoot: dirname(customConfigDirectory),
				}))
			: []),
	];
	return {
		project: absoluteProject,
		home,
		configRoot,
		cacheRoot,
		globalConfig: join(configRoot, "opencode.json"),
		projectConfig: join(absoluteProject, "opencode.json"),
		globalPluginDirectory: join(configRoot, "plugins"),
		projectPluginDirectory: join(absoluteProject, ".opencode", "plugins"),
		globalConfigFiles,
		projectConfigFiles,
		projectDirectoryConfigFiles,
		customConfigFile,
		customConfigDirectory,
		customDirectoryConfigFiles,
		managedConfigRoot,
		managedConfigFiles,
		pluginDirectories,
		managedPreferencePaths:
			options.managedPreferencePaths?.map(normalizedInjectedRoot) ??
			systemManagedPreferencePaths(platform, home),
		hasInlineConfig: Boolean(env.OPENCODE_CONFIG_CONTENT?.trim()),
		packageCacheRoot: join(cacheRoot, "packages"),
		journalRoot: join(configRoot, "flow-activation-recovery"),
		globalWrapperRecoveryRoot: join(configRoot, "flow-activation-recovery"),
		projectWrapperRecoveryRoot: join(
			absoluteProject,
			".opencode",
			"flow-activation-recovery",
		),
		cacheRecoveryRoot: join(cacheRoot, "flow-activation-recovery"),
	};
}

async function optionalLstat(path: string) {
	try {
		return await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function symlinkInPathRange(
	safetyRoot: string,
	target: string,
): Promise<string | null> {
	const root = normalize(safetyRoot);
	const destination = normalize(target);
	const pathFromRoot = relative(root, destination);
	if (
		pathFromRoot === ".." ||
		pathFromRoot.startsWith(`..${sep}`) ||
		isAbsolute(pathFromRoot)
	) {
		throw new Error(
			`${destination} is outside its mutation safety root ${root}`,
		);
	}
	let current = root;
	const parts = pathFromRoot ? pathFromRoot.split(sep) : [];
	for (let index = -1; index < parts.length; index += 1) {
		if (index >= 0) {
			const part = parts[index];
			if (!part) continue;
			current = join(current, part);
		}
		const metadata = await optionalLstat(current);
		if (!metadata) return null;
		if (metadata.isSymbolicLink()) return current;
	}
	return null;
}

async function assertSafeMutationPath(
	safetyRoot: string,
	target: string,
): Promise<void> {
	const symlink = await symlinkInPathRange(safetyRoot, target);
	if (symlink) {
		throw new Error(
			`${target}: mutation refused because ancestor ${symlink} is a symbolic link`,
		);
	}
}

async function readRegularFileWithoutFollowing(
	path: string,
	maximumBytes?: number,
): Promise<string> {
	const pathMetadata = await lstat(path);
	if (pathMetadata.isSymbolicLink()) {
		throw new Error("symbolic link refused");
	}
	if (!pathMetadata.isFile()) throw new Error("not a regular file");
	if (maximumBytes !== undefined && pathMetadata.size > maximumBytes) {
		throw new Error(`file exceeds ${maximumBytes} bytes`);
	}
	const handle = await open(path, constants.O_RDONLY | NO_FOLLOW);
	try {
		const metadata = await handle.stat();
		if (!metadata.isFile()) throw new Error("not a regular file");
		if (
			metadata.dev !== pathMetadata.dev ||
			metadata.ino !== pathMetadata.ino
		) {
			throw new Error("file changed while activation was running");
		}
		return await handle.readFile({ encoding: "utf8" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ELOOP") {
			throw new Error("symbolic link refused");
		}
		throw error;
	} finally {
		await handle.close();
	}
}

function configDescriptors(paths: ActivationPaths): ConfigDescriptor[] {
	const descriptors: ConfigDescriptor[] = [
		...paths.globalConfigFiles.map((path) => ({
			source: "global-config" as const,
			scope: "global" as const,
			path,
			mutable: true,
			safetyRoot: dirname(paths.configRoot),
			manualRemediation: `edit ${path} manually`,
		})),
		...(paths.customConfigFile
			? [
					{
						source: "custom-config" as const,
						scope: "custom" as const,
						path: paths.customConfigFile,
						mutable: true,
						safetyRoot: dirname(paths.customConfigFile),
						manualRemediation: `edit OPENCODE_CONFIG file ${paths.customConfigFile} manually`,
					},
				]
			: []),
		...paths.projectConfigFiles.map((path) => ({
			source: "project-config" as const,
			scope: "project" as const,
			path,
			mutable: true,
			safetyRoot: paths.project,
			manualRemediation: `edit ${path} manually`,
		})),
		...paths.projectDirectoryConfigFiles.map((path) => ({
			source: "project-directory-config" as const,
			scope: "project" as const,
			path,
			mutable: true,
			safetyRoot: paths.project,
			manualRemediation: `edit ${path} manually`,
		})),
		...paths.customDirectoryConfigFiles.map((path) => ({
			source: "custom-directory-config" as const,
			scope: "custom" as const,
			path,
			mutable: true,
			safetyRoot: dirname(paths.customConfigDirectory as string),
			manualRemediation: `edit OPENCODE_CONFIG_DIR file ${path} manually`,
		})),
		...paths.managedConfigFiles.map((path) => ({
			source: "managed-config" as const,
			scope: "managed" as const,
			path,
			mutable: false,
			safetyRoot: dirname(paths.managedConfigRoot),
			manualRemediation: `ask the OpenCode administrator to remove the Flow entry from ${path}`,
		})),
	];
	const unique = new Map<string, ConfigDescriptor>();
	for (const descriptor of descriptors) {
		const previous = unique.get(descriptor.path);
		if (!previous || (!descriptor.mutable && previous.mutable)) {
			unique.set(descriptor.path, descriptor);
		}
	}
	return [...unique.values()];
}

function pluginDirectoryDescriptors(
	paths: ActivationPaths,
): PluginDirectoryDescriptor[] {
	const unique = new Map<string, PluginDirectoryDescriptor>();
	for (const descriptor of paths.pluginDirectories) {
		if (!unique.has(descriptor.path)) unique.set(descriptor.path, descriptor);
	}
	return [...unique.values()];
}

function parseFlowNpmSpecifier(specifier: string): {
	isFlow: boolean;
	version: string | null;
} {
	const match = FLOW_NPM_SPECIFIER_PATTERN.exec(specifier);
	if (!match) return { isFlow: false, version: null };
	const candidate = match[1];
	return {
		isFlow: true,
		version: candidate && isExactFlowVersion(candidate) ? candidate : null,
	};
}

function pluginSpecifier(entry: PluginSpec): string {
	return Array.isArray(entry) ? entry[0] : entry;
}

function isPluginOptions(value: unknown): value is PluginOptions {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePluginSpecs(value: unknown): PluginSpec[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new Error("config plugin must be an array");
	}
	return value.map((entry, index) => {
		if (typeof entry === "string") return entry;
		if (
			Array.isArray(entry) &&
			entry.length === 2 &&
			typeof entry[0] === "string" &&
			isPluginOptions(entry[1])
		) {
			return [entry[0], entry[1]];
		}
		throw new Error(
			`config plugin[${index}] must be a string or [specifier, options] tuple`,
		);
	});
}

function stripJsoncComments(content: string): string {
	let output = "";
	let inString = false;
	let escaped = false;
	for (let index = 0; index < content.length; index += 1) {
		const character = content[index];
		if (!character) continue;
		if (inString) {
			output += character;
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === '"') inString = false;
			continue;
		}
		if (character === '"') {
			inString = true;
			output += character;
			continue;
		}
		const next = content[index + 1];
		if (character === "/" && next === "/") {
			output += "  ";
			index += 2;
			while (index < content.length) {
				const commentCharacter = content[index];
				if (commentCharacter === "\n" || commentCharacter === "\r") {
					index -= 1;
					break;
				}
				output += " ";
				index += 1;
			}
			continue;
		}
		if (character === "/" && next === "*") {
			output += "  ";
			index += 2;
			let closed = false;
			while (index < content.length) {
				const commentCharacter = content[index];
				const following = content[index + 1];
				if (commentCharacter === "*" && following === "/") {
					output += "  ";
					index += 1;
					closed = true;
					break;
				}
				output +=
					commentCharacter === "\n" || commentCharacter === "\r"
						? commentCharacter
						: " ";
				index += 1;
			}
			if (!closed) throw new Error("unterminated block comment");
			continue;
		}
		output += character;
	}
	if (inString) throw new Error("unterminated JSON string");
	return output;
}

function removeJsoncTrailingCommas(content: string): string {
	let output = "";
	let inString = false;
	let escaped = false;
	for (let index = 0; index < content.length; index += 1) {
		const character = content[index];
		if (!character) continue;
		if (inString) {
			output += character;
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === '"') inString = false;
			continue;
		}
		if (character === '"') {
			inString = true;
			output += character;
			continue;
		}
		if (character === ",") {
			let lookahead = index + 1;
			while (/\s/.test(content[lookahead] ?? "")) lookahead += 1;
			if (content[lookahead] === "}" || content[lookahead] === "]") {
				output += " ";
				continue;
			}
		}
		output += character;
	}
	return output;
}

function parseConfigContent(content: string): {
	value: Record<string, unknown>;
	plugin: PluginSpec[];
	format: "strict-json" | "jsonc";
} {
	let parsed: unknown;
	let format: "strict-json" | "jsonc" = "strict-json";
	try {
		parsed = JSON.parse(content);
	} catch {
		format = "jsonc";
		parsed = JSON.parse(removeJsoncTrailingCommas(stripJsoncComments(content)));
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("config root must be a JSON object");
	}
	const value = parsed as Record<string, unknown>;
	return { value, plugin: parsePluginSpecs(value.plugin), format };
}

function looksLikeFlowPath(path: string): boolean {
	const name = basename(path);
	return (
		/opencode-plugin-flow/i.test(path) ||
		/(?:^|[-_.])flow(?:[-_.].*)?(?:plugin|wrapper)|(?:plugin|wrapper).*flow/i.test(
			name,
		)
	);
}

function parseOwnedWrapper(
	content: string,
):
	| { kind: "owned"; version: string }
	| { kind: "not-owned" }
	| { kind: "invalid"; reason: string } {
	if (!content.startsWith(OWNED_WRAPPER_MARKER)) {
		return { kind: "not-owned" };
	}
	const firstNewline = content.indexOf("\n");
	const secondNewline = content.indexOf("\n", firstNewline + 1);
	const thirdNewline = content.indexOf("\n", secondNewline + 1);
	if (firstNewline < 0 || secondNewline < 0 || thirdNewline < 0) {
		return { kind: "invalid", reason: "owned wrapper marker is incomplete" };
	}
	const versionLine = content.slice(firstNewline + 1, secondNewline);
	const hashLine = content.slice(secondNewline + 1, thirdNewline);
	const version = /^\/\/ version=(.+)$/.exec(versionLine)?.[1];
	const expectedHash = /^\/\/ body-sha256=([a-f0-9]{64})$/.exec(hashLine)?.[1];
	if (!version || !isExactFlowVersion(version)) {
		return { kind: "invalid", reason: "owned wrapper version is invalid" };
	}
	if (!expectedHash) {
		return { kind: "invalid", reason: "owned wrapper hash is invalid" };
	}
	const body = content.slice(thirdNewline + 1);
	if (sha256(body) !== expectedHash) {
		return { kind: "invalid", reason: "owned wrapper was edited" };
	}
	if (!body.includes(`${FLOW_PACKAGE_NAME}@${version}`)) {
		return {
			kind: "invalid",
			reason: "owned wrapper body does not reference its declared Flow version",
		};
	}
	return { kind: "owned", version };
}

/** Create the only local-wrapper format activation-apply is allowed to archive. */
export function createMarkerOwnedFlowWrapper(version: string): string {
	const exactVersion = resolveActivationTarget(version);
	const body = `export { default } from "${FLOW_PACKAGE_NAME}@${exactVersion}";\n`;
	return [
		OWNED_WRAPPER_MARKER,
		`// version=${exactVersion}`,
		`// body-sha256=${sha256(body)}`,
		body,
	].join("\n");
}

function hintedFlowVersion(content: string): string | null {
	const candidate = new RegExp(
		`${FLOW_PACKAGE_NAME.replaceAll("-", "\\-")}@([^/\\s"']+)`,
	).exec(content)?.[1];
	return candidate && isExactFlowVersion(candidate) ? candidate : null;
}

async function classifyLocalPlugin(
	path: string,
	source: ActivationSource,
	scope: ActivationRecordScope,
	target: string,
	specifier: string,
): Promise<ActivationRecord | null> {
	const metadata = await optionalLstat(path);
	if (!metadata) {
		if (!looksLikeFlowPath(specifier)) return null;
		return {
			source,
			scope,
			path,
			specifier,
			resolvedVersion: null,
			ownership: "unknown-flow-like",
			status: "refused",
			reason: "referenced local plugin is absent",
		};
	}
	if (metadata.isSymbolicLink()) {
		if (!looksLikeFlowPath(specifier) && !looksLikeFlowPath(path)) return null;
		return {
			source,
			scope,
			path,
			specifier,
			resolvedVersion: null,
			ownership: "unknown-flow-like",
			status: "refused",
			reason: "symbolic link refused",
		};
	}
	if (!metadata.isFile()) {
		if (!looksLikeFlowPath(specifier) && !looksLikeFlowPath(path)) return null;
		return {
			source,
			scope,
			path,
			specifier,
			resolvedVersion: null,
			ownership: "unknown-flow-like",
			status: "refused",
			reason: "local plugin is not a regular file",
		};
	}
	let content: string;
	try {
		content = await readRegularFileWithoutFollowing(
			path,
			MAX_LOCAL_PLUGIN_BYTES,
		);
	} catch (error) {
		if (!looksLikeFlowPath(specifier) && !looksLikeFlowPath(path)) return null;
		return {
			source,
			scope,
			path,
			specifier,
			resolvedVersion: null,
			ownership: "unknown-flow-like",
			status: "refused",
			reason: error instanceof Error ? error.message : String(error),
		};
	}
	const owned = parseOwnedWrapper(content);
	if (owned.kind === "owned") {
		return {
			source,
			scope,
			path,
			specifier,
			resolvedVersion: owned.version,
			ownership: "marker-owned-wrapper",
			status: "conflict",
			reason:
				owned.version === target
					? "local wrapper duplicates the canonical npm activation source"
					: "local wrapper activates another Flow version",
		};
	}
	const flowLike =
		looksLikeFlowPath(specifier) ||
		looksLikeFlowPath(path) ||
		content.includes(FLOW_PACKAGE_NAME) ||
		content.includes(OWNED_WRAPPER_MARKER);
	if (!flowLike) return null;
	return {
		source,
		scope,
		path,
		specifier,
		resolvedVersion: hintedFlowVersion(content),
		ownership: "unknown-flow-like",
		status: "refused",
		reason:
			owned.kind === "invalid"
				? owned.reason
				: "Flow-like local plugin has no verifiable ownership marker",
	};
}

function relativeLocalSpecifier(configPath: string, specifier: string): string {
	if (specifier.startsWith("file:")) return fileURLToPath(specifier);
	if (isAbsolute(specifier)) return normalize(specifier);
	return resolve(dirname(configPath), specifier);
}

function isLocalPluginSpecifier(specifier: string): boolean {
	return (
		specifier.startsWith(".") ||
		specifier.startsWith("file:") ||
		isAbsolute(specifier)
	);
}

async function inspectConfig(
	descriptor: ConfigDescriptor,
	target: string,
): Promise<{ records: ActivationRecord[]; issues: ActivationIssue[] }> {
	const records: ActivationRecord[] = [];
	const issues: ActivationIssue[] = [];
	const symlinkAncestor = await symlinkInPathRange(
		descriptor.safetyRoot,
		descriptor.path,
	);
	if (symlinkAncestor) {
		issues.push({
			source: descriptor.source,
			path: descriptor.path,
			code: "unsafe-symlink",
			message: `config ancestor ${symlinkAncestor} is a symbolic link`,
		});
		return { records, issues };
	}
	const metadata = await optionalLstat(descriptor.path);
	if (!metadata) return { records, issues };
	if (metadata.isSymbolicLink() || !metadata.isFile()) {
		issues.push({
			source: descriptor.source,
			path: descriptor.path,
			code: "invalid-config",
			message: metadata.isSymbolicLink()
				? "config symbolic link refused"
				: "config is not a regular file",
		});
		return { records, issues };
	}
	let content: string;
	try {
		content = await readRegularFileWithoutFollowing(descriptor.path);
	} catch (error) {
		issues.push({
			source: descriptor.source,
			path: descriptor.path,
			code: "invalid-config",
			message: error instanceof Error ? error.message : String(error),
		});
		return { records, issues };
	}
	let parsed: ReturnType<typeof parseConfigContent>;
	try {
		parsed = parseConfigContent(content);
	} catch (error) {
		issues.push({
			source: descriptor.source,
			path: descriptor.path,
			code: "invalid-config",
			message: `config cannot be conservatively parsed as JSON/JSONC: ${error instanceof Error ? error.message : String(error)}`,
		});
		return { records, issues };
	}
	for (const entry of parsed.plugin) {
		const specifier = pluginSpecifier(entry);
		const npm = parseFlowNpmSpecifier(specifier);
		if (npm.isFlow) {
			const record: ActivationRecord = {
				source: descriptor.source,
				scope: descriptor.scope,
				path: descriptor.path,
				specifier,
				resolvedVersion: npm.version,
				ownership: "flow-npm",
				status: npm.version === target ? "target" : "conflict",
			};
			if (npm.version === null) {
				record.reason = "Flow npm activation is not pinned to an exact version";
			} else if (npm.version !== target) {
				record.reason = "Flow npm activation targets another version";
			}
			records.push(record);
			continue;
		}
		if (!looksLikeFlowPath(specifier) && !isLocalPluginSpecifier(specifier)) {
			continue;
		}
		let localPath: string;
		try {
			localPath = relativeLocalSpecifier(descriptor.path, specifier);
		} catch {
			if (!looksLikeFlowPath(specifier)) continue;
			records.push({
				source: descriptor.source,
				scope: descriptor.scope,
				path: specifier,
				specifier,
				resolvedVersion: null,
				ownership: "unknown-flow-like",
				status: "refused",
				reason: "local Flow-like plugin specifier is invalid",
			});
			continue;
		}
		const local = await classifyLocalPlugin(
			localPath,
			descriptor.source,
			descriptor.scope,
			target,
			specifier,
		);
		if (local) records.push(local);
	}
	return { records, issues };
}

async function inspectInlineConfig(
	content: string,
	project: string,
	target: string,
): Promise<{ records: ActivationRecord[]; issues: ActivationIssue[] }> {
	const records: ActivationRecord[] = [];
	const issues: ActivationIssue[] = [];
	let parsed: ReturnType<typeof parseConfigContent>;
	try {
		parsed = parseConfigContent(content);
	} catch (error) {
		issues.push({
			source: "inline-config",
			path: "env:OPENCODE_CONFIG_CONTENT",
			code: "invalid-config",
			message: `inline config cannot be conservatively parsed as JSON/JSONC: ${error instanceof Error ? error.message : String(error)}`,
		});
		return { records, issues };
	}
	const virtualConfigPath = join(project, "opencode.inline.json");
	for (const entry of parsed.plugin) {
		const specifier = pluginSpecifier(entry);
		const npm = parseFlowNpmSpecifier(specifier);
		if (npm.isFlow) {
			const record: ActivationRecord = {
				source: "inline-config",
				scope: "inline",
				path: "env:OPENCODE_CONFIG_CONTENT",
				specifier,
				resolvedVersion: npm.version,
				ownership: "flow-npm",
				status: npm.version === target ? "target" : "conflict",
			};
			if (npm.version === null) {
				record.reason = "Flow npm activation is not pinned to an exact version";
			} else if (npm.version !== target) {
				record.reason = "Flow npm activation targets another version";
			}
			records.push(record);
			continue;
		}
		if (!looksLikeFlowPath(specifier) && !isLocalPluginSpecifier(specifier)) {
			continue;
		}
		let localPath: string;
		try {
			localPath = relativeLocalSpecifier(virtualConfigPath, specifier);
		} catch {
			if (!looksLikeFlowPath(specifier)) continue;
			records.push({
				source: "inline-config",
				scope: "inline",
				path: "env:OPENCODE_CONFIG_CONTENT",
				specifier,
				resolvedVersion: null,
				ownership: "unknown-flow-like",
				status: "refused",
				reason: "inline local Flow-like plugin specifier is invalid",
			});
			continue;
		}
		const local = await classifyLocalPlugin(
			localPath,
			"inline-config",
			"inline",
			target,
			specifier,
		);
		if (local) records.push(local);
	}
	return { records, issues };
}

async function inspectPluginDirectory(
	descriptor: PluginDirectoryDescriptor,
	target: string,
): Promise<{ records: ActivationRecord[]; issues: ActivationIssue[] }> {
	const records: ActivationRecord[] = [];
	const issues: ActivationIssue[] = [];
	const symlinkAncestor = await symlinkInPathRange(
		descriptor.safetyRoot,
		descriptor.path,
	);
	if (symlinkAncestor) {
		issues.push({
			source: descriptor.source,
			path: descriptor.path,
			code: "unsafe-symlink",
			message: `plugin directory ancestor ${symlinkAncestor} is a symbolic link`,
		});
		return { records, issues };
	}
	const metadata = await optionalLstat(descriptor.path);
	if (!metadata) return { records, issues };
	if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
		issues.push({
			source: descriptor.source,
			path: descriptor.path,
			code: "invalid-plugin-directory",
			message: metadata.isSymbolicLink()
				? "plugin directory symbolic link refused"
				: "plugin directory is not a real directory",
		});
		return { records, issues };
	}
	const entries = await readdir(descriptor.path, { withFileTypes: true });
	for (const entry of entries) {
		if (!LOCAL_PLUGIN_EXTENSION_PATTERN.test(entry.name)) continue;
		const path = join(descriptor.path, entry.name);
		const record = await classifyLocalPlugin(
			path,
			descriptor.source,
			descriptor.scope,
			target,
			path,
		);
		if (record) records.push(record);
	}
	return { records, issues };
}

async function inspectCacheArtifact(
	path: string,
	specifier: string,
	target: string,
): Promise<FlowCacheArtifact> {
	const metadata = await optionalLstat(path);
	if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
		return {
			path,
			specifier,
			resolvedVersion: null,
			status: "ambiguous",
			reason: "cache artifact is not a real directory",
		};
	}
	const nodeModulesPath = join(path, "node_modules");
	const packagePath = join(nodeModulesPath, FLOW_PACKAGE_NAME);
	const manifestPath = join(packagePath, "package.json");
	try {
		for (const directory of [nodeModulesPath, packagePath]) {
			const directoryMetadata = await lstat(directory);
			if (
				directoryMetadata.isSymbolicLink() ||
				!directoryMetadata.isDirectory()
			) {
				throw new Error("nested package path is not a real directory");
			}
		}
		const manifest = JSON.parse(
			await readRegularFileWithoutFollowing(manifestPath),
		) as { name?: unknown; version?: unknown };
		if (
			manifest.name !== FLOW_PACKAGE_NAME ||
			typeof manifest.version !== "string" ||
			!isExactFlowVersion(manifest.version)
		) {
			throw new Error("nested package manifest does not prove a Flow version");
		}
		return {
			path,
			specifier,
			resolvedVersion: manifest.version,
			status: manifest.version === target ? "target" : "inactive",
		};
	} catch (error) {
		return {
			path,
			specifier,
			resolvedVersion: null,
			status: "ambiguous",
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}

async function inspectCache(
	paths: ActivationPaths,
	target: string,
): Promise<{ artifacts: FlowCacheArtifact[]; issues: ActivationIssue[] }> {
	const artifacts: FlowCacheArtifact[] = [];
	const issues: ActivationIssue[] = [];
	const symlinkAncestor = await symlinkInPathRange(
		dirname(paths.cacheRoot),
		paths.packageCacheRoot,
	);
	if (symlinkAncestor) {
		issues.push({
			source: "cache",
			path: paths.packageCacheRoot,
			code: "unsafe-symlink",
			message: `cache ancestor ${symlinkAncestor} is a symbolic link`,
		});
		return { artifacts, issues };
	}
	const metadata = await optionalLstat(paths.packageCacheRoot);
	if (!metadata) return { artifacts, issues };
	if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
		issues.push({
			source: "cache",
			path: paths.packageCacheRoot,
			code: "ambiguous-cache-artifact",
			message: "OpenCode package cache root is not a real directory",
		});
		return { artifacts, issues };
	}
	for (const entry of await readdir(paths.packageCacheRoot, {
		withFileTypes: true,
	})) {
		if (
			entry.name !== FLOW_PACKAGE_NAME &&
			!entry.name.startsWith(`${FLOW_PACKAGE_NAME}@`)
		) {
			continue;
		}
		const artifact = await inspectCacheArtifact(
			join(paths.packageCacheRoot, entry.name),
			entry.name,
			target,
		);
		artifacts.push(artifact);
		if (artifact.status === "ambiguous") {
			issues.push({
				source: "cache",
				path: artifact.path,
				code: "ambiguous-cache-artifact",
				message:
					artifact.reason ?? "cache artifact does not prove a Flow version",
			});
		}
	}
	return { artifacts, issues };
}

async function activationLimitations(
	paths: ActivationPaths,
): Promise<ActivationLimitation[]> {
	const limitations: ActivationLimitation[] = [
		{
			source: "remote-config",
			coverage: "runtime-leadership",
			blocking: false,
			detail:
				"Authenticated .well-known and organization API configs cannot be inspected offline; Flow runtime leadership detects duplicate loaded versions and fails closed.",
		},
	];
	if (paths.managedPreferencePaths.length > 0) {
		const detected: string[] = [];
		for (const path of paths.managedPreferencePaths) {
			try {
				if (await optionalLstat(path)) detected.push(path);
			} catch {
				// Preference files can be intentionally unreadable to an unprivileged
				// process. Preserve that uncertainty instead of failing the inventory.
				detected.push(`${path} (unreadable)`);
			}
		}
		limitations.push({
			source: "managed-preferences",
			coverage: "runtime-leadership",
			blocking: false,
			detail:
				detected.length > 0
					? `Detected managed preference source(s) ${detected.join(", ")}; plist/MDM plugin values are not decoded by this dependency-free preflight, and runtime leadership fails closed on duplicates.`
					: "macOS MDM preferences may add runtime config outside readable JSON/JSONC files; Flow runtime leadership fails closed on duplicate loaded versions.",
		});
	}
	return limitations;
}

function activationReasons(
	records: ActivationRecord[],
	cacheArtifacts: FlowCacheArtifact[],
	issues: ActivationIssue[],
	target: string,
): string[] {
	const reasons = issues.map((issue) => `${issue.path}: ${issue.message}`);
	const targetPins = records.filter(
		(record) =>
			record.ownership === "flow-npm" &&
			record.resolvedVersion === target &&
			record.status === "target",
	);
	if (targetPins.length !== 1) {
		reasons.push(
			`expected one exact ${FLOW_PACKAGE_NAME}@${target} activation, found ${targetPins.length}`,
		);
	}
	if (records.length !== 1) {
		reasons.push(
			`expected one Flow activation source, found ${records.length}`,
		);
	}
	const inactive = cacheArtifacts.filter(
		(artifact) => artifact.status === "inactive",
	);
	if (inactive.length > 0) {
		reasons.push(`found ${inactive.length} inactive Flow cache artifact(s)`);
	}
	return [...new Set(reasons)];
}

export async function checkFlowActivation(options: {
	project: string;
	target?: string;
	paths?: ActivationPathOptions;
}): Promise<ActivationCheckReport> {
	const target = resolveActivationTarget(options.target);
	const paths = resolveActivationPaths(options.project, options.paths);
	const env = options.paths?.env ?? process.env;
	const records: ActivationRecord[] = [];
	const issues: ActivationIssue[] = [];
	try {
		const projectMetadata = await lstat(paths.project);
		if (projectMetadata.isSymbolicLink()) {
			issues.push({
				source: "project",
				path: paths.project,
				code: "unsafe-symlink",
				message:
					"project root symbolic link refused for activation mutation safety",
			});
		} else if (!projectMetadata.isDirectory()) {
			issues.push({
				source: "project",
				path: paths.project,
				code: "invalid-project",
				message: "project path is not a directory",
			});
		}
	} catch (error) {
		issues.push({
			source: "project",
			path: paths.project,
			code: "invalid-project",
			message:
				(error as NodeJS.ErrnoException).code === "ENOENT"
					? "project path does not exist"
					: error instanceof Error
						? error.message
						: String(error),
		});
	}
	for (const descriptor of configDescriptors(paths)) {
		try {
			const inspected = await inspectConfig(descriptor, target);
			records.push(...inspected.records);
			issues.push(...inspected.issues);
		} catch (error) {
			issues.push({
				source: descriptor.source,
				path: descriptor.path,
				code: "invalid-config",
				message: `config could not be inspected safely: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}
	if (env.OPENCODE_CONFIG_CONTENT?.trim()) {
		const inspected = await inspectInlineConfig(
			env.OPENCODE_CONFIG_CONTENT,
			paths.project,
			target,
		);
		records.push(...inspected.records);
		issues.push(...inspected.issues);
	}
	for (const descriptor of pluginDirectoryDescriptors(paths)) {
		try {
			const inspected = await inspectPluginDirectory(descriptor, target);
			records.push(...inspected.records);
			issues.push(...inspected.issues);
		} catch (error) {
			issues.push({
				source: descriptor.source,
				path: descriptor.path,
				code: "invalid-plugin-directory",
				message: `plugin directory could not be inspected safely: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}
	let cache: Awaited<ReturnType<typeof inspectCache>>;
	try {
		cache = await inspectCache(paths, target);
	} catch (error) {
		cache = {
			artifacts: [],
			issues: [
				{
					source: "cache",
					path: paths.packageCacheRoot,
					code: "ambiguous-cache-artifact",
					message: `package cache could not be inspected safely: ${error instanceof Error ? error.message : String(error)}`,
				},
			],
		};
	}
	issues.push(...cache.issues);
	const limitations = await activationLimitations(paths);
	const reasons = activationReasons(records, cache.artifacts, issues, target);
	return {
		mode: "check",
		project: paths.project,
		target,
		paths,
		records,
		cacheArtifacts: cache.artifacts,
		issues,
		limitations,
		singleVersionSatisfied: reasons.length === 0,
		reasons,
	};
}

function detectIndent(content: string): string {
	return /\n([ \t]+)"/.exec(content)?.[1] ?? "\t";
}

async function readConfigSnapshot(
	descriptor: ConfigDescriptor,
): Promise<StrictConfigSnapshot> {
	const metadata = await optionalLstat(descriptor.path);
	if (!metadata) {
		return {
			descriptor,
			exists: false,
			content: null,
			digest: null,
			value: {},
			plugin: [],
			format: "strict-json",
			indent: "\t",
			newline: "\n",
			finalNewline: true,
			mode: 0o600,
		};
	}
	if (metadata.isSymbolicLink() || !metadata.isFile()) {
		throw new Error(`${descriptor.path}: config must be a regular file`);
	}
	await assertSafeMutationPath(descriptor.safetyRoot, descriptor.path);
	const content = await readRegularFileWithoutFollowing(descriptor.path);
	let parsed: ReturnType<typeof parseConfigContent>;
	try {
		parsed = parseConfigContent(content);
	} catch (error) {
		throw new Error(
			`${descriptor.path}: config cannot be conservatively parsed as JSON/JSONC: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return {
		descriptor,
		exists: true,
		content,
		digest: sha256(content),
		value: parsed.value,
		plugin: parsed.plugin,
		format: parsed.format,
		indent: detectIndent(content),
		newline: content.includes("\r\n") ? "\r\n" : "\n",
		finalNewline: content.endsWith("\n"),
		mode: metadata.mode & 0o777,
	};
}

function updatedConfigContent(
	snapshot: StrictConfigSnapshot,
	entries: PluginSpec[],
): string {
	const value = { ...snapshot.value, plugin: entries };
	let content = JSON.stringify(value, null, snapshot.indent).replaceAll(
		"\n",
		snapshot.newline,
	);
	if (snapshot.finalNewline) content += snapshot.newline;
	return content;
}

function wrapperRecoveryRoot(
	paths: ActivationPaths,
	wrapper: OwnedWrapper,
): string {
	if (
		[
			"global-config",
			"project-config",
			"project-directory-config",
			"custom-config",
			"custom-directory-config",
		].includes(wrapper.source)
	) {
		return join(dirname(wrapper.path), ".flow-activation-recovery");
	}
	if (wrapper.source === "home-plugin-directory") {
		return join(paths.home, ".opencode", "flow-activation-recovery");
	}
	if (wrapper.scope === "global") return paths.globalWrapperRecoveryRoot;
	if (wrapper.scope === "custom" && paths.customConfigDirectory) {
		return join(paths.customConfigDirectory, "flow-activation-recovery");
	}
	return paths.projectWrapperRecoveryRoot;
}

function wrapperMutationSafetyRoot(
	paths: ActivationPaths,
	wrapper: OwnedWrapper,
): string {
	const directory = pluginDirectoryDescriptors(paths).find((descriptor) => {
		if (descriptor.source !== wrapper.source) return false;
		const fromDirectory = relative(descriptor.path, wrapper.path);
		return (
			fromDirectory !== ".." &&
			!fromDirectory.startsWith(`..${sep}`) &&
			!isAbsolute(fromDirectory)
		);
	});
	if (directory) return directory.safetyRoot;
	const config = configDescriptors(paths).find(
		(descriptor) => descriptor.source === wrapper.source,
	);
	return config?.safetyRoot ?? dirname(wrapper.path);
}

function uniqueOwnedWrappers(records: ActivationRecord[]): OwnedWrapper[] {
	const wrappers = new Map<string, OwnedWrapper>();
	for (const record of records) {
		if (
			record.ownership !== "marker-owned-wrapper" ||
			record.resolvedVersion === null
		) {
			continue;
		}
		wrappers.set(record.path, {
			path: record.path,
			scope: record.scope,
			source: record.source,
			version: record.resolvedVersion,
		});
	}
	return [...wrappers.values()];
}

function removableConfigEntry(
	entry: PluginSpec,
	descriptor: ConfigDescriptor,
	records: ActivationRecord[],
): boolean {
	const specifier = pluginSpecifier(entry);
	if (parseFlowNpmSpecifier(specifier).isFlow) return true;
	if (!isLocalPluginSpecifier(specifier) && !looksLikeFlowPath(specifier)) {
		return false;
	}
	let localPath: string;
	try {
		localPath = relativeLocalSpecifier(descriptor.path, specifier);
	} catch {
		return false;
	}
	return records.some(
		(record) =>
			record.source === descriptor.source &&
			record.specifier === specifier &&
			record.path === localPath &&
			record.ownership === "marker-owned-wrapper",
	);
}

function activationRefusals(before: ActivationCheckReport): string[] {
	return [
		...before.issues.map((issue) => `${issue.path}: ${issue.message}`),
		...before.records
			.filter((record) => record.ownership === "unknown-flow-like")
			.map(
				(record) =>
					`${record.path}: ${record.reason ?? "unknown Flow-like activation refused"}`,
			),
		...before.cacheArtifacts
			.filter((artifact) => artifact.status === "ambiguous")
			.map(
				(artifact) =>
					`${artifact.path}: ${artifact.reason ?? "ambiguous cache artifact refused"}`,
			),
	];
}

async function assertUnchangedConfig(
	snapshot: StrictConfigSnapshot,
): Promise<void> {
	await assertSafeMutationPath(
		snapshot.descriptor.safetyRoot,
		snapshot.descriptor.path,
	);
	const metadata = await optionalLstat(snapshot.descriptor.path);
	if (!snapshot.exists) {
		if (metadata) {
			throw new Error(
				`${snapshot.descriptor.path}: config appeared while activation was running`,
			);
		}
		return;
	}
	if (!metadata?.isFile() || metadata.isSymbolicLink()) {
		throw new Error(
			`${snapshot.descriptor.path}: config changed while activation was running`,
		);
	}
	const current = await readRegularFileWithoutFollowing(
		snapshot.descriptor.path,
	);
	if (sha256(current) !== snapshot.digest) {
		throw new Error(
			`${snapshot.descriptor.path}: config changed while activation was running`,
		);
	}
}

async function atomicWriteConfig(
	snapshot: StrictConfigSnapshot,
	content: string,
	runId: string,
): Promise<void> {
	await assertUnchangedConfig(snapshot);
	await mkdir(dirname(snapshot.descriptor.path), { recursive: true });
	await assertSafeMutationPath(
		snapshot.descriptor.safetyRoot,
		snapshot.descriptor.path,
	);
	const temporaryPath = join(
		dirname(snapshot.descriptor.path),
		`.${basename(snapshot.descriptor.path)}.flow-${runId}.tmp`,
	);
	try {
		await writeFile(temporaryPath, content, {
			encoding: "utf8",
			flag: "wx",
			mode: snapshot.mode,
		});
		await rename(temporaryPath, snapshot.descriptor.path);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}

async function configIsWritable(
	snapshot: StrictConfigSnapshot,
): Promise<boolean> {
	if (!snapshot.descriptor.mutable) return false;
	try {
		await assertSafeMutationPath(
			snapshot.descriptor.safetyRoot,
			snapshot.descriptor.path,
		);
		if (snapshot.exists) {
			await access(snapshot.descriptor.path, constants.W_OK);
			return true;
		}
		let parent = dirname(snapshot.descriptor.path);
		while (!(await optionalLstat(parent))) {
			const next = dirname(parent);
			if (next === parent) return false;
			parent = next;
		}
		await access(parent, constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

async function pathCanBeMoved(
	source: string,
	destinationRoot: string,
): Promise<boolean> {
	try {
		await access(dirname(source), constants.W_OK);
		let parent = destinationRoot;
		while (!(await optionalLstat(parent))) {
			const next = dirname(parent);
			if (next === parent) return false;
			parent = next;
		}
		await access(parent, constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

async function writeJournal(
	journalPath: string,
	journal: ActivationJournal,
): Promise<void> {
	await mkdir(dirname(journalPath), { recursive: true, mode: 0o700 });
	const temporaryPath = `${journalPath}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporaryPath, `${JSON.stringify(journal, null, 2)}\n`, {
			encoding: "utf8",
			flag: "wx",
			mode: 0o600,
		});
		await rename(temporaryPath, journalPath);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}

async function verifyOwnedWrapper(wrapper: OwnedWrapper): Promise<void> {
	const content = await readRegularFileWithoutFollowing(
		wrapper.path,
		MAX_LOCAL_PLUGIN_BYTES,
	);
	const parsed = parseOwnedWrapper(content);
	if (parsed.kind !== "owned" || parsed.version !== wrapper.version) {
		throw new Error(
			`${wrapper.path}: owned wrapper changed while activation was running`,
		);
	}
}

async function verifyCacheArtifact(
	artifact: FlowCacheArtifact,
	target: string,
): Promise<void> {
	const inspected = await inspectCacheArtifact(
		artifact.path,
		artifact.specifier,
		target,
	);
	if (
		inspected.status !== "inactive" ||
		inspected.resolvedVersion !== artifact.resolvedVersion
	) {
		throw new Error(
			`${artifact.path}: cache artifact changed while activation was running`,
		);
	}
}

async function replaceKnownConfigContent(options: {
	snapshot: StrictConfigSnapshot;
	expectedDigest: string;
	content: string;
	mode: number;
	runId: string;
}): Promise<void> {
	await assertSafeMutationPath(
		options.snapshot.descriptor.safetyRoot,
		options.snapshot.descriptor.path,
	);
	const current = await readRegularFileWithoutFollowing(
		options.snapshot.descriptor.path,
	);
	if (sha256(current) !== options.expectedDigest) {
		throw new Error(
			`${options.snapshot.descriptor.path}: automatic restore refused because the applied config changed`,
		);
	}
	const temporaryPath = join(
		dirname(options.snapshot.descriptor.path),
		`.${basename(options.snapshot.descriptor.path)}.restore-${options.runId}.tmp`,
	);
	try {
		await writeFile(temporaryPath, options.content, {
			encoding: "utf8",
			flag: "wx",
			mode: options.mode,
		});
		await rename(temporaryPath, options.snapshot.descriptor.path);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}

async function rollbackCompletedActions(options: {
	journal: ActivationJournal;
	journalPath: string;
	runId: string;
	snapshots: StrictConfigSnapshot[];
	paths: ActivationPaths;
	wrappers: OwnedWrapper[];
}): Promise<string[]> {
	const failures: string[] = [];
	for (const action of options.journal.actions.toReversed()) {
		if (action.state !== "complete") continue;
		try {
			if (action.action === "rewrite-config") {
				const snapshot = options.snapshots.find(
					(candidate) => candidate.descriptor.path === action.path,
				);
				if (!snapshot || !action.appliedDigest) {
					throw new Error("restore metadata is incomplete");
				}
				if (action.originalAbsent) {
					await assertSafeMutationPath(
						snapshot.descriptor.safetyRoot,
						action.path,
					);
					const current = await readRegularFileWithoutFollowing(action.path);
					if (sha256(current) !== action.appliedDigest) {
						throw new Error(
							"created config changed after apply; automatic removal refused",
						);
					}
					if (!action.recoveryPath) {
						throw new Error("created config recovery path is missing");
					}
					await assertSafeMutationPath(
						snapshot.descriptor.safetyRoot,
						action.recoveryPath,
					);
					await mkdir(dirname(action.recoveryPath), {
						recursive: true,
						mode: 0o700,
					});
					await rename(action.path, action.recoveryPath);
				} else {
					if (!action.backupPath) throw new Error("config backup is missing");
					const backup = await readRegularFileWithoutFollowing(
						action.backupPath,
					);
					await replaceKnownConfigContent({
						snapshot,
						expectedDigest: action.appliedDigest,
						content: backup,
						mode: action.originalMode ?? snapshot.mode,
						runId: options.runId,
					});
				}
			} else if (
				action.action === "quarantine-wrapper" ||
				action.action === "quarantine-cache"
			) {
				if (!action.recoveryPath) throw new Error("recovery path is missing");
				let safetyRoot: string;
				if (action.action === "quarantine-cache") {
					safetyRoot = dirname(options.paths.cacheRoot);
				} else {
					const wrapper = options.wrappers.find(
						(candidate) => candidate.path === action.path,
					);
					if (!wrapper) throw new Error("wrapper safety metadata is missing");
					safetyRoot = wrapperMutationSafetyRoot(options.paths, wrapper);
				}
				await assertSafeMutationPath(safetyRoot, action.path);
				await assertSafeMutationPath(safetyRoot, action.recoveryPath);
				if (await optionalLstat(action.path)) {
					throw new Error(
						"original path is occupied; automatic restore refused",
					);
				}
				const recovery = await optionalLstat(action.recoveryPath);
				if (!recovery || recovery.isSymbolicLink()) {
					throw new Error("quarantined artifact is missing or symbolic");
				}
				await mkdir(dirname(action.path), { recursive: true });
				await rename(action.recoveryPath, action.path);
			}
			action.state = "rolled-back";
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			action.state = "rollback-failed";
			action.error = message;
			failures.push(`${action.path}: ${message}`);
		}
		try {
			await writeJournal(options.journalPath, options.journal);
		} catch (error) {
			failures.push(
				`journal update: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return failures;
}

export async function applyFlowActivation(options: {
	project: string;
	scope: ActivationScope;
	target?: string;
	apply?: boolean;
	paths?: ActivationPathOptions;
	/** @internal Deterministic failure-injection seam for recovery tests. */
	afterMutation?: (operation: ActivationPlanOperation) => Promise<void>;
}): Promise<ActivationApplyReport> {
	const target = resolveActivationTarget(options.target);
	const before = await checkFlowActivation({
		project: options.project,
		target,
		...(options.paths ? { paths: options.paths } : {}),
	});
	const refusals = activationRefusals(before);
	const snapshots: StrictConfigSnapshot[] = [];
	for (const descriptor of configDescriptors(before.paths)) {
		try {
			snapshots.push(await readConfigSnapshot(descriptor));
		} catch (error) {
			refusals.push(error instanceof Error ? error.message : String(error));
		}
	}
	const pin = `${FLOW_PACKAGE_NAME}@${target}`;
	const canonicalPath =
		options.scope === "global"
			? before.paths.globalConfig
			: before.paths.projectConfig;
	const nextEntries = new Map<string, PluginSpec[]>();
	for (const snapshot of snapshots) {
		const retained = snapshot.plugin.filter(
			(entry) =>
				!removableConfigEntry(entry, snapshot.descriptor, before.records),
		);
		if (snapshot.descriptor.path === canonicalPath) retained.push(pin);
		nextEntries.set(snapshot.descriptor.path, retained);
	}
	const ownedWrappers = uniqueOwnedWrappers(before.records).filter(
		(wrapper) =>
			wrapper.source !== "inline-config" && wrapper.source !== "managed-config",
	);
	const wrappers: OwnedWrapper[] = [];
	for (const wrapper of ownedWrappers) {
		try {
			const safetyRoot = wrapperMutationSafetyRoot(before.paths, wrapper);
			const recoveryRoot = wrapperRecoveryRoot(before.paths, wrapper);
			await assertSafeMutationPath(safetyRoot, wrapper.path);
			await assertSafeMutationPath(safetyRoot, recoveryRoot);
			if (!(await pathCanBeMoved(wrapper.path, recoveryRoot))) {
				throw new Error(
					`${wrapper.path}: marker-owned wrapper or recovery parent is not writable; archive it manually and rerun activation-apply`,
				);
			}
			wrappers.push(wrapper);
		} catch (error) {
			refusals.push(error instanceof Error ? error.message : String(error));
		}
	}
	const provenInactiveCache = before.cacheArtifacts.filter(
		(artifact) => artifact.status === "inactive",
	);
	const inactiveCache: FlowCacheArtifact[] = [];
	for (const artifact of provenInactiveCache) {
		try {
			const safetyRoot = dirname(before.paths.cacheRoot);
			await assertSafeMutationPath(safetyRoot, artifact.path);
			await assertSafeMutationPath(safetyRoot, before.paths.cacheRecoveryRoot);
			if (
				!(await pathCanBeMoved(artifact.path, before.paths.cacheRecoveryRoot))
			) {
				throw new Error(
					`${artifact.path}: proven inactive cache artifact or recovery parent is not writable; move it outside ${before.paths.packageCacheRoot} manually and rerun activation-apply`,
				);
			}
			inactiveCache.push(artifact);
		} catch (error) {
			refusals.push(error instanceof Error ? error.message : String(error));
		}
	}
	const plan: ActivationPlanOperation[] = [];
	const changedSnapshots: StrictConfigSnapshot[] = [];
	const addManualRemediation = (
		snapshot: StrictConfigSnapshot | null,
		path: string,
		detail: string,
	) => {
		plan.push({
			action: "manual-remediation",
			...(snapshot ? { scope: snapshot.descriptor.scope } : {}),
			path,
			detail,
		});
		refusals.push(`${path}: ${detail}`);
	};
	const scheduleConfigRewrite = async (
		snapshot: StrictConfigSnapshot,
		detail: string,
	) => {
		if (changedSnapshots.includes(snapshot)) return;
		if (!snapshot.descriptor.mutable) {
			addManualRemediation(
				snapshot,
				snapshot.descriptor.path,
				`managed config is immutable; ${snapshot.descriptor.manualRemediation}`,
			);
			return;
		}
		if (snapshot.format === "jsonc") {
			addManualRemediation(
				snapshot,
				snapshot.descriptor.path,
				`JSONC Flow activation was inventoried but cannot be edited losslessly without a JSONC editor; ${snapshot.descriptor.manualRemediation}, remove every ${FLOW_PACKAGE_NAME} entry, then rerun activation-apply`,
			);
			return;
		}
		if (!(await configIsWritable(snapshot))) {
			addManualRemediation(
				snapshot,
				snapshot.descriptor.path,
				`config or its mutation path is not safely writable; ${snapshot.descriptor.manualRemediation}`,
			);
			return;
		}
		changedSnapshots.push(snapshot);
		plan.push({
			action: "rewrite-config",
			scope: snapshot.descriptor.scope,
			path: snapshot.descriptor.path,
			detail,
		});
	};
	for (const snapshot of snapshots) {
		const entries = nextEntries.get(snapshot.descriptor.path) ?? [];
		const changed =
			(snapshot.descriptor.path === canonicalPath && !snapshot.exists) ||
			JSON.stringify(entries) !== JSON.stringify(snapshot.plugin);
		if (!changed) continue;
		await scheduleConfigRewrite(
			snapshot,
			snapshot.descriptor.path === canonicalPath
				? `write canonical exact pin ${pin} last`
				: "remove recognized Flow activation entries while preserving string/tuple entries and options",
		);
	}
	for (const record of before.records.filter(
		(record) => record.source === "inline-config",
	)) {
		addManualRemediation(
			null,
			"env:OPENCODE_CONFIG_CONTENT",
			`inline Flow activation ${record.specifier} is immutable; remove it from OPENCODE_CONFIG_CONTENT or unset that variable, then rerun activation-apply`,
		);
	}
	const canonicalSnapshot = snapshots.find(
		(snapshot) => snapshot.descriptor.path === canonicalPath,
	);
	for (const wrapper of wrappers) {
		plan.push({
			action: "quarantine-wrapper",
			scope: wrapper.scope,
			path: wrapper.path,
			detail: "move marker-proven wrapper outside OpenCode plugin discovery",
		});
	}
	for (const artifact of inactiveCache) {
		plan.push({
			action: "quarantine-cache",
			path: artifact.path,
			detail: `move proven inactive Flow ${artifact.resolvedVersion} cache artifact; never clear the cache root`,
		});
	}
	const base: ActivationApplyReport = {
		mode: options.apply === true ? "apply" : "dry-run",
		project: before.project,
		target,
		scope: options.scope,
		status: refusals.length > 0 ? "refused" : "ready",
		before,
		plan,
		refusals: [...new Set(refusals)],
	};
	if (options.apply !== true || refusals.length > 0) return base;
	if (plan.length === 0) {
		return { ...base, status: "applied", after: before };
	}

	const runId = `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`;
	const runRoot = join(before.paths.journalRoot, runId);
	const journalPath = join(runRoot, "journal.json");
	const actions: JournalAction[] = [];
	for (const snapshot of changedSnapshots) {
		const action: JournalAction = {
			action: "rewrite-config",
			path: snapshot.descriptor.path,
			originalAbsent: !snapshot.exists,
			originalMode: snapshot.mode,
			state: "pending",
		};
		if (snapshot.exists) {
			action.backupPath = join(
				runRoot,
				"configs",
				`${snapshot.descriptor.source}-${sha256(snapshot.descriptor.path).slice(0, 12)}.backup`,
			);
		} else {
			action.recoveryPath = join(
				dirname(snapshot.descriptor.path),
				".flow-activation-recovery",
				runId,
				`${basename(snapshot.descriptor.path)}-${sha256(snapshot.descriptor.path).slice(0, 12)}`,
			);
		}
		actions.push(action);
	}
	for (const wrapper of wrappers) {
		actions.push({
			action: "quarantine-wrapper",
			path: wrapper.path,
			recoveryPath: join(
				wrapperRecoveryRoot(before.paths, wrapper),
				runId,
				`${basename(wrapper.path)}-${sha256(wrapper.path).slice(0, 12)}`,
			),
			state: "pending",
		});
	}
	for (const artifact of inactiveCache) {
		actions.push({
			action: "quarantine-cache",
			path: artifact.path,
			recoveryPath: join(
				before.paths.cacheRecoveryRoot,
				runId,
				`${basename(artifact.path)}-${sha256(artifact.path).slice(0, 12)}`,
			),
			state: "pending",
		});
	}
	const journal: ActivationJournal = {
		format: "flow-activation-journal-v1",
		runId,
		createdAt: new Date().toISOString(),
		project: before.project,
		target,
		scope: options.scope,
		state: "prepared",
		actions,
	};
	try {
		await assertSafeMutationPath(dirname(before.paths.configRoot), runRoot);
		await mkdir(runRoot, { recursive: true, mode: 0o700 });
		await writeJournal(journalPath, journal);
	} catch (error) {
		const message = `recovery journal could not be prepared safely at ${journalPath}: ${error instanceof Error ? error.message : String(error)}`;
		return {
			...base,
			status: "refused",
			refusals: [...new Set([...base.refusals, message])],
		};
	}

	try {
		for (const snapshot of changedSnapshots) {
			await assertUnchangedConfig(snapshot);
			const action = actions.find(
				(candidate) =>
					candidate.action === "rewrite-config" &&
					candidate.path === snapshot.descriptor.path,
			);
			if (snapshot.exists && action?.backupPath) {
				await mkdir(dirname(action.backupPath), {
					recursive: true,
					mode: 0o700,
				});
				await writeFile(action.backupPath, snapshot.content as string, {
					encoding: "utf8",
					flag: "wx",
					mode: 0o600,
				});
			}
		}
		if (canonicalSnapshot && !changedSnapshots.includes(canonicalSnapshot)) {
			await assertUnchangedConfig(canonicalSnapshot);
		}
		for (const wrapper of wrappers) await verifyOwnedWrapper(wrapper);
		for (const artifact of inactiveCache) {
			await verifyCacheArtifact(artifact, target);
		}
		journal.state = "applying";
		await writeJournal(journalPath, journal);
		const nonTargetConfigs = changedSnapshots.filter(
			(snapshot) => snapshot.descriptor.path !== canonicalPath,
		);
		const targetConfig = changedSnapshots.find(
			(snapshot) => snapshot.descriptor.path === canonicalPath,
		);
		for (const snapshot of nonTargetConfigs) {
			const entries = nextEntries.get(snapshot.descriptor.path) ?? [];
			const content = updatedConfigContent(snapshot, entries);
			await atomicWriteConfig(snapshot, content, runId);
			const action = actions.find(
				(candidate) =>
					candidate.action === "rewrite-config" &&
					candidate.path === snapshot.descriptor.path,
			);
			if (action) {
				action.appliedDigest = sha256(content);
				action.state = "complete";
			}
			await writeJournal(journalPath, journal);
			await options.afterMutation?.(
				plan.find(
					(operation) =>
						operation.action === "rewrite-config" &&
						operation.path === snapshot.descriptor.path,
				) as ActivationPlanOperation,
			);
		}
		for (const wrapper of wrappers) {
			const action = actions.find(
				(candidate) =>
					candidate.action === "quarantine-wrapper" &&
					candidate.path === wrapper.path,
			);
			if (!action?.recoveryPath) {
				throw new Error(`${wrapper.path}: missing wrapper recovery path`);
			}
			await verifyOwnedWrapper(wrapper);
			await assertSafeMutationPath(
				wrapperMutationSafetyRoot(before.paths, wrapper),
				wrapper.path,
			);
			await mkdir(dirname(action.recoveryPath), {
				recursive: true,
				mode: 0o700,
			});
			await rename(wrapper.path, action.recoveryPath);
			action.state = "complete";
			await writeJournal(journalPath, journal);
			await options.afterMutation?.(
				plan.find(
					(operation) =>
						operation.action === "quarantine-wrapper" &&
						operation.path === wrapper.path,
				) as ActivationPlanOperation,
			);
		}
		for (const artifact of inactiveCache) {
			const action = actions.find(
				(candidate) =>
					candidate.action === "quarantine-cache" &&
					candidate.path === artifact.path,
			);
			if (!action?.recoveryPath) {
				throw new Error(`${artifact.path}: missing cache recovery path`);
			}
			await verifyCacheArtifact(artifact, target);
			await assertSafeMutationPath(
				dirname(before.paths.cacheRoot),
				artifact.path,
			);
			await mkdir(dirname(action.recoveryPath), {
				recursive: true,
				mode: 0o700,
			});
			await rename(artifact.path, action.recoveryPath);
			action.state = "complete";
			await writeJournal(journalPath, journal);
			await options.afterMutation?.(
				plan.find(
					(operation) =>
						operation.action === "quarantine-cache" &&
						operation.path === artifact.path,
				) as ActivationPlanOperation,
			);
		}
		if (targetConfig) {
			const targetEntries = nextEntries.get(targetConfig.descriptor.path) ?? [];
			const targetContent = updatedConfigContent(targetConfig, targetEntries);
			await atomicWriteConfig(targetConfig, targetContent, runId);
			const targetAction = actions.find(
				(candidate) =>
					candidate.action === "rewrite-config" &&
					candidate.path === targetConfig.descriptor.path,
			);
			if (targetAction) {
				targetAction.appliedDigest = sha256(targetContent);
				targetAction.state = "complete";
			}
			await writeJournal(journalPath, journal);
			await options.afterMutation?.(
				plan.find(
					(operation) =>
						operation.action === "rewrite-config" &&
						operation.path === targetConfig.descriptor.path,
				) as ActivationPlanOperation,
			);
		}
		const after = await checkFlowActivation({
			project: before.project,
			target,
			...(options.paths ? { paths: options.paths } : {}),
		});
		if (!after.singleVersionSatisfied) {
			throw new Error(
				`post-apply inventory did not prove a single version: ${after.reasons.join("; ")}`,
			);
		}
		journal.state = "complete";
		await writeJournal(journalPath, journal);
		return {
			...base,
			status: "applied",
			recovery: { runId, journalPath },
			after,
			refusals: [],
		};
	} catch (error) {
		journal.state = "failed";
		journal.error = error instanceof Error ? error.message : String(error);
		try {
			await writeJournal(journalPath, journal);
		} catch {
			// The stable journal path is still returned below for manual inspection.
		}
		const rollbackFailures = await rollbackCompletedActions({
			journal,
			journalPath,
			runId,
			snapshots: changedSnapshots,
			paths: before.paths,
			wrappers,
		});
		const recoveryState =
			rollbackFailures.length === 0 ? "rolled-back" : "rollback-failed";
		journal.state = recoveryState;
		if (rollbackFailures.length > 0) {
			journal.error = `${journal.error ?? "apply failed"}; rollback: ${rollbackFailures.join("; ")}`;
		}
		try {
			await writeJournal(journalPath, journal);
		} catch {
			// Keep returning the known journal path even when its final update fails.
		}
		const guidance =
			recoveryState === "rolled-back"
				? [
						"All completed mutations were restored from exact backups or quarantine renames.",
						`Inspect ${journalPath} and resolve the recorded failure before retrying.`,
					]
				: [
						"Stop OpenCode before manual recovery.",
						`Inspect ${journalPath}; for rollback-failed actions, restore backupPath to path or rename recoveryPath back to path only after verifying the destination is absent or unchanged.`,
						"Do not delete the recovery directory until activation-check succeeds.",
					];
		return {
			...base,
			status: "refused",
			recovery: { runId, journalPath },
			failure: {
				message: journal.error ?? "activation apply failed",
				recoveryState,
				guidance,
			},
			refusals: [journal.error ?? "activation apply failed"],
		};
	}
}
