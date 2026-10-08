import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	collectGitDiff,
	jsonStringBytes,
} from "../src/infrastructure/fs/review-diff.js";

const roots: string[] = [];
async function root() {
	const directory = await mkdtemp(join(tmpdir(), "flow-review-diff-"));
	roots.push(directory);
	return directory;
}
function quote(value: string) {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
async function fakeGit(program: string) {
	const directory = await root();
	const script = join(directory, "fixture.mjs");
	await writeFile(script, program);
	await writeFile(
		join(directory, "git"),
		`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`,
		{ mode: 0o755 },
	);
	return { directory, environment: { ...process.env, PATH: directory } };
}
function processGone(pid: number) {
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
		throw error;
	}
}
afterEach(async () => {
	for (const directory of roots.splice(0)) {
		for (const name of ["pid", "holder-pid"]) {
			try {
				const pid = Number(await readFile(join(directory, name), "utf8"));
				if (Number.isSafeInteger(pid) && pid > 0 && !processGone(pid))
					process.kill(pid, "SIGKILL");
			} catch {}
		}
		await rm(directory, { recursive: true, force: true });
	}
});

test("real Git exits zero for identical operands and one for a complete changed hunk", async () => {
	const directory = await root();
	const before = join(directory, "before");
	const after = join(directory, "after");
	await writeFile(before, "old\n");
	await writeFile(after, "old\n");
	const args = [
		"diff",
		"--no-index",
		"--no-ext-diff",
		"--no-textconv",
		"--no-color",
		"--",
		before,
		after,
	];
	expect(await collectGitDiff(args, process.env)).toEqual(Buffer.alloc(0));
	await writeFile(after, "new\n");
	expect((await collectGitDiff(args, process.env)).toString()).toContain(
		"-old\n+new\n",
	);
});

test.skipIf(process.platform === "win32").each([0, 1])(
	"exit %s returns exact binary stdout",
	async (code) => {
		const fixture = await fakeGit(
			`process.stdout.write(Buffer.from([0,255,128,13,10]), () => process.exit(${code}));`,
		);
		expect(await collectGitDiff([], fixture.environment)).toEqual(
			Buffer.from([0, 255, 128, 13, 10]),
		);
	},
);

test("launch failure rejects after process launch handling completes", async () => {
	const directory = await root();
	await expect(
		collectGitDiff([], { ...process.env, PATH: directory }),
	).rejects.toThrow(/ENOENT|Executable not found/);
});

test("unexpected Git exit rejects rather than returning stderr as evidence", async () => {
	const directory = await root();
	await expect(
		collectGitDiff(
			["-C", directory, "rev-parse", "--verify", "HEAD"],
			process.env,
		),
	).rejects.toThrow("exited with code 128");
});

test.skipIf(process.platform === "win32")(
	"signal rejection observes an exited child",
	async () => {
		const fixture = await fakeGit(
			`import {writeFileSync} from "node:fs";writeFileSync(process.env.PID_FILE,String(process.pid));process.kill(process.pid,"SIGTERM");`,
		);
		await expect(
			collectGitDiff([], {
				...fixture.environment,
				PID_FILE: join(fixture.directory, "pid"),
			}),
		).rejects.toThrow("SIGTERM");
		expect(
			processGone(
				Number(await readFile(join(fixture.directory, "pid"), "utf8")),
			),
		).toBe(true);
	},
);

test.skipIf(process.platform === "win32")(
	"exactly four MiB of stdout remains accepted",
	async () => {
		const fixture = await fakeGit(
			`process.stdout.write(Buffer.alloc(4*1024*1024,127),()=>process.exit(1));`,
		);
		const output = await collectGitDiff([], fixture.environment);
		expect(output.equals(Buffer.alloc(4 * 1024 * 1024, 127))).toBe(true);
	},
);

test.skipIf(process.platform === "win32").each(["stdout", "stderr"] as const)(
	"%s overflow kills a TERM-ignoring child and waits for pipe EOF while the holder remains alive",
	async (channel) => {
		const fixture = await fakeGit(`
		import {spawn} from "node:child_process";
		import {existsSync,writeFileSync} from "node:fs";
		process.on("SIGTERM",()=>{});
		writeFileSync(process.env.PID_FILE,String(process.pid));
		process.chdir(process.env.OPERANDS);
		spawn(process.execPath,[process.env.HOLDER],{stdio:["ignore",1,2],env:process.env});
		const interval=setInterval(()=>{if(!existsSync(process.env.READY))return;clearInterval(interval);const stream=process.${channel};const bytes=Buffer.alloc(65536,120);const pump=()=>{if(stream.write(bytes))setImmediate(pump);else stream.once("drain",pump);};pump();},5);
	`);
		const operands = join(fixture.directory, "operands");
		await mkdir(operands);
		await writeFile(join(operands, "before"), "captured-before");
		await writeFile(join(operands, "after"), "captured-after");
		const holder = join(fixture.directory, "holder.mjs");
		await writeFile(
			holder,
			`import {closeSync,existsSync,writeFileSync} from "node:fs";writeFileSync(process.env.HOLDER_PID,String(process.pid));writeFileSync(process.env.READY,"ready");setTimeout(()=>{writeFileSync(process.env.MARKER,JSON.stringify(existsSync(process.env.OPERANDS+"/before")&&existsSync(process.env.OPERANDS+"/after")));closeSync(1);closeSync(2);setInterval(()=>{},1000);},250);`,
		);
		const marker = join(fixture.directory, "marker");
		const environment = {
			...fixture.environment,
			PID_FILE: join(fixture.directory, "pid"),
			HOLDER_PID: join(fixture.directory, "holder-pid"),
			OPERANDS: operands,
			HOLDER: holder,
			READY: join(fixture.directory, "ready"),
			MARKER: marker,
		};
		const capture = collectGitDiff([], environment).finally(async () => {
			expect(
				processGone(Number(await readFile(environment.PID_FILE, "utf8"))),
			).toBe(true);
			expect(await readFile(marker, "utf8")).toBe("true");
			await rm(operands, { recursive: true });
		});
		await expect(capture).rejects.toThrow(`${channel} exceeds its capacity`);
		expect(
			processGone(Number(await readFile(environment.HOLDER_PID, "utf8"))),
		).toBe(false);
	},
);

const oracle = (text: string) => Buffer.byteLength(JSON.stringify(text));
test("all single UTF16 code units and boundary adjacency match built-in JSON UTF8 bytes", () => {
	for (let code = 0; code <= 0xffff; code++) {
		const text = String.fromCharCode(code);
		expect(jsonStringBytes(text)).toBe(oracle(text));
	}
	const units = [
		0, 8, 9, 10, 12, 13, 31, 32, 34, 92, 127, 128, 0x7ff, 0x800, 0x2028, 0x2029,
		0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xffff,
	];
	for (const a of units)
		for (const b of units)
			for (const c of units) {
				const text = String.fromCharCode(a, b, c);
				expect(jsonStringBytes(text)).toBe(oracle(text));
			}
});
test("deterministic arbitrary Unicode, escape-heavy strings and long boundaries match JSON", () => {
	let state = 0x6d2b79f5;
	const next = () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return state >>> 0;
	};
	for (let sample = 0; sample < 3000; sample++) {
		let text = "";
		const length = next() % 256;
		for (let index = 0; index < length; index++)
			text += String.fromCharCode(next() & 0xffff);
		expect(jsonStringBytes(text)).toBe(oracle(text));
	}
	for (const text of [
		"",
		'"\\\b\f\n\r\t\0',
		"🙂🧪",
		`${"x".repeat(16383)}🙂`,
		`${"x".repeat(16384)}\ud800`,
		`\udc00${"x".repeat(65535)}`,
		'🙂"\\\t'.repeat(100000),
	])
		expect(jsonStringBytes(text)).toBe(oracle(text));
});
