import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { RecoveryController } from "../../application/recovery-policy.js";
import {
	type FlowCodingModel,
	resolveFlowReviewerConfiguration,
} from "../../config-shared.js";
import { createWorkspaceFlowService } from "../../infrastructure/fs/workspace-flow-service.js";
import { resolveWorkspaceRoot } from "../../infrastructure/fs/workspace-paths.js";
import {
	persistWorkspaceValidation,
	prepareWorkspaceValidation,
	readWorkspaceTestReport,
} from "../../infrastructure/fs/workspace-validation.js";
import { createJevDecisionProvider } from "../../infrastructure/jev-decision-provider.js";
import { resolveFlowPluginVersion } from "../../version.js";
import { AutoDriveCoordinator, autoDriveDelivery } from "./auto-drive.js";
import { createCommandHook, textPart } from "./command-hook.js";
import { createConfigHook } from "./config.js";
import {
	createFlowPluginInstanceId,
	FLOW_LEADERSHIP_PROTOCOL_VERSION,
	registerFlowPluginInstance,
} from "./leadership.js";
import { createFlowLog } from "./logging.js";
import type { Hooks, Plugin } from "./sdk.js";
import { guardTools } from "./tool-guard.js";
import { createTools } from "./tools.js";
import { ValidationCaptureCoordinator } from "./validation-capture.js";

const FlowPlugin: Plugin = async (ctx, pluginOptions) => {
	const log = createFlowLog(ctx);
	let reviewerConfiguration = resolveFlowReviewerConfiguration({
		pluginOptions,
		onWarning: (warning) => log("warn", warning),
	});
	let planningModel: string | undefined;
	const codingModels = new Map<string, FlowCodingModel>();
	const version = resolveFlowPluginVersion();
	const pluginEntrySha256 = `sha256:${createHash("sha256")
		.update(await readFile(fileURLToPath(import.meta.url)))
		.digest("hex")}`;
	let workspace: string;
	try {
		workspace = resolveWorkspaceRoot(ctx);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		log("error", `Flow ${version} cannot start here: ${message}`);
		throw error;
	}
	const runtimeGuard = registerFlowPluginInstance(workspace, {
		packageName: "opencode-plugin-flow",
		version,
		protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION,
		instanceId: createFlowPluginInstanceId(),
	});
	const initial = runtimeGuard.query();
	const level = initial.operational ? "info" : "error";
	log(level, `Flow ${version}: ${initial.message}`);
	const recovery = new RecoveryController(
		createJevDecisionProvider(() => process.env.TYPESAFE_API_KEY),
	);
	const flow = createWorkspaceFlowService(workspace);
	const autoDrive = new AutoDriveCoordinator({
		recovery,
		readProjection: async () => {
			const response = await flow.status({ request: { view: "compact" } });
			if (response.status !== "ok") throw new Error(response.summary);
			const projection = response.workflowData.projection;
			if (projection.view !== "compact")
				throw new Error("Flow auto-drive received a non-compact projection.");
			return {
				sessionId: "sessionId" in projection ? projection.sessionId : undefined,
				status: projection.status,
				revision: projection.revision,
				nextAction: projection.nextAction,
			};
		},
		prompt: async (sessionID, prompt, delivery, metadata) => {
			await ctx.client.session.promptAsync({
				path: { id: sessionID },
				query: { directory: ctx.directory },
				body: {
					agent: delivery.agent,
					model: delivery.model,
					...(delivery.variant === undefined
						? {}
						: { variant: delivery.variant }),
					parts: [textPart(prompt, true, metadata)],
				},
				throwOnError: true,
			});
		},
		onWarning: (message) => log("warn", message),
	});
	const validation = new ValidationCaptureCoordinator({
		persistObservation: persistWorkspaceValidation,
		readReport: readWorkspaceTestReport,
	});
	const tools = createTools({
		recovery,
		validation,
		prepareValidation: prepareWorkspaceValidation,
		autoTimingSnapshot: () => autoDrive.timingSnapshot(),
		autoContinuationSupport: () => autoDrive.continuationSupport(),
		readReviewerConfiguration: () => reviewerConfiguration,
		readPlanningModel: () => planningModel,
		readCodingModel: (sessionID) => codingModels.get(sessionID),
		runtimeIdentity: { packageVersion: version, pluginEntrySha256 },
	});
	return {
		config: createConfigHook(ctx, {
			assertOperational: (action) => runtimeGuard.assertOperational(action),
			reviewerConfiguration,
			onPlanningModel: (model) => {
				planningModel = model;
			},
			onReviewerConfiguration: (configuration) => {
				reviewerConfiguration = configuration;
			},
		}),
		tool: guardTools(tools, runtimeGuard, autoDrive),
		"command.execute.before": createCommandHook({
			assertOperational: (action) => runtimeGuard.assertOperational(action),
			autoDrive,
			flow,
			recovery,
		}),
		"chat.message": async (input, output) => {
			if (
				!["flow-planner", "flow-reviewer", "flow-worker"].includes(
					output.message.agent,
				)
			) {
				const delivery = autoDriveDelivery(output.message, input.variant);
				codingModels.delete(input.sessionID);
				codingModels.set(input.sessionID, {
					...delivery.model,
					...(delivery.variant ? { variant: delivery.variant } : {}),
				});
				if (codingModels.size > 128) {
					const oldest = codingModels.keys().next().value;
					if (oldest) codingModels.delete(oldest);
				}
			}

			const observed = await autoDrive.observeMessage(
				input.sessionID,
				autoDriveDelivery(output.message, input.variant),
				output.parts,
				output.message.id,
			);
			if (observed === "stale-continuation")
				throw new Error("Discarded a stale Flow auto continuation.");
			recovery.observeMessage(
				input.sessionID,
				output.message.id,
				output.parts.every(
					(part) => part.type === "text" && part.synthetic === true,
				),
				observed === "accepted-continuation",
			);
		},
		"experimental.session.compacting": async (input, output) => {
			const context = autoDrive.compactionContext(input.sessionID);
			if (context) output.context.push(context);
		},
		event: async (input) => {
			const event = input.event;
			if (
				event.type === "message.updated" &&
				event.properties.info.role === "assistant" &&
				event.properties.info.parentID
			)
				recovery.observeAssistant(
					event.properties.info.sessionID,
					event.properties.info.id,
					event.properties.info.parentID,
				);
			if (event.type === "message.updated")
				return autoDrive.observeHostMessage(
					event.properties.info.sessionID,
					event.properties.info,
				);
			if (event.type === "message.part.updated")
				return autoDrive.observeHostPart(
					event.properties.part.sessionID,
					event.properties.part,
				);
			if (event.type === "session.deleted" || event.type === "session.error") {
				const sessionID =
					event.type === "session.deleted"
						? event.properties.info.id
						: event.properties.sessionID;
				if (event.type === "session.deleted")
					codingModels.delete(event.properties.info.id);
				if (!sessionID) return autoDrive.clear();
				validation.cancel(sessionID);
				return void autoDrive.deactivate(sessionID);
			}
			if (event.type !== "session.idle" && event.type !== "session.compacted")
				return;
			const sessionID = event.properties?.sessionID;
			validation.cancel(sessionID);
			if (event.type === "session.compacted")
				return autoDrive.observeCompaction(sessionID);
			if (runtimeGuard.query().operational) return autoDrive.onIdle(sessionID);
			autoDrive.deactivate(sessionID);
		},
		"tool.execute.before": async (input, output) =>
			validation.observeToolBefore(input, output),
		"tool.execute.after": async (input, output) => {
			try {
				await validation.observeToolAfter(input, output);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				log("error", "Flow validation capture failed closed.", { message });
				output.output = `${output.output}\n\n[flow-validation-error] ${message}`;
			}
		},
		dispose: async () => {
			codingModels.clear();
			autoDrive.clear();
			runtimeGuard.release();
		},
	} satisfies Hooks;
};

export default FlowPlugin;
