const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

export function isAuditSurfaceEnabled(): boolean {
	const raw = process.env.FLOW_ENABLE_AUDIT_SURFACE;
	if (!raw) return false;
	return ENABLED_VALUES.has(raw.trim().toLowerCase());
}
