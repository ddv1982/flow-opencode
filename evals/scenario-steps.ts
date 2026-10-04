import type { EvalHost } from "./harness.js";
import { instructionDelivery } from "./provenance.js";

export type ScenarioStep = Readonly<{ freshSession?: boolean }> &
	(
		| Readonly<{ command: string; arguments: string }>
		| Readonly<{ kind: "prompt"; prompt: string }>
	);

export function scenarioStepCatalog(step: ScenarioStep) {
	return "kind" in step
		? {
				kind: step.kind,
				prompt: step.prompt,
				freshSession: step.freshSession === true,
			}
		: {
				command: step.command,
				arguments: step.arguments,
				freshSession: step.freshSession === true,
			};
}

export function scenarioStepInstruction(step: ScenarioStep, sequence: number) {
	return instructionDelivery(
		"kind" in step
			? {
					source: "user-prompt",
					name: "user-prompt",
					sequence,
					text: step.prompt,
				}
			: {
					source: "command",
					name: step.command,
					sequence,
					text: `/${step.command} ${step.arguments}`.trim(),
				},
	);
}

export function runScenarioStep(
	host: Pick<EvalHost, "runCommand" | "runPrompt">,
	sessionId: string,
	step: ScenarioStep,
	model: string,
) {
	return "kind" in step
		? host.runPrompt(sessionId, step.prompt, model)
		: host.runCommand(sessionId, step.command, step.arguments, model);
}
