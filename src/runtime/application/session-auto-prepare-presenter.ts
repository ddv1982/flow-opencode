import type { Session } from "../schema";
import { deriveSessionOperatorState } from "../session-operator-state";
import { explainSessionState } from "../summary";
import { guidanceFields } from "./session-presenter-shared";
import { toJson } from "./workspace-runtime";

type AutoPrepareMode = "resume" | "missing_goal" | "start_new_goal";

export function autoPrepareResponse(
	mode: AutoPrepareMode,
	goal: string | null,
	nextCommand: string,
	session?: Session | null,
) {
	const guidance =
		mode === "resume" && session
			? explainSessionState(session)
			: mode === "missing_goal"
				? explainSessionState(null)
				: {
						...explainSessionState(null),
						summary: `Flow should start a new autonomous goal: ${goal}`,
						blocker: null,
						reason:
							"A new explicit goal was provided, so Flow should start a fresh session for it.",
						nextStep: "Start the new autonomous goal.",
						nextCommand,
					};
	const payload =
		mode === "missing_goal"
			? {
					status: "missing_goal" as const,
					mode: "missing_goal" as const,
					summary:
						"No active Flow session exists. Provide a goal to start a new autonomous run.",
					...guidanceFields(guidance),
					nextCommand,
				}
			: mode === "resume" && goal
				? {
						status: "ok" as const,
						mode: "resume" as const,
						goal,
						summary: `Resuming active Flow goal: ${goal}`,
						...guidanceFields(guidance),
						nextCommand,
					}
				: {
						status: "ok" as const,
						mode: "start_new_goal" as const,
						goal,
						summary: `Starting a new autonomous Flow goal: ${goal}`,
						...guidanceFields(guidance),
						nextCommand,
					};
	return {
		payload: toJson(payload),
		metadata: {
			mode,
			goal,
			operator: deriveSessionOperatorState(session ?? null),
		},
	};
}
