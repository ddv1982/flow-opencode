import { isRecord } from "../../evals/host-observation.js";

export function localScriptedProvider() {
	const requests: { model: unknown; tools: string[]; scenario: string }[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const body: unknown = await request.json();
			if (!isRecord(body) || !Array.isArray(body.messages))
				return new Response("Invalid local request", { status: 400 });
			const messages = body.messages.filter(isRecord);
			const latestUser = messages.findLast(
				(message) => message.role === "user",
			);
			const text =
				typeof latestUser?.content === "string"
					? latestUser.content
					: JSON.stringify(latestUser?.content);
			const tools = Array.isArray(body.tools)
				? body.tools
						.filter(isRecord)
						.flatMap((tool) =>
							isRecord(tool.function) && typeof tool.function.name === "string"
								? [tool.function.name]
								: [],
						)
				: [];
			requests.push({
				model: body.model,
				tools,
				scenario: text?.includes("FLOW_SMOKE_QUIET")
					? "quiet"
					: text?.includes("FLOW_SMOKE_RETRY")
						? "retry"
						: text?.includes("FLOW_SMOKE_PROVIDER_ERROR")
							? "error"
							: text?.includes("FLOW_SMOKE_DELAY")
								? "delay"
								: text?.includes("FLOW_SMOKE_ACTIONS")
									? "actions"
									: "plain",
			});
			if (
				text?.includes("FLOW_SMOKE_RETRY") &&
				requests.filter((entry) => entry.scenario === "retry").length === 2
			)
				return Response.json(
					{ error: { message: "Local transient error" } },
					{ status: 503 },
				);
			if (
				text?.includes("FLOW_SMOKE_QUIET") &&
				requests.filter((entry) => entry.scenario === "quiet").length === 2
			)
				await Bun.sleep(6000);
			if (text?.includes("FLOW_SMOKE_PROVIDER_ERROR"))
				return Response.json(
					{ error: { message: "Local scripted provider error" } },
					{ status: 400 },
				);
			const actions: unknown = JSON.parse(
				text?.match(/FLOW_SMOKE_ACTIONS (\[.*\])/s)?.[1] ?? "[]",
			);
			if (
				!Array.isArray(actions) ||
				actions.some(
					(action) =>
						!isRecord(action) ||
						typeof action.tool !== "string" ||
						!isRecord(action.input),
				)
			)
				return new Response("Invalid local actions", { status: 400 });
			const userIndex = messages.findLastIndex(
				(message) => message.role === "user",
			);
			const consumed = messages
				.slice(userIndex + 1)
				.reduce(
					(total, message) =>
						total +
						(Array.isArray(message.tool_calls) ? message.tool_calls.length : 0),
					0,
				);
			const next = actions.filter(isRecord)[consumed];
			const calls = next
				? [
						{
							index: 0,
							id: `call_smoke_${consumed}`,
							type: "function",
							function: {
								name: next.tool,
								arguments: JSON.stringify(next.input),
							},
						},
					]
				: [];
			const base = {
				id: "chatcmpl-local-smoke",
				object: "chat.completion.chunk",
				created: 1,
				model: "wire-model",
			};
			const encoder = new TextEncoder();
			const chunk = (delta: unknown, finish_reason: string | null = null) =>
				encoder.encode(
					`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
				);
			let cancelled = false;
			return new Response(
				new ReadableStream<Uint8Array>({
					async start(controller) {
						controller.enqueue(
							chunk({
								role: "assistant",
								content: text?.includes("FLOW_SMOKE_DELAY")
									? "Local request started "
									: "",
							}),
						);
						if (text?.includes("FLOW_SMOKE_DELAY")) await Bun.sleep(1000);
						if (cancelled) return;
						controller.enqueue(
							chunk(
								calls.length
									? { tool_calls: calls }
									: { content: "Local smoke complete" },
							),
						);
						controller.enqueue(chunk({}, calls.length ? "tool_calls" : "stop"));
						controller.enqueue(
							encoder.encode(
								`data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 13, completion_tokens: 9, total_tokens: 22, prompt_tokens_details: { cached_tokens: 3 }, completion_tokens_details: { reasoning_tokens: 4 } } })}\n\ndata: [DONE]\n\n`,
							),
						);
						controller.close();
					},
					cancel() {
						cancelled = true;
					},
				}),
				{ headers: { "content-type": "text/event-stream" } },
			);
		},
	});
	return { server, requests, baseURL: new URL("v1", server.url).href };
}
