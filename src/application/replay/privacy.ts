const FORBIDDEN_KEY_PATTERN =
	/(?:secret|token|password|passwd|credential|authorization|cookie|api[_-]?key|private[_-]?key|environment|env(?:ironment)?[_-]?value|prompt|reasoning|transcript|finding|command|argument|argv|stdout|stderr|tool[_-]?(?:input|output|result)|raw[_-]?(?:input|output|payload)|^(?:input|output|result|path)$|path$)/i;

const SECRET_VALUE_PATTERNS = [
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
	/\b(?:sk|pk)-[a-zA-Z0-9_-]{16,}\b/,
	/\bgh[pousr]_[a-zA-Z0-9]{20,}\b/,
	/\bAKIA[0-9A-Z]{16}\b/,
	/\bxox[baprs]-[a-zA-Z0-9-]{10,}\b/,
	/\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/,
	/\bBearer\s+[a-zA-Z0-9._~+/-]+=*\b/i,
	/\b(?:api[_-]?key|password|secret)\s*[:=]\s*\S+/i,
	/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\//i,
] as const;

const ABSOLUTE_PATH_PATTERNS = [
	/^\/(?!\/)/,
	/[A-Za-z]:\\(?:[^\\\s]+\\)*/,
] as const;

const APPROVED_SENSITIVE_KEY_PATTERN =
	/^(?:findingFingerprints|findingCount|previousFindingCount|currentFindingCount|duplicateFindingCount|inputTokenCount|cacheReadTokenCount|outputTokenCount|promptCharacterCount)$/;

export type ReplayPrivacyValidation =
	| { readonly safe: true; readonly violations: readonly [] }
	| { readonly safe: false; readonly violations: readonly string[] };

export class ReplayPrivacyError extends Error {
	readonly code = "replay_privacy_violation";
	readonly violations: readonly string[];

	constructor(violations: readonly string[]) {
		super("Replay fixture failed the privacy allowlist.");
		this.name = "ReplayPrivacyError";
		this.violations = violations;
	}
}

function scanValue(
	value: unknown,
	location: string,
	violations: string[],
	seen: Set<object>,
): void {
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "number"
	) {
		return;
	}
	if (typeof value === "string") {
		if (
			SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value)) ||
			ABSOLUTE_PATH_PATTERNS.some((pattern) => pattern.test(value))
		) {
			violations.push(location);
		}
		return;
	}
	if (typeof value !== "object") {
		violations.push(location);
		return;
	}
	if (seen.has(value)) {
		violations.push(location);
		return;
	}
	seen.add(value);
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			scanValue(item, `${location}[${index}]`, violations, seen);
		}
	} else {
		const prototype = Object.getPrototypeOf(value) as object | null;
		if (prototype !== Object.prototype && prototype !== null) {
			violations.push(location);
		} else {
			for (const [key, item] of Object.entries(value)) {
				const childLocation = `${location}.${key}`;
				if (
					FORBIDDEN_KEY_PATTERN.test(key) &&
					!APPROVED_SENSITIVE_KEY_PATTERN.test(key)
				) {
					violations.push(childLocation);
				}
				scanValue(item, childLocation, violations, seen);
			}
		}
	}
	seen.delete(value);
}

/** Scans any raw value without trusting its schema or object prototype. */
export function validateReplayFixturePrivacy(
	raw: unknown,
): ReplayPrivacyValidation {
	const violations: string[] = [];
	scanValue(raw, "$", violations, new Set<object>());
	const uniqueViolations = [...new Set(violations)].sort();
	if (uniqueViolations.length > 0) {
		return { safe: false, violations: uniqueViolations };
	}
	return { safe: true, violations: [] };
}
