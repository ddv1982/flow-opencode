import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type {
	RecoveryController,
	RecoverySettings,
} from "../../application/recovery-policy.js";
import {
	type FlowCodingModel,
	resolveFlowReviewerConfiguration,
} from "../../config-shared.js";
import { createFileSourceIdentityProvider } from "../../infrastructure/fs/source-identity.js";
import { createWorkspaceFlowService } from "../../infrastructure/fs/workspace-flow-service.js";
import {
	HomeDirectoryWorkspaceError,
	resolveWorkspaceRoot,
} from "../../infrastructure/fs/workspace-paths.js";
import {
	persistWorkspaceValidation,
	prepareWorkspaceValidation,
	readWorkspaceTestReport,
} from "../../infrastructure/fs/workspace-validation.js";
import { resolveFlowPluginVersion } from "../../version.js";
import { AutoDriveCoordinator } from "./auto-drive.js";
import { registerFlowAgents } from "./config.js";
import { registerHttpTransport } from "./http-transport.js";
import {
	createFlowPluginInstanceId,
	FLOW_LEADERSHIP_PROTOCOL_VERSION,
	registerFlowPluginInstance,
} from "./leadership.js";
import { registerFlowLifecycle } from "./lifecycle.js";
import { createFlowLog } from "./logging.js";
import { createFlowModelPreferences } from "./model-preferences.js";
import { Plugin } from "./sdk.js";
import { guardTools } from "./tool-guard.js";
import { createTools, registerFlowTools } from "./tools.js";
import { ValidationCaptureCoordinator } from "./validation-capture.js";

const JevModel = z
	.string()
	.max(32)
	.regex(/^jev-\d+\.\d+\.\d+$/);
const ModelMismatch = z.object({
	reason: z.literal("model-mismatch"),
	requestedModel: JevModel,
	model: JevModel,
});

export function createFlowPlugin(dependencies: {
	createRecovery(): RecoveryController;
	defaultRecovery?(): RecoverySettings | null;
	entryUrl: string;
}): Plugin.Plugin {
	return Plugin.define({
		id: "opencode-plugin-flow",
		async setup(ctx) {
			const log = createFlowLog(ctx);
			let workspace: string;
			try {
				workspace = resolveWorkspaceRoot({ directory: ctx.location.directory });
			} catch (error) {
				if (!(error instanceof HomeDirectoryWorkspaceError)) throw error;
				log(
					"warn",
					"Flow is inactive in the home directory to keep its state inside a project. Open a project folder and start OpenCode there: cd /path/to/project && opencode2.",
				);
				return;
			}
			const baseReviewer = resolveFlowReviewerConfiguration({
				pluginOptions: ctx.options,
				onWarning: (warning) => log("warn", warning),
			});
			let reviewerConfiguration = baseReviewer;
			let planningModel: string | undefined;
			const codingModels = new Map<string, FlowCodingModel>();
			const version = resolveFlowPluginVersion();
			const pluginEntrySha256 = `sha256:${createHash("sha256")
				.update(await readFile(fileURLToPath(dependencies.entryUrl)))
				.digest("hex")}`;
			const runtimeGuard = registerFlowPluginInstance(workspace, {
				packageName: "opencode-plugin-flow",
				version,
				protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION,
				instanceId: createFlowPluginInstanceId(),
			});
			const initial = runtimeGuard.query();
			log(
				initial.operational ? "info" : "error",
				`Flow ${version}: ${initial.message}`,
			);
			let recovery: RecoveryController;
			try {
				recovery = dependencies.createRecovery();
			} catch (error) {
				runtimeGuard.release();
				throw error;
			}
			const flow = createWorkspaceFlowService(workspace);
			let lifecycle:
				| Awaited<ReturnType<typeof registerFlowLifecycle>>
				| undefined;
			const autoDrive = new AutoDriveCoordinator({
				recovery,
				readSourceDigest: () =>
					createFileSourceIdentityProvider(workspace).computeSourceDigest(),
				readProjection: async () => {
					const response = await flow.status({ request: { view: "compact" } });
					if (response.status !== "ok") throw new Error(response.summary);
					const projection = response.workflowData.projection;
					if (projection.view !== "compact")
						throw new Error(
							"Flow auto-drive received a non-compact projection.",
						);
					return {
						sessionId:
							"sessionId" in projection ? projection.sessionId : undefined,
						status: projection.status,
						revision: projection.revision,
						nextAction: projection.nextAction,
						...("prerequisiteRepair" in projection &&
						projection.prerequisiteRepair
							? { prerequisiteRepair: projection.prerequisiteRepair }
							: {}),
					};
				},
				prompt: async (sessionID, prompt, delivery, metadata, intent) => {
					if (!lifecycle)
						throw new Error(
							"Flow lifecycle is not ready for continuation dispatch.",
						);
					return lifecycle.prompt(
						sessionID,
						prompt,
						delivery,
						metadata,
						intent,
					);
				},
				onWarning: (message) => log("warn", message),
			});
			const validation = new ValidationCaptureCoordinator({
				readSession: (sessionID) => ctx.session.get({ sessionID }),
				persistObservation: persistWorkspaceValidation,
				readReport: readWorkspaceTestReport,
				onRecorded: (receipt) => autoDrive.observeValidation(receipt),
				onReceiptError: (error) =>
					log("warn", "Flow continuation receipt was not accepted.", {
						message: String(error),
					}),
			});
			const cleanups: Array<() => void | Promise<void>> = [];
			let disposed = false;
			const dispose = async () => {
				if (disposed) return;
				disposed = true;
				autoDrive.clear();
				validation.clear();
				codingModels.clear();
				runtimeGuard.release();
				for (const cleanup of cleanups.reverse()) {
					try {
						await cleanup();
					} catch (error) {
						log("error", "Flow cleanup failed.", { message: String(error) });
					}
				}
			};
			try {
				const transport = await registerHttpTransport(ctx.provider);
				cleanups.push(() => transport.dispose());
				const controller = new AbortController();
				const events = (async () => {
					try {
						for await (const event of ctx.event.subscribe({
							signal: controller.signal,
						})) {
							validation.observeShellEvent(event);
							if (event.type === "session.deleted")
								validation.cancel(event.data.sessionID);
						}
						if (!controller.signal.aborted)
							throw new Error("The native shell observation stream ended.");
					} catch (error) {
						if (controller.signal.aborted) return;
						validation.clear();
						autoDrive.clear();
						runtimeGuard.release();
						log("error", "Flow lost native shell observation and stopped.", {
							message: String(error),
						});
					}
				})();
				cleanups.push(async () => {
					controller.abort();
					await events;
				});
				const preferences = await createFlowModelPreferences(ctx, {
					onChange: async () => {
						if (disposed) return;
						planningModel = preferences.planningModel();
						reviewerConfiguration =
							preferences.reviewerConfiguration(baseReviewer);
						await ctx.agent.reload();
					},
				});
				cleanups.push(() => preferences.dispose());
				planningModel = preferences.planningModel();
				reviewerConfiguration = preferences.reviewerConfiguration(baseReviewer);
				const agents = await registerFlowAgents(ctx, {
					assertOperational: (action) => runtimeGuard.assertOperational(action),
					readPlanningModel: () => planningModel,
					readReviewerConfiguration: () => reviewerConfiguration,
				});
				cleanups.push(() => agents.dispose());
				lifecycle = await registerFlowLifecycle({
					ctx,
					autoDrive,
					recovery,
					flow,
					runtimeGuard,
					log,
					codingModels,
					onFlowTerminal: (host) => {
						validation.cancel(host);
					},
					...(dependencies.defaultRecovery
						? { defaultRecovery: dependencies.defaultRecovery }
						: {}),
				});
				const activeLifecycle = lifecycle;
				cleanups.push(() => activeLifecycle.dispose());
				const tools = createTools({
					recovery,
					validation,
					prepareValidation: prepareWorkspaceValidation,
					onRecoveryOutcome: async (outcome) => {
						const mismatch = ModelMismatch.safeParse(outcome);
						if (mismatch.success)
							log(
								"warn",
								`Requested ${mismatch.data.requestedModel}, received ${mismatch.data.model}. Recovery remains blocked pending qualification.`,
							);
					},
					autoTimingSnapshot: () => autoDrive.timingSnapshot(),
					autoContinuationSnapshot: (host) =>
						autoDrive.continuationSnapshot(host),
					validationOrigin: (host, assistant, prepared) =>
						autoDrive.validationOrigin(host, assistant, prepared),
					autoContinuationSupport: () => autoDrive.continuationSupport(),
					readReviewerConfiguration: () => reviewerConfiguration,
					readPlanningModel: () => planningModel,
					readCodingModel: (sessionID) => codingModels.get(sessionID),
					runtimeIdentity: { packageVersion: version, pluginEntrySha256 },
				});
				const registration = await registerFlowTools(
					ctx,
					guardTools(tools, runtimeGuard, autoDrive, (sessionID) =>
						ctx.session.get({ sessionID }),
					),
					async (context) => {
						await activeLifecycle.verifyTool(context, "flow");
					},
				);
				cleanups.push(() => registration.dispose());
				const before = await ctx.tool.hook("execute.before", async (input) => {
					if (input.tool !== "shell" || validation.pendingCount() === 0) return;
					const access = await activeLifecycle.verifyTool(
						input,
						"native",
						input.tool,
					);
					if (access.kind === "flow")
						await validation.observeToolBefore(input, access.assertCurrent);
				});
				cleanups.push(() => before.dispose());
				const after = await ctx.tool.hook("execute.after", async (input) => {
					try {
						await validation.observeToolAfter(input);
					} catch (error) {
						log("error", "Flow validation capture failed closed.", {
							message: String(error),
						});
						if (input.status === "completed") {
							const marker =
								"\n\n[flow-validation-error] Flow validation capture failed. No validation receipt was produced.";
							const content = input.result.content;
							input.result = {
								...input.result,
								content:
									typeof content === "string"
										? content + marker
										: [...(content ?? []), { type: "text", text: marker }],
							};
						}
					}
				});
				cleanups.push(() => after.dispose());

				return dispose;
			} catch (error) {
				await dispose();
				throw error;
			}
		},
	});
}
