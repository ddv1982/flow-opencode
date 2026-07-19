export const MAX_ORCHESTRATION_PASSES = 50;

// Retain a bounded canonical outcome window while the append-only causal and
// review ledgers preserve older lifecycle ownership and accounting evidence.
export const MAX_HISTORY_ENTRIES = 500;

// Keep the durable public identity bounded independently of storage layout.
// Persistence maps the exact value to a fixed lowercase SHA-256 filename.
export const MAX_SESSION_ID_LENGTH = 128;

// Review results are copied into durable Session v4 state when a final review
// binds its feature prerequisite. Bound the complete serialized value so the
// aggregate cannot bypass the existing per-field limits by combining many
// individually valid findings.
export const MAX_REVIEW_ASSIGNMENT_RESULT_BYTES = 64 * 1024;
