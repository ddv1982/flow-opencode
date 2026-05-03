import {
	parseToolArgs,
	toJson,
} from "../../../runtime/application/workspace-runtime";
import { errorResponse } from "../../../runtime/errors";
import { InvalidFlowWorkspaceRootError } from "../../../runtime/workspace-root";
import type { ToolContext } from "./schemas";

type ParseSchema<T> = {
	parse: (input: unknown) => T;
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
