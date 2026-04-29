type AuditSurfaceState = {
	all: boolean;
	config: boolean;
	tools: boolean;
	reportsTool: boolean;
	writeTool: boolean;
	guidance: boolean;
	any: boolean;
};

const ALWAYS_ON_AUDIT_SURFACE: AuditSurfaceState = {
	all: true,
	config: true,
	tools: true,
	reportsTool: true,
	writeTool: true,
	guidance: true,
	any: true,
};

export function isAuditSurfaceEnabled(): boolean {
	return true;
}

export function isAuditConfigEnabled(): boolean {
	return true;
}

export function isAuditToolsEnabled(): boolean {
	return true;
}

export function isAuditReportsToolEnabled(): boolean {
	return true;
}

export function isAuditWriteToolEnabled(): boolean {
	return true;
}

export function isAuditGuidanceEnabled(): boolean {
	return true;
}

export function getAuditSurfaceState(): AuditSurfaceState {
	return { ...ALWAYS_ON_AUDIT_SURFACE };
}
