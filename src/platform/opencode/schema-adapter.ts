import { z } from "zod";
import {
	type ToolContext,
	type ToolDefinition,
	type ToolResult,
	tool,
} from "./sdk.js";

type RequestSchema = z.ZodObject<{ request: z.ZodType }>;
type HostShape = NonNullable<Parameters<typeof tool.schema.object>[0]>;

/** Bridges OpenCode's type-incompatible Zod minor and verifies both parsers. */
function witness(schema: z.core.JSONSchema.BaseSchema): unknown {
	if (schema.const !== undefined) return schema.const;
	if (schema.enum?.[0] !== undefined) return schema.enum[0];
	const branch = schema.anyOf?.[0] ?? schema.oneOf?.[0];
	if (branch) return witness(branch);
	if (schema.type === "object") {
		return Object.fromEntries(
			(schema.required ?? []).map((name) => {
				const child = schema.properties?.[name];
				return [name, witness(typeof child === "object" ? child : {})];
			}),
		);
	}
	if (schema.type === "array") {
		const child = Array.isArray(schema.items) ? schema.items[0] : schema.items;
		if (!child || typeof child === "boolean") return [];
		return Array.from({ length: schema.minItems ?? 0 }, () => witness(child));
	}
	if (schema.type === "number" || schema.type === "integer")
		return schema.minimum ?? 0;
	if (schema.type === "boolean") return false;
	if (schema.type === "null") return null;
	return "w";
}

function hostShape(schema: RequestSchema): HostShape {
	const shape = schema.shape as unknown as HostShape;
	const hostSchema = tool.schema.object(shape);
	const sample = witness(
		z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }),
	);
	const application = schema.safeParse(sample);
	const hostResult = hostSchema.safeParse(sample);
	if (
		!application.success ||
		!hostResult.success ||
		JSON.stringify(application.data) !== JSON.stringify(hostResult.data)
	) {
		throw new Error("Flow and OpenCode schemas disagree.");
	}
	tool.schema.toJSONSchema(hostSchema);
	return shape;
}

export function defineFlowTool<Schema extends RequestSchema>(input: {
	description: string;
	schema: Schema;
	execute: (args: z.infer<Schema>, context: ToolContext) => Promise<ToolResult>;
}): ToolDefinition {
	return tool({
		description: input.description,
		args: hostShape(input.schema),
		execute: async (args, context) =>
			input.execute(input.schema.parse(args), context),
	});
}
