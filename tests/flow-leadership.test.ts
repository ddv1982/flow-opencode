import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	FlowLeadershipHandle,
	FlowPluginIdentity,
} from "../src/platform/opencode/leadership.js";
import {
	createFlowPluginInstanceId,
	FLOW_LEADERSHIP_PROTOCOL_VERSION,
	FLOW_LEADERSHIP_REGISTRY_SYMBOL,
	registerFlowPluginInstance,
} from "../src/platform/opencode/leadership.js";

const DEFAULT_PROJECT = "/projects/default";

function register(
	instanceId: string,
	project = DEFAULT_PROJECT,
	identity: Partial<FlowPluginIdentity> = {},
): FlowLeadershipHandle {
	return registerFlowPluginInstance(project, {
		packageName: "opencode-plugin-flow",
		version: "5.3.4",
		protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION,
		instanceId,
		...identity,
	});
}

afterEach(() => {
	Reflect.deleteProperty(globalThis, FLOW_LEADERSHIP_REGISTRY_SYMBOL);
});

describe("Flow project-scoped duplicate guard", () => {
	for (const example of [
		{
			name: "keeps distinct projects independent",
			firstProject: "/projects/one",
			secondProject: "/projects/two",
			expectedOperational: true,
		},
		{
			name: "canonicalizes equivalent project paths",
			firstProject: "/projects/one/../same",
			secondProject: "/projects/same",
			expectedOperational: false,
		},
	] as const) {
		test(example.name, () => {
			const first = register("first", example.firstProject);
			const second = register("second", example.secondProject);

			expect(first.isOperational()).toBe(example.expectedOperational);
			expect(second.isOperational()).toBe(example.expectedOperational);
		});
	}

	test("canonicalizes symlink aliases to one project identity", async () => {
		if (process.platform === "win32") return;
		const root = await mkdtemp(join(tmpdir(), "flow-leadership-"));
		try {
			const project = join(root, "project");
			const alias = join(root, "project-alias");
			await mkdir(project);
			await symlink(project, alias, "dir");

			const first = register("real-path", project);
			const second = register("symlink-path", alias);

			expect(first.query().reason).toBe("duplicate-instances");
			expect(second.query().reason).toBe("duplicate-instances");
			expect(first.scopeId).toBe(second.scopeId);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	for (const versions of [
		["1.0.0", "99.0.0"],
		["99.0.0", "1.0.0"],
		["development", "release"],
	] as const) {
		test(`fails every duplicate closed without electing by version: ${versions.join(" then ")}`, () => {
			const first = register("first", DEFAULT_PROJECT, {
				version: versions[0],
			});
			expect(first.isOperational()).toBe(true);
			const second = register("second", DEFAULT_PROJECT, {
				version: versions[1],
			});

			for (const handle of [first, second]) {
				expect(handle.query()).toMatchObject({
					registered: true,
					operational: false,
					role: "indeterminate",
					reason: "duplicate-instances",
					registeredCount: 2,
					diagnosticLeader: null,
				});
				expect(() => handle.assertOperational("change Flow state")).toThrow(
					"duplicate-instances",
				);
			}
		});
	}

	test("rechecks dynamically and restores the remaining instance on release", () => {
		const first = register("first");
		const duplicate = register("duplicate");

		expect(first.isOperational()).toBe(false);
		expect(duplicate.release()).toBe(true);
		expect(duplicate.query().reason).toBe("released");
		expect(duplicate.release()).toBe(false);
		expect(first.query()).toMatchObject({
			operational: true,
			role: "leader",
			reason: "sole-instance",
			registeredCount: 1,
		});
		expect(first.release()).toBe(true);
		expect(
			Reflect.get(globalThis, FLOW_LEADERSHIP_REGISTRY_SYMBOL),
		).toBeUndefined();
	});

	test("shares one process-global guard across separately loaded module copies", async () => {
		const first = register("first");
		const moduleUrl = new URL(
			"../src/platform/opencode/leadership.ts",
			import.meta.url,
		);
		moduleUrl.searchParams.set("copy", createFlowPluginInstanceId());
		const independent = (await import(
			moduleUrl.href
		)) as typeof import("../src/platform/opencode/leadership.js");
		const duplicate = independent.registerFlowPluginInstance(DEFAULT_PROJECT, {
			packageName: "opencode-plugin-flow",
			version: "6.0.0",
			protocolVersion: independent.FLOW_LEADERSHIP_PROTOCOL_VERSION,
			instanceId: "independent",
		});

		expect(independent.FLOW_LEADERSHIP_REGISTRY_SYMBOL).toBe(
			FLOW_LEADERSHIP_REGISTRY_SYMBOL,
		);
		expect(first.isOperational()).toBe(false);
		expect(duplicate.isOperational()).toBe(false);
		expect(duplicate.release()).toBe(true);
		expect(first.isOperational()).toBe(true);
	});

	for (const occupied of [
		Object.freeze({ owner: "another plugin" }),
		Object.freeze({
			kind: "opencode-plugin-flow.runtime-leadership",
			formatVersion: 1,
			projects: new Map(),
		}),
	] as const) {
		test("leaves an incompatible registry or protocol untouched and fails closed", () => {
			Reflect.set(globalThis, FLOW_LEADERSHIP_REGISTRY_SYMBOL, occupied);
			const handle = register("blocked");

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
			expect(handle.release()).toBe(false);
		});
	}

	test("fails a caller with an unsupported runtime protocol closed", () => {
		const current = register("current");
		const handle = register("future", DEFAULT_PROJECT, {
			protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION + 1,
		});

		expect(current.query().reason).toBe("duplicate-instances");
		expect(handle.query()).toMatchObject({
			registered: true,
			operational: false,
			reason: "incompatible-registry",
		});
		expect(handle.release()).toBe(true);
	});

	test("keeps repeated registration idempotent and rejects identity collisions", () => {
		const first = register("same");
		const repeated = register("same");

		expect(first.isOperational()).toBe(true);
		expect(repeated.query().registeredCount).toBe(1);
		expect(() =>
			register("same", DEFAULT_PROJECT, { version: "other" }),
		).toThrow("already registered with different identity data");
		expect(repeated.release()).toBe(true);
		expect(first.query().reason).toBe("not-registered");
	});

	test("creates distinct runtime instance IDs", () => {
		expect(createFlowPluginInstanceId()).not.toBe(createFlowPluginInstanceId());
	});
});
