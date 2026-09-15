export type ObservedModelIdentity =
	| {
			readonly kind: "observed";
			readonly value: {
				readonly providerID: string;
				readonly modelID: string;
			};
	  }
	| {
			readonly kind: "unobserved";
			readonly reason:
				| "endpoint-failure"
				| "field-unavailable"
				| "no-completed-assistant"
				| "conflicting-observations"
				| "reviewer-child-not-observed";
	  };

export type ObservedActor = {
	readonly role: "manager" | "reviewer";
	readonly sessionIds: readonly string[];
	readonly actualModel: ObservedModelIdentity;
	readonly actualVariant?: ObservedVariant | undefined;
};

export type ObservedVariant =
	| { readonly kind: "observed"; readonly value: string }
	| Extract<ObservedModelIdentity, { kind: "unobserved" }>;

export type HostActorObservation = Readonly<{
	model: ObservedModelIdentity;
	variant: ObservedVariant;
}>;

export type ObservedGuidanceLoad = {
	readonly sequence: number;
	readonly sessionIndex: number;
	readonly agent: string;
	readonly id: string | null;
	readonly rawOutput: string;
	readonly utf8Bytes: number;
};

export type ObservedSession = {
	readonly id: string;
	readonly agent: string | null;
	readonly parentID: string | null;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function nonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function messageModelIdentity(message: unknown): {
	readonly providerID: string;
	readonly modelID: string;
} | null {
	if (!isRecord(message) || !isRecord(message.info)) return null;
	const info = message.info;
	if (info.role !== "assistant" || "error" in info) return null;
	const time = isRecord(info.time) ? info.time : null;
	if (typeof time?.completed !== "number") return null;
	const model = isRecord(info.model) ? info.model : null;
	const providerID =
		nonEmptyString(model?.providerID) ?? nonEmptyString(info.providerID);
	const modelID =
		nonEmptyString(model?.modelID) ?? nonEmptyString(info.modelID);
	return providerID && modelID ? { providerID, modelID } : null;
}

/** Extracts the Phase 0-approved identity fields from a host message response. */
export function extractObservedModelIdentity(
	messages: readonly unknown[] | null,
): ObservedModelIdentity {
	if (messages === null)
		return { kind: "unobserved", reason: "endpoint-failure" };
	const completed = messages.filter((message) => {
		if (!isRecord(message) || !isRecord(message.info)) return false;
		if (message.info.role !== "assistant" || "error" in message.info)
			return false;
		const time = isRecord(message.info.time) ? message.info.time : null;
		return typeof time?.completed === "number";
	});
	if (completed.length === 0)
		return { kind: "unobserved", reason: "no-completed-assistant" };
	const identities = completed
		.map(messageModelIdentity)
		.filter(
			(value): value is { providerID: string; modelID: string } =>
				value !== null,
		);
	if (identities.length === 0)
		return { kind: "unobserved", reason: "field-unavailable" };
	const unique = new Map(
		identities.map((identity) => [
			`${identity.providerID}\u0000${identity.modelID}`,
			identity,
		]),
	);
	if (unique.size > 1)
		return { kind: "unobserved", reason: "conflicting-observations" };
	const identity = identities[0];
	return identity
		? { kind: "observed", value: identity }
		: { kind: "unobserved", reason: "field-unavailable" };
}

function messageVariant(message: unknown): string | null {
	if (!isRecord(message) || !isRecord(message.info)) return null;
	const info = message.info;
	if (info.role !== "assistant" || "error" in info) return null;
	if (!isRecord(info.time) || typeof info.time.completed !== "number")
		return null;
	const model = isRecord(info.model) ? info.model : null;
	return nonEmptyString(info.variant) ?? nonEmptyString(model?.variant);
}

export function extractObservedVariant(
	messages: readonly unknown[] | null,
): ObservedVariant {
	if (messages === null)
		return { kind: "unobserved", reason: "endpoint-failure" };
	const completed = messages.filter((message) => {
		if (!isRecord(message) || !isRecord(message.info)) return false;
		const info = message.info;
		return (
			info.role === "assistant" &&
			!("error" in info) &&
			isRecord(info.time) &&
			typeof info.time.completed === "number"
		);
	});
	if (completed.length === 0)
		return { kind: "unobserved", reason: "no-completed-assistant" };
	const values = completed.map(messageVariant);
	const known = new Set(
		values.filter((value): value is string => value !== null),
	);
	if (known.size > 1)
		return { kind: "unobserved", reason: "conflicting-observations" };
	const value = values[0];
	return value !== null && value !== undefined && !values.includes(null)
		? { kind: "observed", value }
		: { kind: "unobserved", reason: "field-unavailable" };
}

/** Only children linked to a known session and named flow-reviewer are reviewers. */
export function selectLineageValidatedReviewers(
	parentSessionIds: readonly string[],
	children: readonly ObservedSession[],
): readonly ObservedSession[] {
	const parents = new Set(parentSessionIds);
	return children.filter(
		(child) =>
			child.agent === "flow-reviewer" &&
			child.parentID !== null &&
			parents.has(child.parentID),
	);
}

export function extractObservedActor(input: {
	readonly role: "manager" | "reviewer";
	readonly sessions: readonly {
		readonly id: string;
		readonly messages: readonly unknown[] | null;
	}[];
}): ObservedActor {
	if (input.sessions.length === 0) {
		return {
			role: input.role,
			sessionIds: [],
			actualModel: {
				kind: "unobserved",
				reason:
					input.role === "reviewer"
						? "reviewer-child-not-observed"
						: "no-completed-assistant",
			},
		};
	}
	const observations = input.sessions.map((session) =>
		extractObservedModelIdentity(session.messages),
	);
	const observed = observations.filter(
		(
			observation,
		): observation is Extract<ObservedModelIdentity, { kind: "observed" }> =>
			observation.kind === "observed",
	);
	const unique = new Map(
		observed.map((observation) => [
			`${observation.value.providerID}\u0000${observation.value.modelID}`,
			observation,
		]),
	);
	const unavailable = observations.find(
		(observation) => observation.kind === "unobserved",
	);
	const actualModel: ObservedModelIdentity =
		unique.size > 1
			? { kind: "unobserved", reason: "conflicting-observations" }
			: (unavailable ??
				observed[0] ?? {
					kind: "unobserved",
					reason: "field-unavailable",
				});
	const variantEvidence = input.sessions.some((session) =>
		(session.messages ?? []).some(
			(message) => messageVariant(message) !== null,
		),
	);
	const variants = input.sessions.map((session) =>
		extractObservedVariant(session.messages),
	);
	const variantValues = new Set(
		variants.flatMap((variant) =>
			variant.kind === "observed" ? [variant.value] : [],
		),
	);
	const actualVariant: ObservedVariant =
		variantValues.size > 1
			? { kind: "unobserved", reason: "conflicting-observations" }
			: (variants.find((variant) => variant.kind === "unobserved") ??
				variants[0] ?? { kind: "unobserved", reason: "field-unavailable" });
	return {
		role: input.role,
		sessionIds: input.sessions.map((session) => session.id),
		actualModel,
		...(variantEvidence ? { actualVariant } : {}),
	};
}

export function reviewerActorObservation(input: {
	readonly sessions: readonly {
		readonly id: string;
		readonly messages: readonly unknown[] | null;
	}[];
	readonly childEndpointFailed: boolean;
}): ObservedActor {
	const actor = extractObservedActor({
		role: "reviewer",
		sessions: input.sessions,
	});
	return input.childEndpointFailed
		? {
				...actor,
				actualModel: { kind: "unobserved", reason: "endpoint-failure" },
				...(actor.actualVariant
					? {
							actualVariant: {
								kind: "unobserved" as const,
								reason: "endpoint-failure" as const,
							},
						}
					: {}),
			}
		: actor;
}

export function guidanceLoad(
	input: Omit<ObservedGuidanceLoad, "utf8Bytes">,
): ObservedGuidanceLoad {
	return {
		...input,
		utf8Bytes: new TextEncoder().encode(input.rawOutput).byteLength,
	};
}
