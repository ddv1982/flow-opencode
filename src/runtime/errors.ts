import type { RuntimeToolResponse } from "./application";

export function errorResponse(
	summary: string,
	extra?: RuntimeToolResponse,
): RuntimeToolResponse {
	return {
		status: "error",
		summary,
		...(extra ?? {}),
	};
}
