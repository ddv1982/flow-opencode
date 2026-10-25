import { appendFile } from "node:fs/promises";
import { Model, Plugin, Provider } from "@opencode/plugin";
import { z } from "zod";
import { isRecord } from "../../evals/host-observation.js";

const Options = z
	.object({ baseURL: z.string().url(), receipt: z.string().min(1) })
	.strict();

export default Plugin.define({
	id: "flow-v2-local-smoke",
	async setup(context) {
		const options = Options.parse(context.options);
		const url = new URL(options.baseURL);
		if (
			url.protocol !== "http:" ||
			url.hostname !== "127.0.0.1" ||
			!url.port ||
			url.username ||
			url.password
		)
			throw new Error("Smoke provider must be loopback HTTP.");
		const providerID = Provider.ID.make("flow-smoke");
		const id = Model.ID.make("catalog-model");
		const model = Model.Info.default(providerID, id);
		await context.provider.transform((editor) =>
			editor.add({
				info: {
					...Provider.Info.empty(providerID),
					name: "Local scripted smoke",
					activation: "enabled",
					package: "@opencode/ai/providers/openai-compatible",
					settings: { baseURL: options.baseURL },
				},
				models: [
					{
						...model,
						modelID: Model.ID.make("wire-model"),
						capabilities: { ...model.capabilities, tools: true },
					},
				],
			}),
		);
		await context.session.hook("title", (input) => {
			input.result = "Flow smoke";
		});
		await context.session.hook("compaction", (input) => {
			input.result = { summary: "Flow smoke compacted summary" };
		});
		await context.session.hook("http.request", (input) => {
			const requestURL = new URL(input.request.url);
			if (requestURL.origin !== url.origin)
				throw new Error("Smoke forbids nonloopback or foreign model requests.");
		});
		let sequence = 0;
		const record = (value: object) =>
			appendFile(
				options.receipt,
				`${JSON.stringify({ sequence: sequence++, time: Date.now(), ...value })}\n`,
			);
		const controller = new AbortController();
		const events = (async () => {
			try {
				for await (const event of context.event.subscribe({
					signal: controller.signal,
				})) {
					if (
						event.type === "shell.created" ||
						event.type === "shell.exited" ||
						event.type === "session.execution.failed" ||
						event.type === "session.step.failed"
					)
						await record({
							kind: "shell-event",
							type: event.type,
							data: event.data,
						});
				}
			} catch {
				if (!controller.signal.aborted)
					await record({ kind: "event-stream-failure" });
			}
		})();
		await context.tool.hook("execute.before", async (input) => {
			if (input.tool === "shell")
				await record({
					kind: "shell-before",
					sessionID: input.sessionID,
					messageID: input.messageID,
					callID: input.id,
					input: input.input,
				});
		});

		await context.tool.hook("execute.after", async (input) => {
			const output =
				input.status === "completed" && isRecord(input.result.output)
					? input.result.output
					: undefined;
			let application: unknown;
			if (input.tool.startsWith("flow_") && input.status === "completed") {
				const content = input.result.content;
				const text =
					typeof content === "string"
						? content
						: (content ?? [])
								.filter((item) => item.type === "text")
								.map((item) => item.text)
								.join("\n");
				try {
					const parsed: unknown = JSON.parse(text);
					if (isRecord(parsed))
						application = { status: parsed.status, summary: parsed.summary };
				} catch {}
			}

			await record({
				kind: "tool",
				application,
				tool: input.tool,
				sessionID: input.sessionID,
				messageID: input.messageID,
				callID: input.id,
				agent: input.agent,
				status: input.status,
				...(input.tool === "shell" && output
					? {
							output: {
								exit: output.exit,
								truncated: output.truncated,
								status: output.status,
								timeout: output.timeout,
								footer:
									typeof output.output === "string"
										? output.output.slice(-240)
										: undefined,
							},
						}
					: {}),
			});
		});

		await context.command.transform((editor) =>
			editor.add({
				name: "flow-smoke-inventory",
				description: "Record local smoke tool IDs",
				execute: async () => {
					await appendFile(
						options.receipt,
						`${JSON.stringify({ kind: "inventory", tools: (await context.tool.list()).map((tool) => tool.id).sort() })}\n`,
					);
				},
			}),
		);
		await appendFile(
			options.receipt,
			`${JSON.stringify({ kind: "setup", version: context.app.version, directory: context.location.directory })}\n`,
		);
		return async () => {
			controller.abort();
			await events;
			await appendFile(
				options.receipt,
				`${JSON.stringify({ kind: "cleanup" })}\n`,
			);
		};
	},
});
