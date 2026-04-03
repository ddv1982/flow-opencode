export const FEATURE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const FEATURE_ID_MESSAGE = "Feature ids must be lowercase kebab-case";

export const VALIDATION_SCOPES = ["targeted", "broad"] as const;

export const FEATURE_REVIEW_SCOPE = "feature";
export const FINAL_REVIEW_SCOPE = "final";
export const REVIEW_SCOPES = [FEATURE_REVIEW_SCOPE, FINAL_REVIEW_SCOPE] as const;
