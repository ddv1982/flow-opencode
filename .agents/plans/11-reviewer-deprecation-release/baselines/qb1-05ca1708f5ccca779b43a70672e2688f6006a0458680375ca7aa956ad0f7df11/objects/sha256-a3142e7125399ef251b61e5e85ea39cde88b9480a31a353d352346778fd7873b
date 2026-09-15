import { CampaignCancelled } from "./campaign-stop.js";
import type { AttemptOutcome } from "./report.js";

export type DurableFailureOrigin = Extract<
	AttemptOutcome,
	{ kind: "failure" }
>["origin"];
export type FailureOrigin = DurableFailureOrigin | "persistence";

export type AttemptFailure<Origin extends FailureOrigin = FailureOrigin> =
	Readonly<{
		origin: Origin;
		code: string;
		detail: string;
		retryable: boolean;
	}>;

function detail(error: unknown): string {
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: JSON.stringify(error) || String(error);
	return message.slice(0, 4096);
}

export function attemptFailure<Origin extends FailureOrigin>(
	origin: Origin,
	code: string,
	error: unknown,
	retryable: boolean,
): AttemptFailure<Origin> {
	return { origin, code, detail: detail(error), retryable };
}

export function failureOutcome(
	failure: AttemptFailure<DurableFailureOrigin>,
): Extract<AttemptOutcome, { kind: "failure" }> {
	return {
		kind: "failure",
		origin: failure.origin,
		code: failure.code,
		retryable: failure.retryable,
	};
}

export function providerFailure(error: unknown): AttemptFailure<"provider"> {
	return attemptFailure("provider", "provider-rejected-turn", error, true);
}

export function evaluateScenario<T>(
	check: (outcome: T) => readonly string[],
	outcome: T,
):
	| Readonly<{ kind: "evaluated"; issues: readonly string[] }>
	| Readonly<{
			kind: "failure";
			failure: AttemptFailure<"evaluator">;
	  }> {
	try {
		return { kind: "evaluated", issues: check(outcome) };
	} catch (error) {
		return {
			kind: "failure",
			failure: attemptFailure(
				"evaluator",
				"scenario-check-threw",
				error,
				false,
			),
		};
	}
}

export class EvaluationPhaseError extends Error {
	readonly failure: AttemptFailure<DurableFailureOrigin>;

	constructor(failure: AttemptFailure<DurableFailureOrigin>, cause: unknown) {
		super(failure.detail, { cause });
		this.failure = failure;
	}
}

export async function evaluationPhase<T>(
	origin: DurableFailureOrigin,
	code: string,
	retryable: boolean,
	operation: () => Promise<T>,
): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (
			error instanceof CampaignCancelled ||
			error instanceof EvaluationPhaseError ||
			error instanceof EvaluationPersistenceError
		)
			throw error;
		throw new EvaluationPhaseError(
			attemptFailure(origin, code, error, retryable),
			error,
		);
	}
}

export function evaluatorFailure(
	error: unknown,
	code = "evaluator-transform-threw",
): AttemptFailure<DurableFailureOrigin> {
	return error instanceof EvaluationPhaseError
		? error.failure
		: attemptFailure("evaluator", code, error, false);
}

export function strongestFailureOrigin(
	origins: readonly (FailureOrigin | null | undefined)[],
): FailureOrigin | null {
	for (const origin of [
		"persistence",
		"evaluator",
		"host",
		"provider",
	] as const) {
		if (origins.includes(origin)) return origin;
	}
	return null;
}

export function isEvaluatorFailure(
	origin: FailureOrigin | null | undefined,
): origin is "evaluator" {
	return origin === "evaluator";
}

export class EvaluationPersistenceError extends Error {
	readonly failure: AttemptFailure<"persistence">;

	constructor(phase: string, cause: unknown) {
		const failure = attemptFailure(
			"persistence",
			`${phase}-write-failed`,
			cause,
			false,
		);
		super(failure.detail, { cause });
		this.failure = failure;
	}
}

export async function persistEvaluation<T>(
	phase: string,
	operation: () => Promise<T>,
): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		throw new EvaluationPersistenceError(phase, error);
	}
}

export async function preservePrimaryFailure<T>(
	operation: () => Promise<T>,
	cleanup: () => Promise<void>,
): Promise<T> {
	let result: T | undefined;
	let primary: unknown;
	let cleanupFailure: unknown;
	let failed = false;
	try {
		result = await operation();
	} catch (error) {
		failed = true;
		primary = error;
	}
	try {
		await cleanup();
	} catch (error) {
		if (!failed || primary instanceof CampaignCancelled) throw error;
		cleanupFailure = error;
	}
	if (failed) {
		if (primary instanceof Error && cleanupFailure !== undefined) {
			Object.defineProperty(primary, "cause", {
				configurable: true,
				value: new AggregateError(
					[
						...(primary.cause === undefined ? [] : [primary.cause]),
						cleanupFailure,
					],
					"Cleanup also failed.",
				),
			});
		}
		throw primary;
	}
	return result as T;
}
