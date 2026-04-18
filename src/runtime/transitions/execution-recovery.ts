import type { TransitionRecovery } from "./shared";
import {
  resolveResetFeatureRecovery,
  resolveStatusRecovery,
  type CompletionRecoveryKind,
  type StatusRecoveryTemplate,
} from "./execution-recovery-policy";

export type { CompletionRecoveryKind } from "./execution-recovery-policy";

function buildStatusRecovery(recovery: StatusRecoveryTemplate): TransitionRecovery {
  return {
    errorCode: recovery.errorCode,
    resolutionHint: recovery.resolutionHint,
    recoveryStage: recovery.recoveryStage,
    prerequisite: recovery.prerequisite,
    ...(recovery.requiredArtifact ? { requiredArtifact: recovery.requiredArtifact } : {}),
    nextCommand: recovery.nextCommand ?? "/flow-status",
    ...(recovery.nextRuntimeTool
      ? {
          nextRuntimeTool: recovery.nextRuntimeTool,
          ...(recovery.nextRuntimeArgs ? { nextRuntimeArgs: recovery.nextRuntimeArgs } : {}),
        }
      : {}),
    ...(recovery.retryable !== undefined ? { retryable: recovery.retryable } : {}),
    ...(recovery.autoResolvable !== undefined ? { autoResolvable: recovery.autoResolvable } : {}),
  };
}

function buildResetFeatureRecovery(
  featureId: string,
  recovery: Omit<StatusRecoveryTemplate, "nextCommand" | "nextRuntimeTool" | "nextRuntimeArgs">,
): TransitionRecovery {
  return {
    errorCode: recovery.errorCode,
    resolutionHint: recovery.resolutionHint,
    recoveryStage: recovery.recoveryStage,
    prerequisite: recovery.prerequisite,
    ...(recovery.requiredArtifact ? { requiredArtifact: recovery.requiredArtifact } : {}),
    nextCommand: `/flow-reset feature ${featureId}`,
    nextRuntimeTool: "flow_reset_feature",
    nextRuntimeArgs: { featureId },
    ...(recovery.retryable !== undefined ? { retryable: recovery.retryable } : {}),
    ...(recovery.autoResolvable !== undefined ? { autoResolvable: recovery.autoResolvable } : {}),
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
