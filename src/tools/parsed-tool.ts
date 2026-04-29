import {
	errorResponse,
	InvalidFlowWorkspaceRootError,
	parseToolArgs,
	toJson,
} from "../runtime/application";
import { parseStrictJsonObject } from "../runtime/json/strict-object";
import type { ToolContext } from "./schemas";

type ParseSchema<T> = {
	parse: (input: unknown) => T;
};

type JsonTransportOptions<Transport, Payload> = {
	transportSchema: ParseSchema<Transport>;
	field: keyof Transport & string;
	payloadSchema: ParseSchema<Payload>;
	legacySchema?: ParseSchema<Payload>;
	messagePrefix?: string;
};

function workspaceErrorResponse(error: InvalidFlowWorkspaceRootError) {
	return toJson(
		errorResponse(error.summary, {
			workspaceRoot: error.details.root,
			workspace: error.details,
			remediation: error.remediation,
		}),
	);
}

function invalidJsonResponse(messagePrefix: string, field: string): string {
	return toJson(
		errorResponse(
			`${messagePrefix}: ${field}: Expected a valid JSON string payload.`,
		),
	);
}

export function parseJsonTransportArgs<Transport, Payload>(
	args: unknown,
	options: JsonTransportOptions<Transport, Payload>,
): { ok: true; value: Payload } | { ok: false; response: string } {
	const messagePrefix =
		options.messagePrefix ?? "Tool argument validation failed";
	const transportParsed = parseToolArgs(
		options.transportSchema,
		args,
		messagePrefix,
	);
	if (transportParsed.ok) {
		const rawJson = transportParsed.value[options.field];
		if (typeof rawJson !== "string") {
			return {
				ok: false,
				response: invalidJsonResponse(messagePrefix, options.field),
			};
		}

		const payload = parseStrictJsonObject(
			rawJson,
			`${options.field} JSON string`,
		);
		if (!payload.ok) {
			return {
				ok: false,
				response: invalidJsonResponse(messagePrefix, options.field),
			};
		}

		return parseToolArgs(options.payloadSchema, payload.value, messagePrefix);
	}

	if (options.legacySchema) {
		return parseToolArgs(options.legacySchema, args, messagePrefix);
	}

	return transportParsed;
}

export function withParsedArgs<T>(
	schema: ParseSchema<T>,
	run: (input: T, context: ToolContext) => Promise<string>,
): (args: unknown, context: ToolContext) => Promise<string> {
	return async (args, context) => {
		const parsed = parseToolArgs(schema, args);
		if (!parsed.ok) {
			return parsed.response;
		}

		try {
			return await run(parsed.value, context);
		} catch (error) {
			if (error instanceof InvalidFlowWorkspaceRootError) {
				return workspaceErrorResponse(error);
			}

			throw error;
		}
	};
}

export function withJsonTransportArgs<Transport, Payload>(
	options: JsonTransportOptions<Transport, Payload>,
	run: (input: Payload, context: ToolContext) => Promise<string>,
): (args: unknown, context: ToolContext) => Promise<string> {
	return async (args, context) => {
		const parsed = parseJsonTransportArgs(args, options);
		if (!parsed.ok) {
			return parsed.response;
		}

		try {
			return await run(parsed.value, context);
		} catch (error) {
			if (error instanceof InvalidFlowWorkspaceRootError) {
				return workspaceErrorResponse(error);
			}

			throw error;
		}
	};
}
