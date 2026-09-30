import type { PreparedValidation } from "../../application/prepare-validation.js";
import type { RecoveryController } from "../../application/recovery-policy.js";
import type {
	SourceDigest,
	ValidationObservation,
} from "../../domain/session.js";
import { assertionsSatisfied } from "../../domain/test-results.js";
import { FLOW_MANAGER_KERNEL } from "../../guidance/catalog.js";
import {
	decideOnIdle,
	type IdleDecision,
	isHandback,
	isPendingReviewer,
} from "./auto-drive-decision.js";
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
export type AutoValidationOrigin = Readonly<{
	hostSessionId: string;
	sessionId: string;
	authority: string;
	assistantId: string;
	assertions: readonly string[];
}> &
	Pick<ValidationObservation, "featureId" | "runId" | "sourceDigest">;
export type AutoValidationReceipt = Readonly<{
	origin: AutoValidationOrigin;
	captureId: string;
	observation: ValidationObservation;
}>;
interface AutoDriveMessagePart {
	readonly type?: string;
	readonly text?: string;
	readonly synthetic?: boolean;
	readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface AutoDriveDelivery {
	readonly agent: string;
	readonly model: Readonly<{ providerID: string; modelID: string }>;
	readonly variant?: string | undefined;
}

/** OpenCode stores the resolved variant inside the model but accepts it beside it. */
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
type HostMessage = Record<"id" | "role", string> & {
	parentID?: string;
	summary?: unknown;
};
type HostPart = { type: string; messageID: string; auto?: boolean };
type Compaction = Record<"authority" | "user", string> &
	Partial<Record<"summary" | "successor", string>>;
type Checkpoint = { revision: number; answered: boolean; advance?: number };
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
/** The single in-memory continuation lease; nothing here is durable. */
type Lease = {
	hostSessionId: string;
	requestGoal: string;
	newlyAnchoredSessionId: string | null;
	intent: AutoGoalIntent;
	token: string;
	baseline: AutoDriveProjection | null;
	delivery: AutoDriveDelivery | null;
	lastPromptedRevision: number | null;
	handbackPromptedRevision: number | null;
	checkpoint: Checkpoint | null;
	pendingReply: boolean;
	/** Serializes work so concurrent idle events cannot double-prompt. */
	inFlight: "status" | "reply-status" | "prompt" | null;
	idlePending: boolean;
	messageId: string | null;
	assistantParents: Map<string, string>;
	lastAssistantParent: string | null;
	compaction: Compaction | null;
	manualContinuation: { revision: number } | null;
	validation: {
		revision: number;
		outcome: "passed" | "failed" | "ineligible";
		sourceDigest: SourceDigest;
		checked: boolean;
	} | null;
	ownInspectDraft: {
		sessionId: string;
		revision: number;
		prompted: boolean;
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
	prompt: (
		sessionID: string,
		prompt: string,
		delivery: AutoDriveDelivery,
		metadata: Readonly<Record<string, unknown>>,
	) => Promise<void>;
	onWarning?: ((message: string) => void) | undefined;
	createToken?: (() => string) | undefined;
	now?: (() => number) | undefined;
}>;
const STOP = /^(?:(?:stop|cancel) \/flow-auto|\/flow-auto (?:stop|cancel))$/i;
const INITIAL_ROUTE =
	"Read compact status, load flow-plan, then call flow_plan_save.";
const CONTINUATION_ROUTE = [
	"Load flow-run guidance before any feature or closure route;",
	"for a fresh close use compact session id/revision plus a fresh operation id,",
	"and replay archiveRetry exactly from its projected request.",
].join(" ");
const HANDBACK_ROUTE = [
	"Call flow_status with the compact view first.",
	"Print findingsDigest as the user-facing list. Do not invent ids.",
].join(" ");

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
	/** Whether this host has ever reported assistant message parentage. */
	#hostParentage = false;
	/** Whether any assistant message has arrived without a parent. */
	#hostMissingParentage = false;
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
		} catch {
			// Warning delivery is best-effort; a failed host sink must not stop the lease.
		}
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
			this.#hostParentage
				? `Flow: ${kind} origin was unavailable.`
				: "Flow: this host reports no assistant message parentage, so /flow-auto cannot continue automatically. Drive each feature with /flow-run.",
			this.#hostParentage ? "missing-lineage" : "unsupported",
		);
	}
	#waitAt(lease: Lease, revision: number): void {
		const current = lease.checkpoint;
		lease.checkpoint =
			current?.revision === revision ? current : { revision, answered: false };
		lease.checkpoint.answered = false;
		lease.messageId = null;
		lease.lastPromptedRevision = null;
		this.#setTiming("waiting-for-user");
	}
	async #promptHandback(
		lease: Lease,
		projection: AutoDriveProjection,
	): Promise<void> {
		if (!isHandback(projection)) return;
		if (lease.handbackPromptedRevision === projection.revision) return;
		if (!lease.delivery) return;
		lease.handbackPromptedRevision = projection.revision;
		lease.messageId = null;
		this.#setTiming("active");
		lease.inFlight = "prompt";
		try {
			const handback = [
				`Flow is handing control back at compact revision ${projection.revision}.`,
				HANDBACK_ROUTE,
				`Then follow ${projection.nextAction} or stop at await-user-direction.`,
				"Do not expand the approved goal.",
			].join(" ");
			await this.#options.prompt(
				lease.hostSessionId,
				`${handback}\n\n${FLOW_MANAGER_KERNEL}`,
				lease.delivery,
				{ [FLOW_AUTO_METADATA_KEY]: lease.token },
			);
		} catch (error) {
			this.#stop(
				lease,
				`Flow auto prompt failed: ${String(error)}`,
				"prompt-error",
			);
		}
	}
	async #read(lease: Lease): Promise<AutoDriveProjection | null> {
		try {
			return await this.#options.readProjection();
		} catch (error) {
			this.#stop(
				lease,
				`Flow auto status failed: ${String(error)}`,
				"status-error",
			);
			return null;
		}
	}
	async activate(
		hostSessionId: string,
		requestGoal = "",
		options: Readonly<{
			newlyAnchoredSessionId?: string | null;
			intent?: AutoGoalIntent;
		}> = {},
	): Promise<Record<string, unknown>> {
		const token = this.#options.createToken?.() ?? crypto.randomUUID();
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
			delivery: null,
			lastPromptedRevision: null,
			handbackPromptedRevision: null,
			checkpoint: null,
			pendingReply: false,
			inFlight: null,
			idlePending: false,
			messageId: null,
			assistantParents: new Map(),
			lastAssistantParent: null,
			compaction: null,
			manualContinuation: null,
			validation: null,
			ownInspectDraft: null,
		};
		const lease = this.#lease;
		const baseline = await this.#read(lease);
		if (!baseline) throw new Error("Flow auto-drive compact status failed.");
		lease.baseline = baseline;
		if (this.#lease !== lease) throw new Error("Flow auto-drive superseded.");
		if (!isPendingReviewer(baseline))
			lease.checkpoint = { revision: baseline.revision, answered: false };
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
				(lease.manualContinuation?.revision ??
					lease.checkpoint?.revision ??
					0) ||
			!["blocked", "ready", "running"].includes(projection.status)
		) {
			this.#stop(lease);
			return null;
		}
		if (projection.nextAction === "await-user-direction") {
			lease.checkpoint = { revision: projection.revision, answered: false };
			lease.manualContinuation = null;
		} else {
			lease.checkpoint = null;
			lease.manualContinuation = { revision: projection.revision };
		}
		return lease.token;
	}
	clear(
		reason: Extract<
			AutoDriveDisposition,
			{ state: "inactive" }
		>["reason"] = "restarted",
	): void {
		this.#options.recovery?.revoke();
		if (this.#lease) {
			this.#setTiming("inactive");
			this.#disposition = { state: "inactive", reason };
		}
		this.#lease = null;
	}
	async observeMessage(
		hostSessionId: string,
		delivery: AutoDriveDelivery,
		parts: readonly AutoDriveMessagePart[],
		messageId: string,
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
			lease.delivery = delivery;
			lease.messageId = messageId;
			if (
				!lease.manualContinuation &&
				!lease.checkpoint &&
				lease.lastPromptedRevision !== null
			)
				lease.checkpoint = {
					revision: lease.lastPromptedRevision,
					answered: false,
				};
			this.#setTiming("active");
			return "accepted-continuation";
		}
		if (lease?.hostSessionId !== hostSessionId || !message.user)
			return "accepted";
		if (lease.ownInspectDraft?.prompted) {
			this.deactivate(hostSessionId);
			return "accepted";
		}
		lease.ownInspectDraft = null;
		if (lease.checkpoint?.answered || lease.pendingReply) {
			this.deactivate(hostSessionId);
			return "accepted";
		}
		if (lease.checkpoint) delete lease.checkpoint.advance;
		if (!lease.checkpoint && lease.inFlight !== "status")
			this.deactivate(hostSessionId);
		else {
			lease.messageId = messageId;
			lease.delivery = delivery;
			lease.pendingReply = true;
			if (!lease.inFlight) await this.onIdle(hostSessionId);
		}
		return "accepted";
	}
	compactionContext(hostSessionId: string): string | null {
		if (this.#lease?.hostSessionId !== hostSessionId) return null;
		const context = [
			"An in-memory /flow-auto continuation remains active.",
			"Read compact Flow state first.",
			CONTINUATION_ROUTE,
			"Do not expand the approved goal; stop for required user direction, a hard blocker, or confirmed closure.",
		].join(" ");
		return `${context}\n\n${FLOW_MANAGER_KERNEL}`;
	}
	observeHostMessage(host: string, message: HostMessage): void {
		// Recorded before the lease guard: parentage is a property of the host, not
		// of the session that happens to hold the lease.
		if (message.role === "assistant") {
			if (message.parentID === undefined) this.#hostMissingParentage = true;
			else this.#hostParentage = true;
		}
		const lease = this.#lease;
		if (lease?.hostSessionId !== host) return;
		if (message.role === "assistant" && message.parentID !== undefined) {
			lease.assistantParents.set(message.id, message.parentID);
			if (message.summary !== true) {
				lease.lastAssistantParent = message.parentID;
				if (lease.compaction) lease.compaction = null;
			} else if (lease.compaction) {
				if (
					message.parentID === lease.compaction.user &&
					lease.messageId === lease.compaction.authority
				)
					lease.compaction.summary = message.id;
				else lease.compaction = null;
			}
		} else if (message.role === "user" && lease.compaction) {
			const compaction = lease.compaction;
			if (
				compaction.summary &&
				(!compaction.successor || compaction.successor === message.id)
			)
				compaction.successor = message.id;
			else lease.compaction = null;
		}
	}
	observeHostPart(host: string, part: HostPart): void {
		const lease = this.#lease;
		if (
			lease?.hostSessionId !== host ||
			part.type !== "compaction" ||
			part.auto !== true
		)
			return;
		lease.compaction =
			lease.lastAssistantParent && lease.lastAssistantParent === lease.messageId
				? { authority: lease.lastAssistantParent, user: part.messageID }
				: null;
	}
	observeCompaction(host: string): void {
		const lease = this.#lease;
		if (lease?.hostSessionId !== host || lease.messageId === null) return;
		const compaction = lease.compaction;
		lease.compaction = null;
		if (!compaction?.successor || lease.messageId !== compaction.authority)
			return void this.#rejectOrigin(lease, "compaction");
		lease.messageId = compaction.successor;
		this.#options.recovery?.observeMessage(host, compaction.successor, true);
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
		if (lease?.hostSessionId !== host || !lease.messageId) return;
		const origin = lease.assistantParents.get(assistantId);
		if (origin === undefined) return void this.#rejectOrigin(lease, "mutation");
		if (origin !== lease.messageId) return;
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
			lease.ownInspectDraft = { sessionId: created, revision, prompted: false };
		if (baseline && baseline.sessionId === undefined && created)
			lease.baseline = { ...baseline, sessionId: created };
		const point = lease.checkpoint;
		if (!point) return;
		if (revision > point.revision)
			point.advance = revision + Number(reviewerPending);
	}
	validationOrigin(
		hostSessionId: string,
		assistantId: string,
		prepared: Pick<
			PreparedValidation,
			"featureId" | "runId" | "sourceDigest" | "assertions"
		>,
	): AutoValidationOrigin | null {
		const lease = this.#lease;
		if (
			lease?.hostSessionId !== hostSessionId ||
			!lease.messageId ||
			!lease.baseline?.sessionId
		)
			return null;
		const parent = lease.assistantParents.get(assistantId);
		if (parent === undefined) {
			this.#rejectOrigin(lease, "mutation");
			return null;
		}
		if (parent !== lease.messageId) return null;
		const origin: AutoValidationOrigin = {
			hostSessionId,
			sessionId: lease.baseline.sessionId,
			authority: lease.messageId,
			assistantId,
			featureId: prepared.featureId,
			runId: prepared.runId,
			sourceDigest: prepared.sourceDigest,
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
			lease.messageId !== origin.authority ||
			lease.assistantParents.get(origin.assistantId) !== origin.authority ||
			observation.id !== receipt.captureId ||
			observation.featureId !== origin.featureId ||
			observation.runId !== origin.runId ||
			observation.sourceDigest !== origin.sourceDigest
		)
			return;
		const checkpoint = lease.checkpoint;
		if (
			!checkpoint ||
			observation.recordedRevision <= checkpoint.revision ||
			observation.recordedRevision <= (lease.validation?.revision ?? -1)
		)
			return;
		const outcome =
			observation.ineligibleReason !== undefined ||
			!observation.outputComplete ||
			observation.exitCode === null ||
			!assertionsSatisfied(origin.assertions, observation.observedAssertions)
				? "ineligible"
				: observation.exitCode === 0
					? "passed"
					: "failed";
		lease.validation = {
			revision: observation.recordedRevision,
			outcome,
			sourceDigest: observation.sourceDigest,
			checked: false,
		};
		if (outcome !== "ineligible")
			checkpoint.advance = observation.recordedRevision;
	}
	continuationSnapshot(hostSessionId: string): AutoContinuationSnapshot | null {
		return this.#disposition && this.#dispositionHost === hostSessionId
			? { scope: "current-plugin-process", ...this.#disposition }
			: null;
	}
	/**
	 * What this process has observed about the host's continuation support.
	 *
	 * Reported rather than enforced: an `unsupported` host still gets the whole
	 * lifecycle, one `/flow-run` at a time. The point is that the user hears it from
	 * Flow instead of inferring it from a workflow that stops after every feature.
	 */
	continuationSupport(): ProcessLocalAutoContinuationSupport {
		if (this.#hostParentage) return "supported";
		return this.#hostMissingParentage ? "unsupported" : "unknown";
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
	/** Routes one idle event; every unproven continuation stops or parks. */
	async onIdle(hostSessionId: string): Promise<void> {
		const lease = this.#lease;
		if (!lease || lease.hostSessionId !== hostSessionId) return;
		if (lease.inFlight) {
			if (
				lease.inFlight !== "reply-status" ||
				!lease.pendingReply ||
				lease.checkpoint?.advance !== undefined
			)
				lease.idlePending = true;
			return;
		}
		lease.inFlight = lease.pendingReply ? "reply-status" : "status";
		try {
			const projection = await this.#read(lease);
			if (!projection) return;
			if (this.#lease !== lease) return;
			const baseline = lease.baseline;
			if (!baseline) return this.#stop(lease);
			if (lease.manualContinuation) {
				if (
					projection.sessionId !== baseline.sessionId ||
					projection.revision < lease.manualContinuation.revision
				)
					return this.#stop(lease, undefined, "unowned");
				if (
					(projection.status === "ready" || projection.status === "running") &&
					projection.nextAction !== "await-user-direction"
				) {
					lease.manualContinuation.revision = projection.revision;
					this.#setTiming("paused");
					this.#disposition = { state: "paused", reason: "manual-command" };
					return;
				}
				lease.manualContinuation = null;
			}
			const draft = lease.ownInspectDraft;
			if (
				draft &&
				!draft.prompted &&
				!lease.pendingReply &&
				projection.sessionId === draft.sessionId &&
				projection.revision === draft.revision &&
				projection.status === "planning" &&
				projection.nextAction === "flow_plan_approve" &&
				lease.delivery
			) {
				draft.prompted = true;
				lease.messageId = null;
				lease.inFlight = "prompt";
				try {
					await this.#options.prompt(
						hostSessionId,
						`The accepted draft belongs to this /flow-auto invocation, keeps its exact goal, and contains only inspect features. Approve this one draft, then continue the ordinary Flow lifecycle. Do not edit product files.\n\n${FLOW_MANAGER_KERNEL}`,
						lease.delivery,
						{ [FLOW_AUTO_METADATA_KEY]: lease.token },
					);
				} catch (error) {
					this.#stop(
						lease,
						`Flow inspection approval prompt failed: ${String(error)}`,
						"prompt-error",
					);
				}
				return;
			}
			const validation = lease.validation;
			if (
				validation &&
				!validation.checked &&
				validation.revision === projection.revision
			) {
				const authority = lease.messageId;
				let currentSource: SourceDigest | undefined;
				try {
					currentSource = await this.#options.readSourceDigest?.();
				} catch {
					currentSource = undefined;
				}
				if (
					this.#lease !== lease ||
					lease.messageId !== authority ||
					lease.validation !== validation
				)
					return;
				validation.checked = true;
				if (currentSource !== validation.sourceDigest)
					validation.outcome = "ineligible";
			}
			const decision: IdleDecision = decideOnIdle(
				{
					baseline,
					checkpoint: lease.checkpoint,
					pendingReply: lease.pendingReply,
					lastPromptedRevision: lease.lastPromptedRevision,
					hasDelivery: lease.delivery !== null,
					validation: lease.validation,
				},
				projection,
			);
			if (lease.pendingReply && projection.status !== "idle")
				lease.pendingReply = false;
			const proposal =
				(projection.status === "blocked" || projection.status === "ready") &&
				decision.kind === "handback-and-wait"
					? this.#options.recovery?.proposalPrompt(
							hostSessionId,
							projection.sessionId,
							projection.revision,
							projection.nextAction,
						)
					: null;
			if (proposal && lease.delivery) {
				this.#waitAt(lease, projection.revision);
				lease.handbackPromptedRevision = projection.revision;
				this.#setTiming("active");
				lease.inFlight = "prompt";
				await this.#options
					.prompt(hostSessionId, proposal, lease.delivery, {
						[FLOW_AUTO_METADATA_KEY]: lease.token,
					})
					.catch((error) =>
						this.#stop(
							lease,
							`Flow recovery prompt failed: ${String(error)}`,
							"prompt-error",
						),
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
							: !lease.delivery
								? "no-delivery"
								: "no-progress",
					);
				case "prompt-initial": {
					lease.lastPromptedRevision = 0;
					lease.inFlight = "prompt";
					// Narrowing only: decideOnIdle already required hasDelivery.
					if (!lease.delivery) return;
					await this.#options
						.prompt(
							hostSessionId,
							`${INITIAL_ROUTE}\n\n${FLOW_MANAGER_KERNEL}`,
							lease.delivery,
							{ [FLOW_AUTO_METADATA_KEY]: lease.token },
						)
						.catch((error) =>
							this.#stop(
								lease,
								`Flow auto prompt failed: ${String(error)}`,
								"prompt-error",
							),
						);
					return;
				}
				case "handback-and-wait":
					await this.#promptHandback(lease, projection);
					if (this.#lease !== lease) return;
					this.#disposition = {
						state: "waiting",
						reason:
							projection.nextAction === "flow_plan_approve"
								? "plan-approval"
								: "user-direction",
					};
					return void this.#waitAt(lease, projection.revision);
				case "answered":
					if (lease.checkpoint) lease.checkpoint.answered = true;
					this.#setTiming("active");
					return;
				case "handback-or-deactivate": {
					const already =
						lease.handbackPromptedRevision === projection.revision;
					await this.#promptHandback(lease, projection);
					if (this.#lease !== lease) return;
					if (
						!already &&
						lease.handbackPromptedRevision === projection.revision
					) {
						this.#setTiming("paused");
						this.#disposition = { state: "paused", reason: "handback" };
						return;
					}
					return void this.deactivate(hostSessionId, "unsupported-action");
				}
				case "pause":
					if (decision.clearCheckpoint) lease.checkpoint = null;
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
					if (decision.clearCheckpoint) lease.checkpoint = null;
					// Narrowing only: decideOnIdle already required hasDelivery.
					if (!lease.delivery) return;
					lease.lastPromptedRevision = projection.revision;
					lease.messageId = null;
					this.#setTiming("active");
					this.#disposition = { state: "active", reason: "continuation" };
					lease.inFlight = "prompt";
					try {
						const continuation = [
							`Continue the same user-authorized /flow-auto lifecycle from compact revision ${projection.revision}.`,
							"Call flow_status with the compact view first.",
							CONTINUATION_ROUTE,
							`Then follow ${projection.nextAction} without expanding the approved goal.`,
						].join(" ");
						await this.#options.prompt(
							hostSessionId,
							`${continuation}\n\n${FLOW_MANAGER_KERNEL}`,
							lease.delivery,
							{ [FLOW_AUTO_METADATA_KEY]: lease.token },
						);
					} catch (error) {
						this.#stop(
							lease,
							`Flow auto prompt failed: ${String(error)}`,
							"prompt-error",
						);
					}
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
				const rerun = lease.idlePending;
				lease.idlePending = false;
				lease.inFlight = null;
				if (rerun) await this.onIdle(hostSessionId);
			}
		}
	}
}
