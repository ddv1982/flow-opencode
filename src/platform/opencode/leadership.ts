const REGISTRY_KIND = "opencode-plugin-flow.runtime-leadership";
const REGISTRY_FORMAT_VERSION = 1;
const MAX_PACKAGE_NAME_LENGTH = 214;
const MAX_VERSION_LENGTH = 256;
const MAX_INSTANCE_ID_LENGTH = 128;

export const FLOW_LEADERSHIP_PROTOCOL_VERSION = 1;
export const FLOW_LEADERSHIP_MAX_INSTANCES = 32;
export const FLOW_LEADERSHIP_REGISTRY_SYMBOL = Symbol.for(REGISTRY_KIND);

const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

type SemanticIdentifier =
	| { readonly kind: "numeric"; readonly value: bigint }
	| { readonly kind: "text"; readonly value: string };

interface SemanticVersion {
	readonly major: bigint;
	readonly minor: bigint;
	readonly patch: bigint;
	readonly prerelease: readonly SemanticIdentifier[] | null;
}

export interface FlowPluginIdentity {
	readonly packageName: string;
	readonly version: string;
	readonly protocolVersion: number;
	readonly instanceId: string;
}

interface RegisteredFlowInstance extends FlowPluginIdentity {}

interface FlowLeadershipRegistry {
	readonly kind: typeof REGISTRY_KIND;
	readonly formatVersion: typeof REGISTRY_FORMAT_VERSION;
	readonly registrations: Map<string, RegisteredFlowInstance>;
	capacityExceeded: boolean;
}

export type FlowLeadershipRole =
	| "leader"
	| "nonleader"
	| "unregistered"
	| "indeterminate";

export type FlowLeadershipReason =
	| "sole-instance"
	| "duplicate-instances"
	| "not-registered"
	| "released"
	| "incompatible-registry"
	| "registry-capacity-exceeded";

export interface FlowLeadershipStatus {
	readonly instanceId: string;
	readonly registered: boolean;
	readonly operational: boolean;
	readonly role: FlowLeadershipRole;
	readonly reason: FlowLeadershipReason;
	readonly registeredCount: number | null;
	readonly diagnosticLeader: FlowPluginIdentity | null;
	readonly registrations: readonly FlowPluginIdentity[];
	readonly message: string;
}

export interface FlowLeadershipHandle {
	readonly identity: FlowPluginIdentity;
	query(): FlowLeadershipStatus;
	isOperational(): boolean;
	assertOperational(action?: string): void;
	release(): boolean;
}

export class FlowLeadershipError extends Error {
	readonly code = "FLOW_LEADERSHIP_BLOCKED";
	readonly status: FlowLeadershipStatus;

	constructor(status: FlowLeadershipStatus, action?: string) {
		const actionPrefix = action ? `Flow cannot ${action}. ` : "";
		super(`${actionPrefix}${status.message}`);
		this.name = "FlowLeadershipError";
		this.status = status;
	}
}

function parseSemanticVersion(version: string): SemanticVersion | null {
	if (version.length === 0 || version.length > MAX_VERSION_LENGTH) return null;
	const match = SEMVER_PATTERN.exec(version);
	const major = match?.[1];
	const minor = match?.[2];
	const patch = match?.[3];
	if (major === undefined || minor === undefined || patch === undefined) {
		return null;
	}
	const prereleaseText = match?.[4];
	const prerelease = prereleaseText
		? prereleaseText
				.split(".")
				.map<SemanticIdentifier>((identifier) =>
					/^\d+$/.test(identifier)
						? { kind: "numeric", value: BigInt(identifier) }
						: { kind: "text", value: identifier },
				)
		: null;
	return {
		major: BigInt(major),
		minor: BigInt(minor),
		patch: BigInt(patch),
		prerelease,
	};
}

function compareBigInts(left: bigint, right: bigint): -1 | 0 | 1 {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function compareText(left: string, right: string): -1 | 0 | 1 {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function comparePrerelease(
	left: readonly SemanticIdentifier[] | null,
	right: readonly SemanticIdentifier[] | null,
): -1 | 0 | 1 {
	if (left === null && right === null) return 0;
	if (left === null) return 1;
	if (right === null) return -1;
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		const leftIdentifier = left[index];
		const rightIdentifier = right[index];
		if (leftIdentifier === undefined) return -1;
		if (rightIdentifier === undefined) return 1;
		if (
			leftIdentifier.kind === "numeric" &&
			rightIdentifier.kind === "numeric"
		) {
			const comparison = compareBigInts(
				leftIdentifier.value,
				rightIdentifier.value,
			);
			if (comparison !== 0) return comparison;
			continue;
		}
		if (leftIdentifier.kind === "numeric") return -1;
		if (rightIdentifier.kind === "numeric") return 1;
		const comparison = compareText(leftIdentifier.value, rightIdentifier.value);
		if (comparison !== 0) return comparison;
	}
	return 0;
}

export function compareSemanticVersions(
	left: string,
	right: string,
): -1 | 0 | 1 {
	const leftVersion = parseSemanticVersion(left);
	const rightVersion = parseSemanticVersion(right);
	if (!leftVersion || !rightVersion) {
		throw new TypeError(
			"Flow leadership versions must be valid exact semantic versions.",
		);
	}
	for (const [leftPart, rightPart] of [
		[leftVersion.major, rightVersion.major],
		[leftVersion.minor, rightVersion.minor],
		[leftVersion.patch, rightVersion.patch],
	] as const) {
		const comparison = compareBigInts(leftPart, rightPart);
		if (comparison !== 0) return comparison;
	}
	return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

function assertNonemptyBoundedString(
	value: string,
	name: string,
	maxLength: number,
): void {
	if (
		value.length === 0 ||
		value.length > maxLength ||
		value.trim() !== value
	) {
		throw new TypeError(
			`Flow leadership ${name} must be a non-empty, trimmed string of at most ${maxLength} characters.`,
		);
	}
}

function validateIdentity(identity: FlowPluginIdentity): void {
	assertNonemptyBoundedString(
		identity.packageName,
		"package name",
		MAX_PACKAGE_NAME_LENGTH,
	);
	assertNonemptyBoundedString(
		identity.instanceId,
		"instance ID",
		MAX_INSTANCE_ID_LENGTH,
	);
	if (!parseSemanticVersion(identity.version)) {
		throw new TypeError(
			`Flow leadership version '${identity.version}' is not a valid exact semantic version.`,
		);
	}
	if (
		!Number.isSafeInteger(identity.protocolVersion) ||
		identity.protocolVersion < 1
	) {
		throw new TypeError(
			"Flow leadership protocol version must be a positive safe integer.",
		);
	}
}

function snapshotIdentity(identity: FlowPluginIdentity): FlowPluginIdentity {
	return Object.freeze({
		packageName: identity.packageName,
		version: identity.version,
		protocolVersion: identity.protocolVersion,
		instanceId: identity.instanceId,
	});
}

function isRegisteredFlowInstance(
	value: unknown,
): value is RegisteredFlowInstance {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<RegisteredFlowInstance>;
	return (
		typeof candidate.packageName === "string" &&
		candidate.packageName.length > 0 &&
		candidate.packageName.length <= MAX_PACKAGE_NAME_LENGTH &&
		candidate.packageName.trim() === candidate.packageName &&
		typeof candidate.version === "string" &&
		parseSemanticVersion(candidate.version) !== null &&
		typeof candidate.protocolVersion === "number" &&
		Number.isSafeInteger(candidate.protocolVersion) &&
		candidate.protocolVersion >= 1 &&
		typeof candidate.instanceId === "string" &&
		candidate.instanceId.length > 0 &&
		candidate.instanceId.length <= MAX_INSTANCE_ID_LENGTH &&
		candidate.instanceId.trim() === candidate.instanceId
	);
}

function isCompatibleRegistry(value: unknown): value is FlowLeadershipRegistry {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<FlowLeadershipRegistry>;
	if (
		candidate.kind !== REGISTRY_KIND ||
		candidate.formatVersion !== REGISTRY_FORMAT_VERSION ||
		!(candidate.registrations instanceof Map) ||
		typeof candidate.capacityExceeded !== "boolean" ||
		candidate.registrations.size > FLOW_LEADERSHIP_MAX_INSTANCES
	) {
		return false;
	}
	for (const [instanceId, registration] of candidate.registrations) {
		if (
			typeof instanceId !== "string" ||
			!isRegisteredFlowInstance(registration) ||
			registration.instanceId !== instanceId
		) {
			return false;
		}
	}
	return true;
}

function readRegistrySlot(): unknown {
	try {
		return Reflect.get(globalThis, FLOW_LEADERSHIP_REGISTRY_SYMBOL);
	} catch {
		return null;
	}
}

function createRegistry(): FlowLeadershipRegistry {
	return {
		kind: REGISTRY_KIND,
		formatVersion: REGISTRY_FORMAT_VERSION,
		registrations: new Map(),
		capacityExceeded: false,
	};
}

function acquireRegistry():
	| { readonly ok: true; readonly registry: FlowLeadershipRegistry }
	| { readonly ok: false } {
	const existing = readRegistrySlot();
	if (existing !== undefined) {
		return isCompatibleRegistry(existing)
			? { ok: true, registry: existing }
			: { ok: false };
	}
	const registry = createRegistry();
	try {
		if (!Reflect.set(globalThis, FLOW_LEADERSHIP_REGISTRY_SYMBOL, registry)) {
			return { ok: false };
		}
	} catch {
		return { ok: false };
	}
	const installed = readRegistrySlot();
	return isCompatibleRegistry(installed)
		? { ok: true, registry: installed }
		: { ok: false };
}

function compareRegistrationTieBreakers(
	left: RegisteredFlowInstance,
	right: RegisteredFlowInstance,
): -1 | 0 | 1 {
	for (const comparison of [
		compareText(left.version, right.version),
		compareText(left.packageName, right.packageName),
		left.protocolVersion < right.protocolVersion
			? -1
			: left.protocolVersion > right.protocolVersion
				? 1
				: 0,
		compareText(left.instanceId, right.instanceId),
	] as const) {
		if (comparison !== 0) return comparison;
	}
	return 0;
}

function compareRegistrations(
	left: RegisteredFlowInstance,
	right: RegisteredFlowInstance,
): -1 | 0 | 1 {
	const versionComparison = compareSemanticVersions(
		left.version,
		right.version,
	);
	return versionComparison === 0
		? compareRegistrationTieBreakers(left, right)
		: versionComparison;
}

function diagnosticLeader(
	registrations: readonly RegisteredFlowInstance[],
): RegisteredFlowInstance | null {
	let leader: RegisteredFlowInstance | null = null;
	for (const candidate of registrations) {
		if (
			leader === null ||
			compareSemanticVersions(candidate.version, leader.version) > 0 ||
			(compareSemanticVersions(candidate.version, leader.version) === 0 &&
				compareRegistrationTieBreakers(candidate, leader) < 0)
		) {
			leader = candidate;
		}
	}
	return leader;
}

function identityLabel(identity: FlowPluginIdentity): string {
	return `${identity.packageName}@${identity.version} (instance ${identity.instanceId}, protocol ${identity.protocolVersion})`;
}

function freezeStatus(status: FlowLeadershipStatus): FlowLeadershipStatus {
	return Object.freeze({
		...status,
		registrations: Object.freeze([...status.registrations]),
	});
}

function incompatibleStatus(instanceId: string): FlowLeadershipStatus {
	return freezeStatus({
		instanceId,
		registered: false,
		operational: false,
		role: "indeterminate",
		reason: "incompatible-registry",
		registeredCount: null,
		diagnosticLeader: null,
		registrations: [],
		message:
			"Flow is disabled because the process-global leadership registry is incompatible; its existing value was left untouched.",
	});
}

function queryRegistryStatus(
	instanceId: string,
	expectedRecord: RegisteredFlowInstance | null,
	matchAnyRecord: boolean,
	localReason: FlowLeadershipReason | null,
	released: boolean,
): FlowLeadershipStatus {
	if (released) {
		return freezeStatus({
			instanceId,
			registered: false,
			operational: false,
			role: "unregistered",
			reason: "released",
			registeredCount: 0,
			diagnosticLeader: null,
			registrations: [],
			message: `Flow instance '${instanceId}' has released its leadership registration.`,
		});
	}
	const value = readRegistrySlot();
	if (value === undefined) {
		const reason = localReason ?? "not-registered";
		return freezeStatus({
			instanceId,
			registered: false,
			operational: false,
			role:
				reason === "incompatible-registry" ? "indeterminate" : "unregistered",
			reason,
			registeredCount: 0,
			diagnosticLeader: null,
			registrations: [],
			message:
				reason === "registry-capacity-exceeded"
					? "Flow is disabled because the leadership registry exceeded its bounded instance capacity."
					: reason === "incompatible-registry"
						? "Flow is disabled because its leadership registration could not use the process-global registry."
						: `Flow instance '${instanceId}' is not registered.`,
		});
	}
	if (!isCompatibleRegistry(value)) return incompatibleStatus(instanceId);
	const records = [...value.registrations.values()].sort(compareRegistrations);
	const current = value.registrations.get(instanceId);
	const registered =
		current !== undefined && (matchAnyRecord || current === expectedRecord);
	const leader = diagnosticLeader(records);
	const registrations = records.map(snapshotIdentity);
	const leaderSnapshot = leader ? snapshotIdentity(leader) : null;
	if (value.capacityExceeded || localReason === "registry-capacity-exceeded") {
		return freezeStatus({
			instanceId,
			registered,
			operational: false,
			role:
				!registered || !leader
					? "unregistered"
					: current === leader
						? "leader"
						: "nonleader",
			reason: "registry-capacity-exceeded",
			registeredCount: records.length,
			diagnosticLeader: leaderSnapshot,
			registrations,
			message: `Flow is disabled because the leadership registry exceeded its bounded capacity of ${FLOW_LEADERSHIP_MAX_INSTANCES} instances.`,
		});
	}
	if (!registered || !current) {
		return freezeStatus({
			instanceId,
			registered: false,
			operational: false,
			role:
				localReason === "incompatible-registry"
					? "indeterminate"
					: "unregistered",
			reason: localReason ?? "not-registered",
			registeredCount: records.length,
			diagnosticLeader: leaderSnapshot,
			registrations,
			message:
				localReason === "incompatible-registry"
					? "Flow is disabled because its leadership registration could not use the process-global registry."
					: `Flow instance '${instanceId}' is not registered.`,
		});
	}
	if (records.length === 1 && leader === current) {
		return freezeStatus({
			instanceId,
			registered: true,
			operational: true,
			role: "leader",
			reason: "sole-instance",
			registeredCount: 1,
			diagnosticLeader: snapshotIdentity(current),
			registrations,
			message: `Flow instance ${identityLabel(current)} is the sole active instance.`,
		});
	}
	if (!leader) {
		return incompatibleStatus(instanceId);
	}
	return freezeStatus({
		instanceId,
		registered: true,
		operational: false,
		role: current === leader ? "leader" : "nonleader",
		reason: "duplicate-instances",
		registeredCount: records.length,
		diagnosticLeader: snapshotIdentity(leader),
		registrations,
		message: `Flow is disabled while ${records.length} instances are registered. The deterministic diagnostic leader is ${identityLabel(leader)}.`,
	});
}

function identitiesMatch(
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

function removeEmptyRegistry(registry: FlowLeadershipRegistry): void {
	if (registry.registrations.size !== 0) return;
	if (readRegistrySlot() !== registry) return;
	try {
		Reflect.deleteProperty(globalThis, FLOW_LEADERSHIP_REGISTRY_SYMBOL);
	} catch {
		// An empty compatible registry is safe to reuse if the slot is not configurable.
	}
}

export function createFlowPluginInstanceId(): string {
	return globalThis.crypto.randomUUID();
}

export function queryFlowPluginLeadership(
	instanceId: string,
): FlowLeadershipStatus {
	assertNonemptyBoundedString(
		instanceId,
		"instance ID",
		MAX_INSTANCE_ID_LENGTH,
	);
	return queryRegistryStatus(instanceId, null, true, null, false);
}

export function unregisterFlowPluginInstance(instanceId: string): boolean {
	assertNonemptyBoundedString(
		instanceId,
		"instance ID",
		MAX_INSTANCE_ID_LENGTH,
	);
	const value = readRegistrySlot();
	if (!isCompatibleRegistry(value)) return false;
	if (!value.registrations.delete(instanceId)) return false;
	removeEmptyRegistry(value);
	return true;
}

export function registerFlowPluginInstance(
	input: FlowPluginIdentity,
): FlowLeadershipHandle {
	validateIdentity(input);
	const identity = snapshotIdentity(input);
	const acquired = acquireRegistry();
	let record: RegisteredFlowInstance | null = null;
	let localReason: FlowLeadershipReason | null = null;
	if (!acquired.ok) {
		localReason = "incompatible-registry";
	} else {
		const existing = acquired.registry.registrations.get(identity.instanceId);
		if (existing) {
			if (!identitiesMatch(existing, identity)) {
				throw new Error(
					`Flow leadership instance ID '${identity.instanceId}' is already registered with different identity data.`,
				);
			}
			record = existing;
		} else if (
			acquired.registry.registrations.size >= FLOW_LEADERSHIP_MAX_INSTANCES
		) {
			acquired.registry.capacityExceeded = true;
			localReason = "registry-capacity-exceeded";
		} else {
			record = identity;
			acquired.registry.registrations.set(identity.instanceId, record);
		}
	}
	let released = false;
	return Object.freeze({
		identity,
		query(): FlowLeadershipStatus {
			return queryRegistryStatus(
				identity.instanceId,
				record,
				false,
				localReason,
				released,
			);
		},
		isOperational(): boolean {
			return this.query().operational;
		},
		assertOperational(action?: string): void {
			const status = this.query();
			if (!status.operational) throw new FlowLeadershipError(status, action);
		},
		release(): boolean {
			if (released || !record) return false;
			const value = readRegistrySlot();
			if (
				!isCompatibleRegistry(value) ||
				value.registrations.get(identity.instanceId) !== record
			) {
				return false;
			}
			value.registrations.delete(identity.instanceId);
			released = true;
			removeEmptyRegistry(value);
			return true;
		},
	} satisfies FlowLeadershipHandle);
}
