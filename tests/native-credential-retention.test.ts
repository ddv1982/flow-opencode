import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CredentialEntry } from "@opencode/client";
import { EvalHost } from "../evals/harness.js";

for (const mode of [
	"idle",
	"active-reject",
	"wait-reject",
	"list-reject",
	"handoff-reject",
] as const) {
	test(`native credential shutdown preserves rotation through ${mode}`, async () => {
		const scratch = await mkdtemp(
			join(tmpdir(), "native-credential-retention-"),
		);
		const project = join(scratch, "project");
		await mkdir(project);
		const credential: CredentialEntry = {
			id: "credential_fixture",
			integrationID: "fixture",
			label: "Local test",
			active: true,
			value: { type: "key", key: "synthetic-before" },
		};
		const before: CredentialEntry[] = [credential];
		const after: CredentialEntry[] = [
			{ ...credential, value: { type: "key", key: "synthetic-after" } },
		];
		let listed = 0;
		let authenticationDisposed = 0;
		const delivered: unknown[] = [];
		const candidate: unknown = Reflect.construct(EvalHost, [project, scratch]);
		if (!(candidate instanceof EvalHost))
			throw new Error("Invalid native host fixture");
		Reflect.set(candidate, "nativeClient", {
			session: {
				active: async () => {
					if (mode === "active-reject")
						throw new Error("Native active query failed");
					return mode === "wait-reject"
						? { session_fixture: { type: "running" } }
						: {};
				},
				interrupt: async () => ({ interrupted: true }),
				wait: async () => {
					throw new Error("Native drain timed out");
				},
			},
			credential: {
				list: async () => {
					listed++;
					if (mode === "list-reject")
						throw new Error("Native credential export failed");
					return structuredClone(after);
				},
			},
		});
		Reflect.set(candidate, "credentialHandoff", {
			before,
			onStop: async (snapshot: unknown) => {
				delivered.push(snapshot);
				if (mode === "handoff-reject")
					throw new Error("Native credential handoff failed");
			},
		});
		Reflect.set(candidate, "nativeAuthSource", {
			dispose: async () => {
				authenticationDisposed++;
			},
		});
		try {
			if (mode === "idle") {
				await candidate.stop();
				await expect(access(scratch)).rejects.toThrow();
			} else {
				await expect(candidate.stop()).rejects.toThrow();
				await access(scratch);
			}
			expect(listed).toBe(1);
			expect(delivered).toEqual(
				mode === "list-reject" ? [] : [{ before, after }],
			);
			await candidate.stop().catch(() => {});
			expect(listed).toBe(1);
			expect(delivered).toHaveLength(mode === "list-reject" ? 0 : 1);
			expect(authenticationDisposed).toBe(1);
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});
}

test("native authentication closes after termination fails without retaining a live project", async () => {
	const scratch = await mkdtemp(join(tmpdir(), "native-auth-termination-"));
	const project = join(scratch, "project");
	await mkdir(project);
	const candidate: unknown = Reflect.construct(EvalHost, [project, scratch]);
	if (!(candidate instanceof EvalHost))
		throw new Error("Invalid native host fixture");
	let disposed = 0;
	let retained = 0;
	Reflect.set(candidate, "server", {
		get pid() {
			throw new Error("Native process identity unavailable");
		},
	});
	Reflect.set(candidate, "nativeAuthSource", {
		dispose: async () => {
			disposed++;
		},
	});
	candidate.retainProjectOnStop(async () => {
		retained++;
	});
	try {
		await expect(candidate.stop()).rejects.toThrow(
			"Native process identity unavailable",
		);
		await candidate.stop().catch(() => {});
		expect(disposed).toBe(1);
		expect(retained).toBe(0);
		await access(scratch);
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
});
