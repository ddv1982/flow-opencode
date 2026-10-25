import {
	createFlowCoreConfigEntries,
	type FlowReviewerConfiguration,
} from "../../config-shared.js";
import { Model, type PluginContext } from "./sdk.js";

export async function registerFlowAgents(
	ctx: { agent: Pick<PluginContext["agent"], "transform"> },
	options: Readonly<{
		assertOperational(action: string): void;
		readPlanningModel(): string | undefined;
		readReviewerConfiguration(): FlowReviewerConfiguration;
	}>,
) {
	return ctx.agent.transform((editor) => {
		options.assertOperational("apply its OpenCode configuration");
		const planningModel = options.readPlanningModel();
		const entries = createFlowCoreConfigEntries({
			planningModel,
			reviewerConfiguration: options.readReviewerConfiguration(),
		});
		for (const [name, definition] of Object.entries(entries.agent)) {
			if (name === "flow-planner" && !planningModel) {
				editor.remove(name);
				continue;
			}
			editor.update(name, (agent) => {
				agent.mode = definition.mode;
				agent.hidden = definition.hidden;
				agent.system = definition.system;
				agent.description = definition.description;
				agent.permissions = structuredClone(definition.permissions);
				agent.request = { settings: {}, headers: {}, body: {} };
				delete agent.model;
				delete agent.steps;
				if ("model" in definition && definition.model) {
					agent.model = Model.Ref.parse(definition.model);
					if ("variant" in definition && definition.variant)
						agent.model.variant = Model.VariantID.make(definition.variant);
				}
				if ("steps" in definition && definition.steps)
					agent.steps = definition.steps;
			});
		}
	});
}
