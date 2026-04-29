const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

const FLOW_ENABLE_AUDIT_SURFACE = "FLOW_ENABLE_AUDIT_SURFACE";
const FLOW_ENABLE_AUDIT_CONFIG = "FLOW_ENABLE_AUDIT_CONFIG";
const FLOW_ENABLE_AUDIT_TOOLS = "FLOW_ENABLE_AUDIT_TOOLS";
const FLOW_ENABLE_AUDIT_GUIDANCE = "FLOW_ENABLE_AUDIT_GUIDANCE";

type AuditSurfaceState = {
	all: boolean;
	config: boolean;
	tools: boolean;
	guidance: boolean;
	any: boolean;
};

function isEnabled(name: string): boolean {
	const raw = process.env[name];
	if (!raw) return false;
	return ENABLED_VALUES.has(raw.trim().toLowerCase());
}

export function isAuditSurfaceEnabled(): boolean {
	return isEnabled(FLOW_ENABLE_AUDIT_SURFACE);
}

export function isAuditConfigEnabled(): boolean {
	return isAuditSurfaceEnabled() || isEnabled(FLOW_ENABLE_AUDIT_CONFIG);
}

export function isAuditToolsEnabled(): boolean {
	return isAuditSurfaceEnabled() || isEnabled(FLOW_ENABLE_AUDIT_TOOLS);
}

export function isAuditGuidanceEnabled(): boolean {
	return isAuditSurfaceEnabled() || isEnabled(FLOW_ENABLE_AUDIT_GUIDANCE);
}

export function getAuditSurfaceState(): AuditSurfaceState {
	const all = isAuditSurfaceEnabled();
	const config = isAuditConfigEnabled();
	const tools = isAuditToolsEnabled();
	const guidance = isAuditGuidanceEnabled();
	return {
		all,
		config,
		tools,
		guidance,
		any: config || tools || guidance,
	};
}
