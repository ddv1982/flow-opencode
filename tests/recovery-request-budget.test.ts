import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	cancelRequestBudget,
	createRequestBudget,
	RequestAuthorizationSchema,
	requestBudgetStatus,
	reserveRequest,
} from "../evals/recovery-decisions/request-budget.js";
import { createRequestGate } from "../evals/recovery-decisions/request-gate.js";
import { datasetDigest } from "../evals/recovery-decisions/schema.js";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});
async function fixture(maxRequests = 5, maxMicroUsd = 25000) {
	const root = await mkdtemp(join(tmpdir(), "request-budget-"));
	roots.push(root);
	const directory = join(root, "budget");
	const authorization = await createRequestBudget(directory, {
		schemaVersion: 1,
		origin: "simulation",
		purpose: "offline test",
		maxRequests,
		maxMicroUsd,
		expiresAt: new Date(Date.now() + 60000).toISOString(),
		models: ["openai/gpt-5.6-terra", "xai/grok-4.6", "typesafe/jev-1.13.0"].map(
			(model) => ({
				model,
				reservationMicroUsd: 5000,
				basis: { kind: "simulation" },
			}),
		),
	});
	return {
		directory,
		authorizationDigest: datasetDigest(authorization),
		authorization,
		root,
	};
}
const request = (
	url = "https://api.x.ai/v1/chat/completions",
	model = "grok-4.6",
) =>
	new Request(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: "Bearer never-retain-this",
		},
		body: JSON.stringify({
			model,
			messages: [{ role: "user", content: "private task text" }],
		}),
	});

test("shared integer-dollar limit survives concurrent clients and reopening", async () => {
	const f = await fixture(10, 15000);
	const settled = await Promise.allSettled(
		Array.from({ length: 12 }, (_, i) =>
			reserveRequest(
				f.directory,
				i % 2 ? "openai/gpt-5.6-terra" : "xai/grok-4.6",
				f.authorizationDigest,
			),
		),
	);
	expect(settled.filter((row) => row.status === "fulfilled")).toHaveLength(3);
	expect(await requestBudgetStatus(f.directory)).toMatchObject({
		consumed: 3,
		reservedMicroUsd: 15000,
	});
	await expect(
		reserveRequest(f.directory, "typesafe/jev-1.13.0", f.authorizationDigest),
	).rejects.toThrow("exhausted");
	await expect(
		createRequestBudget(f.directory, f.authorization),
	).rejects.toThrow();
});

test("every forwarded retry is reserved before dispatch and failures do not refund", async () => {
	const f = await fixture(2);
	let sent = 0;
	const gate = createRequestGate({
		...f,
		transport: async (req) => {
			sent++;
			expect((await requestBudgetStatus(f.directory)).consumed).toBe(sent);
			expect(req.redirect).toBe("error");
			expect(req.headers.get("authorization")).toBe("Bearer never-retain-this");
			return new Response("retry", { status: 503 });
		},
	});
	await gate(request());
	await gate(request());
	await expect(gate(request())).rejects.toThrow("exhausted");
	expect(sent).toBe(2);
	const receipt = await readFile(
		join(f.directory, "request-000000.json"),
		"utf8",
	);
	expect(receipt).not.toContain("never-retain");
	expect(receipt).not.toContain("private task");
});

test("unknown models routes hosted tools and oversized bodies never reach transport", async () => {
	const f = await fixture();
	let sent = 0;
	const gate = createRequestGate({
		...f,
		transport: async () => {
			sent++;
			return new Response();
		},
	});
	for (const invalid of [
		request("https://api.x.ai/v1/chat/completions?redirect=other"),
		request("https://api.openai.com/v1/responses", "gpt-5.6-terra"),
		request("https://chatgpt.com/backend-api/codex/responses", "gpt-5.6-sol"),
		new Request("https://api.x.ai/v1/responses", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: "grok-4.6",
				tools: [{ type: "web_search" }],
			}),
		}),
		new Request("https://api.x.ai/v1/responses", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ model: "grok-4.6", input: "x".repeat(2_000_001) }),
		}),
	])
		await expect(gate(invalid)).rejects.toThrow();
	expect(sent).toBe(0);
	expect((await requestBudgetStatus(f.directory)).consumed).toBe(0);
});

test("both OAuth routes and Jev share the same request ceiling", async () => {
	const f = await fixture(3);
	const gate = createRequestGate({
		...f,
		transport: async () => new Response("ok"),
	});
	await gate(
		request("https://chatgpt.com/backend-api/codex/responses", "gpt-5.6-terra"),
	);
	await gate(request("https://api.x.ai/v1/responses"));
	await gate(request("https://api.typesafe.ai/v1/systemone", "jev-1.13.0"));
	await expect(gate(request())).rejects.toThrow();
	expect((await requestBudgetStatus(f.directory)).reservedMicroUsd).toBe(15000);
});

test("cancellation expiry changed authority and write failure cannot dispatch", async () => {
	const f = await fixture();
	let sent = 0;
	const gate = createRequestGate({
		...f,
		transport: async () => {
			sent++;
			throw new Error("secret transport failure");
		},
	});
	await expect(
		gate(request(), { signal: AbortSignal.abort() }),
	).rejects.toThrow();
	expect(sent).toBe(0);
	await expect(gate(request())).rejects.toThrow("reservation remains consumed");
	expect((await requestBudgetStatus(f.directory)).consumed).toBe(1);
	await cancelRequestBudget(f.directory);
	await cancelRequestBudget(f.directory);
	await expect(gate(request())).rejects.toThrow("ended");
	expect(sent).toBe(1);
	const other = await fixture();
	const changed = { ...other.authorization, expiresAt: "2020-01-01T00:00:00Z" };
	await writeFile(
		join(other.directory, "authorization.json"),
		JSON.stringify(changed),
	);
	await expect(
		reserveRequest(other.directory, "xai/grok-4.6", other.authorizationDigest),
	).rejects.toThrow("changed");
	await expect(
		reserveRequest(other.directory, "xai/grok-4.6", datasetDigest(changed)),
	).rejects.toThrow("ended");
	const broken = await fixture();
	await writeFile(join(broken.directory, "request-000000.json"), "truncated");
	await expect(
		createRequestGate({
			...broken,
			transport: async () => {
				sent++;
				return new Response();
			},
		})(request()),
	).rejects.toThrow();
	expect(sent).toBe(1);
});

test("live authorization cannot mistake simulation reservations for reviewed billing bounds", async () => {
	const f = await fixture();
	expect(
		RequestAuthorizationSchema.safeParse({ ...f.authorization, origin: "live" })
			.success,
	).toBe(false);
	expect(
		RequestAuthorizationSchema.safeParse({ ...f.authorization, maxMicroUsd: 0 })
			.success,
	).toBe(false);
	expect(
		RequestAuthorizationSchema.safeParse({
			...f.authorization,
			maxMicroUsd: 1.5,
		}).success,
	).toBe(false);
});

test("separate processes contend for a single immutable request slot", async () => {
	const f = await fixture(1);
	const module = join(
		process.cwd(),
		"evals/recovery-decisions/request-budget.ts",
	);
	const script = `import {reserveRequest} from ${JSON.stringify(module)}; try {await reserveRequest(${JSON.stringify(f.directory)},"xai/grok-4.6",${JSON.stringify(f.authorizationDigest)});} catch {process.exitCode=2;}`;
	const workers = Array.from({ length: 4 }, () =>
		Bun.spawn([process.execPath, "-e", script], {
			stdout: "pipe",
			stderr: "pipe",
		}),
	);
	const codes = await Promise.all(workers.map((worker) => worker.exited));
	expect(codes.sort()).toEqual([0, 2, 2, 2]);
	expect((await requestBudgetStatus(f.directory)).consumed).toBe(1);
});

test("request budget CLI requires explicit caps, refuses overwrite and durably cancels", async () => {
	const f = await fixture();
	const spec = join(f.root, "spec.json"),
		output = join(f.root, "cli-budget");
	await writeFile(spec, JSON.stringify(f.authorization));
	const run = async (...args: string[]) => {
		const child = Bun.spawn(
			[process.execPath, "evals/recovery-decisions/run.ts", ...args],
			{ stdout: "pipe", stderr: "pipe" },
		);
		return child.exited;
	};
	expect(await run("request-budget-create", spec, output)).toBe(0);
	expect(await run("request-budget-create", spec, output)).toBe(2);
	expect(await run("request-budget-cancel", output)).toBe(0);
	expect((await requestBudgetStatus(output)).cancelled).toBe(true);
	await expect(
		reserveRequest(output, "xai/grok-4.6", f.authorizationDigest),
	).rejects.toThrow("ended");
});

test("control traffic cannot exempt a remote provider and legacy paid features are refused", async () => {
	const f = await fixture();
	let sent = 0;
	const transport = async () => {
		sent++;
		return new Response();
	};
	expect(() =>
		createRequestGate({ ...f, transport, controlOrigin: "https://api.x.ai" }),
	).toThrow("loopback");
	const gate = createRequestGate({
		...f,
		transport,
		controlOrigin: "http://127.0.0.1:12345",
	});
	await gate("http://127.0.0.1:12345/session");
	for (const feature of [
		{ search_parameters: { mode: "auto" } },
		{ n: 2 },
		{ background: true },
		{ service_tier: "priority" },
	]) {
		await expect(
			gate("https://api.x.ai/v1/responses", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ model: "grok-4.6", ...feature }),
			}),
		).rejects.toThrow("paid request features");
	}
	expect(sent).toBe(1);
	expect((await requestBudgetStatus(f.directory)).consumed).toBe(0);
});
