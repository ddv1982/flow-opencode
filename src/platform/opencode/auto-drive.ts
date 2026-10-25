import type { PreparedValidation } from "../../application/prepare-validation.js";
import type { RecoveryController } from "../../application/recovery-policy.js";
import type { SourceDigest } from "../../domain/session.js";
import { FLOW_MANAGER_KERNEL } from "../../guidance/catalog.js";
import {
	decideOnIdle,
	type IdleDecision,
	isHandback,
	isPendingReviewer,
} from "./auto-drive-decision.js";
import {
	AutoDriveDispatch,
	type AutomaticPrompt,
	type DispatchCapture,
	type DispatchIntent,
	type IdleOwner,
	type SendEffect,
} from "./auto-drive-dispatch.js";
import {
	AUTO_INITIAL_PROMPT,
	autoCompactionMessage,
	autoHandbackMessage,
	CONTINUATION_ROUTE,
} from "./auto-drive-messages.js";
import {
	type AutoValidationOrigin,
	type AutoValidationReceipt,
	type ValidationContinuationOutcome,
	validationContinuationOutcome,
	validationReceiptMatches,
} from "./auto-drive-validation.js";

export type {
	AutoValidationOrigin,
	AutoValidationReceipt,
} from "./auto-drive-validation.js";
export const FLOW_AUTO_METADATA_KEY = "opencode-plugin-flow/auto";
export type AutoGoalIntent =
	| "inspection-deliverable"
	| "plan-only"
	| "uncertain";
export interface AutoDriveProjection {
	readonly sessionId?: string | undefined;
	readonly status: string;
	readonly revision: number;
	readonly nextAction: string | null;
	readonly prerequisiteRepair?:
		| Readonly<{
				featureId: string;
				runId: string;
				validationId: string;
				sourceDigest: SourceDigest;
				boundary: string;
		  }>
		| undefined;
}
type AutoDriveDisposition =
	| Readonly<{ state: "active"; reason: "invocation" | "continuation" }>
	| Readonly<{ state: "waiting"; reason: "plan-approval" | "user-direction" }>
	| Readonly<{
			state: "paused";
			reason:
				| "stalled"
				| "validation-failed"
				| "validation-ineligible"
				| "manual-command"
				| "handback";
	  }>
	| Readonly<{
			state: "inactive";
			reason:
				| "interrupted"
				| "cancelled"
				| "restarted"
				| "unsupported"
				| "missing-lineage"
				| "unowned"
				| "no-progress"
				| "no-delivery"
				| "completed"
				| "unsupported-action"
				| "status-error"
				| "prompt-error";
	  }>;
export type AutoContinuationSnapshot = AutoDriveDisposition &
	Readonly<{
		scope: "current-plugin-process";
	}>;
interface AutoDriveMessagePart {
	readonly type?: string;
	readonly text?: string;
	readonly synthetic?: boolean;
	readonly metadata?: Readonly<Record<string, unknown>>;
}
export type AutoDriveAuthority = Readonly<{
	hostSessionId: string;
	token: string;
	epoch: number;
}>;
export interface AutoDriveDelivery {
	readonly agent: string;
	readonly model: Readonly<{ providerID: string; modelID: string }>;
	readonly variant?: string | undefined;
}

export function autoDriveDelivery(
	message: Readonly<{
		agent: string;
		model: AutoDriveDelivery["model"] & Readonly<{ variant?: unknown }>;
	}>,
	requestedVariant?: string,
): AutoDriveDelivery {
	const variant = Object.hasOwn(message.model, "variant")
		? typeof message.model.variant === "string"
			? message.model.variant
			: undefined
		: requestedVariant;
	return {
		agent: message.agent,
		model: {
			providerID: message.model.providerID,
			modelID: message.model.modelID,
		},
		...(variant === undefined ? {} : { variant }),
	};
}
export type ProcessLocalAutoContinuationSupport =
	| "supported"
	| "unsupported"
	| "unknown";
export interface AutoTimingSnapshot {
	readonly scope: "latest-flow-auto-in-current-plugin-process";
	readonly authoritative: false;
	readonly state: "active" | "waiting-for-user" | "paused" | "inactive";
	readonly activeMs: number;
	readonly waitingForUserMs: number;
	readonly pausedTimeExcluded: true;
}
type Lease = {
	hostSessionId: string;
	requestGoal: string;
	newlyAnchoredSessionId: string | null;
	intent: AutoGoalIntent;
	token: string;
	baseline: AutoDriveProjection | null;
	send: AutoDriveDispatch;
	inFlight: "status" | "reply-status" | "prompt" | null;
	idlePending: boolean;
	assistantOrigins: Map<string, string>;
	validation: {
		revision: number;
		outcome: ValidationContinuationOutcome;
		sourceDigest: SourceDigest;
		checked: boolean;
		validationId: string;
		featureId: string;
		runId: string;
	} | null;
};
type TimingField = "state" | "activeMs" | "waitingForUserMs";
type Timing = {
	-readonly [Key in TimingField]: AutoTimingSnapshot[Key];
} & { since: number };
type AutoDriveOptions = Readonly<{
	recovery?: RecoveryController;
	readProjection: () => Promise<AutoDriveProjection>;
	readSourceDigest?: () => Promise<SourceDigest>;
	prompt: AutomaticPrompt;
	onWarning?: ((message: string) => void) | undefined;
	createToken?: (() => string) | undefined;
	now?: (() => number) | undefined;
}>;
const STOP = /^(?:(?:stop|cancel) \/flow-auto|\/flow-auto (?:stop|cancel))$/i;

function inspectMessage(parts: readonly AutoDriveMessagePart[]) {
	let token: string | null = null;
	let text = "";
	let user = false;
	for (const part of parts) {
		if (part.synthetic === true) {
			const value = part.metadata?.[FLOW_AUTO_METADATA_KEY];
			if (typeof value === "string") token = value;
		} else {
			user = true;
			text += ` ${part.text ?? ""}`;
		}
	}
	return { token, user, text: text.trim().replace(/\s+/g, " ") };
}
export class AutoDriveCoordinator {
	#lease: Lease | null = null;
	#timing: Timing | null = null;
	#disposition: AutoDriveDisposition | null = null;
	#dispositionHost: string | null = null;
	readonly #validationOrigins = new WeakMap<AutoValidationOrigin, Lease>();
	readonly #options: AutoDriveOptions;
	#repairSession: string | undefined;
	readonly #repairHandoffs = new Set<string>();
	#epoch = 0;
	#authorityReady = false;
	constructor(options: AutoDriveOptions) {
		this.#options = options;
	}
	#now(): number {
		return this.#options.now?.() ?? performance.now();
	}
	#setTiming(state: Timing["state"]): void {
		const timing = this.#timing;
		if (!timing) return;
		const now = this.#now();
		const elapsed = Math.max(0, now - timing.since);
		if (timing.state === "active") timing.activeMs += elapsed;
		if (timing.state === "waiting-for-user") timing.waitingForUserMs += elapsed;
		timing.state = state;
		timing.since = now;
		if (state === "active" && this.#disposition?.state !== "active")
			this.#disposition = { state: "active", reason: "continuation" };
		if (state === "waiting-for-user" && this.#disposition?.state !== "waiting")
			this.#disposition = { state: "waiting", reason: "user-direction" };
	}
	#warn(message: string): void {
		try {
			this.#options.onWarning?.(message);
		} catch {}
	}
	#stop(
		lease: Lease,
		warning?: string,
		reason: Extract<
			AutoDriveDisposition,
			{ state: "inactive" }
		>["reason"] = "no-progress",
	): void {
		if (this.#lease !== lease) return;
		this.deactivate(lease.hostSessionId, reason);
		if (warning) this.#warn(warning);
	}
	#rejectOrigin(lease: Lease, kind: "compaction" | "mutation"): void {
		this.#stop(
			lease,
			`Flow: ${kind} origin was unavailable.`,
			"missing-lineage",
		);
	}
	#waitAt(lease: Lease, revision: number): void {
		lease.send.waitAt(revision);
		this.#setTiming("waiting-for-user");
	}
	#waiting(lease: Lease, projection: AutoDriveProjection): void {
		this.#disposition = {
			state: "waiting",
			reason:
				projection.nextAction === "flow_plan_approve"
					? "plan-approval"
					: "user-direction",
		};
		this.#waitAt(lease, projection.revision);
	}
	async #send(
		lease: Lease,
		text: string,
		effect: SendEffect,
		clearPendingReply: boolean,
		owner?: IdleOwner,
	): Promise<void> {
		const capture = this.captureDispatch(lease.hostSessionId, lease.token);
		if (!capture || !lease.send.delivery || (owner && !owner.current())) return;
		lease.inFlight = "prompt";
		try {
			const result = await lease.send.send(
				this.#options.prompt,
				lease.hostSessionId,
				text,
				{ [FLOW_AUTO_METADATA_KEY]: lease.token },
				effect,
				clearPendingReply,
				capture,
				owner,
			);
			if (result.kind === "withheld") lease.idlePending = false;
		} catch (error) {
			if (
				(!owner || owner.current()) &&
				(capture.current() ||
					(this.#lease === lease &&
						this.#epoch === capture.authority.epoch &&
						lease.token === capture.authority.token))
			)
				this.#stop(
					lease,
					`Flow auto prompt failed: ${String(error)}`,
					"prompt-error",
				);
		}
	}
	async resumeDeferred(host: string): Promise<void> {
		const lease = this.#lease;
		if (lease?.hostSessionId !== host) return;
		const owner = await lease.send.takeDeferred();
		if (owner && this.#lease === lease) await this.onIdle(host, owner);
	}
	async #read(
		lease: Lease,
		owner?: IdleOwner,
	): Promise<AutoDriveProjection | null> {
		const epoch = this.#epoch;
		try {
			const projection = await Promise.race([
				this.#options.readProjection(),
				lease.send.cancelled,
			]);
			return this.#epoch === epoch ? projection : null;
		} catch (error) {
			if (this.#epoch !== epoch || (owner && !owner.current())) return null;
			this.#stop(
				lease,
				`Flow auto status failed: ${String(error)}`,
				"status-error",
			);
			return null;
		}
	}
	createInvocationToken(): string {
		return this.#options.createToken?.() ?? crypto.randomUUID();
	}
	async activate(
		hostSessionId: string,
		requestGoal = "",
		options: Readonly<{
			token?: string;
			newlyAnchoredSessionId?: string | null;
			intent?: AutoGoalIntent;
		}> = {},
	): Promise<Record<string, unknown>> {
		this.#lease?.send.invalidate();
		this.#epoch++;
		this.#authorityReady = true;
		const token = options.token ?? this.createInvocationToken();
		this.#disposition = { state: "active", reason: "invocation" };
		this.#dispositionHost = hostSessionId;
		this.#timing = {
			state: "active",
			since: this.#now(),
			activeMs: 0,
			waitingForUserMs: 0,
		};
		this.#lease = {
			hostSessionId,
			requestGoal,
			newlyAnchoredSessionId: options.newlyAnchoredSessionId ?? null,
			intent: options.intent ?? "uncertain",
			token,
			baseline: null,
			send: new AutoDriveDispatch(this.#repairHandoffs),
			inFlight: null,
			idlePending: false,
			assistantOrigins: new Map(),
			validation: null,
		};
		const lease = this.#lease;
		const baseline = await this.#read(lease);
		if (this.#lease !== lease) throw new Error("Flow auto-drive superseded.");
		if (!baseline) throw new Error("Flow auto-drive compact status failed.");
		lease.baseline = baseline;
		if (!isPendingReviewer(baseline))
			lease.send.checkpoint = { revision: baseline.revision, answered: false };
		return { [FLOW_AUTO_METADATA_KEY]: token };
	}
	deactivate(
		hostSessionId: string,
		reason: Extract<
			AutoDriveDisposition,
			{ state: "inactive" }
		>["reason"] = "interrupted",
	): boolean {
		if (this.#lease?.hostSessionId !== hostSessionId) return false;
		this.clear(reason);
		return true;
	}
	async resumeForCommand(hostSessionId: string): Promise<string | null> {
		const lease = this.#lease;
		if (lease?.hostSessionId !== hostSessionId) return null;
		const projection = await this.#read(lease);
		if (this.#lease !== lease || !projection) return null;
		if (
			projection.sessionId !== lease.baseline?.sessionId ||
			projection.revision <
				(lease.send.manualContinuation?.revision ??
					lease.send.checkpoint?.revision ??
					0) ||
			!["blocked", "ready", "running"].includes(projection.status)
		) {
			this.#stop(lease);
			return null;
		}
		if (projection.nextAction === "await-user-direction") {
			lease.send.checkpoint = {
				revision: projection.revision,
				answered: false,
			};
			lease.send.manualContinuation = null;
		} else {
			lease.send.checkpoint = null;
			lease.send.manualContinuation = { revision: projection.revision };
		}
		return lease.token;
	}
	clear(
		reason: Extract<
			AutoDriveDisposition,
			{ state: "inactive" }
		>["reason"] = "restarted",
	): void {
		this.#epoch++;
		this.#options.recovery?.revoke();
		if (this.#lease) {
			this.#setTiming("inactive");
			this.#disposition = { state: "inactive", reason };
		}
		this.#lease?.send.invalidate();
		this.#lease = null;
	}
	async observeMessage(
		hostSessionId: string,
		delivery: AutoDriveDelivery,
		parts: readonly AutoDriveMessagePart[],
		messageId: string,
		intent?: DispatchIntent,
	): Promise<"accepted" | "accepted-continuation" | "stale-continuation"> {
		const lease = this.#lease;
		const message = inspectMessage(parts);
		if (lease?.hostSessionId === hostSessionId && STOP.test(message.text)) {
			this.deactivate(hostSessionId, "cancelled");
			return "accepted";
		}
		if (message.token !== null) {
			if (
				!lease ||
				lease.hostSessionId !== hostSessionId ||
				lease.token !== message.token
			)
				return "stale-continuation";
			const activation = lease.send.activate(intent, messageId, delivery);
			this.#authorityReady = true;
			this.#setTiming(activation.timing);
			if (activation.disposition === "continuation")
				this.#disposition = { state: "active", reason: "continuation" };
			if (
				activation.disposition === "plan-approval" ||
				activation.disposition === "user-direction"
			)
				this.#disposition = {
					state: "waiting",
					reason: activation.disposition,
				};
			if (activation.disposition === "handback")
				this.#disposition = { state: "paused", reason: "handback" };
			return "accepted-continuation";
		}
		if (lease?.hostSessionId !== hostSessionId || !message.user)
			return "accepted";
		if (lease.send.ownInspectDraft?.prompted) {
			this.deactivate(hostSessionId);
			return "accepted";
		}
		lease.send.ownInspectDraft = null;
		if (lease.send.checkpoint?.answered || lease.send.pendingReply) {
			this.deactivate(hostSessionId);
			return "accepted";
		}
		if (lease.send.checkpoint) delete lease.send.checkpoint.advance;
		if (
			(!lease.send.checkpoint || lease.send.replacesCheckpoint) &&
			lease.inFlight !== "status"
		)
			this.deactivate(hostSessionId);
		else {
			this.#authorityReady = true;
			lease.token = crypto.randomUUID();
			lease.send.messageId = messageId;
			lease.send.delivery = delivery;
			lease.send.pendingReply = true;
			if (!lease.inFlight) await this.onIdle(hostSessionId);
		}
		return "accepted";
	}
	compactionContext(hostSessionId: string): string | null {
		if (this.#lease?.hostSessionId !== hostSessionId) return null;
		return autoCompactionMessage();
	}
	captureAuthority(host: string, token?: string): AutoDriveAuthority | null {
		const lease = this.#lease;
		if (
			!this.#authorityReady ||
			!lease ||
			lease.hostSessionId !== host ||
			(token !== undefined && lease.token !== token)
		)
			return null;
		return Object.freeze({
			hostSessionId: host,
			token: lease.token,
			epoch: this.#epoch,
		});
	}
	captureDispatch(
		host: string,
		token: string,
		intent?: DispatchIntent,
	): DispatchCapture | null {
		const authority = this.captureAuthority(host, token),
			lease = this.#lease;
		if (!authority || !lease) return null;
		const source = lease.send.messageId;
		return Object.freeze({
			authority,
			source,
			current: () =>
				this.#lease === lease &&
				this.isAuthorityCurrent(authority) &&
				lease.send.messageId === source &&
				(!intent || lease.send.isPrepared(intent)),
		});
	}
	isAuthorityCurrent(authority: AutoDriveAuthority, source?: string): boolean {
		return (
			this.#authorityReady &&
			this.#lease?.hostSessionId === authority.hostSessionId &&
			this.#lease.token === authority.token &&
			this.#epoch === authority.epoch &&
			(source === undefined || this.#lease.send.messageId === source)
		);
	}
	revokeExecutions(host: string): void {
		if (this.#lease?.hostSessionId !== host) return;
		this.#epoch++;
		this.#authorityReady = false;
		this.#lease.assistantOrigins.clear();
		this.#lease.send.renew();
	}
	observeAssistant(host: string, assistantId: string, origin: string): void {
		const lease = this.#lease;
		if (lease?.hostSessionId !== host) return;
		const prior = lease.assistantOrigins.get(assistantId);
		if (prior !== undefined && prior !== origin)
			return void this.#rejectOrigin(lease, "mutation");
		lease.assistantOrigins.set(assistantId, origin);
	}
	observeCompaction(
		host: string,
		authority: AutoDriveAuthority,
		source: string,
		controlID: string,
	): void {
		const lease = this.#lease;
		if (!lease || lease.hostSessionId !== host) return;
		if (!this.isAuthorityCurrent(authority) || lease.send.messageId !== source)
			return void this.#rejectOrigin(lease, "compaction");
		lease.send.messageId = controlID;
		this.#options.recovery?.observeMessage(host, controlID, true, true);
	}
	observeMutation(
		host: string,
		revision: number,
		created: string | undefined,
		assistantId: string,
		reviewerPending: boolean,
		mutation?: Readonly<{
			tool: string;
			goal: string;
			features: ReadonlyArray<Readonly<{ kind?: string | undefined }>>;
		}>,
	): void {
		const lease = this.#lease;
		if (
			!this.#authorityReady ||
			lease?.hostSessionId !== host ||
			!lease.send.messageId
		)
			return;
		const origin = lease.assistantOrigins.get(assistantId);
		if (origin === undefined) return void this.#rejectOrigin(lease, "mutation");
		if (origin !== lease.send.messageId) return;
		lease.validation = null;
		const baseline = lease.baseline;
		const freshIdle =
			baseline?.status === "idle" && baseline.sessionId === undefined;
		const freshAnchor =
			lease.newlyAnchoredSessionId !== null &&
			baseline?.status === "planning" &&
			baseline.revision === 0 &&
			baseline.nextAction === "flow_plan_save" &&
			baseline.sessionId === lease.newlyAnchoredSessionId;
		if (
			(freshIdle || freshAnchor) &&
			lease.intent === "inspection-deliverable" &&
			created &&
			(!freshAnchor || created === lease.newlyAnchoredSessionId) &&
			revision === 1 &&
			mutation?.tool === "flow_plan_save" &&
			lease.requestGoal.trim().length > 0 &&
			mutation.goal === lease.requestGoal.trim() &&
			mutation.features.length > 0 &&
			mutation.features.every((feature) => feature.kind === "inspect")
		)
			lease.send.ownInspectDraft = {
				sessionId: created,
				revision,
				prompted: false,
			};
		if (baseline && baseline.sessionId === undefined && created)
			lease.baseline = { ...baseline, sessionId: created };
		const point = lease.send.checkpoint;
		if (!point) return;
		if (revision > point.revision)
			point.advance = revision + Number(reviewerPending);
	}
	validationOrigin(
		hostSessionId: string,
		assistantId: string,
		prepared: Pick<
			PreparedValidation,
			| "featureId"
			| "runId"
			| "sourceDigest"
			| "command"
			| "scope"
			| "hostPlatform"
			| "intent"
			| "declaredPlatform"
			| "assertions"
		>,
	): AutoValidationOrigin | null {
		const lease = this.#lease;
		if (
			!this.#authorityReady ||
			lease?.hostSessionId !== hostSessionId ||
			!lease.send.messageId ||
			!lease.baseline?.sessionId
		)
			return null;
		const source = lease.assistantOrigins.get(assistantId);
		if (source === undefined) {
			this.#rejectOrigin(lease, "mutation");
			return null;
		}
		if (source !== lease.send.messageId) return null;
		const origin: AutoValidationOrigin = {
			hostSessionId,
			sessionId: lease.baseline.sessionId,
			authority: lease.send.messageId,
			assistantId,
			featureId: prepared.featureId,
			runId: prepared.runId,
			sourceDigest: prepared.sourceDigest,
			command: prepared.command,
			scope: prepared.scope,
			hostPlatform: prepared.hostPlatform,
			intent: prepared.intent,
			...(prepared.declaredPlatform !== undefined
				? { declaredPlatform: prepared.declaredPlatform }
				: {}),
			assertions: [...prepared.assertions],
		};
		this.#validationOrigins.set(origin, lease);
		return origin;
	}
	observeValidation(receipt: AutoValidationReceipt): void {
		const { origin, observation } = receipt;
		const lease = this.#lease;
		const owner = this.#validationOrigins.get(origin);
		this.#validationOrigins.delete(origin);
		if (
			!lease ||
			owner !== lease ||
			lease.hostSessionId !== origin.hostSessionId ||
			lease.baseline?.sessionId !== origin.sessionId ||
			lease.send.messageId !== origin.authority ||
			lease.assistantOrigins.get(origin.assistantId) !== origin.authority ||
			!validationReceiptMatches(receipt)
		)
			return;
		const checkpoint = lease.send.checkpoint;
		if (
			!checkpoint ||
			observation.recordedRevision <= checkpoint.revision ||
			observation.recordedRevision <= (lease.validation?.revision ?? -1)
		)
			return;
		const outcome = validationContinuationOutcome(origin, observation);
		lease.validation = {
			revision: observation.recordedRevision,
			outcome,
			sourceDigest: observation.sourceDigest,
			checked: false,
			validationId: observation.id,
			featureId: observation.featureId,
			runId: observation.runId,
		};
		if (outcome !== "ineligible")
			checkpoint.advance = observation.recordedRevision;
	}
	continuationSnapshot(hostSessionId: string): AutoContinuationSnapshot | null {
		return this.#disposition && this.#dispositionHost === hostSessionId
			? { scope: "current-plugin-process", ...this.#disposition }
			: null;
	}
	continuationSupport(): ProcessLocalAutoContinuationSupport {
		return "supported";
	}
	timingSnapshot(): AutoTimingSnapshot | null {
		const timing = this.#timing;
		if (!timing) return null;
		const elapsed = Math.max(0, this.#now() - timing.since);
		return {
			scope: "latest-flow-auto-in-current-plugin-process",
			authoritative: false,
			state: timing.state,
			activeMs: timing.activeMs + (timing.state === "active" ? elapsed : 0),
			waitingForUserMs:
				timing.waitingForUserMs +
				(timing.state === "waiting-for-user" ? elapsed : 0),
			pausedTimeExcluded: true,
		};
	}
	async onIdle(hostSessionId: string, owner?: IdleOwner): Promise<void> {
		const lease = this.#lease;
		if (!lease || lease.hostSessionId !== hostSessionId) return;
		const epoch = this.#epoch;
		if (!this.#authorityReady || (owner && !owner.current())) return;
		const capture = this.captureDispatch(hostSessionId, lease.token);
		if (!capture) return;
		if (lease.inFlight) {
			if (
				lease.inFlight !== "reply-status" ||
				!lease.send.pendingReply ||
				lease.send.checkpoint?.advance !== undefined
			)
				lease.idlePending = true;
			return;
		}
		lease.inFlight = lease.send.pendingReply ? "reply-status" : "status";
		try {
			const projection = await this.#read(lease, owner);
			if (!projection) return;
			if (
				this.#lease !== lease ||
				this.#epoch !== epoch ||
				(owner && !owner.current())
			)
				return;
			const baseline = lease.baseline;
			if (!baseline) return this.#stop(lease);
			if (lease.send.manualContinuation) {
				if (
					projection.sessionId !== baseline.sessionId ||
					projection.revision < lease.send.manualContinuation.revision
				)
					return this.#stop(lease, undefined, "unowned");
				if (
					(projection.status === "ready" || projection.status === "running") &&
					projection.nextAction !== "await-user-direction"
				) {
					lease.send.manualContinuation.revision = projection.revision;
					this.#setTiming("paused");
					this.#disposition = { state: "paused", reason: "manual-command" };
					return;
				}
				lease.send.manualContinuation = null;
			}
			const draft = lease.send.ownInspectDraft;
			if (
				draft &&
				!draft.prompted &&
				!lease.send.pendingReply &&
				projection.sessionId === draft.sessionId &&
				projection.revision === draft.revision &&
				projection.status === "planning" &&
				projection.nextAction === "flow_plan_approve" &&
				lease.send.delivery
			) {
				await this.#send(
					lease,
					`The accepted draft belongs to this /flow-auto invocation, keeps its exact goal, and contains only inspect features. Approve this one draft, then continue the ordinary Flow lifecycle. Do not edit product files.\n\n${FLOW_MANAGER_KERNEL}`,
					{ kind: "draft", draft },
					false,
					owner,
				);
				return;
			}
			const validation = lease.validation;
			if (
				validation &&
				!validation.checked &&
				validation.revision === projection.revision
			) {
				const authority = lease.send.messageId;
				let currentSource: SourceDigest | undefined;
				try {
					const read = this.#options.readSourceDigest?.();
					currentSource = read
						? await Promise.race([read, lease.send.cancelled])
						: undefined;
				} catch {
					currentSource = undefined;
				}
				if (
					this.#lease !== lease ||
					this.#epoch !== epoch ||
					lease.send.messageId !== authority ||
					lease.validation !== validation ||
					!capture.current() ||
					(owner !== undefined && !owner.current())
				)
					return;
				validation.checked = true;
				if (currentSource !== validation.sourceDigest)
					validation.outcome = "ineligible";
			}
			if (this.#repairSession !== projection.sessionId) {
				this.#repairSession = projection.sessionId;
				this.#repairHandoffs.clear();
			}
			const repair = projection.prerequisiteRepair;
			const repairKey = repair
				? JSON.stringify([
						projection.sessionId,
						repair.featureId,
						repair.boundary,
					])
				: null;
			const repairAvailable =
				!!repair &&
				!!validation &&
				validation.checked &&
				validation.outcome === "failed" &&
				repair.validationId === validation.validationId &&
				repair.runId === validation.runId &&
				repair.featureId === validation.featureId &&
				repair.sourceDigest === validation.sourceDigest &&
				repairKey !== null &&
				!this.#repairHandoffs.has(repairKey);
			const decision: IdleDecision = decideOnIdle(
				{
					baseline,
					checkpoint: lease.send.checkpoint,
					pendingReply: lease.send.pendingReply,
					lastPromptedRevision: lease.send.lastPromptedRevision,
					hasDelivery: lease.send.delivery !== null,
					validation: lease.validation,
					repairHandoffAvailable: repairAvailable,
				},
				projection,
			);
			const clearPendingReply =
				lease.send.pendingReply && projection.status !== "idle";
			if (
				![
					"prompt-initial",
					"continue",
					"handback-and-wait",
					"handback-or-deactivate",
				].includes(decision.kind) &&
				clearPendingReply
			)
				lease.send.pendingReply = false;
			const proposal =
				(projection.status === "blocked" || projection.status === "ready") &&
				decision.kind === "handback-and-wait"
					? this.#options.recovery?.prepareProposalPrompt(
							hostSessionId,
							projection.sessionId,
							projection.revision,
							projection.nextAction,
						)
					: null;
			if (proposal && lease.send.delivery) {
				await this.#send(
					lease,
					proposal.text,
					{ kind: "recovery", revision: projection.revision, proposal },
					clearPendingReply,
					owner,
				);
				return;
			}
			switch (decision.kind) {
				case "deactivate":
					return void this.deactivate(
						hostSessionId,
						(projection.status === "idle" &&
							baseline.sessionId !== undefined) ||
							(projection.nextAction === null &&
								["completed", "closed"].includes(projection.status))
							? "completed"
							: "no-progress",
					);
				case "stop":
					return this.#stop(
						lease,
						decision.warning,
						projection.sessionId !== baseline.sessionId
							? "unowned"
							: !lease.send.delivery
								? "no-delivery"
								: "no-progress",
					);
				case "prompt-initial":
					await this.#send(
						lease,
						AUTO_INITIAL_PROMPT,
						{ kind: "initial" },
						clearPendingReply,
						owner,
					);
					return;
				case "handback-and-wait":
				case "handback-or-deactivate": {
					const needed =
						isHandback(projection) &&
						lease.send.handbackPromptedRevision !== projection.revision &&
						lease.send.delivery;
					if (needed)
						await this.#send(
							lease,
							autoHandbackMessage(projection),
							{ kind: decision.kind, projection },
							clearPendingReply,
							owner,
						);
					else if (decision.kind === "handback-and-wait") {
						if (clearPendingReply) lease.send.pendingReply = false;
						this.#waiting(lease, projection);
					} else this.deactivate(hostSessionId, "unsupported-action");
					return;
				}
				case "answered":
					if (lease.send.checkpoint) lease.send.checkpoint.answered = true;
					this.#setTiming("active");
					return;

				case "pause":
					if (decision.clearCheckpoint) lease.send.checkpoint = null;
					this.#setTiming("paused");
					this.#disposition = {
						state: "paused",
						reason:
							lease.validation?.outcome === "failed"
								? "validation-failed"
								: lease.validation?.outcome === "ineligible"
									? "validation-ineligible"
									: "stalled",
					};
					return this.#warn(decision.warning);
				case "continue": {
					const continuation = [
						`Continue the same user-authorized /flow-auto lifecycle from compact revision ${projection.revision}.`,
						"Call flow_status with the compact view first.",
						CONTINUATION_ROUTE,
						decision.repairHandoff
							? "A complete failed required gate permits one bounded same-goal prerequisite handoff. Use flow_plan_amend before repair edits. Preserve test discovery, assertions, and acceptance criteria; never exclude or skip existing tests. Test the supported reversible remedy, then rerun the unchanged command. Do not infer new outcome or external-action authority."
							: `Then follow ${projection.nextAction} without expanding the approved goal.`,
					].join(" ");
					await this.#send(
						lease,
						`${continuation}\n\n${FLOW_MANAGER_KERNEL}`,
						{
							kind: "continuation",
							revision: projection.revision,
							clearCheckpoint: decision.clearCheckpoint,
							repairKey: decision.repairHandoff ? repairKey : null,
						},
						clearPendingReply,
						owner,
					);
					return;
				}
				default: {
					const unhandled: never = decision;
					throw new Error(
						`Unhandled auto-drive decision: ${String(unhandled)}`,
					);
				}
			}
		} finally {
			if (this.#lease === lease) {
				const rerun = lease.idlePending && !lease.send.deferred;
				lease.idlePending = false;
				lease.inFlight = null;
				if (rerun && this.#epoch === epoch && (!owner || owner.current()))
					await this.onIdle(hostSessionId, owner);
			}
		}
	}
}
