export type ValidationCommandClass =
	| "test"
	| "typecheck"
	| "lint"
	| "build"
	| "format"
	| "smoke"
	| "other";

/**
 * Classify a validation command for evidence matching.
 *
 * Precedence is intentional and preserves the classifier contract previously
 * exposed at the application boundary.
 */
export function validationCommandClass(
	command: string,
): ValidationCommandClass {
	const normalized = command.trim().toLowerCase();
	if (/\b(typecheck|tsc|swiftc\s+-typecheck)\b/.test(normalized)) {
		return "typecheck";
	}
	if (/\b(format|prettier)\b/.test(normalized)) return "format";
	if (/\b(lint|eslint|biome\s+check)\b/.test(normalized)) return "lint";
	if (/\b(build|compile|xcodebuild)\b/.test(normalized)) return "build";
	if (/\b(smoke)\b/.test(normalized)) return "smoke";
	if (/\b(test|vitest|jest|pytest|swift\s+test)\b/.test(normalized)) {
		return "test";
	}
	return "other";
}
