import {
	type FlowReviewRecordFeatureArgs,
	FlowReviewRecordFeatureArgsSchema,
	type FlowReviewRecordFinalArgs,
	FlowReviewRecordFinalArgsSchema,
	type WorkerResultArgs,
	WorkerResultArgsSchema,
} from "./schema";

type JsonObject = Record<string, unknown>;

type ParseErrorKind =
	| "empty_payload"
	| "invalid_json_syntax"
	| "duplicate_json_key"
	| "non_object_payload"
	| "trailing_text"
	| "schema_validation_failed";

type ParseResult =
	| { ok: true; value: JsonObject }
	| { ok: false; error: string; kind: ParseErrorKind };

function isWhitespace(char: string | undefined): boolean {
	return char === " " || char === "\n" || char === "\r" || char === "\t";
}

function skipWhitespace(input: string, start: number): number {
	let index = start;
	while (index < input.length && isWhitespace(input[index])) {
		index += 1;
	}
	return index;
}

function scanJsonString(
	input: string,
	start: number,
): { ok: true; end: number; value: string } | { ok: false; error: string } {
	if (input[start] !== '"') {
		return { ok: false, error: "Expected string." };
	}

	let index = start + 1;
	while (index < input.length) {
		const char = input[index];
		if (char === '"') {
			try {
				return {
					ok: true,
					end: index + 1,
					value: JSON.parse(input.slice(start, index + 1)) as string,
				};
			} catch {
				return { ok: false, error: "Invalid JSON string literal." };
			}
		}
		if (char === "\\") {
			index += 2;
			continue;
		}
		index += 1;
	}

	return { ok: false, error: "Unterminated JSON string literal." };
}

function scanJsonValue(
	input: string,
	start: number,
):
	| { ok: true; end: number }
	| { ok: false; error: string; kind: ParseErrorKind } {
	const index = skipWhitespace(input, start);
	const char = input[index];

	if (char === "{") {
		return scanJsonObject(input, index);
	}
	if (char === "[") {
		let cursor = skipWhitespace(input, index + 1);
		if (input[cursor] === "]") {
			return { ok: true, end: cursor + 1 };
		}
		while (cursor < input.length) {
			const value = scanJsonValue(input, cursor);
			if (!value.ok) {
				return value;
			}
			cursor = skipWhitespace(input, value.end);
			if (input[cursor] === ",") {
				cursor = skipWhitespace(input, cursor + 1);
				continue;
			}
			if (input[cursor] === "]") {
				return { ok: true, end: cursor + 1 };
			}
			return {
				ok: false,
				error: "Invalid JSON syntax inside array.",
				kind: "invalid_json_syntax",
			};
		}
		return {
			ok: false,
			error: "Unterminated JSON array.",
			kind: "invalid_json_syntax",
		};
	}
	if (char === '"') {
		const scanned = scanJsonString(input, index);
		return scanned.ok
			? { ok: true, end: scanned.end }
			: {
					ok: false,
					error: scanned.error,
					kind: "invalid_json_syntax",
				};
	}

	const primitiveMatch = input
		.slice(index)
		.match(/^(true|false|null|-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?)/);
	if (!primitiveMatch) {
		return {
			ok: false,
			error: "Invalid JSON value.",
			kind: "invalid_json_syntax",
		};
	}

	return { ok: true, end: index + primitiveMatch[0].length };
}

function scanJsonObject(
	input: string,
	start: number,
):
	| { ok: true; end: number }
	| { ok: false; error: string; kind: ParseErrorKind } {
	if (input[start] !== "{") {
		return {
			ok: false,
			error: "Expected JSON object.",
			kind: "non_object_payload",
		};
	}

	let index = skipWhitespace(input, start + 1);
	const seenKeys = new Set<string>();
	if (input[index] === "}") {
		return { ok: true, end: index + 1 };
	}

	while (index < input.length) {
		const key = scanJsonString(input, index);
		if (!key.ok) {
			return {
				ok: false,
				error: key.error,
				kind: "invalid_json_syntax",
			};
		}
		if (seenKeys.has(key.value)) {
			return {
				ok: false,
				error: `Duplicate JSON key '${key.value}'.`,
				kind: "duplicate_json_key",
			};
		}
		seenKeys.add(key.value);

		index = skipWhitespace(input, key.end);
		if (input[index] !== ":") {
			return {
				ok: false,
				error: "Expected ':' after object key.",
				kind: "invalid_json_syntax",
			};
		}

		const value = scanJsonValue(input, index + 1);
		if (!value.ok) {
			return value;
		}

		index = skipWhitespace(input, value.end);
		if (input[index] === ",") {
			index = skipWhitespace(input, index + 1);
			continue;
		}
		if (input[index] === "}") {
			return { ok: true, end: index + 1 };
		}
		return {
			ok: false,
			error: "Invalid JSON syntax inside object.",
			kind: "invalid_json_syntax",
		};
	}

	return {
		ok: false,
		error: "Unterminated JSON object.",
		kind: "invalid_json_syntax",
	};
}

function parseJsonObject(raw: string, label: string): ParseResult {
	if (raw.trim().length === 0) {
		return {
			ok: false,
			error: `${label} payload is empty.`,
			kind: "empty_payload",
		};
	}

	const start = skipWhitespace(raw, 0);
	if (raw[start] !== "{") {
		return {
			ok: false,
			error: `${label} payload must be a JSON object.`,
			kind: "non_object_payload",
		};
	}

	const scanned = scanJsonObject(raw, start);
	if (!scanned.ok) {
		return {
			ok: false,
			error: `${label} payload ${scanned.error}`,
			kind: scanned.kind,
		};
	}

	const trailingStart = skipWhitespace(raw, scanned.end);
	if (trailingStart !== raw.length) {
		return {
			ok: false,
			error: `${label} payload has trailing non-JSON text.`,
			kind: "trailing_text",
		};
	}

	const normalized = raw.slice(start, scanned.end);
	try {
		const parsed = JSON.parse(normalized);
		if (
			parsed === null ||
			typeof parsed !== "object" ||
			Array.isArray(parsed)
		) {
			return {
				ok: false,
				error: `${label} payload must be a JSON object.`,
				kind: "non_object_payload",
			};
		}

		return { ok: true, value: parsed as JsonObject };
	} catch (error) {
		return {
			ok: false,
			error:
				error instanceof Error
					? `${label} payload is not valid JSON: ${error.message}`
					: `${label} payload is not valid JSON.`,
			kind: "invalid_json_syntax",
		};
	}
}

export function parseStrictJsonObject(raw: string, label: string): ParseResult {
	return parseJsonObject(raw, label);
}

function normalizeStringList(value: unknown): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: undefined;
}

function normalizeObjectList(value: unknown): unknown[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	return Array.isArray(value)
		? value.filter(
				(item) =>
					item !== null && typeof item === "object" && !Array.isArray(item),
			)
		: undefined;
}

export function normalizeReviewerDecision(
	raw: string,
	scope: "feature" | "final",
	activeFeatureId?: string,
):
	| { ok: true; value: FlowReviewRecordFeatureArgs | FlowReviewRecordFinalArgs }
	| { ok: false; error: string; kind: ParseErrorKind } {
	const parsed = parseJsonObject(raw, "Reviewer");
	if (!parsed.ok) {
		return parsed;
	}

	const normalized = {
		scope,
		status: parsed.value.status,
		summary: parsed.value.summary,
		blockingFindings: normalizeObjectList(parsed.value.blockingFindings),
		followUps: normalizeObjectList(parsed.value.followUps),
		suggestedValidation: normalizeStringList(parsed.value.suggestedValidation),
		...(scope === "feature" ? { featureId: activeFeatureId } : {}),
	};

	const schema =
		scope === "feature"
			? FlowReviewRecordFeatureArgsSchema
			: FlowReviewRecordFinalArgsSchema;
	const result = schema.safeParse(normalized);
	if (!result.success) {
		const issue = result.error.issues[0];
		const path = issue?.path?.length ? issue.path.join(".") : "args";
		return {
			ok: false,
			error: `Reviewer payload failed normalization: ${path}: ${issue?.message ?? "Invalid value."}`,
			kind: "schema_validation_failed",
		};
	}

	return { ok: true, value: result.data };
}

export function normalizeWorkerResult(
	raw: string,
	activeFeatureId?: string,
):
	| { ok: true; value: WorkerResultArgs }
	| { ok: false; error: string; kind: ParseErrorKind } {
	const parsed = parseJsonObject(raw, "Worker");
	if (!parsed.ok) {
		return parsed;
	}

	const featureResult =
		parsed.value.featureResult &&
		typeof parsed.value.featureResult === "object" &&
		!Array.isArray(parsed.value.featureResult)
			? {
					...(parsed.value.featureResult as JsonObject),
					...(activeFeatureId ? { featureId: activeFeatureId } : {}),
				}
			: parsed.value.featureResult;

	const normalized = {
		contractVersion: parsed.value.contractVersion,
		status: parsed.value.status,
		summary: parsed.value.summary,
		artifactsChanged: normalizeObjectList(parsed.value.artifactsChanged),
		validationRun: normalizeObjectList(parsed.value.validationRun),
		validationScope: parsed.value.validationScope,
		reviewIterations: parsed.value.reviewIterations,
		decisions: normalizeObjectList(parsed.value.decisions),
		nextStep: parsed.value.nextStep,
		outcome: parsed.value.outcome,
		featureResult,
		featureReview: parsed.value.featureReview,
		finalReview: parsed.value.finalReview,
	};

	const result = WorkerResultArgsSchema.safeParse(normalized);
	if (!result.success) {
		const issue = result.error.issues[0];
		const path = issue?.path?.length ? issue.path.join(".") : "args";
		return {
			ok: false,
			error: `Worker payload failed normalization: ${path}: ${issue?.message ?? "Invalid value."}`,
			kind: "schema_validation_failed",
		};
	}

	return { ok: true, value: result.data };
}
