import { z } from "zod";
import { SimulationScriptSchema } from "./treatment.js";

const ToolOutput = z
	.object({
		workflowData: z
			.object({
				projection: z
					.object({
						sessionId: z.string(),
						revision: z.number(),
						blockedFeature: z.object({ featureId: z.string() }).nullable(),
						findingsDigest: z.unknown(),
					})
					.passthrough()
					.optional(),
				recovery: z.unknown().optional(),
			})
			.passthrough(),
	})
	.passthrough();
const Input = z
	.object({ type: z.string().optional(), output: z.unknown().optional() })
	.passthrough();
const ResetRequest = z
	.object({
		operationId: z.string(),
		expectedRevision: z.number(),
		featureId: z.string(),
		nextFeatureId: z.string(),
	})
	.strict();
const Recommended = z
	.object({
		recommended: z.object({
			kind: z.literal("feature-reset"),
			request: ResetRequest,
		}),
	})
	.passthrough();
const Finding = z
	.object({
		featureId: z.string(),
		findingId: z.string(),
		severity: z.enum(["blocking", "advisory"]),
		live: z.boolean(),
	})
	.passthrough();
export function createSimulationTransport(input: unknown) {
	const script = SimulationScriptSchema.parse(input);
	let managerCalls = 0;
	let jevCalls = 0;
	return async (request: Request): Promise<Response> => {
		const body = await request.json();
		const url = new URL(request.url);
		if (
			url.origin === "https://api.typesafe.ai" &&
			url.pathname === "/v1/systemone"
		) {
			if (script.kind === "operator-resume-v1")
				throw new Error("Unexpected Jev request in operator script.");
			if (++jevCalls !== 1) throw new Error("Simulation Jev script exhausted.");
			const parsed = z
				.object({
					model: z.literal("jev-1.13.0"),
					state: z.object({
						candidates: z.array(z.object({ id: z.string() })).length(1),
					}),
				})
				.parse(body);
			const candidate = parsed.state.candidates[0];
			if (!candidate) throw new Error("Missing simulation candidate.");
			if (script.kind === "guarded-reset-v1" && script.jevDelayMs)
				await Bun.sleep(script.jevDelayMs);
			return Response.json({
				model: "jev-1.13.0",
				answers: {
					choice: {
						type: "choice",
						choice: candidate.id,
						probabilities: { [candidate.id]: 1, abstain: 0 },
						confidence: 1,
					},
					goal_0: { type: "noul", noul: 1 },
					fit_0: {
						type: "noul",
						noul:
							script.kind === "recovery-operator-v1" ||
							script.outcome === "accepted"
								? 1
								: 0.5,
					},
				},
				usage: { input_tokens: 100, output_tokens: 10 },
			});
		}
		const model =
			url.href === "https://api.x.ai/v1/responses"
				? "grok-4.6"
				: url.href === "https://chatgpt.com/backend-api/codex/responses"
					? "gpt-5.6-terra"
					: null;
		if (!model) throw new Error("Unexpected simulation route.");
		const parsed = z
			.object({
				model: z.literal(model),
				input: z.array(Input),
				stream: z.literal(true),
				tools: z
					.array(z.object({ name: z.string().optional() }).passthrough())
					.optional(),
			})
			.parse(body);
		if (++managerCalls > (script.kind === "recovery-operator-v1" ? 12 : 8))
			throw new Error("Simulation manager script exhausted.");
		const combined = script.kind === "recovery-operator-v1";
		const calls = new Map(
			parsed.input
				.filter(
					(row) =>
						row.type === "function_call" && typeof row.call_id === "string",
				)
				.map((row) => [row.call_id, row]),
		);
		const completed = parsed.input.filter(
			(row) => row.type === "function_call_output" && calls.has(row.call_id),
		);
		const toolResults = parsed.input.filter(
			(row) =>
				row.type === "function_call_output" &&
				(!combined || calls.get(row.call_id)?.name === "flow_status"),
		);
		const reset = completed.find(
			(row) => calls.get(row.call_id)?.name === "flow_feature_reset",
		);
		const outputs = toolResults.flatMap((row) => {
			if (typeof row.output !== "string") return [];
			try {
				const result = ToolOutput.safeParse(JSON.parse(row.output));
				return result.success ? [result.data] : [];
			} catch {
				return [];
			}
		});
		const latest = outputs.at(-1);
		let tool: { name: string; arguments: unknown } | undefined;
		const hasFlowTools =
			parsed.tools?.some((tool) => tool.name === "flow_status") === true;
		const recommendation = Recommended.safeParse(latest?.workflowData.recovery);
		if (combined && reset) {
			const result =
				typeof reset.output === "string"
					? ToolOutput.parse(JSON.parse(reset.output))
					: null;
			const request = recommendation.success
				? recommendation.data.recommended.request
				: null;
			const call = calls.get(reset.call_id);
			const used = z
				.object({ request: ResetRequest })
				.parse(JSON.parse(String(call?.arguments)));
			if (JSON.stringify(used.request) !== JSON.stringify(request))
				throw new Error("Simulation reset differs from the observed grant.");
			if (
				!request ||
				result?.workflowData.projection?.revision !==
					request.expectedRevision + 1
			)
				throw new Error(
					"Simulation reset did not advance the granted revision.",
				);
		}
		if (
			hasFlowTools &&
			(script.kind === "operator-resume-v1" ||
				(combined &&
					toolResults.length >= 2 &&
					(!recommendation.success || reset)))
		) {
			const resumed = parsed.input.some(
				(row) =>
					row.role === "user" &&
					JSON.stringify(row.content).includes(
						"Write fixed followed by a newline.",
					),
			);
			const written = parsed.input.some(
				(row) => row.type === "function_call" && row.name === "bash",
			);
			if (!resumed)
				tool = {
					name: "question",
					arguments: {
						questions: [
							{
								question: "Which output should I write?",
								header: "Output",
								options: [
									{
										label: "Fixed",
										description: "Write the corrected output.",
									},
								],
							},
						],
					},
				};
			else if (!written)
				tool = {
					name: "bash",
					arguments: {
						command: combined
							? "printf '%s\\n' 'export const parse = (value: string | null) => value?.trim() ?? \"\";' > parser.ts && printf 'fixed\\n' > result.txt"
							: "printf 'fixed\\n' > result.txt",
						description: combined
							? "Repair the parser and write the operator selected result"
							: "Write the operator selected result",
					},
				};
		} else if (hasFlowTools && toolResults.length === 0)
			tool = {
				name: "flow_status",
				arguments: { request: { view: "detail" } },
			};
		else if (hasFlowTools && toolResults.length === 1) {
			const projection = latest?.workflowData.projection;
			const digest = z.array(Finding).safeParse(projection?.findingsDigest);
			if (!projection?.blockedFeature || !digest.success)
				throw new Error("Simulation requires blocked fixture findings.");
			const ids = [
				...new Set(
					digest.data
						.filter(
							(row) =>
								row.featureId === projection.blockedFeature?.featureId &&
								row.live &&
								row.severity === "blocking",
						)
						.map((row) => row.findingId),
				),
			];
			if (!ids.length || ids.length > 30)
				throw new Error("Simulation requires bounded live blockers.");
			tool = {
				name: "flow_status",
				arguments: {
					request: { view: "compact" },
					recoveryProposal: {
						id: "simulation-repair",
						sessionId: projection.sessionId,
						expectedRevision: projection.revision,
						candidates: [
							{
								id: "repair",
								action: "retry",
								featureId: projection.blockedFeature.featureId,
								remedy: "Guard null before parsing",
								changedFromPreviousAttempt:
									"Handle absent values instead of coercion",
								findingIds: ids,
							},
						],
					},
				},
			};
		} else if (hasFlowTools && toolResults.length === 2 && latest) {
			const result = Recommended.safeParse(latest.workflowData.recovery);
			if (result.success)
				tool = {
					name: "flow_feature_reset",
					arguments: { request: result.data.recommended.request },
				};
		}
		const id = `simulation-${managerCalls}`;
		const item = tool
			? {
					type: "function_call",
					id: `item-${managerCalls}`,
					call_id: `call-${managerCalls}`,
					name: tool.name,
					arguments: JSON.stringify(tool.arguments),
					status: "completed",
				}
			: {
					type: "message",
					id: `item-${managerCalls}`,
					role: "assistant",
					status: "completed",
					content: [
						{
							type: "output_text",
							text: "Simulation complete.",
							annotations: [],
						},
					],
				};
		const response = {
			id,
			object: "response",
			created_at: 0,
			status: "completed",
			model,
			output: [item],
			usage: {
				input_tokens: 100,
				output_tokens: 10,
				total_tokens: 110,
				input_tokens_details: { cached_tokens: 0 },
				output_tokens_details: { reasoning_tokens: 0 },
			},
			incomplete_details: null,
			error: null,
		};
		const events: Record<string, unknown>[] = [
			{
				type: "response.created",
				response: { ...response, status: "in_progress", output: [] },
			},
		];
		if (tool) {
			events.push(
				{
					type: "response.output_item.added",
					output_index: 0,
					item: { ...item, arguments: "", status: "in_progress" },
				},
				{
					type: "response.function_call_arguments.delta",
					output_index: 0,
					item_id: item.id,
					delta: JSON.stringify(tool.arguments),
				},
				{
					type: "response.function_call_arguments.done",
					output_index: 0,
					item_id: item.id,
					arguments: JSON.stringify(tool.arguments),
				},
			);
		} else {
			events.push(
				{
					type: "response.output_item.added",
					output_index: 0,
					item: { ...item, content: [], status: "in_progress" },
				},
				{
					type: "response.content_part.added",
					output_index: 0,
					content_index: 0,
					item_id: item.id,
					part: { type: "output_text", text: "", annotations: [] },
				},
				{
					type: "response.output_text.delta",
					output_index: 0,
					content_index: 0,
					item_id: item.id,
					delta: "Simulation complete.",
				},
				{
					type: "response.output_text.done",
					output_index: 0,
					content_index: 0,
					item_id: item.id,
					text: "Simulation complete.",
				},
			);
		}
		events.push(
			{ type: "response.output_item.done", output_index: 0, item },
			{ type: "response.completed", response },
		);
		return new Response(
			events
				.map(
					(event, sequence_number) =>
						`data: ${JSON.stringify({ ...event, sequence_number })}\n\n`,
				)
				.join(""),
			{ headers: { "content-type": "text/event-stream" } },
		);
	};
}
