import { expect } from "bun:test";
import type { OpenCodeClient } from "@opencode/client";
import { EvalHost } from "../../evals/harness.js";
import { listNativeMessages } from "../../evals/opencode-host.js";
import {
	generatedOutputTokens,
	normalizeStudyUsage,
} from "../../evals/study-usage.js";

export async function proveNativeUsage(
	client: OpenCodeClient,
	sessionID: string,
	project: string,
) {
	const native = (await listNativeMessages(client, sessionID)).find(
		(message) => message.type === "assistant",
	);
	expect(native?.tokens).toEqual({
		input: 10,
		output: 5,
		reasoning: 4,
		cache: { read: 3, write: 0 },
	});
	const reader: unknown = Reflect.construct(EvalHost, [project, project]);
	if (!(reader instanceof EvalHost))
		throw new Error("Could not create native usage reader");
	Reflect.set(reader, "nativeClient", client);
	const observed = await reader.outcome([sessionID], 1);
	const usage = normalizeStudyUsage({
		tokens: observed.tokens,
		costUsd: observed.costUsd,
		...(observed.usageAvailability
			? { availability: observed.usageAvailability }
			: {}),
	});
	expect(usage.tokens).toEqual({
		input: 10,
		output: 5,
		reasoning: 4,
		cacheRead: 3,
		cacheWrite: 0,
	});
	expect(
		Object.values(usage.tokens).reduce((total, count) => total + count, 0),
	).toBe(22);
	expect(generatedOutputTokens(usage)).toBe(9);
	return { nativeTokens: native?.tokens, usage };
}
