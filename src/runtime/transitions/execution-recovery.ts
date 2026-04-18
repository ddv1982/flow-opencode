import { FLOW_STATUS_COMMAND, flowResetFeatureCommand } from "../constants";
import {
	type CompletionRecoveryKind,
	resolveResetFeatureRecovery,
	resolveStatusRecovery,
	type StatusRecoveryTemplate,
} from "./execution-recovery-policy";
import type { TransitionRecovery } from "./shared";

export type { CompletionRecoveryKind } from "./execution-recovery-policy";

function buildStatusRecovery(
	recovery: StatusRecoveryTemplate,
): TransitionRecovery {
	return {
		errorCode: recovery.errorCode,
		resolutionHint: recovery.resolutionHint,
		recoveryStage: recovery.recoveryStage,
		prerequisite: recovery.prerequisite,
		...(recovery.requiredArtifact
			? { requiredArtifact: recovery.requiredArtifact }
			: {}),
		nextCommand: recovery.nextCommand ?? FLOW_STATUS_COMMAND,
		...(recovery.nextRuntimeTool
			? {
					nextRuntimeTool: recovery.nextRuntimeTool,
					...(recovery.nextRuntimeArgs
						? { nextRuntimeArgs: recovery.nextRuntimeArgs }
						: {}),
				}
			: {}),
		...(recovery.retryable !== undefined
			? { retryable: recovery.retryable }
			: {}),
		...(recovery.autoResolvable !== undefined
			? { autoResolvable: recovery.autoResolvable }
			: {}),
	};
}

function buildResetFeatureRecovery(
	featureId: string,
	recovery: Omit<
		StatusRecoveryTemplate,
		"nextCommand" | "nextRuntimeTool" | "nextRuntimeArgs"
	>,
): TransitionRecovery {
	return {
		errorCode: recovery.errorCode,
		resolutionHint: recovery.resolutionHint,
		recoveryStage: recovery.recoveryStage,
		prerequisite: recovery.prerequisite,
		...(recovery.requiredArtifact
			? { requiredArtifact: recovery.requiredArtifact }
			: {}),
		nextCommand: flowResetFeatureCommand(featureId),
		nextRuntimeTool: "flow_reset_feature",
		nextRuntimeArgs: { featureId },
		...(recovery.retryable !== undefined
			? { retryable: recovery.retryable }
			: {}),
		...(recovery.autoResolvable !== undefined
			? { autoResolvable: recovery.autoResolvable }
			: {}),
	};
}

export function buildCompletionRecovery(
	featureId: string,
	wasFinalFeature: boolean,
	kind: CompletionRecoveryKind,
): TransitionRecovery {
	const statusRecovery = resolveStatusRecovery(kind, wasFinalFeature);
	if (statusRecovery) {
		return buildStatusRecovery(statusRecovery);
	}

	const resetFeatureRecovery = resolveResetFeatureRecovery(kind);
	if (resetFeatureRecovery) {
		return buildResetFeatureRecovery(featureId, resetFeatureRecovery);
	}

	throw new Error(`Unhandled completion recovery kind: ${kind}`);
}
