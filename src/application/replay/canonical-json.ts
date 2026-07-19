export type CanonicalJsonValue =
	| null
	| boolean
	| number
	| string
	| readonly CanonicalJsonValue[]
	| { readonly [key: string]: CanonicalJsonValue };

/**
 * Locale-independent total order over distinct UTF-16 strings.
 *
 * `localeCompare` can return `0` for distinct Unicode strings (for example a
 * precomposed character and its decomposed sequence), which leaves object-key
 * ordering dependent on insertion order and the host locale. Comparing raw
 * UTF-16 code units yields a deterministic total order in which two keys are
 * equal only when they are the identical string, so distinct keys always order
 * identically regardless of insertion order or locale.
 */
function compareCanonicalKeys(left: string, right: string): number {
	const length = Math.min(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		const delta = left.charCodeAt(index) - right.charCodeAt(index);
		if (delta !== 0) return delta;
	}
	return left.length - right.length;
}

function canonicalize(value: CanonicalJsonValue): string {
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "string"
	) {
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
			throw new TypeError("Canonical replay JSON permits safe integers only.");
		}
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalize(item)).join(",")}]`;
	}
	const entries = Object.entries(value as Record<string, CanonicalJsonValue>)
		.sort(([left], [right]) => compareCanonicalKeys(left, right))
		.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
	return `{${entries.join(",")}}`;
}

/** Stable, whitespace-free JSON with recursively sorted object keys. */
export function canonicalizeReplayJson(value: CanonicalJsonValue): string {
	return canonicalize(value);
}

export const canonicalReplayJson = canonicalizeReplayJson;
