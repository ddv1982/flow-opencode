import type { ObservedAssertion } from "./session.js";

/** Whether every declared name was reported as a passing case. */
export function assertionsSatisfied(
	declared: readonly string[],
	observed: readonly ObservedAssertion[] | undefined,
): boolean {
	return declared.every((name) =>
		(observed ?? []).some(
			(assertion) => assertion.name === name && assertion.status === "passed",
		),
	);
}

/** The declared names an observation did not report as passing, with why. */
export function unmetAssertions(
	declared: readonly string[],
	observed: readonly ObservedAssertion[] | undefined,
): string[] {
	return declared.flatMap((name) => {
		const found = (observed ?? []).find((assertion) => assertion.name === name);
		if (found?.status === "passed") return [];
		return [`${JSON.stringify(name)} ${found?.status ?? "absent"}`];
	});
}
