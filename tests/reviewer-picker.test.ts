import { expect, test } from "bun:test";
import {
	createFlowCoreConfigEntries,
	resolveFlowReviewerConfiguration,
} from "../src/config-shared.js";
import { createConfigHook } from "../src/platform/opencode/config.js";
import {
	applyReviewerPreference,
	modelChoices,
	modelPreference,
	modelPreferencePatch,
} from "../src/platform/opencode/model-picker.js";
import type { HostConfig, Provider } from "../src/platform/opencode/sdk.js";
import picker from "../src/tui.js";

const reviewPreferencePatch = (model: string) =>
	modelPreferencePatch("review", model);
const reviewPreference = (config: { agent?: Record<string, unknown> }) =>
	modelPreference(config, "review");

const config: HostConfig = {
	model: "test/coding",
	plugin: [
		"other-plugin",
		[
			"opencode-plugin-flow@8.4.0",
			{
				extra: true,
				reviewer: { model: "test/old", variant: "high", steps: 80 },
			},
		],
	],
};
const provider = {
	id: "test",
	name: "Test provider",
	models: {
		luna: {
			id: "luna",
			name: "Luna",
			status: "active",
			capabilities: {
				toolcall: true,
				input: { text: true },
				output: { text: true },
			},
		},
		image: {
			id: "image",
			name: "Images",
			status: "active",
			capabilities: {
				toolcall: false,
				input: { text: true },
				output: { text: false },
			},
		},
	},
} as unknown as Provider;

test("lists connected coding models without requiring a paid probe", () => {
	expect(modelChoices([provider], ["test"]).map((item) => item.value)).toEqual([
		"test/luna",
	]);
	expect(modelChoices([provider], [])).toEqual([]);
});
test("writes one preference without copying plugins or credentials", () => {
	expect(reviewPreferencePatch("test/luna")).toEqual({
		agent: { "flow-reviewer": { options: { flowReviewerModel: "test/luna" } } },
	});
	expect(reviewPreferencePatch("")).toEqual({
		agent: { "flow-reviewer": { options: { flowReviewerModel: "" } } },
	});
	const base = {
		model: {
			kind: "explicit" as const,
			source: "plugin-option" as const,
			value: "test/old",
		},
		variant: {
			kind: "explicit" as const,
			source: "environment" as const,
			value: "high",
		},
		steps: { kind: "host-default" as const },
	};
	expect(applyReviewerPreference(base, "test/luna")).toEqual({
		model: { kind: "explicit", source: "picker", value: "test/luna" },
		steps: base.steps,
	});
	expect(applyReviewerPreference(base, "")).toBe(base);
	expect(
		reviewPreference({
			agent: {
				"flow-reviewer": { options: { flowReviewerModel: "test/luna" } },
			},
		}),
	).toBe("test/luna");
	expect(() =>
		reviewPreference({
			agent: { "flow-reviewer": { options: { flowReviewerModel: 42 } } },
		}),
	).toThrow();
});

async function host(preference?: string) {
	let current = structuredClone(config);
	if (preference) current.agent = reviewPreferencePatch(preference).agent;
	let connected = ["test"];
	let busy = false;
	let writes = 0;
	const commands: Array<{ slashName: string; run(): void | Promise<void> }> =
		[];
	let select:
		| {
				options: Array<{ value: string }>;
				onSelect(item: { value: string }): void;
		  }
		| undefined;
	let confirm: { onConfirm(): void; onCancel(): void } | undefined;
	const toasts: Array<{ variant: string; message: string }> = [];
	const api = {
		lifecycle: { signal: new AbortController().signal },
		state: { ready: true, path: { directory: "/fixture" } },
		keymap: {
			registerLayer: (layer: { commands: typeof commands }) => {
				commands.splice(0, commands.length, ...layer.commands);
			},
		},
		ui: {
			toast: (toast: (typeof toasts)[number]) => toasts.push(toast),
			dialog: { replace: (render: () => unknown) => render(), clear: () => {} },
			DialogSelect: (props: typeof select) => {
				select = props;
				return null;
			},
			DialogConfirm: (props: typeof confirm) => {
				confirm = props;
				return null;
			},
		},
		client: {
			global: {
				config: {
					get: async () => ({ data: structuredClone(current) }),
					update: async ({ config: next }: { config: HostConfig }) => {
						writes++;
						current = {
							...current,
							...next,
							agent: { ...current.agent, ...next.agent },
						};
						return { data: current };
					},
				},
			},
			provider: {
				list: async () => ({ data: { all: [provider], connected } }),
			},
			session: {
				status: async () => ({
					data: { session: { type: busy ? "busy" : "idle" } },
				}),
			},
		},
	};
	await picker.tui(
		api as unknown as Parameters<typeof picker.tui>[0],
		undefined,
		{} as Parameters<typeof picker.tui>[2],
	);
	return {
		open: async () => {
			await commands
				.find((command) => command.slashName === "flow-reviewer")
				?.run();
		},
		openModels: async () => {
			await commands
				.find((command) => command.slashName === "flow-models")
				?.run();
		},
		chooseRole: async (value: string) => {
			select?.onSelect({ value });
			await new Promise((resolve) => setTimeout(resolve, 0));
		},
		config: () => structuredClone(current),
		choose: (value = "test/luna") => select?.onSelect({ value }),
		cancel: () => confirm?.onCancel(),
		confirm: async () => {
			confirm?.onConfirm();
			await new Promise((resolve) => setTimeout(resolve, 0));
		},
		busy: () => {
			busy = true;
		},
		disconnect: () => {
			connected = [];
		},
		change: () => {
			current.agent = {
				"flow-reviewer": { options: { flowReviewerModel: "test/other" } },
			};
		},
		choices: () => select?.options,
		writes: () => writes,
		toasts,
	};
}
test("native command requires a confirmed selection before saving", async () => {
	const h = await host();
	await h.open();
	h.choose();
	h.cancel();
	expect(h.writes()).toBe(0);
	await h.open();
	h.choose();
	await h.confirm();
	expect(h.writes()).toBe(1);
	expect(h.toasts.at(-1)?.variant).toBe("success");
});
test("rechecks activity, concurrent edits and provider availability before saving", async () => {
	for (const condition of ["busy", "change", "disconnect"] as const) {
		const h = await host();
		await h.open();
		h.choose();
		h[condition]();
		await h.confirm();
		expect(h.writes()).toBe(0);
		expect(h.toasts.at(-1)?.variant).toBe("error");
	}
});

test("server config applies the picker preference and restores original defaults", async () => {
	const base = resolveFlowReviewerConfiguration({
		env: {
			OPENCODE_FLOW_REVIEWER_MODEL: "test/default",
			OPENCODE_FLOW_REVIEWER_VARIANT: "high",
		},
	});
	let current = base;
	const hook = createConfigHook(
		{},
		{
			reviewerConfiguration: base,
			onReviewerConfiguration: (value) => {
				current = value;
			},
		},
	);
	const config = reviewPreferencePatch("test/luna") as {
		agent: Record<string, unknown>;
	};
	await hook(config);
	expect(current.model).toMatchObject({ value: "test/luna", source: "picker" });
	expect(current.variant).toBeUndefined();
	expect(config.agent["flow-reviewer"]).toMatchObject({ model: "test/luna" });
	expect(config.agent["flow-reviewer"]).not.toHaveProperty("options");
	await hook(config);
	expect(current.model).toMatchObject({ value: "test/luna" });
	await hook(reviewPreferencePatch(""));
	expect(current).toBe(base);
});

test("shows an unavailable saved preference explicitly", async () => {
	const h = await host("disconnected/model");
	await h.open();
	expect(h.choices()).toContainEqual(
		expect.objectContaining({ value: "disconnected/model", disabled: true }),
	);
	expect(h.writes()).toBe(0);
});

test("shared menu saves and resets planning independently of review and coding", async () => {
	const h = await host("test/review");
	await h.openModels();
	expect(h.choices()?.map((choice) => choice.value)).toEqual([
		"planning",
		"review",
	]);
	await h.chooseRole("planning");
	h.choose();
	await h.confirm();
	expect(modelPreference(h.config(), "planning")).toBe("test/luna");
	expect(modelPreference(h.config(), "review")).toBe("test/review");
	expect(h.config().model).toBe("test/coding");
	await h.openModels();
	await h.chooseRole("planning");
	h.choose("");
	await h.confirm();
	expect(modelPreference(h.config(), "planning")).toBe("");
	expect(modelPreference(h.config(), "review")).toBe("test/review");
	expect(h.config().model).toBe("test/coding");
});

test("planning config survives repeated hooks and resets to direct manager planning", async () => {
	let requested: string | undefined;
	const hook = createConfigHook(
		{},
		{
			onPlanningModel: (model) => {
				requested = model;
			},
		},
	);
	const config = modelPreferencePatch("planning", "test/planner");
	await hook(config);
	await hook(config);
	expect(requested).toBe("test/planner");
	expect(config.agent["flow-planner"]).toMatchObject({
		model: "test/planner",
		permission: {
			edit: "deny",
			bash: "deny",
			"flow_*": "deny",
			task: { "*": "deny" },
		},
	});
	const reset = modelPreferencePatch("planning", "");
	await hook(reset);
	expect(requested).toBeUndefined();
	expect(reset.agent["flow-planner"]).not.toHaveProperty("model");
	expect(reset.agent["flow-planner"]).toHaveProperty("disable", true);
	expect(() =>
		modelPreference(
			{ agent: { "flow-planner": { options: { flowPlanningModel: 42 } } } },
			"planning",
		),
	).toThrow("must be a string");
});

test("no planning preference disables specialist discovery and leaves command models untouched", () => {
	const configured = createFlowCoreConfigEntries({ env: {} });
	expect(configured.agent["flow-planner"].disable).toBe(true);
	for (const command of Object.values(configured.command))
		expect(command).not.toHaveProperty("model");
	const enabled = createFlowCoreConfigEntries({
		env: {},
		planningModel: "test/planner",
	});
	expect(enabled.agent["flow-planner"]).toMatchObject({
		disable: false,
		model: "test/planner",
	});
	expect(enabled.command).toEqual(configured.command);
	expect(enabled.agent["flow-reviewer"]).toEqual(
		configured.agent["flow-reviewer"],
	);
});

test("saved role preferences do not produce collision warnings but custom agents do", async () => {
	const warnings: string[] = [];
	const ctx = {
		client: {
			app: {
				log: ({ body }: { body: { level: string; message: string } }) => {
					if (body.level === "warn") warnings.push(body.message);
				},
			},
		},
	};
	const base = resolveFlowReviewerConfiguration({ env: {} });
	for (const role of ["planning", "review"] as const) {
		for (const model of ["test/model", ""]) {
			warnings.length = 0;
			const preference = modelPreferencePatch(role, model);
			const original = preference.agent;
			const saved = structuredClone(original);
			await createConfigHook(ctx, { reviewerConfiguration: base })(preference);
			expect(original).toEqual(saved);
			expect(
				warnings.filter((message) => message.includes("user-defined")),
			).toEqual([]);
		}
		const stored = modelPreferencePatch(role, "test/model");
		const name = Object.keys(stored.agent)[0];
		if (!name) throw new Error("Missing fixture role");
		for (const entry of [
			{ ...stored.agent[name], prompt: "Custom agent" },
			{ options: { ...stored.agent[name]?.options, custom: true } },
		]) {
			warnings.length = 0;
			await createConfigHook(ctx, { reviewerConfiguration: base })({
				agent: { [name]: entry },
			});
			expect(
				warnings.some((message) =>
					message.includes(`user-defined agent named '${name}'`),
				),
			).toBe(true);
		}
	}
});
