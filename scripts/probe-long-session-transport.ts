#!/usr/bin/env bun
import { createServer, request } from "node:http";
import { postSessionJson } from "../evals/harness.js";

type ProbeResult = {
	readonly client: "fetch" | "postSessionJson" | "node:http";
	readonly result: "ok" | "error";
	readonly elapsedMs: number;
	readonly errorName?: string;
	readonly errorMessage?: string;
};

function delayMs(argv: readonly string[]): number {
	const index = argv.indexOf("--delay-ms");
	const value = index >= 0 ? Number(argv[index + 1]) : 310_000;
	if (!Number.isSafeInteger(value) || value < 1 || value > 20 * 60_000) {
		throw new Error("--delay-ms must be an integer from 1 through 1200000.");
	}
	return value;
}

function failure(
	client: ProbeResult["client"],
	started: number,
	error: unknown,
): ProbeResult {
	return {
		client,
		result: "error",
		elapsedMs: Date.now() - started,
		errorName: error instanceof Error ? error.name : "unknown",
		errorMessage: error instanceof Error ? error.message : String(error),
	};
}

async function fetchProbe(url: string): Promise<ProbeResult> {
	const started = Date.now();
	try {
		const response = await fetch(url, {
			method: "POST",
			body: "{}",
			signal: new AbortController().signal,
		});
		await response.text();
		return { client: "fetch", result: "ok", elapsedMs: Date.now() - started };
	} catch (error) {
		return failure("fetch", started, error);
	}
}

async function sessionProbe(url: string): Promise<ProbeResult> {
	const started = Date.now();
	try {
		await postSessionJson(
			url,
			{},
			{
				signal: new AbortController().signal,
			},
		);
		return {
			client: "postSessionJson",
			result: "ok",
			elapsedMs: Date.now() - started,
		};
	} catch (error) {
		return failure("postSessionJson", started, error);
	}
}

async function nodeHttpProbe(url: string): Promise<ProbeResult> {
	const started = Date.now();
	return new Promise((resolve) => {
		const outgoing = request(url, { method: "POST" }, (response) => {
			response.resume();
			response.on("end", () =>
				resolve({
					client: "node:http",
					result: "ok",
					elapsedMs: Date.now() - started,
				}),
			);
		});
		outgoing.setTimeout(0);
		outgoing.on("error", (error) =>
			resolve(failure("node:http", started, error)),
		);
		outgoing.end("{}");
	});
}

const waitMs = delayMs(process.argv.slice(2));
const server = createServer((_request, response) => {
	setTimeout(() => {
		response.writeHead(200, { "content-type": "application/json" });
		response.end("{}");
	}, waitMs);
});

await new Promise<void>((resolve, reject) => {
	server.once("error", reject);
	server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("No probe port.");
const url = `http://127.0.0.1:${address.port}/slow`;
const results = await Promise.all([
	fetchProbe(url),
	sessionProbe(url),
	nodeHttpProbe(url),
]);
console.log(JSON.stringify({ delayMs: waitMs, results }, null, 2));
server.closeAllConnections();
await new Promise<void>((resolve) => server.close(() => resolve()));
