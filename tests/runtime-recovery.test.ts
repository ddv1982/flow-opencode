import { describe, expect, test } from "bun:test";
import { buildCompletionRecovery } from "../src/runtime/transitions/execution-recovery";
import type { CompletionRecoveryKind } from "../src/runtime/transitions/execution-recovery";

describe("runtime recovery policy mapping", () => {
  test("maps missing_reviewer_decision to feature vs final status recovery", () => {
    const featureRecovery = buildCompletionRecovery("setup-runtime", false, "missing_reviewer_decision");
    expect(featureRecovery.errorCode).toBe("missing_feature_reviewer_decision");
    expect(featureRecovery.requiredArtifact).toBe("feature_reviewer_decision");
    expect(featureRecovery.nextCommand).toBe("/flow-status");
    expect(featureRecovery.nextRuntimeTool).toBeUndefined();

    const finalRecovery = buildCompletionRecovery("setup-runtime", true, "missing_reviewer_decision");
    expect(finalRecovery.errorCode).toBe("missing_final_reviewer_decision");
    expect(finalRecovery.requiredArtifact).toBe("final_reviewer_decision");
    expect(finalRecovery.nextCommand).toBe("/flow-status");
    expect(finalRecovery.nextRuntimeTool).toBeUndefined();
  });

  test("maps missing_validation_scope to targeted vs broad status recovery", () => {
    const targeted = buildCompletionRecovery("setup-runtime", false, "missing_validation_scope");
    expect(targeted.errorCode).toBe("missing_targeted_validation");
    expect(targeted.requiredArtifact).toBe("targeted_validation_result");
    expect(targeted.nextCommand).toBe("/flow-status");

    const broad = buildCompletionRecovery("setup-runtime", true, "missing_validation_scope");
    expect(broad.errorCode).toBe("missing_broad_validation");
    expect(broad.requiredArtifact).toBe("broad_validation_result");
    expect(broad.nextCommand).toBe("/flow-status");
  });

  test("maps reset-feature failures to reset command/tool guidance", () => {
    const failingValidation = buildCompletionRecovery("setup-runtime", false, "failing_validation");
    expect(failingValidation.errorCode).toBe("failing_validation");
    expect(failingValidation.recoveryStage).toBe("reset_feature");
    expect(failingValidation.prerequisite).toBe("feature_reset_required");
    expect(failingValidation.nextCommand).toBe("/flow-reset feature setup-runtime");
    expect(failingValidation.nextRuntimeTool).toBe("flow_reset_feature");
    expect(failingValidation.nextRuntimeArgs).toEqual({ featureId: "setup-runtime" });

    const failingFeatureReview = buildCompletionRecovery("setup-runtime", false, "failing_feature_review");
    expect(failingFeatureReview.errorCode).toBe("failing_feature_review");
    expect(failingFeatureReview.recoveryStage).toBe("reset_feature");
    expect(failingFeatureReview.nextCommand).toBe("/flow-reset feature setup-runtime");
    expect(failingFeatureReview.nextRuntimeTool).toBe("flow_reset_feature");
    expect(failingFeatureReview.nextRuntimeArgs).toEqual({ featureId: "setup-runtime" });

    const failingFinalReview = buildCompletionRecovery("setup-runtime", true, "failing_final_review");
    expect(failingFinalReview.errorCode).toBe("failing_final_review");
    expect(failingFinalReview.recoveryStage).toBe("reset_feature");
    expect(failingFinalReview.nextCommand).toBe("/flow-reset feature setup-runtime");
    expect(failingFinalReview.nextRuntimeTool).toBe("flow_reset_feature");
    expect(failingFinalReview.nextRuntimeArgs).toEqual({ featureId: "setup-runtime" });
  });

  test("maps static status recovery kinds to flow-status guidance", () => {
    const missingValidation = buildCompletionRecovery("setup-runtime", false, "missing_validation");
    expect(missingValidation.errorCode).toBe("missing_validation_evidence");
    expect(missingValidation.recoveryStage).toBe("rerun_validation");
    expect(missingValidation.nextCommand).toBe("/flow-status");
    expect(missingValidation.nextRuntimeTool).toBeUndefined();

    const missingFinalReview = buildCompletionRecovery("setup-runtime", true, "missing_final_review");
    expect(missingFinalReview.errorCode).toBe("missing_final_review_payload");
    expect(missingFinalReview.recoveryStage).toBe("retry_completion");
    expect(missingFinalReview.requiredArtifact).toBe("final_review_payload");
    expect(missingFinalReview.nextCommand).toBe("/flow-status");
    expect(missingFinalReview.nextRuntimeTool).toBeUndefined();
  });

  test("supports every completion recovery kind without hitting the defensive throw path", () => {
    const allKinds: CompletionRecoveryKind[] = [
      "missing_validation",
      "failing_validation",
      "missing_reviewer_decision",
      "missing_validation_scope",
      "failing_feature_review",
      "missing_final_review",
      "failing_final_review",
    ];

    for (const kind of allKinds) {
      expect(() => buildCompletionRecovery("setup-runtime", false, kind)).not.toThrow();
      expect(() => buildCompletionRecovery("setup-runtime", true, kind)).not.toThrow();
    }
  });
});
