type StrictJsonObjectParseResult =
	| { ok: true; value: Record<string, unknown> }
	| { ok: false; error: string };

function findDuplicateKey(input: string): string | null {
	type Frame = { isObject: boolean; keys: Set<string>; awaitingKey: boolean };
	const stack: Frame[] = [];
	let index = 0;

	while (index < input.length) {
		const char = input[index];
		if (char === "{") {
			stack.push({ isObject: true, keys: new Set(), awaitingKey: true });
			index += 1;
			continue;
		}
		if (char === "[") {
			stack.push({ isObject: false, keys: new Set(), awaitingKey: false });
			index += 1;
			continue;
		}
		if (char === "}" || char === "]") {
			stack.pop();
			index += 1;
			continue;
		}
		if (char === ",") {
			const top = stack.at(-1);
			if (top?.isObject) top.awaitingKey = true;
			index += 1;
			continue;
		}
		if (char === ":") {
			const top = stack.at(-1);
			if (top?.isObject) top.awaitingKey = false;
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
				if (input[cursor] === '"') break;
				cursor += 1;
			}
			const top = stack.at(-1);
			if (top?.isObject && top.awaitingKey) {
				const key = JSON.parse(input.slice(index, cursor + 1)) as string;
				if (top.keys.has(key)) return key;
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
		return { ok: false, error: `${label} is empty.` };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		return {
			ok: false,
			error:
				error instanceof Error
					? `${label} is not valid JSON: ${error.message}`
					: `${label} is not valid JSON.`,
		};
	}

	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { ok: false, error: `${label} must be a JSON object.` };
	}

	const duplicate = findDuplicateKey(raw);
	if (duplicate) {
		return { ok: false, error: `${label} has duplicate key '${duplicate}'.` };
	}

	return { ok: true, value: parsed as Record<string, unknown> };
}
