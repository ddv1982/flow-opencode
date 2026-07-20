import { realpathSync } from "node:fs";
import { resolve } from "node:path";

const REGISTRY_KIND = "opencode-plugin-flow.runtime-leadership";
const REGISTRY_FORMAT_VERSION = 2;

export const FLOW_LEADERSHIP_PROTOCOL_VERSION = 1;
export const FLOW_LEADERSHIP_REGISTRY_SYMBOL = Symbol.for(REGISTRY_KIND);

export interface FlowPluginIdentity {
	readonly packageName: string;
	readonly version: string;
	readonly protocolVersion: number;
	readonly instanceId: string;
}

interface FlowLeadershipRegistry {
	readonly kind: typeof REGISTRY_KIND;
	readonly formatVersion: typeof REGISTRY_FORMAT_VERSION;
	readonly projects: Map<string, Map<string, FlowPluginIdentity>>;
}

export type FlowLeadershipReason =
	| "sole-instance"
	| "duplicate-instances"
	| "not-registered"
	| "released"
	| "incompatible-registry";

export interface FlowLeadershipStatus {
	readonly instanceId: string;
	readonly registered: boolean;
	readonly operational: boolean;
	readonly role: "leader" | "unregistered" | "indeterminate";
	readonly reason: FlowLeadershipReason;
	readonly registeredCount: number | null;
	readonly diagnosticLeader: FlowPluginIdentity | null;
	readonly registrations: readonly FlowPluginIdentity[];
	readonly message: string;
}

export interface FlowLeadershipHandle {
	readonly identity: FlowPluginIdentity;
	readonly scopeId: string;
	query(): FlowLeadershipStatus;
	isOperational(): boolean;
	assertOperational(action?: string): void;
	release(): boolean;
}

function boundedText(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.trim() === value &&
		!value.includes("\0")
	);
}

function validIdentity(value: unknown): value is FlowPluginIdentity {
	if (typeof value !== "object" || value === null) return false;
	const identity = value as Partial<FlowPluginIdentity>;
	return (
		boundedText(identity.packageName) &&
		boundedText(identity.version) &&
		boundedText(identity.instanceId) &&
		typeof identity.protocolVersion === "number" &&
		Number.isSafeInteger(identity.protocolVersion) &&
		identity.protocolVersion > 0
	);
}

function canonicalProjectId(scopeId: string): string {
	if (!boundedText(scopeId))
		throw new TypeError("Flow leadership scope ID must be a non-empty path.");
	const projectId = resolve(scopeId);
	try {
		return realpathSync(projectId);
	} catch {
		return projectId;
	}
}

function compatibleRegistry(value: unknown): value is FlowLeadershipRegistry {
	if (typeof value !== "object" || value === null) return false;
	const registry = value as Partial<FlowLeadershipRegistry>;
	if (
		registry.kind !== REGISTRY_KIND ||
		registry.formatVersion !== REGISTRY_FORMAT_VERSION ||
		!(registry.projects instanceof Map)
	) {
		return false;
	}
	for (const [projectId, registrations] of registry.projects) {
		if (
			!boundedText(projectId) ||
			canonicalProjectId(projectId) !== projectId ||
			!(registrations instanceof Map)
		) {
			return false;
		}
		for (const [instanceId, identity] of registrations) {
			if (!validIdentity(identity) || identity.instanceId !== instanceId) {
				return false;
			}
		}
	}
	return true;
}

function readRegistry(): unknown {
	return Reflect.get(globalThis, FLOW_LEADERSHIP_REGISTRY_SYMBOL);
}

function acquireRegistry(): FlowLeadershipRegistry | null {
	const existing = readRegistry();
	if (existing !== undefined)
		return compatibleRegistry(existing) ? existing : null;
	const registry: FlowLeadershipRegistry = {
		kind: REGISTRY_KIND,
		formatVersion: REGISTRY_FORMAT_VERSION,
		projects: new Map(),
	};
	if (!Reflect.set(globalThis, FLOW_LEADERSHIP_REGISTRY_SYMBOL, registry)) {
		return null;
	}
	const installed = readRegistry();
	return compatibleRegistry(installed) ? installed : null;
}

function snapshot(identity: FlowPluginIdentity): FlowPluginIdentity {
	return Object.freeze({ ...identity });
}

function makeStatus(
	identity: FlowPluginIdentity,
	reason: FlowLeadershipReason,
	registrations: readonly FlowPluginIdentity[] = [],
	registered = false,
): FlowLeadershipStatus {
	const operational = reason === "sole-instance";
	return Object.freeze({
		instanceId: identity.instanceId,
		registered,
		operational,
		role: operational
			? "leader"
			: registered || reason === "incompatible-registry"
				? "indeterminate"
				: "unregistered",
		reason,
		registeredCount:
			reason === "incompatible-registry" && !registered
				? null
				: registrations.length,
		diagnosticLeader: operational ? identity : null,
		registrations: Object.freeze([...registrations]),
		message: operational
			? "Flow is active for this project."
			: `Flow is not operational (${reason}).`,
	});
}

function sameIdentity(
	left: FlowPluginIdentity,
	right: FlowPluginIdentity,
): boolean {
	return (
		left.packageName === right.packageName &&
		left.version === right.version &&
		left.protocolVersion === right.protocolVersion &&
		left.instanceId === right.instanceId
	);
}

export const createFlowPluginInstanceId = () => globalThis.crypto.randomUUID();

export function registerFlowPluginInstance(
	scopeId: string,
	input: FlowPluginIdentity,
): FlowLeadershipHandle {
	const projectId = canonicalProjectId(scopeId);
	if (!validIdentity(input)) {
		throw new TypeError("Flow leadership identity is invalid.");
	}
	const identity = snapshot(input);
	const registry = acquireRegistry();
	let record: FlowPluginIdentity | null = null;
	if (registry) {
		let project = registry.projects.get(projectId);
		if (!project) {
			project = new Map();
			registry.projects.set(projectId, project);
		}
		const existing = project.get(identity.instanceId);
		if (existing && !sameIdentity(existing, identity)) {
			throw new Error(
				`Flow leadership instance ID '${identity.instanceId}' is already registered with different identity data.`,
			);
		}
		record = existing ?? identity;
		project.set(identity.instanceId, record);
	}

	let released = false;
	const query = (): FlowLeadershipStatus => {
		if (released) return makeStatus(identity, "released");
		const currentRegistry = readRegistry();
		if (!record) return makeStatus(identity, "incompatible-registry");
		if (currentRegistry === undefined)
			return makeStatus(identity, "not-registered");
		if (!compatibleRegistry(currentRegistry))
			return makeStatus(identity, "incompatible-registry");
		const project = currentRegistry.projects.get(projectId);
		const registrations = project ? [...project.values()].map(snapshot) : [];
		if (project?.get(identity.instanceId) !== record) {
			return makeStatus(identity, "not-registered", registrations);
		}
		if (identity.protocolVersion !== FLOW_LEADERSHIP_PROTOCOL_VERSION) {
			return makeStatus(identity, "incompatible-registry", registrations, true);
		}
		if (registrations.length !== 1) {
			return makeStatus(identity, "duplicate-instances", registrations, true);
		}
		return makeStatus(identity, "sole-instance", registrations, true);
	};

	return Object.freeze({
		identity,
		scopeId: projectId,
		query,
		isOperational: () => query().operational,
		assertOperational(action?: string): void {
			const current = query();
			if (!current.operational) {
				throw new Error(
					`${action ? `Flow cannot ${action}. ` : ""}${current.message}`,
				);
			}
		},
		release(): boolean {
			if (released || !record) return false;
			const currentRegistry = readRegistry();
			if (!compatibleRegistry(currentRegistry)) return false;
			const project = currentRegistry.projects.get(projectId);
			if (project?.get(identity.instanceId) !== record) return false;
			project.delete(identity.instanceId);
			released = true;
			if (project.size === 0) currentRegistry.projects.delete(projectId);
			if (currentRegistry.projects.size === 0) {
				Reflect.deleteProperty(globalThis, FLOW_LEADERSHIP_REGISTRY_SYMBOL);
			}
			return true;
		},
	} satisfies FlowLeadershipHandle);
}
