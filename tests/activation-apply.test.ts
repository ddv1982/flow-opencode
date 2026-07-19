import { afterEach, describe, expect, test } from "bun:test";
import {
	access,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	applyFlowActivation,
	checkFlowActivation,
	createMarkerOwnedFlowWrapper,
	resolveActivationPaths,
} from "../src/distribution/activation.js";

const temporaryRoots: string[] = [];

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "flow-activation-apply-"));
	temporaryRoots.push(root);
	const project = join(root, "project");
	const home = join(root, "home");
	const configRoot = join(root, "config", "opencode");
	const cacheRoot = join(root, "cache", "opencode");
	const managedConfigRoot = join(root, "managed", "opencode");
	await mkdir(project, { recursive: true });
	return {
		root,
		project,
		home,
		configRoot,
		cacheRoot,
		managedConfigRoot,
		paths: {
			home,
			configRoot,
			cacheRoot,
			managedConfigRoot,
			managedPreferencePaths: [],
			env: {},
		},
	};
}

async function writeJson(path: string, value: unknown): Promise<string> {
	const content = `${JSON.stringify(value, null, 2)}\n`;
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, "utf8");
	return content;
}

async function installCacheArtifact(
	cacheRoot: string,
	specifier: string,
	version: string,
): Promise<string> {
	const path = join(cacheRoot, "packages", specifier);
	await writeJson(
		join(path, "node_modules", "opencode-plugin-flow", "package.json"),
		{ name: "opencode-plugin-flow", version },
	);
	return path;
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

afterEach(async () => {
	await Promise.all(
		temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })),
	);
});

describe("Flow activation apply", () => {
	test("dry-runs, then leaves one canonical pin and quarantines only proven artifacts", async () => {
		const environment = await fixture();
		const paths = resolveActivationPaths(
			environment.project,
			environment.paths,
		);
		const wrapper = join(paths.globalPluginDirectory, "flow-owned-wrapper.js");
		await mkdir(dirname(wrapper), { recursive: true });
		await writeFile(wrapper, createMarkerOwnedFlowWrapper("5.1.0"), "utf8");
		const unrelatedLocalPlugin = join(
			paths.globalPluginDirectory,
			"unrelated-plugin.js",
		);
		await writeFile(
			unrelatedLocalPlugin,
			"export default async function unrelated() {}\n",
			"utf8",
		);
		const globalBefore = await writeJson(paths.globalConfig, {
			permission: "allow",
			plugin: [
				"other-plugin@1.0.0",
				["configured-plugin@2.0.0", { mode: "careful", retries: 2 }],
				["opencode-plugin-flow@5.1.0", { legacyOption: true }],
				"./plugins/flow-owned-wrapper.js",
			],
		});
		const projectBefore = await writeJson(paths.projectConfig, {
			plugin: ["opencode-plugin-flow@5.2.2", "project-plugin@2.0.0"],
		});
		const oldCache = await installCacheArtifact(
			environment.cacheRoot,
			"opencode-plugin-flow@5",
			"5.1.0",
		);
		const targetCache = await installCacheArtifact(
			environment.cacheRoot,
			"opencode-plugin-flow@5.2.2",
			"5.2.2",
		);

		const dryRun = await applyFlowActivation({
			project: environment.project,
			scope: "global",
			target: "5.2.2",
			paths: environment.paths,
		});

		expect(dryRun).toMatchObject({ mode: "dry-run", status: "ready" });
		expect(dryRun.plan.map(({ action }) => action)).toEqual(
			expect.arrayContaining([
				"rewrite-config",
				"quarantine-wrapper",
				"quarantine-cache",
			]),
		);
		expect(await readFile(paths.globalConfig, "utf8")).toBe(globalBefore);
		expect(await readFile(paths.projectConfig, "utf8")).toBe(projectBefore);
		expect(await exists(wrapper)).toBe(true);
		expect(await exists(oldCache)).toBe(true);
		expect(await exists(paths.journalRoot)).toBe(false);

		const applied = await applyFlowActivation({
			project: environment.project,
			scope: "global",
			target: "5.2.2",
			apply: true,
			paths: environment.paths,
		});

		expect(applied.status).toBe("applied");
		expect(applied.after?.singleVersionSatisfied).toBe(true);
		expect(applied.after?.records).toHaveLength(1);
		expect(applied.after?.records[0]).toMatchObject({
			source: "global-config",
			specifier: "opencode-plugin-flow@5.2.2",
			ownership: "flow-npm",
			status: "target",
		});
		expect(JSON.parse(await readFile(paths.globalConfig, "utf8"))).toEqual({
			permission: "allow",
			plugin: [
				"other-plugin@1.0.0",
				["configured-plugin@2.0.0", { mode: "careful", retries: 2 }],
				"opencode-plugin-flow@5.2.2",
			],
		});
		expect(JSON.parse(await readFile(paths.projectConfig, "utf8"))).toEqual({
			plugin: ["project-plugin@2.0.0"],
		});
		expect(await exists(wrapper)).toBe(false);
		expect(await exists(unrelatedLocalPlugin)).toBe(true);
		expect(await exists(oldCache)).toBe(false);
		expect(await exists(targetCache)).toBe(true);
		if (!applied.recovery) throw new Error("Expected recovery journal");
		const journal = JSON.parse(
			await readFile(applied.recovery.journalPath, "utf8"),
		) as {
			state?: string;
			actions?: Array<{
				action?: string;
				state?: string;
				recoveryPath?: string;
			}>;
		};
		expect(journal.state).toBe("complete");
		expect(journal.actions?.every(({ state }) => state === "complete")).toBe(
			true,
		);
		const quarantined = journal.actions?.filter(
			({ action }) =>
				action === "quarantine-wrapper" || action === "quarantine-cache",
		);
		for (const action of quarantined ?? []) {
			expect(action.recoveryPath).toBeDefined();
			expect(await exists(action.recoveryPath as string)).toBe(true);
		}
		const backupDirectory = join(
			dirname(applied.recovery.journalPath),
			"configs",
		);
		const backups = await readdir(backupDirectory);
		expect(backups).toHaveLength(2);
		expect(
			await Promise.all(
				backups.map((name) => readFile(join(backupDirectory, name), "utf8")),
			),
		).toEqual(expect.arrayContaining([globalBefore, projectBefore]));

		const repeated = await applyFlowActivation({
			project: environment.project,
			scope: "global",
			target: "5.2.2",
			apply: true,
			paths: environment.paths,
		});
		expect(repeated.status).toBe("applied");
		expect(repeated.plan).toEqual([]);
		expect(repeated.recovery).toBeUndefined();
	});

	test("cleans proven artifacts without rewriting an already-canonical JSONC pin", async () => {
		const environment = await fixture();
		const paths = resolveActivationPaths(
			environment.project,
			environment.paths,
		);
		const canonicalJsonc =
			'{\n  // Preserve this human context byte-for-byte.\n  "plugin": ["opencode-plugin-flow@5.2.2"],\n}\n';
		await mkdir(dirname(paths.globalConfig), { recursive: true });
		await writeFile(paths.globalConfig, canonicalJsonc, "utf8");
		const wrapper = join(paths.globalPluginDirectory, "flow-owned-wrapper.js");
		await mkdir(dirname(wrapper), { recursive: true });
		await writeFile(wrapper, createMarkerOwnedFlowWrapper("5.1.0"), "utf8");

		const report = await applyFlowActivation({
			project: environment.project,
			scope: "global",
			target: "5.2.2",
			apply: true,
			paths: environment.paths,
		});

		expect(report.status).toBe("applied");
		expect(report.after?.singleVersionSatisfied).toBe(true);
		expect(report.plan).not.toContainEqual(
			expect.objectContaining({ action: "rewrite-config" }),
		);
		expect(await readFile(paths.globalConfig, "utf8")).toBe(canonicalJsonc);
		expect(await exists(wrapper)).toBe(false);
	});

	test("refuses unknown or edited Flow-like wrappers without changing configs", async () => {
		const environment = await fixture();
		const paths = resolveActivationPaths(
			environment.project,
			environment.paths,
		);
		const dynamicWrapper = join(
			paths.projectPluginDirectory,
			"flow-dynamic-wrapper.js",
		);
		await mkdir(dirname(dynamicWrapper), { recursive: true });
		await writeFile(
			dynamicWrapper,
			'export { default } from "opencode-plugin-flow@5.1.0";\n',
			"utf8",
		);
		const symlinkTarget = join(environment.root, "outside-flow-wrapper.js");
		const symlinkWrapper = join(
			paths.projectPluginDirectory,
			"flow-linked-wrapper.js",
		);
		await writeFile(symlinkTarget, "export default {};\n", "utf8");
		await symlink(symlinkTarget, symlinkWrapper, "file");
		const configBefore = await writeJson(paths.globalConfig, {
			plugin: ["opencode-plugin-flow@5.1.0"],
		});

		const report = await applyFlowActivation({
			project: environment.project,
			scope: "global",
			target: "5.2.2",
			apply: true,
			paths: environment.paths,
		});

		expect(report.status).toBe("refused");
		expect(report.refusals).toContainEqual(
			expect.stringContaining("no verifiable ownership marker"),
		);
		expect(report.refusals).toContainEqual(
			expect.stringContaining("symbolic link refused"),
		);
		expect(await readFile(paths.globalConfig, "utf8")).toBe(configBefore);
		expect(await exists(dynamicWrapper)).toBe(true);
		expect(await exists(symlinkWrapper)).toBe(true);
		expect(await exists(paths.journalRoot)).toBe(false);
	});

	test("refuses ambiguous cache folders and never clears the cache root", async () => {
		const environment = await fixture();
		const paths = resolveActivationPaths(
			environment.project,
			environment.paths,
		);
		await writeJson(paths.globalConfig, {
			plugin: ["opencode-plugin-flow@5.2.2"],
		});
		const ambiguous = join(
			environment.cacheRoot,
			"packages",
			"opencode-plugin-flow@old",
		);
		await mkdir(ambiguous, { recursive: true });
		await writeFile(join(ambiguous, "user-note.txt"), "keep me\n", "utf8");

		const report = await applyFlowActivation({
			project: environment.project,
			scope: "global",
			target: "5.2.2",
			apply: true,
			paths: environment.paths,
		});

		expect(report.status).toBe("refused");
		expect(report.plan).not.toContainEqual(
			expect.objectContaining({
				action: "quarantine-cache",
				path: ambiguous,
			}),
		);
		expect(await readFile(join(ambiguous, "user-note.txt"), "utf8")).toBe(
			"keep me\n",
		);
	});

	test("quarantines the pinned host's unversioned Flow cache directory", async () => {
		const environment = await fixture();
		const paths = resolveActivationPaths(
			environment.project,
			environment.paths,
		);
		await writeJson(paths.globalConfig, {
			plugin: ["opencode-plugin-flow@5.2.2"],
		});
		const unversionedCache = await installCacheArtifact(
			environment.cacheRoot,
			"opencode-plugin-flow",
			"5.1.0",
		);
		const unrelatedCache = join(
			environment.cacheRoot,
			"packages",
			"unrelated-plugin",
		);
		await mkdir(unrelatedCache, { recursive: true });
		await writeFile(
			join(unrelatedCache, "user-note.txt"),
			"preserve\n",
			"utf8",
		);

		const before = await checkFlowActivation({
			project: environment.project,
			target: "5.2.2",
			paths: environment.paths,
		});
		expect(before.singleVersionSatisfied).toBe(false);
		expect(before.cacheArtifacts).toContainEqual(
			expect.objectContaining({
				path: unversionedCache,
				specifier: "opencode-plugin-flow",
				resolvedVersion: "5.1.0",
				status: "inactive",
			}),
		);

		const applied = await applyFlowActivation({
			project: environment.project,
			scope: "global",
			target: "5.2.2",
			apply: true,
			paths: environment.paths,
		});

		expect(applied.status).toBe("applied");
		expect(applied.after?.singleVersionSatisfied).toBe(true);
		expect(applied.plan).toContainEqual(
			expect.objectContaining({
				action: "quarantine-cache",
				path: unversionedCache,
			}),
		);
		expect(await exists(unversionedCache)).toBe(false);
		expect(await readFile(join(unrelatedCache, "user-note.txt"), "utf8")).toBe(
			"preserve\n",
		);
	});

	test("refuses symlinked project roots and mutation ancestors", async () => {
		const environment = await fixture();
		const linkedProject = join(environment.root, "linked-project");
		await symlink(environment.project, linkedProject, "dir");
		const linked = await applyFlowActivation({
			project: linkedProject,
			scope: "project",
			target: "5.2.2",
			apply: true,
			paths: environment.paths,
		});
		expect(linked.status).toBe("refused");
		expect(linked.refusals).toContainEqual(
			expect.stringContaining("project root symbolic link refused"),
		);

		const outside = join(environment.root, "outside-opencode");
		await mkdir(outside, { recursive: true });
		await symlink(outside, join(environment.project, ".opencode"), "dir");
		const ancestor = await applyFlowActivation({
			project: environment.project,
			scope: "project",
			target: "5.2.2",
			apply: true,
			paths: environment.paths,
		});
		expect(ancestor.status).toBe("refused");
		expect(ancestor.refusals).toContainEqual(
			expect.stringContaining("ancestor"),
		);
		expect(await exists(join(outside, "opencode.json"))).toBe(false);

		await unlink(join(environment.project, ".opencode"));
		const outsideConfigParent = join(environment.root, "outside-config-parent");
		const linkedConfigParent = join(environment.root, "linked-config-parent");
		await mkdir(outsideConfigParent, { recursive: true });
		await symlink(outsideConfigParent, linkedConfigParent, "dir");
		const globalAncestor = await applyFlowActivation({
			project: environment.project,
			scope: "global",
			target: "5.2.2",
			apply: true,
			paths: {
				...environment.paths,
				configRoot: join(linkedConfigParent, "opencode"),
			},
		});
		expect(globalAncestor.status).toBe("refused");
		expect(globalAncestor.refusals).toContainEqual(
			expect.stringContaining("symbolic link"),
		);
		expect(await exists(join(outsideConfigParent, "opencode"))).toBe(false);

		const paths = resolveActivationPaths(
			environment.project,
			environment.paths,
		);
		const outsideRecovery = join(environment.root, "outside-recovery");
		await mkdir(paths.configRoot, { recursive: true });
		await mkdir(outsideRecovery, { recursive: true });
		await symlink(outsideRecovery, paths.journalRoot, "dir");
		const recoveryAncestor = await applyFlowActivation({
			project: environment.project,
			scope: "global",
			target: "5.2.2",
			apply: true,
			paths: environment.paths,
		});
		expect(recoveryAncestor.status).toBe("refused");
		expect(recoveryAncestor.refusals).toContainEqual(
			expect.stringContaining("recovery journal could not be prepared safely"),
		);
		expect(await exists(paths.globalConfig)).toBe(false);
		expect(await readdir(outsideRecovery)).toEqual([]);
	});

	test("rolls back exact mutations and returns an operational recovery journal", async () => {
		const environment = await fixture();
		const paths = resolveActivationPaths(
			environment.project,
			environment.paths,
		);
		const original = await writeJson(paths.globalConfig, {
			plugin: ["opencode-plugin-flow@5.1.0", "keep-plugin@1.0.0"],
		});
		let injected = false;
		const report = await applyFlowActivation({
			project: environment.project,
			scope: "project",
			target: "5.2.2",
			apply: true,
			paths: environment.paths,
			afterMutation: async () => {
				if (injected) return;
				injected = true;
				throw new Error("injected failure after first mutation");
			},
		});

		expect(report.status).toBe("refused");
		expect(report.failure).toMatchObject({
			recoveryState: "rolled-back",
			message: expect.stringContaining("injected failure"),
		});
		expect(report.recovery?.journalPath).toBeDefined();
		expect(await readFile(paths.globalConfig, "utf8")).toBe(original);
		expect(await exists(paths.projectConfig)).toBe(false);
		const journal = JSON.parse(
			await readFile(report.recovery?.journalPath as string, "utf8"),
		) as {
			state?: string;
			actions?: Array<{ state?: string }>;
		};
		expect(journal.state).toBe("rolled-back");
		expect(journal.actions).toContainEqual(
			expect.objectContaining({ state: "rolled-back" }),
		);
	});

	test("preserves concurrent edits and returns explicit manual restore guidance", async () => {
		const environment = await fixture();
		const paths = resolveActivationPaths(
			environment.project,
			environment.paths,
		);
		await writeJson(paths.globalConfig, {
			plugin: ["opencode-plugin-flow@5.1.0"],
		});
		const concurrent = '{"plugin":["concurrent-user-edit@1.0.0"]}\n';
		let injected = false;
		const report = await applyFlowActivation({
			project: environment.project,
			scope: "project",
			target: "5.2.2",
			apply: true,
			paths: environment.paths,
			afterMutation: async () => {
				if (injected) return;
				injected = true;
				await writeFile(paths.globalConfig, concurrent, "utf8");
				throw new Error("injected concurrent edit");
			},
		});

		expect(report.status).toBe("refused");
		expect(report.failure?.recoveryState).toBe("rollback-failed");
		expect(report.failure?.guidance.join(" ")).toContain("restore backupPath");
		expect(report.recovery?.journalPath).toBeDefined();
		expect(await readFile(paths.globalConfig, "utf8")).toBe(concurrent);
	});
});
