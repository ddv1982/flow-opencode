import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type CredentialEntry,
	OpenCode,
	type OpenCodeClient,
} from "@opencode/client";
import { Service } from "@opencode/client/service";
import { canonicalJson } from "../evals/canonical-json.js";
import { startNativeAccountBroker } from "../evals/native-auth/broker.js";
import {
	connectNativeAccountSource,
	nativeAuthSourceSha256,
	stageNativeAuthClient,
} from "../evals/native-auth/host.js";
import {
	type NativeAccountConnection,
	object,
	PLACEHOLDER_REFRESH,
} from "../evals/native-auth/protocol.js";
import { OpenCodeStartup } from "../evals/opencode-host.js";
import {
	canaryPublicNativeEvidence,
	runPaidCanary,
} from "../scripts/canary-run.js";
import { prepareCanaryWorkspace } from "../scripts/canary-workspace.js";
import {
	artifactIdentitySha256,
	CANARY_CHECKLIST_SHA256,
	CANARY_CHECKLIST_VERSION,
	CANARY_NATIVE_AUTH_DIRECTORY,
	CANARY_PLUGIN_LOADER,
	CANARY_PLUGIN_LOADER_SHA256,
	CanaryAuthLaunchReceiptSchema,
	CanaryNativeAuthSchema,
	canaryAuthLaunchMatches,
	canaryProviderConfiguration,
	deriveCanaryResult,
	measureCanaryInstallation,
	parsePreparedCanary,
	preparedCanarySha256,
	recordCanary,
} from "../scripts/eval-canary.js";
import { authorizePaidRun, paidRunStatus } from "../scripts/paid-budget.js";
import { FixtureRpc } from "./fixtures/native-auth-plugin.js";
import { localScriptedProvider } from "./fixtures/opencode-v2-scripted-provider.js";

const roots: string[] = [];
const previousAuthorization = process.env.FLOW_EVAL_AUTHORIZATION;
afterEach(async () => {
	if (previousAuthorization === undefined)
		delete process.env.FLOW_EVAL_AUTHORIZATION;
	else process.env.FLOW_EVAL_AUTHORIZATION = previousAuthorization;
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});
const digest = (value: string | Uint8Array) =>
	`sha256:${createHash("sha256").update(value).digest("hex")}`;
const connection: NativeAccountConnection = {
	version: 1,
	url: "http://127.0.0.1:1/",
	capability: "a".repeat(64),
	accounts: [
		{
			route: {
				providerID: "fake",
				integrationID: "openai",
				credentialID: "synthetic-selected",
				methodID: "synthetic-method",
				label: "synthetic-label",
			},
			metadata: { accountId: "private-metadata-sentinel" },
		},
	],
};
async function fixture(
	options: { auth?: boolean; entry?: string } = { auth: true },
) {
	const root = await realpath(
		await mkdtemp(join(tmpdir(), "flow-canary-auth-")),
	);
	roots.push(root);
	const plugin = join(root, "fixture/.opencode/plugins/flow");
	await mkdir(join(plugin, "dist"), { recursive: true });
	await mkdir(join(root, "package/dist"), { recursive: true });
	const entry = options.entry ?? "export default {};\n";
	const sourcePackage = canonicalJson({
		name: "opencode-plugin-flow",
		version: "10.0.0",
		dependencies: {},
		devDependencies: { "@opencode/plugin": "2.1.4" },
	});
	const pluginPackage = canonicalJson({
		name: "opencode-plugin-flow",
		version: "10.0.0",
		type: "module",
		main: "./dist/index.js",
		exports: { ".": "./dist/index.js", "./tui": "./dist/tui.js" },
		dependencies: { "@opencode/plugin": "2.1.4" },
	});
	const config = canonicalJson({
		plugins: [
			{
				package: "./.opencode/plugins/flow",
				options: { recovery: { mode: "off" } },
			},
		],
		update: "disable",
		share: "disabled",
	});
	for (const [path, bytes] of [
		["package/package.json", sourcePackage],
		["package/dist/index.js", entry],
		["package/dist/tui.js", "export default {};\n"],
		["fixture/.opencode/plugins/flow/index.js", CANARY_PLUGIN_LOADER],
		["fixture/.opencode/plugins/flow/dist/index.js", entry],
		["fixture/.opencode/plugins/flow/dist/tui.js", "export default {};\n"],
		["fixture/.opencode/plugins/flow/package.json", pluginPackage],
		["fixture/opencode.json", config],
	] as const)
		await writeFile(join(root, path), bytes);
	const tar = Bun.spawn(
		["tar", "-czf", join(root, "artifact.tgz"), "package"],
		{ cwd: root, stderr: "pipe" },
	);
	if (await tar.exited) throw new Error(await new Response(tar.stderr).text());
	const artifact = {
		packageVersion: "10.0.0",
		sourceCommit: "synthetic",
		sourceTreeSha256: digest("source"),
		tarballSha256: digest(await readFile(join(root, "artifact.tgz"))),
		unpackedManifestSha256: digest("manifest"),
	};
	const staged =
		options.auth === false
			? undefined
			: await stageNativeAuthClient(join(root, CANARY_NATIVE_AUTH_DIRECTORY));
	const nativeAuth = staged
		? CanaryNativeAuthSchema.parse({
				...staged,
				pluginDirectory: CANARY_NATIVE_AUTH_DIRECTORY,
				kind: "native-account-source-v1",
			})
		: undefined;
	const base = {
		schemaVersion: 2 as const,
		releaseTag: "v10.0.0",
		artifact,
		artifactSha256: artifactIdentitySha256(artifact),
		checklistVersion:
			CANARY_CHECKLIST_VERSION as typeof CANARY_CHECKLIST_VERSION,
		checklistSha256: CANARY_CHECKLIST_SHA256,
		preparedAt: "2026-10-24T00:00:00.000Z",
		artifactFile: "artifact.tgz" as const,
		pluginEntrySha256: digest(entry),
		runtime: {
			hostVersion: "2.1.4" as const,
			sourcePackageSha256: digest(sourcePackage),
			tuiEntrySha256: digest("export default {};\n"),
			pluginPackageSha256: digest(pluginPackage),
			loaderEntrySha256: CANARY_PLUGIN_LOADER_SHA256,
			configSha256: digest(config),
			...(nativeAuth ? { nativeAuth } : {}),
		},
	};
	const prepared = parsePreparedCanary({
		...base,
		sha256: preparedCanarySha256(base),
	});
	await writeFile(join(root, "prepared.json"), canonicalJson(prepared));
	await prepareCanaryWorkspace(join(root, "fixture"));
	await writeFile(join(root, "prompt.txt"), "Local only");
	const privateDirectory = join(root, "source");
	await mkdir(privateDirectory, { mode: 0o700 });
	const source = join(privateDirectory, "connection.json");
	await writeFile(source, JSON.stringify(connection), { mode: 0o600 });
	await authorizePaidRun(root, {
		schemaVersion: 1,
		purpose: "Synthetic loopback only",
		models: ["fake/model", "native-auth-fixture/model"],
		maxDispatches: 1,
		expiresAt: new Date(Date.now() + 120000).toISOString(),
	});
	process.env.FLOW_EVAL_AUTHORIZATION = root;
	return {
		root,
		prepared,
		nativeAuth,
		source,
		input: {
			prepared: join(root, "prepared.json"),
			model: "fake/model",
			prompt: join(root, "prompt.txt"),
			...(nativeAuth ? { nativeAuthSource: source } : {}),
		},
	};
}
function transcript(directory: string) {
	return {
		schemaVersion: 2,
		host: { version: "2.1.4", pid: 42, location: { directory } },
		sessions: [
			{
				info: {
					id: "ses_manager",
					agent: "build",
					model: { providerID: "fake", id: "model", variant: "default" },
					location: { directory },
					outcome: "succeeded",
				},
				messages: [],
			},
			{
				info: {
					id: "ses_reviewer",
					parentID: "ses_manager",
					agent: "flow-reviewer",
					model: { providerID: "fake", id: "model", variant: "default" },
					location: { directory },
				},
				messages: [],
			},
		],
	};
}
function receipt(
	preparedSha256: string,
	nativeAuth: unknown,
	native: ReturnType<typeof transcript>,
) {
	const model = native.sessions[0]?.info.model;
	if (!model) throw new Error("Missing fixture model");
	return CanaryAuthLaunchReceiptSchema.parse({
		schemaVersion: 2,
		warming: false,
		preparedSha256,
		nativeAuth,
		rootSessionID: "ses_manager",
		model,
		host: { pid: 42, version: "2.1.4" },
		provider: { id: "fake", transport: "http" },
		providerPolicySha256: digest(
			canonicalJson(canaryProviderConfiguration(model)),
		),
		native: { path: "native.json", sha256: digest(canonicalJson(native)) },
		outcome: "succeeded",
	});
}

test("sealed client manifest survives key reordering and canonical installation round-trip", async () => {
	const f = await fixture();
	if (!f.nativeAuth) throw new Error("Missing fixture attachment");
	const files = Object.fromEntries(
		Object.entries(f.nativeAuth.files).reverse(),
	);
	expect(String(nativeAuthSourceSha256(files))).toBe(f.nativeAuth.sourceSha256);
	const measured = await measureCanaryInstallation(f.prepared, f.root);
	const roundTrip = JSON.parse(canonicalJson(measured));
	expect(roundTrip.nativeAuth.files).toEqual(files);
	expect(String(nativeAuthSourceSha256(roundTrip.nativeAuth.files))).toBe(
		f.nativeAuth.sourceSha256,
	);
	expect(Object.keys(roundTrip.nativeAuth.sourceFiles).sort()).toEqual([
		"client-plugin.ts",
		"index.ts",
		"package.json",
		"protocol.ts",
	]);
	expect(digest(await readFile(join(f.root, "fixture/opencode.json")))).toBe(
		f.prepared.schemaVersion === 2
			? f.prepared.runtime.configSha256
			: "unexpected",
	);
	const native = transcript("<flow-eval-workspace>");
	const launch = receipt(f.prepared.sha256, f.nativeAuth, native);
	const derive = (installation: unknown) =>
		deriveCanaryResult({
			packageVersion: "10.0.0",
			artifactSha256: f.prepared.artifactSha256,
			tarballSha256: f.prepared.artifact.tarballSha256,
			preparedSha256: f.prepared.sha256,
			pluginEntrySha256: f.prepared.pluginEntrySha256,
			installation,
			session: null,
			transcript: native,
		});
	roundTrip.nativeAuth.launchReceipt = launch;
	expect(derive(roundTrip).hostConfigSha256).toBe(
		derive(JSON.parse(canonicalJson(roundTrip))).hostConfigSha256,
	);
	expect(
		canaryAuthLaunchMatches({
			preparedSha256: f.prepared.sha256,
			nativeAuth: f.nativeAuth,
			receipt: launch,
			transcript: native,
		}),
	).toBe(true);
	roundTrip.nativeAuth.sourceFiles["protocol.ts"] += "\nchanged";
	expect(derive(roundTrip).status).toBe("incomplete");
	expect(derive(roundTrip).checks["installs-packed-artifact"]).toBe(false);
});
for (const mutation of ["entry", "extra", "symlink", "manifest"] as const)
	test(`prepared auth ${mutation} mutation fails before charge`, async () => {
		const f = await fixture();
		if (mutation === "entry")
			await writeFile(
				join(f.root, CANARY_NATIVE_AUTH_DIRECTORY, "client-plugin.ts"),
				"changed",
			);
		if (mutation === "extra")
			await writeFile(
				join(f.root, CANARY_NATIVE_AUTH_DIRECTORY, "extra.ts"),
				"extra",
			);
		if (mutation === "symlink") {
			await rm(join(f.root, CANARY_NATIVE_AUTH_DIRECTORY, "protocol.ts"));
			await symlink(
				join(f.root, "prompt.txt"),
				join(f.root, CANARY_NATIVE_AUTH_DIRECTORY, "protocol.ts"),
			);
		}
		if (mutation === "manifest") {
			const raw = JSON.parse(await readFile(f.input.prepared, "utf8"));
			raw.runtime.nativeAuth.files["protocol.ts"] = digest("different");
			await writeFile(f.input.prepared, canonicalJson(raw));
		}
		await expect(
			runPaidCanary(f.input, async () => {
				throw new Error("launched");
			}),
		).rejects.toThrow();
		expect((await paidRunStatus(f.root)).consumed).toBe(0);
	});
test("source/preparation mode mismatch and unsafe source file fail without charging", async () => {
	const f = await fixture();
	const { nativeAuthSource: _source, ...without } = f.input;
	await expect(runPaidCanary(without)).rejects.toThrow("selected together");
	await chmod(f.source, 0o644);
	await expect(runPaidCanary(f.input)).rejects.toThrow(
		"Native account authentication failed",
	);
	expect((await paidRunStatus(f.root)).consumed).toBe(0);
	const noAuth = await fixture({ auth: false });
	await expect(
		runPaidCanary({ ...noAuth.input, nativeAuthSource: f.source }),
	).rejects.toThrow("selected together");
	expect((await paidRunStatus(noAuth.root)).consumed).toBe(0);
	expect(
		Object.hasOwn(
			noAuth.prepared.schemaVersion === 2 ? noAuth.prepared.runtime : {},
			"nativeAuth",
		),
	).toBe(false);
});
test("charged source acquisition failure is generic, remains consumed, and removes private host data", async () => {
	const f = await fixture();
	await expect(runPaidCanary(f.input)).rejects.toThrow(
		"Native-auth canary execution failed during prepare.",
	);
	expect((await paidRunStatus(f.root)).consumed).toBe(1);
	const run = (await readdir(f.root)).find((name) => name.startsWith("run-"));
	if (!run) throw new Error("Missing failed run");
	expect(await readdir(join(f.root, run))).toEqual(["server.log"]);
	await expect(runPaidCanary(f.input)).rejects.toThrow("exhausted");
	expect(await readFile(join(f.root, run, "server.log"), "utf8")).toBe(
		"Native authentication diagnostics omitted.\n",
	);
});
test("readiness failure before canary generation stays charged once and cannot repeat", async () => {
	const f = await fixture();
	let launches = 0,
		generations = 0,
		releases = 0;
	const relay = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			if (new URL(request.url).pathname === "/acquire")
				return Response.json({ lease: "b".repeat(64) });
			releases++;
			return Response.json({});
		},
	});
	try {
		await writeFile(
			f.source,
			JSON.stringify({ ...connection, url: relay.url.href }),
			{ mode: 0o600 },
		);
		const launch = async (
			_directory: string,
			model: string,
			_prompt: string,
			_prepared: unknown,
			configuration?: NativeAccountConnection,
		) => {
			launches++;
			if (!configuration) throw new Error("Missing synthetic configuration");
			const source = connectNativeAccountSource(configuration);
			const auth = await source.prepareHost({
				directory: join(f.root, "readiness-host"),
				models: [model],
			});
			try {
				const client = {
					rpc: () => ({
						ready: async () => ({
							version: 1,
							state: "not-ready",
							reason: "route-unsettled",
						}),
					}),
				} as unknown as Pick<OpenCodeClient, "rpc">;
				await auth.requireReady(client, {
					directory: "/synthetic/project",
					models: [{ providerID: "fake", id: "model" }],
				});
				generations++;
				return 0;
			} finally {
				await auth.dispose();
				await source.dispose();
			}
		};
		await expect(runPaidCanary(f.input, launch)).rejects.toThrow(
			"Native-auth canary execution failed during execution.",
		);
		expect({
			launches,
			generations,
			releases,
			consumed: (await paidRunStatus(f.root)).consumed,
		}).toEqual({ launches: 1, generations: 0, releases: 1, consumed: 1 });
		await expect(runPaidCanary(f.input, launch)).rejects.toThrow("exhausted");
		expect(launches).toBe(1);
	} finally {
		await relay.stop(true);
	}
});
for (const failure of ["setup", "version", "startup", "release"] as const)
	test(`charged auth ${failure} failure stops its host and disposes private attachment independently`, async () => {
		const f = await fixture();
		let releases = 0;
		const relay = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(request) {
				const path = new URL(request.url).pathname;
				if (path === "/acquire")
					return Response.json({ lease: "b".repeat(64) });
				if (path === "/release") {
					releases++;
					return failure === "release"
						? new Response("private-metadata-sentinel", { status: 503 })
						: Response.json({});
				}
				return new Response("refused", { status: 403 });
			},
		});
		const oldPath = process.env.PATH;
		try {
			await writeFile(
				f.source,
				JSON.stringify({ ...connection, url: relay.url.href }),
				{ mode: 0o600 },
			);
			await writeFile(
				join(f.root, "npm"),
				`#!/usr/bin/env node\nconst args=process.argv.slice(2);if(args[0]==="install"){console.error("opaque-access-sentinel");process.exit(${failure === "setup" || failure === "release" ? 12 : 0});}if(args.includes("--version")){console.log(${JSON.stringify(failure === "version" ? "opencode v1.18.31" : "opencode v2.1.4")});process.exit(0);}console.error("opaque-access-sentinel");process.exit(99);\n`,
				{ mode: 0o700 },
			);
			process.env.PATH = `${f.root}:${oldPath ?? ""}`;
			const phase =
				failure === "release"
					? "cleanup"
					: failure === "setup"
						? "dependencies"
						: "startup";
			await expect(runPaidCanary(f.input)).rejects.toThrow(
				`Native-auth canary execution failed during ${phase}.`,
			);
			expect(releases).toBe(1);
			expect((await paidRunStatus(f.root)).consumed).toBe(1);
			const run = (await readdir(f.root)).find((name) =>
				name.startsWith("run-"),
			);
			if (!run) throw new Error("Missing failed run");
			expect(await readdir(join(f.root, run))).toEqual(["server.log"]);
			expect(await readFile(join(f.root, run, "server.log"), "utf8")).toBe(
				"Native authentication diagnostics omitted.\n",
			);
			expect(
				(await measureCanaryInstallation(f.prepared, f.root)).schemaVersion,
			).toBe(2);
		} finally {
			relay.stop(true);
			if (oldPath === undefined) delete process.env.PATH;
			else process.env.PATH = oldPath;
		}
	});
test("public evidence removes opaque capability, private paths, access and nested metadata keys", () => {
	const values = [
		"opaque-capability-sentinel",
		"/private/auth-connection-sentinel.json",
		"opaque-access-sentinel",
		"metadata-private-sentinel",
	];
	const evidence = {
		text: values.join(" "),
		nested: { [values[3] ?? "missing"]: values[2] },
		messages: [{ error: values[0] }],
	};
	const result = canaryPublicNativeEvidence(evidence, values);
	expect(result).toEqual({
		text: "<private-native-auth> <private-native-auth> <private-native-auth> <private-native-auth>",
		nested: { "<private-native-auth>": "<private-native-auth>" },
		messages: [{ error: "<private-native-auth>" }],
	});
	for (const value of values)
		expect(canonicalJson(result)).not.toContain(value);
});
test("auth recorder requires a launch receipt and retains a canonical self-contained public seal", async () => {
	const f = await fixture();
	if (!f.nativeAuth) throw new Error("Missing fixture attachment");
	const native = transcript(join(f.root, "fixture"));
	const input = {
		repositoryRoot: f.root,
		prepared: f.prepared,
		preparedDirectory: f.root,
		operator: "synthetic",
		session: null,
		transcript: native,
		recordedAt: new Date("2026-10-24T00:00:00.000Z"),
	};
	await expect(recordCanary(input)).rejects.toThrow(
		"matching public launch receipt",
	);
	const launchReceipt = receipt(f.prepared.sha256, f.nativeAuth, native);
	const invalid = {
		...launchReceipt,
		host: { ...launchReceipt.host, pid: 43 },
	};
	await expect(
		recordCanary({ ...input, launchReceipt: invalid }),
	).rejects.toThrow("matching public launch receipt");
	const saved = await recordCanary({ ...input, launchReceipt });
	const installation = JSON.parse(
		await readFile(
			join(f.root, "evals/canary", saved.record.artifacts.installation.path),
			"utf8",
		),
	);
	const retained = JSON.parse(
		await readFile(
			join(
				f.root,
				"evals/canary",
				saved.record.artifacts.transcript?.path ?? "missing",
			),
			"utf8",
		),
	);
	expect(
		canaryAuthLaunchMatches({
			preparedSha256: f.prepared.sha256,
			nativeAuth: f.nativeAuth,
			receipt: installation.nativeAuth.launchReceipt,
			transcript: retained,
		}),
	).toBe(true);
	expect(installation.nativeAuth.launchReceipt.rootSessionID).toMatch(
		/^id_[a-f0-9]{16}$/,
	);
	for (const secret of [
		connection.capability,
		connection.url,
		f.source,
		"private-metadata-sentinel",
	])
		expect(canonicalJson(installation)).not.toContain(secret);
	expect(
		(await recordCanary({ ...input, launchReceipt })).record.recordSha256,
	).toBe(saved.record.recordSha256);
	for (const change of [
		"host",
		"model",
		"policy",
		"native",
		"source",
		"unknown",
	] as const) {
		const changed = structuredClone(launchReceipt);
		if (change === "host") changed.host.pid++;
		if (change === "model") changed.model.id = "other";
		if (change === "policy") changed.providerPolicySha256 = digest("other");
		if (change === "native") changed.native.sha256 = digest("other");
		if (change === "source") changed.nativeAuth.sourceSha256 = digest("other");
		const candidate =
			change === "unknown"
				? { ...changed, configurationPath: "/private/unexpected" }
				: changed;
		expect(
			canaryAuthLaunchMatches({
				preparedSha256: f.prepared.sha256,
				nativeAuth: f.nativeAuth,
				receipt: candidate,
				transcript: native,
			}),
			change,
		).toBe(false);
	}
});

const LIVE = process.env.FLOW_CANARY_NATIVE_AUTH_LIVE === "1";
test.skipIf(!LIVE)(
	"native canary loads sealed auth before seeding, exports before cleanup, and uses only the source bearer",
	async () => {
		const binary = process.env.FLOW_CANARY_LIVE_EXECUTABLE;
		if (!binary)
			throw new Error("A private pinned native executable is required.");
		const scripted = localScriptedProvider();
		let bearerMatches = true;
		let requests = 0;
		let websocket = 0;
		let dropSource: (() => Promise<void>) | undefined;
		const proxy = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(request) {
				if (request.headers.get("upgrade")) {
					websocket++;
					return new Response("No WebSocket", { status: 400 });
				}
				bearerMatches &&=
					request.headers.get("authorization") ===
					"Bearer synthetic-owner-access-1";
				requests++;
				if (dropSource) {
					const stop = dropSource;
					dropSource = undefined;
					await stop();
				}
				const url = new URL(request.url);
				url.host = scripted.server.url.host;
				return fetch(new Request(url.href, request));
			},
		});
		const fixtureURL = pathToFileURL(
			join(import.meta.dir, "fixtures/native-auth-plugin.ts"),
		).href;
		const entry = `import {Plugin} from "@opencode/plugin";
import Fixture from ${JSON.stringify(fixtureURL)};
import {existsSync,writeFileSync} from "node:fs";
import {dirname,join} from "node:path";
export default Plugin.define({id:"flow-canary-native-auth-fixture",async setup(ctx){
 const dispose = await Fixture.setup({...ctx, options:{role:"child",baseURL:${JSON.stringify(new URL("v1", proxy.url).href)}}});
 await ctx.agent.transform(editor=>editor.update("flow-reviewer",agent=>{agent.mode="subagent";agent.system="Local review";agent.permissions=[{action:"*",resource:"*",effect:"allow"}];}));
 await ctx.tool.transform(editor=>editor.add({name:"canary_spawn",description:"Local reviewer",options:{codemode:false},input:{type:"object",properties:{}},async execute(_,context){const child=await ctx.session.create({parentID:context.sessionID,agent:"flow-reviewer",model:{providerID:"native-auth-fixture",id:"model",variant:"default"},location:{directory:ctx.location.directory}});await ctx.session.prompt({sessionID:child.id,text:"Review locally"});await ctx.session.wait({sessionID:child.id});return {content:"Local reviewer complete"};}}));
 return async()=>{writeFileSync(join(dirname(dirname(process.env.XDG_DATA_HOME)),"export-before-stop.json"),JSON.stringify({pid:process.pid,nativeExistsBeforeStop:existsSync(join(dirname(dirname(process.env.XDG_DATA_HOME)),"native.json"))}));await dispose();};
}});`;
		const f = await fixture({ entry });
		const sourceRoot = join(f.root, "owner");
		const env: Record<string, string> = { PATH: "/usr/bin:/bin" };
		for (const [key, leaf] of Object.entries({
			HOME: "home",
			XDG_CONFIG_HOME: "config",
			XDG_DATA_HOME: "data",
			XDG_CACHE_HOME: "cache",
			XDG_STATE_HOME: "state",
			TMPDIR: "tmp",
		})) {
			const path = join(sourceRoot, leaf);
			await mkdir(path, { recursive: true, mode: 0o700 });
			env[key] = path;
		}
		const project = join(sourceRoot, "project");
		await mkdir(project, { mode: 0o700 });
		const sourceFixture = join(sourceRoot, "fixture");
		await mkdir(sourceFixture, { mode: 0o700 });
		await writeFile(
			join(sourceFixture, "index.ts"),
			`export {default} from ${JSON.stringify(fixtureURL)};\n`,
		);
		await mkdir(join(sourceRoot, "config/opencode"), { mode: 0o700 });
		await writeFile(
			join(sourceRoot, "config/opencode/opencode.json"),
			JSON.stringify({
				plugins: [
					{
						package: sourceFixture,
						options: { role: "source", baseURL: new URL("v1", proxy.url).href },
					},
				],
				update: "disable",
				warming: false,
				share: "disabled",
			}),
		);
		const cli = join(sourceRoot, "native-cli");
		await writeFile(
			cli,
			`#!${process.execPath}\nconst {spawn}=require("node:child_process");const child=spawn(${JSON.stringify(binary)},process.argv.slice(2),{env:${JSON.stringify(env)},stdio:"inherit"});child.on("exit",code=>process.exit(code??1));\n`,
			{ mode: 0o700 },
		);
		const allocated = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () => new Response(),
		});
		const port = allocated.port;
		allocated.stop(true);
		const configure = Bun.spawn([cli, "service", "set", "port", String(port)], {
			cwd: project,
			env,
			stdout: "ignore",
			stderr: "pipe",
		});
		if (await configure.exited)
			throw new Error("Private native service configuration failed.");
		const endpoint = await Service.ensure({
			command: [binary, "serve", "--service"],
			env,
			file: join(sourceRoot, "state/opencode/service.json"),
			version: "2.1.4",
		});
		const owner = OpenCode.make({
			baseUrl: endpoint.url,
			headers: Service.headers(endpoint),
		});
		let ownerPID: number | undefined;
		let broker:
			| Awaited<ReturnType<typeof startNativeAccountBroker>>
			| undefined;
		const oldPath = process.env.PATH;
		let childStats: unknown;
		let childRows: CredentialEntry[] = [];
		let privateConfigSha256: string | undefined;
		let importAfterActive = false;
		let rejectChildList = false;
		const factory = OpenCodeStartup.prototype.client;
		const observe = spyOn(
			OpenCodeStartup.prototype,
			"client",
		).mockImplementation(function (
			this: OpenCodeStartup,
			baseUrl: string,
			directory: string,
		) {
			const client = factory.call(this, baseUrl, directory);
			if (!client) return null;
			const create = client.credential.create;
			const list = client.credential.list;
			return {
				...client,
				credential: {
					...client.credential,
					create: async (...args) => {
						const plugins = await client.plugin.list({
							location: { directory },
						});
						importAfterActive = plugins.data.some(
							(plugin) =>
								plugin.id === "flow.native-account-client" &&
								plugin.state.status === "active",
						);
						if (!importAfterActive)
							throw new Error("Client was not active before import");
						return create(...args);
					},
					list: async (...args) => {
						if (rejectChildList)
							throw new Error(
								"opaque-access-sentinel private-account-metadata",
							);
						childStats = await client
							.rpc(FixtureRpc)
							.stats({}, { location: { directory } });
						childRows = await list(...args);
						const run = (await readdir(f.root)).find((name) =>
							name.startsWith("run-"),
						);
						if (run)
							privateConfigSha256 = digest(
								await readFile(
									join(
										f.root,
										run,
										"private-host/config/opencode/opencode.json",
									),
								),
							);
						return childRows;
					},
				},
			};
		});
		try {
			ownerPID = (await owner.server.info()).pid;
			await owner.model.list({ location: { directory: project } });
			await owner.credential.create({
				id: "synthetic-canary-account",
				integrationID: "openai",
				label: "Private synthetic account",
				activate: true,
				value: {
					type: "oauth",
					methodID: "native-auth-fixture-method",
					access: "synthetic-before-access",
					refresh: "original-refresh-must-stay-in-owner",
					expires: 0,
					metadata: { accountId: "private-account-metadata" },
				},
			});
			broker = await startNativeAccountBroker({
				opencodeExecutable: cli,
				models: ["native-auth-fixture/model"],
			});
			await writeFile(f.source, JSON.stringify(broker.configuration), {
				mode: 0o600,
			});
			await symlink(
				join(import.meta.dir, "../node_modules"),
				join(f.root, "fixture/.opencode/plugins/flow/node_modules"),
				"dir",
			);
			await writeFile(
				join(f.root, "npm"),
				`#!/usr/bin/env node\nconst{spawn}=require("node:child_process");const args=process.argv.slice(2);if(args[0]==="install")process.exit(0);if(JSON.stringify(args.slice(0,5))!==JSON.stringify(["exec","--yes","--package=@opencode/cli@2.1.4","--","opencode"]))process.exit(99);const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>["PATH","HOME","XDG_CONFIG_HOME","XDG_DATA_HOME","XDG_CACHE_HOME","XDG_STATE_HOME","TMPDIR","PWD","OPENCODE_FLOW_REVIEWER_MODEL"].includes(key)));env.OPENAI_API_KEY="synthetic-ambient-key";const child=spawn(${JSON.stringify(binary)},args.slice(5),{stdio:"inherit",env});child.on("exit",code=>process.exit(code??1));\n`,
				{ mode: 0o700 },
			);
			process.env.PATH = `${f.root}:${oldPath ?? ""}`;
			await writeFile(
				f.input.prompt,
				'FLOW_SMOKE_ACTIONS [{"tool":"canary_spawn","input":{}}]',
			);
			expect(
				await runPaidCanary({ ...f.input, model: "native-auth-fixture/model" }),
			).toBe(0);
			const run = (await readdir(f.root)).find((name) =>
				name.startsWith("run-"),
			);
			if (!run) throw new Error("Missing native run");
			const output = join(f.root, run);
			expect((await readdir(output)).sort()).toEqual([
				"export-before-stop.json",
				"native.json",
				"run.json",
				"server.log",
			]);
			const native = JSON.parse(
				await readFile(join(output, "native.json"), "utf8"),
			);
			const launch = JSON.parse(
				await readFile(join(output, "run.json"), "utf8"),
			);
			if (!f.nativeAuth) throw new Error("Missing attachment");
			expect(
				canaryAuthLaunchMatches({
					preparedSha256: f.prepared.sha256,
					nativeAuth: f.nativeAuth,
					receipt: launch,
					transcript: native,
				}),
			).toBe(true);
			expect(
				JSON.parse(
					await readFile(join(output, "export-before-stop.json"), "utf8"),
				),
			).toEqual({ pid: launch.host.pid, nativeExistsBeforeStop: true });
			expect(native.sessions.length).toBe(2);
			expect(
				native.sessions.map(
					(session: { info: { model: unknown } }) => session.info.model,
				),
			).toEqual([
				{ providerID: "native-auth-fixture", id: "model", variant: "default" },
				{ providerID: "native-auth-fixture", id: "model", variant: "default" },
			]);
			expect(
				native.sessions
					.map((session: { info: { agent: string; tokens: unknown } }) => ({
						agent: session.info.agent,
						tokens: session.info.tokens,
					}))
					.sort((left: { agent: string }, right: { agent: string }) =>
						left.agent.localeCompare(right.agent),
					),
			).toEqual([
				{
					agent: "build",
					tokens: {
						input: 20,
						output: 10,
						reasoning: 8,
						cache: { read: 6, write: 0 },
					},
				},
				{
					agent: "flow-reviewer",
					tokens: {
						input: 10,
						output: 5,
						reasoning: 4,
						cache: { read: 3, write: 0 },
					},
				},
			]);
			expect(importAfterActive).toBe(true);
			expect(
				childRows.map((row) =>
					row.value.type === "oauth" ? row.value.refresh : "unexpected",
				),
			).toEqual([PLACEHOLDER_REFRESH]);
			expect(childStats).toMatchObject({
				foreignRequests: 0,
				directChildRefreshes: 0,
			});
			expect(requests).toBe(3);
			expect(websocket).toBe(0);
			expect(bearerMatches).toBe(true);
			expect((await paidRunStatus(f.root)).consumed).toBe(1);
			expect(() => process.kill(launch.host.pid, 0)).toThrow();
			expect(() => process.kill(ownerPID ?? 0, 0)).not.toThrow();
			const stats = await owner
				.rpc(FixtureRpc)
				.stats({}, { location: { directory: project } });
			if (!object(stats)) throw new Error("Invalid synthetic stats");
			expect(stats).toMatchObject({
				foreignRequests: 0,
				directChildRefreshes: 0,
			});
			const original = await owner.credential.list();
			expect(original).toMatchObject([
				{
					id: "synthetic-canary-account",
					integrationID: "openai",
					active: true,
					label: "Private synthetic account",
					value: {
						type: "oauth",
						methodID: "native-auth-fixture-method",
						refresh: "synthetic-owner-refresh-1",
						access: "synthetic-owner-access-1",
						metadata: { accountId: "private-account-metadata" },
					},
				},
			]);
			const publicBytes = (
				await Promise.all(
					["run.json", "native.json", "server.log"].map((name) =>
						readFile(join(output, name), "utf8"),
					),
				)
			).join("\n");
			if (!privateConfigSha256)
				throw new Error("Missing private configuration measurement");
			expect(publicBytes).not.toContain(privateConfigSha256);
			expect(publicBytes).not.toContain(
				digest(canonicalJson({ accountId: "private-account-metadata" })),
			);
			for (const secret of [
				broker.configuration.capability,
				broker.configuration.url,
				f.source,
				"private-account-metadata",
				"synthetic-owner-access-1",
				"original-refresh-must-stay-in-owner",
			])
				expect(publicBytes).not.toContain(secret);
			await expect(stat(join(output, "native-auth"))).rejects.toThrow();
			const next = async () => {
				const nextFixture = await fixture({ entry });
				if (!broker) throw new Error("Missing broker");
				await writeFile(
					nextFixture.source,
					JSON.stringify(broker.configuration),
					{ mode: 0o600 },
				);
				await writeFile(
					nextFixture.input.prompt,
					'FLOW_SMOKE_ACTIONS [{"tool":"canary_spawn","input":{}}]',
				);
				await symlink(
					join(import.meta.dir, "../node_modules"),
					join(nextFixture.root, "fixture/.opencode/plugins/flow/node_modules"),
					"dir",
				);
				await writeFile(
					join(nextFixture.root, "npm"),
					await readFile(join(f.root, "npm")),
					{ mode: 0o700 },
				);
				process.env.PATH = `${nextFixture.root}:${oldPath ?? ""}`;
				return nextFixture;
			};
			rejectChildList = true;
			const failedList = await next();
			await expect(
				runPaidCanary({
					...failedList.input,
					model: "native-auth-fixture/model",
				}),
			).rejects.toThrow("Native-auth canary execution failed during cleanup.");
			const failedRun = (await readdir(failedList.root)).find((name) =>
				name.startsWith("run-"),
			);
			if (!failedRun) throw new Error("Missing list-failed run");
			expect((await readdir(join(failedList.root, failedRun))).sort()).toEqual([
				"export-before-stop.json",
				"server.log",
			]);
			expect((await paidRunStatus(failedList.root)).consumed).toBe(1);
			expect(() => process.kill(ownerPID ?? 0, 0)).not.toThrow();
			rejectChildList = false;
			const lostSource = await next();
			const beforeLoss = requests;
			dropSource = () => broker?.dispose() ?? Promise.resolve();
			await expect(
				runPaidCanary({
					...lostSource.input,
					model: "native-auth-fixture/model",
				}),
			).rejects.toThrow("Native-auth canary execution failed");
			expect(requests - beforeLoss).toBe(1);
			expect((await paidRunStatus(lostSource.root)).consumed).toBe(1);
			const lostRun = (await readdir(lostSource.root)).find((name) =>
				name.startsWith("run-"),
			);
			if (!lostRun) throw new Error("Missing source-lost run");
			await expect(
				stat(join(lostSource.root, lostRun, "run.json")),
			).rejects.toThrow();
			await expect(
				stat(join(lostSource.root, lostRun, "private-host")),
			).rejects.toThrow();
			expect(() => process.kill(ownerPID ?? 0, 0)).not.toThrow();
		} finally {
			observe.mockRestore();
			if (oldPath === undefined) delete process.env.PATH;
			else process.env.PATH = oldPath;
			const disposed = await Promise.allSettled([
				Promise.resolve().then(() => broker?.dispose()),
			]);
			if (ownerPID) {
				try {
					process.kill(ownerPID, "SIGTERM");
				} catch {}
				let stopped = false;
				for (let attempt = 0; attempt < 200; attempt++) {
					try {
						process.kill(ownerPID, 0);
					} catch {
						stopped = true;
						break;
					}
					await Bun.sleep(25);
				}
				expect(stopped).toBe(true);
			}
			proxy.stop(true);
			scripted.server.stop(true);
			expect(disposed.every((result) => result.status === "fulfilled")).toBe(
				true,
			);
		}
	},
	120000,
);
