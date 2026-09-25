import { describe, expect, test } from "bun:test";
import {
	createJevBudget,
	JEV_ATTEMPT_RESERVATION_USD,
	requestJev,
} from "../src/infrastructure/jev-transport.js";

describe("bounded Jev transport", () => {
	test("an exact 300-call dollar cap admits all 300 reservations", () => {
		const cap = 300 * JEV_ATTEMPT_RESERVATION_USD;
		const budget = createJevBudget(300, cap);
		for (let index = 0; index < 300; index++)
			expect(budget.reserve()).toBe(true);
		expect(budget.reserve()).toBe(false);
		expect(budget.snapshot()).toMatchObject({
			calls: 300,
			reservedUsd: cap,
		});
	});
	test("retries transient responses at most three attempts and reserves each", async () => {
		let calls = 0;
		const budget = createJevBudget(9, 1);
		const result = await requestJev(
			{},
			{
				apiKey: "secret",
				budget,
				transport: async () => {
					calls++;
					return new Response("unavailable", {
						status: 529,
						headers: { "retry-after": "0" },
					});
				},
			},
		);
		expect(calls).toBe(3);
		expect(result.ok).toBe(false);
		expect(result.attempts).toBe(3);
		expect(budget.snapshot().reservedUsd).toBeCloseTo(
			JEV_ATTEMPT_RESERVATION_USD * 3,
		);
	});
	test("refuses attempt exceeding budget and does not retry authentication", async () => {
		let calls = 0;
		const options = {
			apiKey: "secret",
			transport: async () => {
				calls++;
				return new Response("secret", { status: 401 });
			},
		};
		const noBudget = await requestJev(
			{},
			{ ...options, budget: createJevBudget(3, 0.000001) },
		);
		expect(noBudget).toMatchObject({
			ok: false,
			reason: "budget",
			attempts: 0,
		});
		expect(calls).toBe(0);
		const auth = await requestJev(
			{},
			{ ...options, budget: createJevBudget(3, 1) },
		);
		expect(auth).toMatchObject({
			ok: false,
			reason: "http",
			status: 401,
			attempts: 1,
		});
		expect(calls).toBe(1);
		expect(JSON.stringify(auth)).not.toContain("secret");
	});
	test("deadline covers stalled headers and body even when test transport ignores abort", async () => {
		for (const transport of [
			async () => new Promise<Response>(() => {}),
			async () => new Response(new ReadableStream({ start() {} })),
		]) {
			const start = performance.now();
			const result = await requestJev(
				{},
				{
					apiKey: "secret",
					budget: createJevBudget(3, 1),
					timeoutMs: 20,
					transport,
				},
			);
			expect(result).toMatchObject({
				ok: false,
				reason: "timeout",
				attempts: 1,
			});
			expect(performance.now() - start).toBeLessThan(500);
		}
	});
	test("rejects oversized streaming body and request", async () => {
		const large = await requestJev(
			{},
			{
				apiKey: "secret",
				budget: createJevBudget(3, 1),
				transport: async () => new Response("x".repeat(128001)),
			},
		);
		expect(large).toMatchObject({ ok: false, reason: "oversize" });
		const request = await requestJev(
			{ text: "x".repeat(32001) },
			{
				apiKey: "secret",
				budget: createJevBudget(3, 1),
				transport: async () => {
					throw new Error("must not call");
				},
			},
		);
		expect(request).toMatchObject({
			ok: false,
			reason: "oversize",
			attempts: 0,
		});
	});
	test("pre-cancelled requests consume no budget", async () => {
		const controller = new AbortController();
		controller.abort();
		const budget = createJevBudget(3, 1);
		const result = await requestJev(
			{},
			{ apiKey: "secret", budget, signal: controller.signal },
		);
		expect(result).toMatchObject({
			ok: false,
			reason: "cancelled",
			attempts: 0,
		});
		expect(budget.snapshot().calls).toBe(0);
	});
});

test("HTTP-date backoff beyond deadline prevents another attempt", async () => {
	let calls = 0;
	const result = await requestJev(
		{},
		{
			apiKey: "secret",
			budget: createJevBudget(3, 1),
			timeoutMs: 30,
			transport: async () => {
				calls++;
				return new Response("limited", {
					status: 429,
					headers: {
						"retry-after": new Date(Date.now() + 60000).toUTCString(),
					},
				});
			},
		},
	);
	expect(result).toMatchObject({ ok: false, reason: "timeout", attempts: 1 });
	expect(calls).toBe(1);
});
