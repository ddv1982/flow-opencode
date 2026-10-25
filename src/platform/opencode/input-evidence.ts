import { isDeepStrictEqual as same } from "node:util";
import type {
	OpenCodeEvent,
	SessionInboxSynthetic,
	SessionInboxUser,
	SessionMessageInfo,
	SessionPromptInput,
	SessionSyntheticInput,
} from "@opencode/client";
import type { SessionPrompt } from "@opencode/plugin/promise/session";
import { nativePromptPayload } from "./command-hook.js";
import type { InputOrigin } from "./execution-attribution.js";

export type Payload =
	| Omit<SessionPromptInput, "sessionID" | "id" | "delivery" | "resume">
	| Omit<SessionSyntheticInput, "sessionID" | "id" | "delivery" | "resume">;
export type InputReservation = Readonly<{
	host: string;
	id: string;
	epoch: number;
}>;
type AcceptedPayload =
	| SessionInboxUser["payload"]
	| SessionInboxSynthetic["payload"];
export type FailureFact = Readonly<{
	reservation: InputReservation;
	outcome:
		| "before-registration"
		| "private-rejected"
		| "after-acceptance"
		| "real-claim";
}>;
type AdmissionPhase =
	| Readonly<{ state: "pending"; acceptedPayload?: AcceptedPayload }>
	| Readonly<{
			state: "rejected";
			failure: FailureFact;
			acceptedPayload?: AcceptedPayload;
	  }>
	| Readonly<{
			state: "accepted";
			acceptedPayload: AcceptedPayload;
			origin: InputOrigin;
			failure: FailureFact | null;
	  }>;
export type Admission = {
	readonly kind: "private";
	readonly reservation: InputReservation;
	readonly type: "user" | "synthetic";
	readonly payload: Payload;
	readonly ready: Promise<InputOrigin>;
	readonly settle: (origin: InputOrigin) => void;
	readonly fail: (error: Error) => void;
	phase: AdmissionPhase;
};
export type InboxEvent = Extract<
	OpenCodeEvent,
	{
		type:
			| "session.inbox.enqueued"
			| "session.inbox.cancelled"
			| "session.inbox.delivered"
			| "session.inbox.delivery.changed";
	}
>;
type InboxEnqueued = Extract<InboxEvent, { type: "session.inbox.enqueued" }>;
type EnqueuedUserPayload = Extract<
	InboxEnqueued["data"]["item"],
	{ type: "user" }
>["payload"];
export type Observation = {
	seq: number;
	generation: number | null;
	item: InboxEnqueued["data"]["item"] | null;
	state: "pending" | "delivered" | "cancelled" | "unseen" | "consumed";
};
type RealState =
	| Readonly<{ kind: "deferred" }>
	| Readonly<{ kind: "immediate"; reservation: InputReservation }>
	| Readonly<{
			kind: "activating";
			token: symbol;
			reservation: InputReservation | null;
	  }>
	| Readonly<{
			kind: "settled";
			reservation: InputReservation | null;
			origin: InputOrigin | null;
			automaticHistory: boolean;
	  }>
	| Readonly<{
			kind: "failed";
			reservation: InputReservation | null;
			failure: FailureFact | null;
	  }>;
export type Real = {
	kind: "real";
	registration: symbol;
	prompt: SessionPrompt["prompt"];
	metadata: SessionPrompt["metadata"];
	state: RealState;
	observation: Observation | null;
	reuse: { cancelled: number; hook: boolean } | null;
};
type Alias = Readonly<{
	kind: "alias";
	source: Entry | undefined;
	origin: InputOrigin | null;
}>;
export type Entry =
	| Admission
	| Real
	| { kind: "observed"; observation: Observation }
	| Alias
	| Readonly<{ kind: "reserved"; reservation: InputReservation }>
	| Readonly<{ kind: "failed-reservation"; failure: FailureFact }>;
type History =
	| "retired-ordinary"
	| "retired-automatic"
	| "unknown-history"
	| "rejected";
export type SourceEvidence =
	| Readonly<{ kind: "unregistered"; lineage: History }>
	| Readonly<{ kind: "live"; origin: InputOrigin }>
	| Readonly<{ kind: History }>;

export function facts(entry: Entry | undefined): Readonly<{
	coverage: InputReservation | null;
	failure: FailureFact | null;
	history: History;
}> {
	if (!entry || entry.kind === "observed")
		return { coverage: null, failure: null, history: "unknown-history" };
	if (entry.kind === "alias") return facts(entry.source);
	if (entry.kind === "failed-reservation")
		return { coverage: null, failure: entry.failure, history: "rejected" };
	if (entry.kind === "reserved")
		return { coverage: entry.reservation, failure: null, history: "rejected" };
	if (entry.kind === "private") {
		const phase = entry.phase;
		return {
			coverage: entry.reservation,
			failure: phase.state === "pending" ? null : phase.failure,
			history:
				phase.state !== "accepted"
					? "rejected"
					: phase.origin.authority
						? "retired-automatic"
						: "retired-ordinary",
		};
	}
	const state = entry.state;
	return {
		coverage:
			state.kind === "deferred" || state.kind === "failed"
				? null
				: state.reservation,
		failure: state.kind === "failed" ? state.failure : null,
		history:
			state.kind === "failed"
				? "rejected"
				: state.kind === "settled" && state.automaticHistory
					? "retired-automatic"
					: "retired-ordinary",
	};
}

type TerminalTransition =
	| Readonly<{ kind: "unchanged" }>
	| Readonly<{ kind: "reserved"; next: Entry }>
	| Readonly<{ kind: "private"; phase: AdmissionPhase; reject: boolean }>
	| Readonly<{ kind: "real"; state: RealState }>;
export function terminalize(
	entry: Entry,
	owner:
		| Readonly<{ kind: "reservation"; reservation: InputReservation }>
		| Readonly<{ kind: "claim"; token: symbol }>,
): TerminalTransition | null {
	if (owner.kind === "claim") {
		if (
			entry.kind !== "real" ||
			entry.state.kind !== "activating" ||
			entry.state.token !== owner.token
		)
			return null;
		const reservation = entry.state.reservation;
		return {
			kind: "real",
			state: {
				kind: "failed",
				reservation,
				failure: reservation ? { reservation, outcome: "real-claim" } : null,
			},
		};
	}
	const reservation = owner.reservation;
	if (entry.kind === "reserved" && entry.reservation === reservation)
		return {
			kind: "reserved",
			next: {
				kind: "failed-reservation",
				failure: { reservation, outcome: "before-registration" },
			},
		};
	if (entry.kind === "private" && entry.reservation === reservation) {
		const phase = entry.phase;
		if (
			phase.state === "rejected" ||
			(phase.state === "accepted" && phase.failure)
		)
			return { kind: "unchanged" };
		return phase.state === "accepted"
			? {
					kind: "private",
					phase: {
						...phase,
						failure: { reservation, outcome: "after-acceptance" },
					},
					reject: false,
				}
			: {
					kind: "private",
					phase: {
						...phase,
						state: "rejected",
						failure: { reservation, outcome: "private-rejected" },
					},
					reject: true,
				};
	}
	return facts(entry).failure?.reservation === reservation
		? { kind: "unchanged" }
		: null;
}

export function checkReceipt(
	admission: Admission,
	receipt: SessionInboxUser | SessionInboxSynthetic,
): void {
	if (
		receipt.sessionID !== admission.reservation.host ||
		receipt.id !== admission.reservation.id ||
		receipt.type !== admission.type ||
		!matchesAdmissionPayload(admission.payload, receipt.payload)
	)
		throw new Error(
			"Flow admission receipt did not match its exact local payload.",
		);
}

export function matchesReal(
	entry: Real,
	payload: SessionInboxUser["payload"] | EnqueuedUserPayload,
): boolean {
	return (
		same(entry.metadata ?? {}, payload.metadata ?? {}) &&
		matchesAdmissionPayload(nativePromptPayload(entry.prompt), payload, false)
	);
}

export function checkConsumed(
	entry: Entry,
	id: string,
	native: readonly SessionMessageInfo[],
	final: boolean,
	classify: (origin: InputOrigin) => SourceEvidence,
): SourceEvidence {
	if (entry.kind === "reserved" || entry.kind === "failed-reservation") {
		if (!final) throw new Error("Flow execution epoch was revoked.");
		return { kind: "rejected" };
	}
	if (entry.kind === "alias") {
		if (facts(entry).history === "rejected") return { kind: "rejected" };
		return entry.origin
			? classify(entry.origin)
			: { kind: facts(entry).history };
	}
	if (entry.kind === "observed")
		return { kind: "unregistered", lineage: "unknown-history" };
	const message = native.find((message) => message.id === id);
	if (entry.kind === "real") {
		if (message?.type !== "user" || !matchesReal(entry, message))
			throw new Error(
				"Flow context has an unknown, synthetic, or stale real input.",
			);
		if (
			entry.state.kind === "activating" ||
			(entry.state.kind === "failed" && final)
		)
			throw new Error("Flow execution epoch was revoked.");
		return entry.state.kind === "settled" && entry.state.origin
			? classify(entry.state.origin)
			: { kind: facts(entry).history };
	}
	const phase = entry.phase;
	if (final && phase.state === "rejected") return { kind: "rejected" };
	if (
		!message ||
		message.type !== entry.type ||
		(message.type !== "user" && message.type !== "synthetic")
	)
		throw new Error(
			"Flow native input type conflicts with its admitted dispatch.",
		);
	if (phase.state !== "accepted" && !final) {
		if (!matchesAdmissionPayload(entry.payload, message))
			throw new Error(
				"Flow native input payload conflicts with its admitted dispatch.",
			);
		return { kind: "rejected" };
	}
	const { id: _id, time: _time, type: _type, ...payload } = message;
	if (!same(payload, phase.acceptedPayload))
		throw new Error(
			"Flow native input payload conflicts with its admitted dispatch.",
		);
	if (phase.state !== "accepted")
		throw new Error("Flow admitted input has no settled origin.");
	return classify(phase.origin);
}
function matchesAdmissionPayload(
	expected: Admission["payload"],
	actual:
		| SessionInboxUser["payload"]
		| SessionInboxSynthetic["payload"]
		| EnqueuedUserPayload,
	checkMetadata = true,
): boolean {
	if (
		expected.text !== actual.text ||
		(checkMetadata && !same(expected.metadata ?? {}, actual.metadata ?? {}))
	)
		return false;
	if ("description" in expected || "description" in actual)
		return (
			("description" in expected ? expected.description : undefined) ===
			("description" in actual ? actual.description : undefined)
		);
	const files = "files" in expected ? (expected.files ?? []) : [];
	const nativeFiles = "files" in actual ? (actual.files ?? []) : [];
	if (
		files.length !== nativeFiles.length ||
		files.some((file, i) => {
			const native = nativeFiles[i];
			if (
				!native ||
				file.name !== native.name ||
				file.description !== native.description ||
				!same(file.mention, native.mention)
			)
				return true;
			if (native.source.type === "uri") return native.source.uri !== file.uri;
			const match = /^data:([^;,]+);base64,(.*)$/s.exec(file.uri);
			return !match || match[1] !== native.mime || match[2] !== native.data;
		})
	)
		return false;
	const agents = "agents" in expected ? (expected.agents ?? []) : [];
	const nativeAgents = "agents" in actual ? (actual.agents ?? []) : [];
	if (!same(agents, nativeAgents)) return false;
	const skills = "skills" in expected ? (expected.skills ?? []) : [];
	const nativeSkills = "skills" in actual ? (actual.skills ?? []) : [];
	return (
		skills.length === nativeSkills.length &&
		skills.every(
			(skill, i) =>
				skill.id === nativeSkills[i]?.id &&
				same(skill.mention, nativeSkills[i]?.mention),
		)
	);
}
