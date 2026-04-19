type JsonObject = Record<string, unknown>;

export type StrictJsonObjectParseErrorKind =
	| "empty_payload"
	| "invalid_json_syntax"
	| "duplicate_json_key"
	| "non_object_payload"
	| "trailing_text"
	| "schema_validation_failed";

export type StrictJsonObjectParseResult =
	| { ok: true; value: JsonObject }
	| {
			ok: false;
			error: string;
			kind: StrictJsonObjectParseErrorKind;
	  };

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
	| { ok: false; error: string; kind: StrictJsonObjectParseErrorKind } {
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
	| { ok: false; error: string; kind: StrictJsonObjectParseErrorKind } {
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

export function parseStrictJsonObject(
	raw: string,
	label: string,
): StrictJsonObjectParseResult {
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
