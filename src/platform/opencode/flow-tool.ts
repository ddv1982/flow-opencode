import { z } from "zod";

export type FlowToolContext = Readonly<{
	sessionID: string;
	messageID: string;
	callID: string;
	agent: string;
	directory: string;
	abort: AbortSignal;
	assertCurrent?: (() => Promise<void>) | undefined;
}>;

export type FlowToolResponse = Readonly<{
	status: "ok" | "error";
	summary: string;
	workflowData: object;
}>;

export type FlowToolValue = FlowToolResponse | string;
type FlowToolDefinition = Readonly<{
	description: string;
	input: z.core.JSONSchema.JSONSchema;
	execute(input: unknown, context: FlowToolContext): Promise<FlowToolValue>;
}>;
export type FlowTools = Readonly<Record<string, FlowToolDefinition>>;

export function defineFlowTool<Schema extends z.ZodType>(input: {
	description: string;
	schema: Schema;
	execute: (
		args: z.output<Schema>,
		context: FlowToolContext,
	) => Promise<FlowToolValue>;
}): FlowToolDefinition {
	return {
		description: input.description,
		input: z.toJSONSchema(input.schema, { io: "input" }),
		execute: (args, context) =>
			input.execute(input.schema.parse(args), context),
	};
}
