import type { Feature, Session } from "../schema";
import { fail, succeed, type TransitionResult } from "./shared";

function isFeatureRunnable(feature: Feature, completed: Set<string>): boolean {
	const dependsOn = feature.dependsOn ?? [];
	const blockedBy = feature.blockedBy ?? [];
	return (
		dependsOn.every((id) => completed.has(id)) &&
		blockedBy.every((id) => completed.has(id))
	);
}

type RunnableFeatureResult =
	| { ok: true; value: Feature }
	| { ok: false; message: string; reason: "invalid_request" | "blocked" };

function firstRunnableFeature(
	features: Feature[],
	requestedId?: string,
): RunnableFeatureResult {
	const byId = new Map(features.map((feature) => [feature.id, feature]));
	const completed = new Set(
		features
			.filter((feature) => feature.status === "completed")
			.map((feature) => feature.id),
	);

	if (requestedId) {
		const feature = byId.get(requestedId);
		if (!feature) {
			return {
				ok: false,
				message: `Feature '${requestedId}' was not found in the approved plan.`,
				reason: "invalid_request",
			};
		}
		if (feature.status === "completed") {
			return {
				ok: false,
				message: `Feature '${requestedId}' is already completed.`,
				reason: "invalid_request",
			};
		}
		if (!isFeatureRunnable(feature, completed)) {
			return {
				ok: false,
				message: `Feature '${requestedId}' is not runnable because its prerequisites are not complete.`,
				reason: "invalid_request",
			};
		}

		return { ok: true, value: feature };
	}

	const runnable = features.find(
		(feature) =>
			feature.status !== "completed" && isFeatureRunnable(feature, completed),
	);
	if (!runnable) {
		return {
			ok: false,
			message: "No runnable feature is available in the approved plan.",
			reason: "blocked",
		};
	}

	return { ok: true, value: runnable };
}

function markFeatureInProgress(
	features: Feature[],
	featureId: string,
): Feature[] {
	return features.map((feature) => {
		if (feature.id !== featureId) {
			return feature.status === "in_progress"
				? { ...feature, status: "pending" }
				: feature;
		}

		return { ...feature, status: "in_progress" };
	});
}

function blockRun(
	session: Session,
	message: string,
): { session: Session; feature: null; reason: string } {
	return {
		session: {
			...session,
			status: "blocked",
			execution: {
				...session.execution,
				activeFeatureId: null,
				lastSummary: message,
				lastOutcomeKind: "blocked",
			},
		},
		feature: null,
		reason: message,
	};
}

function startFeatureRun(
	session: Session,
	featureId: string,
): TransitionResult<{
	session: Session;
	feature: Feature | null;
	reason?: string;
}> {
	const plan = session.plan;
	if (!plan) {
		return fail("There is no approved plan to run.");
	}

	const nextPlan = {
		...plan,
		features: markFeatureInProgress(plan.features, featureId),
	};
	const nextSession: Session = {
		...session,
		plan: nextPlan,
		status: "running",
		execution: {
			...session.execution,
			activeFeatureId: featureId,
			lastFeatureId: featureId,
			lastSummary: `Running feature '${featureId}'.`,
			lastOutcomeKind: null,
			lastReviewerDecision: null,
		},
	};

	return succeed({
		session: nextSession,
		feature:
			nextPlan.features.find((feature) => feature.id === featureId) ?? null,
	});
}

export function startRun(
	session: Session,
	requestedId: string | undefined,
	markCompleted: (session: Session, summary: string) => Session,
): TransitionResult<{
	session: Session;
	feature: Feature | null;
	reason?: string;
}> {
	if (session.status === "completed") {
		return fail(
			"This Flow session is already completed. Start a new plan to continue.",
		);
	}
	if (!session.plan || session.approval !== "approved") {
		return fail("There is no approved plan to run.");
	}
	if (session.execution.activeFeatureId) {
		return fail(
			`Feature '${session.execution.activeFeatureId}' is already in progress.`,
		);
	}

	if (
		session.plan.features.every((feature) => feature.status === "completed")
	) {
		return succeed({
			session: markCompleted(session, "All planned features are complete."),
			feature: null,
			reason: "complete",
		});
	}

	const targetResult = firstRunnableFeature(session.plan.features, requestedId);
	if (!targetResult.ok) {
		return targetResult.reason === "invalid_request"
			? fail(targetResult.message)
			: succeed(blockRun(session, targetResult.message));
	}

	return startFeatureRun(session, targetResult.value.id);
}
