import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { startNativeAccountBroker } from "../evals/native-auth/broker.js";
import { NativeAuthError } from "../evals/native-auth/protocol.js";

type Call = { cwd: string; args: string[] };
type Mode =
	| "fail"
	| "replacement"
	| "delete-fail"
	| "replace-after-close"
	| "local-removal-failure"
	| "relay-stop-injection";
const generic = "Native account authentication failed.";

async function brokerCleanup(mode: Mode, dead = false) {
	if (process.pid === 76572) throw new Error("Unexpected cleanup runner PID");
	const root = await mkdtemp(join(tmpdir(), "native-auth-cleanup-"));
	const previousTemporary = process.env.TMPDIR;
	const statePath = join(root, "state.json");
	const log = join(root, "calls.jsonl");
	const executable = join(root, "native-cli");
	const temporary = join(root, "temporary");
	const retained = join(root, "retained");
	await mkdir(temporary, { mode: 0o700 });
	const child = dead
		? spawnSync(process.execPath, ["--eval", "process.exit(0)"])
		: undefined;
	const pid = dead ? child?.pid : process.pid;
	if (pid === undefined || pid === 76572)
		throw new Error("Unexpected cleanup fixture PID");
	const state = { mode: "ready", pid };
	await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
	await writeFile(
		executable,
		`#!${process.execPath}
import { appendFileSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
const statePath = ${JSON.stringify(statePath)};
const state = JSON.parse(readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify({cwd:process.cwd(),args})+"\\n", {mode:0o600});
if(state.mode === "fail" || (state.mode === "delete-fail" && args[1] === "DELETE")) process.exit(1);
if(args[0] === "service") { console.log("http://127.0.0.1:9/"); process.exit(0); }
if(args[1] === "GET") { console.log(JSON.stringify({version:"2.1.4",pid:state.pid+(state.mode === "replacement" ? 1 : 0)}));process.exit(0); }
if(args[1] === "DELETE") {
  if(state.mode === "local-removal-failure") { renameSync(${JSON.stringify(temporary)},${JSON.stringify(retained)});symlinkSync(${JSON.stringify(temporary)},${JSON.stringify(temporary)}); }
  process.exit(0);
}
if(args[2]?.includes("/close")) {
  if(state.mode === "replace-after-close") writeFileSync(statePath,JSON.stringify({...state,mode:"replacement"}));
  console.log(JSON.stringify({output:{}}));process.exit(0);
}
console.log(JSON.stringify({output:{accounts:[{route:{providerID:"alias",integrationID:"openai",credentialID:"selected",methodID:"oauth",label:"Selected"},value:{type:"oauth",methodID:"oauth",access:"synthetic-access",refresh:"flow-native-auth-source-owned",expires:4102444800000}}]}}));
`,
		{ mode: 0o700 },
	);
	await chmod(root, 0o700);
	let owned: string | undefined;
	let broker: Awaited<ReturnType<typeof startNativeAccountBroker>> | undefined;
	const serve = Bun.serve;
	let rawRelay: ReturnType<typeof Bun.serve> | undefined;
	let stopCalls = 0;
	try {
		process.env.TMPDIR = temporary;
		if (mode === "relay-stop-injection") {
			Bun.serve = ((...args: Parameters<typeof Bun.serve>) => {
				const server = serve(...args);
				rawRelay = server;
				return new Proxy(server, {
					get(target, key) {
						if (key === "stop")
							return async () => {
								stopCalls++;
								await target.stop(true);
								throw new Error("relay-stop-private-sentinel");
							};
						const value = Reflect.get(target, key, target);
						return typeof value === "function" ? value.bind(target) : value;
					},
				});
			}) as typeof Bun.serve;
		}
		broker = await startNativeAccountBroker({
			opencodeExecutable: executable,
			models: ["alias/model"],
		});
		const initial: Call[] = (await readFile(log, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		const first = initial[0];
		if (!first) throw new Error("Missing cleanup fixture call");
		owned = dirname(first.cwd);
		await writeFile(statePath, JSON.stringify({ ...state, mode }));
		const disposed = broker.dispose();
		expect(broker.dispose()).toBe(disposed);
		if (dead) await disposed;
		else if (
			mode === "local-removal-failure" ||
			mode === "relay-stop-injection"
		) {
			const failure: unknown = await disposed.catch((error) => error);
			if (!(failure instanceof Error))
				throw new Error("Missing disposal rejection");
			expect(failure.message).toBe("Native account authentication failed.");
			expect(failure instanceof NativeAuthError).toBe(true);
			expect(failure.name).toBe("NativeAuthError");
			expect(failure.message).toBe(generic);
			expect("cause" in failure).toBe(false);
			expect(failure.stack?.includes(basename(owned)) ?? false).toBe(false);
			expect(
				failure.stack?.includes("relay-stop-private-sentinel") ?? false,
			).toBe(false);
			expect(await broker.dispose().catch((error) => error)).toBe(failure);
		} else await expect(disposed).rejects.toThrow(generic);
		if (mode === "local-removal-failure") {
			expect((await lstat(join(retained, basename(owned)))).isDirectory()).toBe(
				true,
			);
			expect((await lstat(temporary)).isSymbolicLink()).toBe(true);
			await rm(temporary);
			await rename(retained, temporary);
			await expect(broker.dispose()).rejects.toThrow(generic);
			expect((await lstat(owned)).isDirectory()).toBe(true);
		} else await expect(lstat(owned)).rejects.toThrow();
		const calls: Call[] = (await readFile(log, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		const cleanup = calls.slice(initial.length);
		expect(
			cleanup.filter((call) => call.args[2]?.includes("/close")).length,
		).toBe(
			mode === "delete-fail" ||
				mode === "replace-after-close" ||
				mode === "local-removal-failure"
				? 1
				: 0,
		);
		expect(cleanup.filter((call) => call.args[1] === "DELETE").length).toBe(
			mode === "delete-fail" || mode === "local-removal-failure" ? 1 : 0,
		);
		if (mode === "relay-stop-injection") expect(stopCalls).toBe(1);
		await expect(fetch(broker.configuration.url)).rejects.toThrow();
	} finally {
		Bun.serve = serve;
		await rawRelay?.stop(true);
		await broker?.dispose().catch(() => {});
		if (previousTemporary === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = previousTemporary;
		if (
			await lstat(retained).then(
				() => true,
				() => false,
			)
		) {
			await rm(temporary);
			await rename(retained, temporary);
		}
		if (owned) await rm(owned, { recursive: true, force: true });
		await rm(root, { recursive: true, force: true });
	}
}

for (const mode of [
	"fail",
	"replacement",
	"delete-fail",
	"replace-after-close",
] as const)
	test(`broker disposal removes its directory and preserves failure through ${mode}`, async () => {
		await brokerCleanup(mode);
	});
test("broker disposal removes its directory when the pinned PID is dead without unpinned RPC", async () => {
	await brokerCleanup("fail", true);
});
test("broker disposal hides real local filesystem removal failure without claiming removal", async () => {
	await brokerCleanup("local-removal-failure");
});
test("broker disposal hides an explicitly injected relay-stop sentinel after attempting safe cleanup", async () => {
	await brokerCleanup("relay-stop-injection");
});
