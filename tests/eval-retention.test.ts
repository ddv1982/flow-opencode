import { expect, test } from "bun:test";
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvalHost } from "../evals/harness.js";

test("shutdown retains the quiescent project once before deleting scratch and rejects late retention", async () => {
	const scratch = await mkdtemp(join(tmpdir(), "retention-check-"));
	const project = join(scratch, "project");
	await mkdir(project);
	await writeFile(join(project, "source"), "retained");
	const host: EvalHost = Reflect.construct(EvalHost, [project, scratch]);
	let captures = 0;
	host.retainProjectOnStop(async (path) => {
		captures += 1;
		expect(await readFile(join(path, "source"), "utf8")).toBe("retained");
	});
	await Promise.all([host.stop(), host.stop()]);
	expect(captures).toBe(1);
	await expect(access(scratch)).rejects.toThrow();
	expect(() => host.retainProjectOnStop(async () => {})).toThrow(
		"before shutdown",
	);
});

test("a retention failure preserves recoverable scratch and cannot be bypassed by a second stop", async () => {
	const scratch = await mkdtemp(join(tmpdir(), "retention-check-"));
	try {
		const project = join(scratch, "project");
		await mkdir(project);
		const host: EvalHost = Reflect.construct(EvalHost, [project, scratch]);
		host.retainProjectOnStop(async () => {
			throw new Error("retention failed");
		});
		await expect(host.stop()).rejects.toThrow("retention failed");
		await expect(host.stop()).rejects.toThrow("retention failed");
		await access(project);
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
});

test("credential synchronization failure still retains the stopped project and preserves scratch", async () => {
	const scratch = await mkdtemp(join(tmpdir(), "retention-check-"));
	try {
		const project = join(scratch, "project");
		await mkdir(project);
		const target = join(scratch, "invalid-credentials");
		await writeFile(target, "invalid-json");
		const host: EvalHost = Reflect.construct(EvalHost, [project, scratch]);
		Reflect.set(host, "credentialPaths", {
			source: join(scratch, "source-credentials"),
			target,
			snapshot: null,
		});
		let retained = false;
		host.retainProjectOnStop(async () => {
			retained = true;
		});
		await expect(host.stop()).rejects.toThrow("credentials are invalid");
		expect(retained).toBe(true);
		await access(project);
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
});

test("settles synchronous retention failure together with invalid credentials", async () => {
	const scratch = await mkdtemp(join(tmpdir(), "retention-check-"));
	try {
		const project = join(scratch, "project");
		await mkdir(project);
		const target = join(scratch, "invalid-credentials");
		await writeFile(target, "invalid-json");
		const host: EvalHost = Reflect.construct(EvalHost, [project, scratch]);
		Reflect.set(host, "credentialPaths", {
			source: join(scratch, "source-credentials"),
			target,
			snapshot: null,
		});
		const retentionFailure = new Error("synchronous retention failed");
		host.retainProjectOnStop(() => {
			throw retentionFailure;
		});
		const failure: unknown = await host.stop().catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(AggregateError);
		if (!(failure instanceof AggregateError))
			throw new Error("Expected both cleanup failures.");
		expect(failure.errors).toHaveLength(2);
		expect(failure.errors[0].message).toContain("credentials are invalid");
		expect(failure.errors[1]).toBe(retentionFailure);
		expect(await host.stop().catch((error: unknown) => error)).toBe(failure);
		await access(project);
		expect(await readFile(target, "utf8")).toBe("invalid-json");
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
});
