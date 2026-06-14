type JsonObject = Record<string, unknown>;

type StrictJsonObjectParseErrorKind =
	| "empty_payload"
	| "invalid_json_syntax"
	| "duplicate_json_key"
	| "non_object_payload";

type StrictJsonObjectParseResult =
	| { ok: true; value: JsonObject }
	| {
			ok: false;
			error: string;
			kind: StrictJsonObjectParseErrorKind;
	  };

/**
 * Scan the raw payload for a duplicate key within any single object scope.
 *
 * JSON.parse validates syntax and trailing text for us, but it silently keeps
 * the last value when a key repeats. We reject duplicate keys outright because
 * a session file with repeated keys is a tamper/corruption signal, so we need
 * this focused pass in addition to JSON.parse. Only structural characters and
 * string literals matter here; every other character (whitespace, primitives)
 * is skipped one char at a time, which is why this stays small.
 */
function findDuplicateKey(input: string): string | null {
	type Frame = { object: boolean; keys: Set<string>; awaitingKey: boolean };
	const stack: Frame[] = [];
	let index = 0;

	while (index < input.length) {
		const char = input[index];

		if (char === "{") {
			stack.push({ object: true, keys: new Set(), awaitingKey: true });
			index += 1;
			continue;
		}
		if (char === "[") {
			stack.push({ object: false, keys: new Set(), awaitingKey: false });
			index += 1;
			continue;
		}
		if (char === "}" || char === "]") {
			stack.pop();
			index += 1;
			continue;
		}
		if (char === ",") {
			const top = stack[stack.length - 1];
			if (top?.object) {
				top.awaitingKey = true;
			}
			index += 1;
			continue;
		}
		if (char === ":") {
			const top = stack[stack.length - 1];
			if (top?.object) {
				top.awaitingKey = false;
			}
			index += 1;
			continue;
		}
		if (char === '"') {
			let cursor = index + 1;
			while (cursor < input.length) {
				if (input[cursor] === "\\") {
					cursor += 2;
					continue;
				}
				if (input[cursor] === '"') {
					break;
				}
				cursor += 1;
			}
			const top = stack[stack.length - 1];
			if (top?.object && top.awaitingKey) {
				const key = JSON.parse(input.slice(index, cursor + 1)) as string;
				if (top.keys.has(key)) {
					return key;
				}
				top.keys.add(key);
			}
			index = cursor + 1;
			continue;
		}

		index += 1;
	}

	return null;
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

	let parsed: unknown;
	try {
		// JSON.parse rejects syntax errors and any trailing non-whitespace text.
		parsed = JSON.parse(raw);
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

	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return {
			ok: false,
			error: `${label} payload must be a JSON object.`,
			kind: "non_object_payload",
		};
	}

	const duplicate = findDuplicateKey(raw);
	if (duplicate !== null) {
		return {
			ok: false,
			error: `${label} payload has a Duplicate JSON key '${duplicate}'.`,
			kind: "duplicate_json_key",
		};
	}

	return { ok: true, value: parsed as JsonObject };
}
