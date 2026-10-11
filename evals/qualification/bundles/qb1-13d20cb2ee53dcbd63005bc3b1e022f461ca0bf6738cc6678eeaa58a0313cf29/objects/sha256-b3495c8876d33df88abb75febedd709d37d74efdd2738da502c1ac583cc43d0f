import type { RetainedScenarioEvidence } from "./grader-input.js";
import type { ObservedToolCall } from "./harness.js";
import { nativeToolWitness } from "./reviewer-access.js";

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function nativeActorBindingIssues(
	evidence: RetainedScenarioEvidence,
): readonly string[] {
	const trace = evidence.gradeInput.hostTrace;
	if (trace?.kind !== "observed") return [];
	const issues: string[] = [];
	const managers = evidence.actors.filter((actor) => actor.role === "manager");
	const manager = managers[0];
	if (
		managers.length !== 1 ||
		!manager ||
		manager.sessionIds.length !== trace.runnerRootSessionIds.length ||
		new Set(manager.sessionIds).size !== manager.sessionIds.length ||
		!trace.runnerRootSessionIds.every((id) => manager.sessionIds.includes(id))
	)
		issues.push("Manager actor sessions differ from native runner roots.");
	const completionCalls = new Map<string, ObservedToolCall[]>();
	for (const call of evidence.gradeInput.allCalls) {
		if (call.tool !== "flow_feature_complete" || !call.native) continue;
		const calls = completionCalls.get(call.native.partId) ?? [];
		calls.push(call);
		completionCalls.set(call.native.partId, calls);
	}
	const incomplete = trace.messages.some(
		(message) =>
			message.role === "assistant" &&
			message.tools.some((tool) => {
				if (tool.tool !== "flow_feature_complete") return false;
				const calls = completionCalls.get(tool.partId) ?? [];
				const call = calls[0];
				return (
					calls.length !== 1 || !call || nativeToolWitness(call, trace) === null
				);
			}),
	);
	if (incomplete)
		issues.push("Native completion part lacks one exact retained call.");
	const reviewers = new Set(
		evidence.actors
			.filter((actor) => actor.role === "reviewer")
			.flatMap((actor) => actor.sessionIds),
	);
	for (const call of evidence.gradeInput.allCalls) {
		const output = record(call.output);
		const operation = record(record(output?.workflowData)?.operation);
		const result = record(record(call.input.request)?.result);
		if (
			call.tool !== "flow_feature_complete" ||
			call.status !== "completed" ||
			output?.status !== "ok" ||
			operation?.replayed !== false ||
			result?.terminalDisposition !== "submitted"
		)
			continue;
		const witness = nativeToolWitness(call, trace);
		const session = trace.sessions.find(
			(session) => session.id === witness?.message.sessionId,
		);
		if (
			!witness ||
			call.agent !== "flow-reviewer" ||
			session?.agent !== "flow-reviewer" ||
			session.parentId === null
		) {
			issues.push("Accepted review has no native reviewer-child witness.");
			continue;
		}
		if (!reviewers.has(session.id))
			issues.push(
				"Accepted reviewer session is absent from reviewer actor evidence.",
			);
	}
	return [...new Set(issues)];
}
