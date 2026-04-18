import type { Plan, Session } from "../src/runtime/schema";
import { createSession } from "../src/runtime/session";

export const samplePlan: Plan = {
	summary: "Implement a small workflow feature set.",
	overview: "Create one setup feature and one execution feature.",
	requirements: ["Keep state durable", "Keep commands concise"],
	architectureDecisions: [
		"Persist session history under .flow/sessions/<id>",
		"Run one feature per worker invocation",
	],
	features: [
		{
			id: "setup-runtime",
			title: "Create runtime helpers",
			summary: "Add runtime helper files and state persistence.",
			fileTargets: ["src/runtime/session.ts"],
			verification: ["bun test"],
			status: "pending",
		},
		{
			id: "execute-feature",
			title: "Implement execution flow",
			summary: "Wire runtime tools to feature execution.",
			fileTargets: ["src/tools.ts"],
			verification: ["bun test"],
			dependsOn: ["setup-runtime"],
			status: "pending",
		},
	],
	goalMode: "implementation",
	decompositionPolicy: "atomic_feature",
};

export function cloneSamplePlan(): Plan {
	return structuredClone(samplePlan);
}

export function createSampleSession(
	goal = "Build a workflow plugin",
): Session {
	return createSession(goal);
}

export const sampleSession: Session = createSampleSession();
