import { afterEach, describe, expect, test } from "bun:test";
import type {
	FlowLeadershipHandle,
	FlowPluginIdentity,
} from "../src/platform/opencode/leadership.js";
import {
	compareSemanticVersions,
	createFlowPluginInstanceId,
	FLOW_LEADERSHIP_MAX_INSTANCES,
	FLOW_LEADERSHIP_PROTOCOL_VERSION,
	FLOW_LEADERSHIP_REGISTRY_SYMBOL,
	FlowLeadershipError,
	queryFlowPluginLeadership,
	registerFlowPluginInstance,
	unregisterFlowPluginInstance,
} from "../src/platform/opencode/leadership.js";

const PACKAGE_NAME = "opencode-plugin-flow";

function identity(
	version: string,
	instanceId: string,
	protocolVersion = FLOW_LEADERSHIP_PROTOCOL_VERSION,
): FlowPluginIdentity {
	return { packageName: PACKAGE_NAME, version, protocolVersion, instanceId };
}

function register(
	version: string,
	instanceId: string,
	protocolVersion = FLOW_LEADERSHIP_PROTOCOL_VERSION,
): FlowLeadershipHandle {
	return registerFlowPluginInstance(
		identity(version, instanceId, protocolVersion),
	);
}

function clearRegistry(): void {
	Reflect.deleteProperty(globalThis, FLOW_LEADERSHIP_REGISTRY_SYMBOL);
}

afterEach(clearRegistry);

describe("Flow process-global leadership", () => {
	for (const loadOrder of [
		["4.9.0", "5.2.2"],
		["5.2.2", "4.9.0"],
	] as const) {
		test(`elects the highest diagnostic version in ${loadOrder.join(" then ")} load order while failing closed`, () => {
			const handles = loadOrder.map((version) =>
				register(version, `instance-${version}`),
			);
			for (const handle of handles) {
				const status = handle.query();
				expect(status.reason).toBe("duplicate-instances");
				expect(status.operational).toBe(false);
				expect(status.registeredCount).toBe(2);
				expect(status.diagnosticLeader?.version).toBe("5.2.2");
			}
			expect(
				handles.find((handle) => handle.identity.version === "5.2.2")?.query()
					.role,
			).toBe("leader");
			expect(
				handles.find((handle) => handle.identity.version === "4.9.0")?.query()
					.role,
			).toBe("nonleader");
			expect(() => handles[0]?.assertOperational("change Flow state")).toThrow(
				FlowLeadershipError,
			);
		});
	}

	test("uses a stable instance-ID tie-breaker for same-version duplicates", () => {
		const later = register("5.2.2", "zeta");
		const earlier = register("5.2.2", "alpha");

		expect(later.query()).toMatchObject({
			operational: false,
			role: "nonleader",
			reason: "duplicate-instances",
		});
		expect(earlier.query()).toMatchObject({
			operational: false,
			role: "leader",
			reason: "duplicate-instances",
		});
		expect(later.query().diagnosticLeader?.instanceId).toBe("alpha");
	});

	test("elects one deterministic diagnostic leader across three versions", () => {
		const middle = register("10.0.0-rc.1", "middle");
		const low = register("1.99.99", "low");
		const high = register("10.0.0", "high");

		for (const handle of [middle, low, high]) {
			expect(handle.isOperational()).toBe(false);
			expect(handle.query().registeredCount).toBe(3);
			expect(handle.query().diagnosticLeader?.instanceId).toBe("high");
		}
		expect(high.query().role).toBe("leader");
	});

	test("compares exact semantic versions without numeric precision loss", () => {
		expect(compareSemanticVersions("5.2.2-rc.2", "5.2.2-rc.10")).toBe(-1);
		expect(compareSemanticVersions("5.2.2+build.1", "5.2.2+build.2")).toBe(0);
		expect(
			compareSemanticVersions(
				"999999999999999999999999.0.0",
				"999999999999999999999998.999.999",
			),
		).toBe(1);
	});

	for (const invalidVersion of [
		"5",
		"v5.2.2",
		"5.02.2",
		"5.2.2-01",
		"5.2.2-",
		"5.2.2+",
		"5.2.2 latest",
	]) {
		test(`rejects invalid exact version '${invalidVersion}'`, () => {
			expect(() => register(invalidVersion, "invalid-version")).toThrow(
				"valid exact semantic version",
			);
			expect(
				Reflect.get(globalThis, FLOW_LEADERSHIP_REGISTRY_SYMBOL),
			).toBeUndefined();
		});
	}

	test("keeps repeated registration idempotent for one instance", () => {
		const first = register("5.2.2", "same-instance");
		const second = register("5.2.2", "same-instance");

		expect(first.query()).toMatchObject({
			registered: true,
			operational: true,
			registeredCount: 1,
			reason: "sole-instance",
		});
		expect(second.query().registrations).toHaveLength(1);
		expect(second.release()).toBe(true);
		expect(first.query()).toMatchObject({
			registered: false,
			operational: false,
			reason: "not-registered",
		});
		expect(second.release()).toBe(false);
	});

	test("rejects reuse of an instance ID with different identity data", () => {
		const original = register("5.2.2", "colliding-instance");
		expect(() => register("5.2.3", "colliding-instance")).toThrow(
			"already registered with different identity data",
		);
		expect(original.isOperational()).toBe(true);
	});

	test("unregisters and re-elects the remaining instance at query time", () => {
		const low = register("4.0.0", "low");
		const high = register("5.0.0", "high");

		expect(low.isOperational()).toBe(false);
		expect(high.query().role).toBe("leader");
		expect(high.release()).toBe(true);
		expect(high.query().reason).toBe("released");
		expect(low.query()).toMatchObject({
			operational: true,
			role: "leader",
			reason: "sole-instance",
			registeredCount: 1,
		});
	});

	test("leaves an incompatible preexisting symbol value untouched and fails closed", () => {
		const occupied = Object.freeze({ owner: "another runtime" });
		Reflect.set(globalThis, FLOW_LEADERSHIP_REGISTRY_SYMBOL, occupied);

		const handle = register("5.2.2", "blocked");
		expect(handle.query()).toMatchObject({
			registered: false,
			operational: false,
			role: "indeterminate",
			reason: "incompatible-registry",
			registeredCount: null,
		});
		expect(Reflect.get(globalThis, FLOW_LEADERSHIP_REGISTRY_SYMBOL)).toBe(
			occupied,
		);
		expect(() => handle.assertOperational("execute a command")).toThrow(
			"process-global leadership registry is incompatible",
		);
		expect(handle.release()).toBe(false);
	});

	test("shares registry semantics with a separately evaluated module API", async () => {
		const moduleUrl = new URL(
			"../src/platform/opencode/leadership.ts",
			import.meta.url,
		);
		moduleUrl.searchParams.set("copy", createFlowPluginInstanceId());
		const independent = (await import(
			moduleUrl.href
		)) as typeof import("../src/platform/opencode/leadership.js");
		const handle = register("5.2.2", "cross-module");

		expect(independent.FLOW_LEADERSHIP_REGISTRY_SYMBOL).toBe(
			FLOW_LEADERSHIP_REGISTRY_SYMBOL,
		);
		expect(independent.queryFlowPluginLeadership("cross-module")).toMatchObject(
			{
				registered: true,
				operational: true,
				reason: "sole-instance",
			},
		);
		expect(independent.unregisterFlowPluginInstance("cross-module")).toBe(true);
		expect(handle.isOperational()).toBe(false);
	});

	test("bounds registrations and keeps every tracked instance closed after overflow", () => {
		const handles = Array.from(
			{ length: FLOW_LEADERSHIP_MAX_INSTANCES },
			(_, index) => register("5.2.2", `bounded-${index}`),
		);
		const overflow = register("5.2.2", "bounded-overflow");

		expect(overflow.query()).toMatchObject({
			registered: false,
			operational: false,
			reason: "registry-capacity-exceeded",
			registeredCount: FLOW_LEADERSHIP_MAX_INSTANCES,
		});
		expect(handles[0]?.query()).toMatchObject({
			registered: true,
			operational: false,
			reason: "registry-capacity-exceeded",
		});
		expect(queryFlowPluginLeadership("bounded-overflow").registered).toBe(
			false,
		);
		expect(unregisterFlowPluginInstance("bounded-0")).toBe(true);
		expect(handles[1]?.isOperational()).toBe(false);
	});
});
