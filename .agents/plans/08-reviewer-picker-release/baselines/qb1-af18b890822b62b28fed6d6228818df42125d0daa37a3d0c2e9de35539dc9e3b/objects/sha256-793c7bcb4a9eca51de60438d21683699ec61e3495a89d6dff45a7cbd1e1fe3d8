import { canonicalJson } from "./canonical-json.js";
import type { EvalReportV2 } from "./report.js";
import {
	assertStudyBudget,
	studyArmMatches,
	studyObservedProfileIssues,
} from "./study-protocol.js";
import { aggregateStudyUsage, generatedOutputTokens } from "./study-usage.js";

export function studyBudgetRequiresStop(report: EvalReportV2): boolean {
	const policy = report.plan.analysis;
	if (policy.kind !== "paired-study") return false;
	const accounting = report.completion.observed.accounting;
	if (report.attempts.length > 0 && accounting?.availability !== "observed")
		return true;
	if (
		accounting &&
		generatedOutputTokens(accounting) >
			policy.accounting.maxGeneratedOutputTokens
	)
		return true;
	const allowance = policy.accounting.preflight;
	if (allowance.kind === "none") return false;
	const called = (report.completion.preflight ?? []).filter(
		(entry) => entry.providerCalled,
	);
	const usage = aggregateStudyUsage(called.map((entry) => entry.accounting));
	return (
		called.length > allowance.maxRequests ||
		(called.length > 0 && usage.availability !== "observed") ||
		(report.completion.preflightWallClockMs ?? 0) > allowance.maxWallClockMs ||
		generatedOutputTokens(usage) > allowance.maxGeneratedOutputTokens ||
		(called.length > 0 &&
			allowance.maxUsd !== null &&
			(usage.costUsd === null
				? allowance.unknownCostPolicy === "stop"
				: usage.costUsd > allowance.maxUsd))
	);
}

export function studyReportIssues(report: EvalReportV2): string[] {
	const policy = report.plan.analysis;
	if (policy.kind !== "paired-study") return [];
	const issues: string[] = [];
	try {
		assertStudyBudget(
			policy,
			report.plan.budget,
			report.plan.cells.filter((cell) => cell.schedule === "primary").length,
		);
	} catch (error) {
		issues.push(error instanceof Error ? error.message : String(error));
	}
	for (const attempt of report.attempts) {
		const accounting = attempt.usage.accounting;
		if (
			!accounting ||
			accounting.tokens.output !== attempt.usage.outputTokens ||
			accounting.costUsd !== attempt.usage.costUsd
		) {
			issues.push(
				`Attempt ${attempt.attemptId} lacks matching versioned usage accounting.`,
			);
		}
		if (
			attempt.outcome.kind === "product" &&
			accounting?.availability !== "observed"
		) {
			issues.push(
				`Product attempt ${attempt.attemptId} lacks observed token categories.`,
			);
		}
		if (
			!Object.values(policy.arms).some((arm) =>
				studyArmMatches(policy, arm, attempt),
			)
		) {
			issues.push(
				`Attempt ${attempt.attemptId} does not match a declared arm.`,
			);
		}
		if (attempt.outcome.kind !== "failure") {
			const arm = Object.values(policy.arms).find((entry) =>
				studyArmMatches(policy, entry, attempt),
			);
			if (arm) issues.push(...studyObservedProfileIssues(arm, attempt.actors));
		}
		if (
			attempt.outcome.kind !== "failure" &&
			!attempt.actors.some((actor) => actor.role === "manager")
		) {
			issues.push(
				`Attempt ${attempt.attemptId} has no observed manager request identity.`,
			);
		}
	}
	const usages = report.attempts.flatMap((attempt) =>
		attempt.usage.accounting ? [attempt.usage.accounting] : [],
	);
	try {
		const accounting = aggregateStudyUsage(usages);
		if (
			!report.completion.observed.accounting ||
			canonicalJson(report.completion.observed.accounting) !==
				canonicalJson(accounting)
		) {
			issues.push("Campaign accounting does not equal its attempt accounting.");
		}
		if (
			generatedOutputTokens(accounting) >
				policy.accounting.maxGeneratedOutputTokens &&
			(report.completion.status !== "stopped" ||
				(report.completion.cause !== "budget" &&
					report.completion.cause !== "operator"))
		) {
			issues.push("Generated-output threshold requires a budget stop.");
		}
	} catch (error) {
		issues.push(error instanceof Error ? error.message : String(error));
	}
	const preflight = report.completion.preflight;
	const allowance = policy.accounting.preflight;
	if (allowance.kind === "none") {
		if (preflight && preflight.length > 0)
			issues.push("An undeclared provider preflight was recorded.");
	} else {
		if (!preflight) issues.push("Declared preflight has no retained receipt.");
		else {
			const models = Object.values(policy.arms).flatMap((arm) => [
				arm.manager,
				...(arm.reviewer?.model ? [arm.reviewer.model] : []),
			]);
			const requested = new Set(models.map((model) => canonicalJson(model)));
			const recorded = new Set(
				preflight.map((entry) => canonicalJson(entry.model)),
			);
			if (recorded.size !== preflight.length)
				issues.push("Preflight profiles must be observed at most once.");
			if (
				preflight.some(
					(entry) =>
						(!entry.providerCalled && entry.failure === null) ||
						(entry.providerCalled &&
							(entry.variantAvailability === "missing" ||
								entry.variantAvailability === "unobserved")),
				)
			) {
				issues.push(
					"Preflight receipt contains contradictory dispatch or variant facts.",
				);
			}
			if (
				report.completion.status === "complete" &&
				[...requested].some(
					(key) =>
						!preflight.some(
							(entry) =>
								canonicalJson(entry.model) === key &&
								entry.providerCalled &&
								entry.failure === null,
						),
				)
			) {
				issues.push(
					"Complete study lacks a successful entitlement receipt for every declared profile.",
				);
			}
			if (
				preflight.some(
					(entry) =>
						!models.some(
							(model) => canonicalJson(model) === canonicalJson(entry.model),
						),
				)
			) {
				issues.push("Preflight receipt names an undeclared model profile.");
			}
			const called = preflight.filter((entry) => entry.providerCalled);
			const aggregate = aggregateStudyUsage(
				called.map((entry) => entry.accounting),
			);
			const exceeded =
				called.length > allowance.maxRequests ||
				(called.length > 0 && aggregate.availability !== "observed") ||
				Math.max(
					report.completion.preflightWallClockMs ?? 0,
					preflight.reduce((sum, entry) => sum + entry.durationMs, 0),
				) > allowance.maxWallClockMs ||
				generatedOutputTokens(aggregate) > allowance.maxGeneratedOutputTokens ||
				(called.length > 0 &&
					allowance.maxUsd !== null &&
					(aggregate.costUsd === null
						? allowance.unknownCostPolicy === "stop"
						: aggregate.costUsd > allowance.maxUsd));
			if (
				exceeded &&
				(report.completion.status !== "stopped" ||
					(report.completion.cause !== "budget" &&
						report.completion.cause !== "operator"))
			) {
				issues.push(
					"Exceeded or unverifiable preflight allowance requires a budget stop.",
				);
			}
		}
	}
	return issues;
}
