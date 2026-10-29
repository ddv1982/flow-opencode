import { expect, test } from "bun:test";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
	access,
	mkdir,
	mkdtemp,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenCodeClient } from "@opencode/client";
import { currentBunToolchain } from "../evals/bun-toolchain.js";
import { packPlugin, preparePackageCache } from "../evals/harness.js";
import {
	installedOpenCodePluginEntry,
	OPENCODE_HOST_VERSION,
	OpenCodeStartup,
	openCodeInvocation,
} from "../evals/opencode-host.js";
import packageJson from "../package.json" with { type: "json" };

async function availablePort(): Promise<number> {
	const server = createServer();
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("No loopback port");
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	return address.port;
}

// This child starts in its own process group. Stop only that owned group and
// await the child, without inspecting the machine's process table.
async function stopOwned(child: ChildProcess): Promise<void> {
	if (
		child.pid === undefined ||
		child.exitCode !== null ||
		child.signalCode !== null
	)
		return;
	const exited = once(child, "exit");
	const signal = (value: NodeJS.Signals) => {
		try {
			if (process.platform !== "win32" && child.pid !== undefined)
				process.kill(-child.pid, value);
			else child.kill(value);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
		}
	};
	signal("SIGTERM");
	if (
		await Promise.race([
			exited.then(() => false),
			Bun.sleep(3_000).then(() => true),
		])
	)
		signal("SIGKILL");
	await exited;
}

test.skipIf(process.env.FLOW_LIVE_SMOKE !== "1")(
	"global packed plugin starts at home and activates in project locations without a model call",
	async () => {
		const root = await realpath(
			await mkdtemp(join(tmpdir(), "flow-plugin-startup-")),
		);
		const home = join(root, "home");
		const project = join(home, "project");
		const plainProject = join(home, "plain project");
		const startup = new OpenCodeStartup();
		let child: ChildProcess | undefined;
		try {
			const toolchain = currentBunToolchain(packageJson.packageManager);
			const tarball =
				process.env.FLOW_LIVE_SMOKE_TARBALL ??
				(await packPlugin(join(import.meta.dir, ".."), root, toolchain));
			const cache = await preparePackageCache(tarball, root, toolchain);
			const plugin = join(cache, "node_modules", "opencode-plugin-flow");
			const entry = await installedOpenCodePluginEntry(
				plugin,
				join(root, "entry"),
			);
			for (const path of [
				project,
				plainProject,
				join(home, ".config", "opencode"),
				...["data", "cache", "state", "tmp"].map((name) => join(root, name)),
			])
				await mkdir(path, { recursive: true });
			await writeFile(
				join(home, ".config", "opencode", "opencode.json"),
				JSON.stringify({ plugins: [entry] }),
			);
			const port = await availablePort();
			const version =
				process.env.FLOW_OPENCODE_SMOKE_VERSION ?? OPENCODE_HOST_VERSION;
			const invoke = (args: string[]) =>
				process.env.FLOW_OPENCODE_SMOKE_EXECUTABLE
					? { command: process.env.FLOW_OPENCODE_SMOKE_EXECUTABLE, args }
					: openCodeInvocation(args, version);
			const environment = {
				PATH: toolchain.environment.PATH,
				HOME: home,
				XDG_CONFIG_HOME: join(home, ".config"),
				XDG_DATA_HOME: join(root, "data"),
				XDG_CACHE_HOME: join(root, "cache"),
				XDG_STATE_HOME: join(root, "state"),
				TMPDIR: join(root, "tmp"),
			};
			expect(
				spawnSync("git", ["init", "-q", project], { env: environment }).status,
			).toBe(0);
			expect(
				spawnSync(
					"git",
					[
						"-C",
						project,
						"-c",
						"core.hooksPath=/dev/null",
						"-c",
						"user.name=Startup fixture",
						"-c",
						"user.email=startup@example.invalid",
						"-c",
						"commit.gpgSign=false",
						"commit",
						"--allow-empty",
						"-qm",
						"fixture",
					],
					{ env: environment },
				).status,
			).toBe(0);
			const invocation = invoke([
				"serve",
				"--hostname",
				"127.0.0.1",
				"--port",
				String(port),
			]);
			child = spawn(invocation.command, invocation.args, {
				cwd: home,
				detached: process.platform !== "win32",
				stdio: ["ignore", "pipe", "pipe"],
				env: environment,
			});
			child.stdout?.on("data", (chunk) => startup.consume(String(chunk)));
			child.stderr?.on("data", (chunk) =>
				startup.consume(String(chunk), "stderr"),
			);
			let spawnError: Error | undefined;
			child.once("error", (error) => {
				spawnError = error;
			});
			let client: OpenCodeClient | null = null;
			const deadline = Date.now() + 120_000;
			while (Date.now() < deadline) {
				if (spawnError) throw spawnError;
				if (child.exitCode !== null)
					throw new Error("Isolated OpenCode exited before readiness.");
				client = startup.client(`http://127.0.0.1:${port}`, home);
				if (client) break;
				await Bun.sleep(50);
			}
			if (!client) throw new Error("Isolated OpenCode did not become ready.");
			const request = () => ({ signal: AbortSignal.timeout(30_000) });
			expect((await client.server.info(request())).version).toBe(version);
			for (const directory of [home, project, plainProject, home]) {
				const location = { directory };
				const scoped = startup.client(`http://127.0.0.1:${port}`, directory);
				if (!scoped) throw new Error("Missing isolated server authentication.");
				const configuration = await scoped.config.get({ location }, request());
				expect(JSON.stringify(configuration).includes(entry)).toBe(true);
				const inventoryDeadline = Date.now() + 30_000;
				let commands = await scoped.command.list({ location }, request());
				while (
					directory !== home &&
					!commands.data.some((item) => item.name === "flow-status") &&
					Date.now() < inventoryDeadline
				) {
					await Bun.sleep(50);
					commands = await scoped.command.list({ location }, request());
				}
				expect(
					commands.data.some((command) => command.name === "flow-status"),
				).toBe(directory !== home);
				const plugins = await scoped.plugin.list({ location }, request());
				expect(
					plugins.data.filter((item) => item.state.status === "failed"),
				).toEqual([]);
			}
			expect(startup.log).toContain("Flow is inactive in the home directory");
			await expect(access(join(home, ".flow"))).rejects.toMatchObject({
				code: "ENOENT",
			});
		} finally {
			try {
				if (child) await stopOwned(child);
			} finally {
				startup.clear();
				await rm(root, { recursive: true, force: true });
			}
		}
	},
	180_000,
);
