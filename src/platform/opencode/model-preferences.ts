import type { Plugin } from "@opencode/plugin";
import type {
	RpcHandlers,
	RpcRegistration,
} from "@opencode/plugin/promise/rpc";
import type {
	PickerSnapshot,
	SaveModelPreferenceResult,
	StoredModelPreferences,
} from "../../application/model-preferences.js";
import {
	projectPreferencesSchema,
	savePreferenceSchema,
} from "../../application/model-preferences-schema.js";
import type { FlowReviewerConfiguration } from "../../config-shared.js";
import { FlowModelPreferencesRpc } from "../../flow-rpc.js";
import { createModelPreferenceStore } from "../../infrastructure/fs/model-preference-store.js";
import {
	applyReviewerPreference,
	choiceKey,
	modelChoices,
	resolvePreference,
	sameChoice,
	sameProject,
} from "./model-picker.js";

export type FlowModelPreferencesContext = Pick<
	Plugin.Context,
	"location" | "options" | "event"
> & {
	readonly model: Pick<Plugin.Context["model"], "list">;
	readonly rpc: {
		register(
			definition: typeof FlowModelPreferencesRpc,
			handlers: RpcHandlers<typeof FlowModelPreferencesRpc>,
		): Promise<RpcRegistration<typeof FlowModelPreferencesRpc>>;
	};
	readonly session: Pick<
		Plugin.Context["session"],
		"hook" | "list" | "context"
	>;
};
export interface FlowModelPreferences {
	planningModel(): string | undefined;
	reviewerConfiguration(
		base: FlowReviewerConfiguration,
	): FlowReviewerConfiguration;
	dispose(): Promise<void>;
}

export async function createFlowModelPreferences(
	ctx: FlowModelPreferencesContext,
	{ onChange }: { onChange: () => Promise<void> | void },
): Promise<FlowModelPreferences> {
	const store = await createModelPreferenceStore();
	let state: StoredModelPreferences;
	let disposed = false;
	let ready = false;
	let failure: unknown;
	let refreshing = Promise.resolve();
	const pending = new Set<string>();
	const writes = new Set<Promise<unknown>>();
	let activityGeneration = 0;
	const project = () =>
		projectPreferencesSchema.parse(ctx.options.modelPreferences ?? {});
	const assertLoaded = () => {
		if (disposed) throw new Error("Flow model preferences have unloaded.");
		if (failure) throw failure;
	};
	const snapshot = (current: StoredModelPreferences): PickerSnapshot => {
		const overrides = project();
		return {
			location: {
				directory: ctx.location.directory,
				...(ctx.location.workspaceID
					? { workspaceID: ctx.location.workspaceID }
					: {}),
			},
			revision: current.revision,
			global: current.roles,
			project: overrides,
			effective: {
				planning: resolvePreference(current.roles, overrides, "planning"),
				review: resolvePreference(current.roles, overrides, "review"),
			},
		};
	};
	const refresh = () => {
		const next = refreshing.then(async () => {
			if (disposed) return;
			const latest = await store.read();
			if (disposed || latest.revision === state?.revision) return;
			state = latest;
			if (ready) await onChange();
		});
		refreshing = next.catch((error) => {
			failure = error;
		});
		return next;
	};
	const stopWatch = store.watch(
		() => {
			void refresh().catch(() => {});
		},
		(error) => {
			failure = error;
		},
	);
	try {
		state = await store.read();
		project();
		await refreshing;
	} catch (error) {
		stopWatch();
		throw error;
	}
	const prompt = await ctx.session
		.hook("prompt", () => {
			activityGeneration++;
		})
		.catch((error) => {
			stopWatch();
			throw error;
		});
	const eventsAbort = new AbortController();
	const events = (async () => {
		try {
			for await (const event of ctx.event.subscribe({
				signal: eventsAbort.signal,
			})) {
				if (event.type === "session.execution.started") {
					activityGeneration++;
					pending.add(event.data.sessionID);
				} else if (
					event.type === "session.execution.succeeded" ||
					event.type === "session.execution.failed" ||
					event.type === "session.execution.interrupted" ||
					event.type === "session.deleted"
				) {
					activityGeneration++;
					pending.delete(event.data.sessionID);
				}
			}
			if (!disposed)
				failure = new Error(
					"Flow cannot verify session activity after the event stream ended.",
				);
		} catch (error) {
			if (!disposed) failure = error;
		}
	})();
	const busy = async () => {
		if (pending.size) return true;
		let cursor: string | undefined;
		do {
			const page = await ctx.session.list({
				...(cursor ? { cursor } : {}),
				limit: 100,
			});
			for (const session of page.data) {
				const messages = await ctx.session.context({ sessionID: session.id });
				const last = messages.at(-1);
				if (!last) {
					if (session.time.updated > session.time.created) return true;
				} else if (
					session.time.idle === undefined ||
					session.time.idle < session.time.updated ||
					last.time.created > session.time.idle
				)
					return true;
			}
			cursor = page.cursor.next ?? undefined;
		} while (cursor);
		return pending.size > 0;
	};
	let registration: RpcRegistration<typeof FlowModelPreferencesRpc>;
	try {
		registration = await ctx.rpc.register(FlowModelPreferencesRpc, {
			async read() {
				assertLoaded();
				await refresh();
				assertLoaded();
				return snapshot(state);
			},
			async set(raw, call): Promise<SaveModelPreferenceResult> {
				const input = savePreferenceSchema.parse(raw);
				if (disposed || call.signal.aborted)
					return { kind: "refused", reason: "unloaded" };
				assertLoaded();
				const write = store.update<SaveModelPreferenceResult>(
					async (current) => {
						const refused = (
							reason: Extract<
								SaveModelPreferenceResult,
								{ kind: "refused" }
							>["reason"],
						) => ({ value: { kind: "refused", reason } as const });
						if (disposed || call.signal.aborted) return refused("unloaded");
						if (current.revision !== input.expectedRevision)
							return refused("stale-preference");
						if (!sameProject(project(), input.expectedProject))
							return refused("stale-project");
						const generation = activityGeneration;
						const [models, active] = await Promise.all([
							ctx.model.list(),
							busy(),
						]);
						assertLoaded();
						if (disposed || call.signal.aborted) return refused("unloaded");
						if (active || pending.size || generation !== activityGeneration)
							return refused("busy");
						if (!sameProject(project(), input.expectedProject))
							return refused("stale-project");
						if (
							input.choice.kind === "model" &&
							!modelChoices(models.data, []).some((option) =>
								sameChoice(option.value, input.choice),
							)
						)
							return refused("unavailable-model");
						if (sameChoice(current.roles[input.role], input.choice))
							return {
								value: { kind: "unchanged", snapshot: snapshot(current) },
							};
						const next = {
							...current,
							revision: current.revision + 1,
							roles: { ...current.roles, [input.role]: input.choice },
						};
						return {
							value: { kind: "saved", snapshot: snapshot(next) },
							next,
							beforeCommit() {
								assertLoaded();
								if (
									call.signal.aborted ||
									pending.size ||
									generation !== activityGeneration ||
									!sameProject(project(), input.expectedProject)
								)
									throw new Error(
										"Flow model preference confirmation became stale. Open the picker again.",
									);
							},
						};
					},
				);
				writes.add(write);
				try {
					const result = await write;
					await refresh();
					return result;
				} finally {
					writes.delete(write);
				}
			},
		});
	} catch (error) {
		disposed = true;
		stopWatch();
		eventsAbort.abort();
		await Promise.allSettled([prompt.dispose(), events, refreshing]);
		throw error;
	}
	await refreshing;
	ready = true;
	return {
		planningModel(): string | undefined {
			const choice = resolvePreference(
				state.roles,
				project(),
				"planning",
			).choice;
			return choiceKey(choice) || undefined;
		},
		reviewerConfiguration(
			base: FlowReviewerConfiguration,
		): FlowReviewerConfiguration {
			const choice = resolvePreference(state.roles, project(), "review").choice;
			return applyReviewerPreference(base, choiceKey(choice) || undefined);
		},
		async dispose(): Promise<void> {
			if (disposed) return;
			disposed = true;
			stopWatch();
			eventsAbort.abort();
			const results = await Promise.allSettled([
				registration.dispose(),
				prompt.dispose(),
				events,
				refreshing,
				...writes,
			]);
			const errors = results
				.filter((result) => result.status === "rejected")
				.map((result) => result.reason);
			if (errors.length)
				throw new AggregateError(
					errors,
					"Flow model preference cleanup failed.",
				);
		},
	};
}
