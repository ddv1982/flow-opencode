import type { PreparedValidation } from "../../application/prepare-validation.js";
import type { ValidationObservation } from "../../domain/session.js";
import { assertionsSatisfied } from "../../domain/test-results.js";

export type AutoValidationOrigin = Readonly<{
	hostSessionId: string;
	sessionId: string;
	authority: string;
	assistantId: string;
}> &
	Pick<
		PreparedValidation,
		| "featureId"
		| "runId"
		| "sourceDigest"
		| "command"
		| "scope"
		| "hostPlatform"
		| "intent"
		| "declaredPlatform"
		| "assertions"
	>;

export type AutoValidationReceipt = Readonly<{
	origin: AutoValidationOrigin;
	captureId: string;
	observation: ValidationObservation;
}>;

export type ValidationContinuationOutcome =
	| "passed"
	| "observed"
	| "failed"
	| "ineligible";

export function validationReceiptMatches(
	receipt: AutoValidationReceipt,
): boolean {
	const { origin, observation } = receipt;
	return (
		observation.id === receipt.captureId &&
		observation.featureId === origin.featureId &&
		observation.runId === origin.runId &&
		observation.sourceDigest === origin.sourceDigest &&
		observation.command === origin.command &&
		observation.scope === origin.scope &&
		observation.hostPlatform === origin.hostPlatform &&
		observation.intent === origin.intent
	);
}

export function validationContinuationOutcome(
	origin: Pick<
		PreparedValidation,
		"intent" | "declaredPlatform" | "assertions"
	>,
	observation: ValidationObservation,
): ValidationContinuationOutcome {
	if (
		observation.ineligibleReason !== undefined ||
		!observation.outputComplete ||
		observation.exitCode === null ||
		(origin.declaredPlatform !== undefined &&
			observation.hostPlatform !== origin.declaredPlatform) ||
		!assertionsSatisfied(origin.assertions, observation.observedAssertions)
	)
		return "ineligible";
	if (origin.intent === "observe") return "observed";
	return observation.exitCode === 0 ? "passed" : "failed";
}
