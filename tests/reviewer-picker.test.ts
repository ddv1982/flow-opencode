import { expect, test } from "bun:test";
import { resolveFlowReviewerConfiguration } from "../src/config-shared.js";
import { createConfigHook } from "../src/platform/opencode/config.js";
import {
	applyReviewerPreference,
	reviewerChoices,
	reviewerPreference,
	reviewerPreferencePatch,
} from "../src/platform/opencode/reviewer-picker.js";
import type { HostConfig, Provider } from "../src/platform/opencode/sdk.js";
import picker from "../src/tui.js";

const config: HostConfig = {
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
	expect(
		reviewerChoices([provider], ["test"]).map((item) => item.value),
	).toEqual(["test/luna"]);
	expect(reviewerChoices([provider], [])).toEqual([]);
});
test("writes one preference without copying plugins or credentials", () => {
	expect(reviewerPreferencePatch("test/luna")).toEqual({
		agent: { "flow-reviewer": { options: { flowReviewerModel: "test/luna" } } },
	});
	expect(reviewerPreferencePatch("")).toEqual({
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
		reviewerPreference({
			agent: {
				"flow-reviewer": { options: { flowReviewerModel: "test/luna" } },
			},
		}),
	).toBe("test/luna");
	expect(() =>
		reviewerPreference({
			agent: { "flow-reviewer": { options: { flowReviewerModel: 42 } } },
		}),
	).toThrow();
});

async function host(preference?: string) {
	let current = structuredClone(config);
	if (preference) current.agent = reviewerPreferencePatch(preference).agent;
	let connected = ["test"];
	let busy = false;
	let writes = 0;
	let command: { slashName: string; run(): Promise<void> } | undefined;
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
			registerLayer: ({ commands }: { commands: [typeof command] }) => {
				command = commands[0];
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
						current = { ...current, ...next };
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
			expect(command?.slashName).toBe("flow-reviewer");
			await command?.run();
		},
		choose: () => select?.onSelect({ value: "test/luna" }),
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
	const config = reviewerPreferencePatch("test/luna") as {
		agent: Record<string, unknown>;
	};
	await hook(config);
	expect(current.model).toMatchObject({ value: "test/luna", source: "picker" });
	expect(current.variant).toBeUndefined();
	expect(config.agent["flow-reviewer"]).toMatchObject({ model: "test/luna" });
	expect(config.agent["flow-reviewer"]).not.toHaveProperty("options");
	await hook(config);
	expect(current.model).toMatchObject({ value: "test/luna" });
	await hook(reviewerPreferencePatch(""));
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
