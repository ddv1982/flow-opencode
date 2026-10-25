import { expect, test } from "bun:test";
import type { LocationRef } from "@opencode/client";
import type {
	DialogSelectOptions,
	ToastOptions,
} from "@opencode/plugin/tui/context";
import type {
	FlowModelRole,
	PickerChoice,
	PickerSnapshot,
	SaveModelPreference,
} from "../src/application/model-preferences.js";
import { resolveFlowReviewerConfiguration } from "../src/config-shared.js";
import {
	applyReviewerPreference,
	choiceKey,
	modelChoices,
	type PickerCatalogModel,
	resolvePreference,
} from "../src/platform/opencode/model-picker.js";
import {
	createModelPicker,
	type ModelPickerHost,
} from "../src/platform/opencode/model-picker-ui.js";
import pickerDefinition from "../src/tui.js";

const model: PickerCatalogModel = {
	id: "native-id",
	providerID: "test",
	name: "Luna",
	enabled: true,
	status: "active",
	capabilities: { tools: true, input: ["text"], output: ["text"] },
};
const selected: PickerChoice = {
	kind: "model",
	model: { providerID: "test", id: "native-id" },
};
const defaults = {
	planning: { kind: "default" },
	review: { kind: "default" },
} as const;
function snapshot(): PickerSnapshot {
	return {
		location: { directory: "/project" },
		revision: 0,
		global: defaults,
		project: {},
		effective: {
			planning: { choice: defaults.planning, source: "role-default" },
			review: { choice: defaults.review, source: "role-default" },
		},
	};
}

test("uses the native selection id and filters disabled, nontext, tool-less, and deprecated models", () => {
	expect(
		modelChoices(
			[
				model,
				{ ...model, id: "disabled", enabled: false },
				{ ...model, id: "old", status: "deprecated" },
				{
					...model,
					id: "image",
					capabilities: { tools: true, input: ["image"], output: ["text"] },
				},
				{
					...model,
					id: "no-tools",
					capabilities: { ...model.capabilities, tools: false },
				},
			],
			[{ id: "test", name: "Test provider" }],
		),
	).toEqual([
		{
			title: "Luna",
			value: selected,
			category: "Test provider",
			description: "test/native-id",
		},
	]);
	expect(pickerDefinition.id).toBe("opencode-plugin-flow.model-picker");
});
test("project default suppresses global and reviewer reset restores base variant and steps", () => {
	const base = resolveFlowReviewerConfiguration({
		env: {},
		pluginOptions: {
			reviewer: { model: "test/base", variant: "high", steps: 80 },
		},
	});
	expect(
		resolvePreference(
			{ ...defaults, review: selected },
			{ review: { kind: "default" } },
			"review",
		),
	).toEqual({ choice: { kind: "default" }, source: "project" });
	expect(applyReviewerPreference(base, "test/native-id")).toEqual({
		model: { kind: "explicit", source: "picker", value: "test/native-id" },
		steps: { kind: "explicit", source: "plugin-option", value: 80 },
	});
	expect(applyReviewerPreference(base, undefined)).toEqual(base);
	expect(base.variant?.value).toBe("high");
});

function fixture() {
	let current = snapshot();
	let catalog = [model];
	let location: LocationRef = { directory: "/project" };
	let role: FlowModelRole | undefined = "review";
	let choice: PickerChoice | undefined = selected;
	let confirm: boolean | undefined = true;
	let active = false;
	let confirmEffect = () => {};
	let readEffect = () => {};
	const saves: SaveModelPreference[] = [];
	const toasts: ToastOptions[] = [];
	const dialogs: Array<{
		options: readonly {
			title: string;
			value: unknown;
			disabled?: boolean;
			category?: string;
			description?: string;
		}[];
		placeholder?: string;
	}> = [];
	let cleared = 0;
	const host: ModelPickerHost = {
		location: () => location,
		async read() {
			readEffect();
			return structuredClone(current);
		},
		async catalog() {
			return {
				models: catalog,
				providers: [{ id: "test", name: "Test provider" }],
			};
		},
		async busy() {
			return active;
		},
		async save(input) {
			saves.push(input);
			current = {
				...current,
				revision: current.revision + 1,
				global: { ...current.global, [input.role]: input.choice },
			};
			return { kind: "saved", snapshot: current };
		},
		dialog: {
			async select<Value>(
				options: DialogSelectOptions<Value>,
			): Promise<Value | undefined> {
				dialogs.push(options);
				const answer = options.title === "Flow model settings" ? role : choice;
				const match = options.options.find(
					(option) =>
						!option.disabled &&
						(typeof option.value === "string"
							? option.value === answer
							: JSON.stringify(option.value) === JSON.stringify(answer)),
				);
				return match?.value;
			},
			async confirm() {
				confirmEffect();
				return confirm;
			},
			clear() {
				cleared++;
			},
		},
		toast: {
			show(value) {
				toasts.push(value);
			},
		},
	};
	const picker = createModelPicker(host);
	return {
		picker,
		saves,
		toasts,
		dialogs,
		current: () => current,
		cleared: () => cleared,
		setCurrent(value: PickerSnapshot) {
			current = value;
		},
		setRole(value: FlowModelRole | undefined) {
			role = value;
		},
		setChoice(value: PickerChoice | undefined) {
			choice = value;
		},
		setConfirm(value: boolean | undefined) {
			confirm = value;
		},
		setBusy(value: boolean) {
			active = value;
		},
		onConfirm(effect: () => void) {
			confirmEffect = effect;
		},
		onRead(effect: () => void) {
			readEffect = effect;
		},
		setCatalog(value: PickerCatalogModel[]) {
			catalog = value;
		},
		setLocation(value: LocationRef) {
			location = value;
		},
	};
}
test("saves each role independently and resets only the selected global role", async () => {
	const f = fixture();
	await f.picker.open();
	expect(f.saves).toEqual([
		{
			role: "review",
			expectedRevision: 0,
			expectedProject: {},
			choice: selected,
		},
	]);
	f.setRole("planning");
	await f.picker.open();
	f.setChoice({ kind: "default" });
	await f.picker.open();
	expect(f.current().global).toEqual({
		planning: { kind: "default" },
		review: selected,
	});
	expect(f.toasts.map((toast) => toast.variant)).toEqual([
		"success",
		"success",
		"success",
	]);
});
test("selection and confirmation cancellation do not write", async () => {
	const f = fixture();
	f.setRole(undefined);
	await f.picker.open();
	f.setRole("review");
	f.setChoice(undefined);
	await f.picker.open();
	f.setChoice(selected);
	f.setConfirm(undefined);
	await f.picker.open();
	expect(f.saves).toEqual([]);
	expect(f.toasts).toEqual([]);
});
test("unavailable current selection is disabled and default remains selectable", async () => {
	const f = fixture();
	f.setCurrent({
		...snapshot(),
		global: {
			...defaults,
			review: { kind: "model", model: { providerID: "gone", id: "old" } },
		},
	});
	f.setChoice({ kind: "default" });
	await f.picker.open();
	expect(f.dialogs[1]?.options[0]).toEqual({
		title: "gone/old",
		value: { kind: "model", model: { providerID: "gone", id: "old" } },
		category: "Current preference",
		description: "Unavailable here; reconnect or choose another model",
		disabled: true,
	});
	expect(f.saves[0]?.choice).toEqual({ kind: "default" });
	expect(f.dialogs[1]?.placeholder).toBe("Search connected models");
});
for (const [name, change, expected] of [
	[
		"busy",
		(f: ReturnType<typeof fixture>) => f.setBusy(true),
		"Wait for active work",
	],
	[
		"stale global",
		(f: ReturnType<typeof fixture>) =>
			f.setCurrent({ ...snapshot(), revision: 1 }),
		"preferences changed",
	],
	[
		"stale project",
		(f: ReturnType<typeof fixture>) =>
			f.setCurrent({ ...snapshot(), project: { planning: selected } }),
		"Project model preferences changed",
	],
	[
		"disconnected",
		(f: ReturnType<typeof fixture>) => f.setCatalog([]),
		"no longer available",
	],
	[
		"location",
		(f: ReturnType<typeof fixture>) => f.setLocation({ directory: "/other" }),
		"Project changed",
	],
] as const) {
	test(`refuses ${name} after confirmation`, async () => {
		const f = fixture();
		f.onConfirm(() => change(f));
		await f.picker.open();
		expect(f.saves).toEqual([]);
		expect(f.toasts[0]?.variant).toBe("error");
		expect(f.toasts[0]?.message).toContain(expected);
	});
}
test("unload while open clears the owned dialog and prevents a late save", async () => {
	const f = fixture();
	f.onConfirm(() => f.picker.dispose());
	await f.picker.open();
	expect(f.cleared()).toBe(1);
	expect(f.saves).toEqual([]);
	expect(f.toasts).toEqual([]);
	await f.picker.open();
	expect(f.saves).toEqual([]);
});
test("reentrant commands cannot open a second picker", async () => {
	const f = fixture();
	f.onRead(() => {
		void f.picker.open();
	});
	await f.picker.open();
	expect(f.saves.length).toBe(1);
	expect(f.dialogs.length).toBe(2);
	expect(choiceKey(f.current().global.review)).toBe("test/native-id");
});
