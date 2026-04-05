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
    ...recovery,
    nextCommand: recovery.nextCommand ?? "/flow-status",
  };
}

function buildResetFeatureRecovery(
  featureId: string,
  recovery: Omit<StatusRecoveryTemplate, "nextCommand" | "nextRuntimeTool" | "nextRuntimeArgs">,
): TransitionRecovery {
  return {
    ...recovery,
    nextCommand: `/flow-reset feature ${featureId}`,
    nextRuntimeTool: "flow_reset_feature",
    nextRuntimeArgs: { featureId },
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
