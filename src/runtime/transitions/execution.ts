import type { Feature, Session, WorkerResultArgs } from "../schema";
import {
	completeExecutionRun,
	markSessionCompleted,
} from "./execution-completion";
import { startRun as startExecutionRun } from "./execution-selection";
import { fail, type TransitionResult } from "./shared";

export type { WorkerOutcomeKind } from "./execution-completion";
export {
	markSessionCompleted,
	validateSuccessfulCompletion,
} from "./execution-completion";

export function startRun(
	session: Session,
	requestedId?: string,
): TransitionResult<{
	session: Session;
	feature: Feature | null;
	reason?: string;
}> {
	return startExecutionRun(session, requestedId, markSessionCompleted);
}

export function completeRun(
	session: Session,
	worker: WorkerResultArgs,
): TransitionResult<Session> {
	if (!session.plan) {
		return fail("There is no active plan to apply the worker result to.");
	}
	if (!session.execution.activeFeatureId) {
		return fail("There is no active feature to complete.");
	}
	if (worker.featureResult.featureId !== session.execution.activeFeatureId) {
		return fail(
			`Worker result feature '${worker.featureResult.featureId}' does not match active feature '${session.execution.activeFeatureId}'.`,
		);
	}

	return completeExecutionRun(
		session,
		session.execution.activeFeatureId,
		worker,
	);
}
