import { FLOW_MANAGER_KERNEL } from "../../guidance/catalog.js";
export const FLOW_AUTO_METADATA_KEY = "opencode-plugin-flow/auto";
export interface AutoDriveProjection {
	readonly sessionId?: string | undefined;
	readonly status: string;
	readonly revision: number;
	readonly nextAction: string | null;
}
interface AutoDriveMessagePart {
	readonly type?: string;
	readonly text?: string;
	readonly synthetic?: boolean;
	readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface AutoDriveDelivery {
	readonly agent: string;
	readonly model: Readonly<{ providerID: string; modelID: string }>;
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
};
type TimingField = "state" | "activeMs" | "waitingForUserMs";
type Timing = {
	-readonly [Key in TimingField]: AutoTimingSnapshot[Key];
} & { since: number };
type AutoDriveOptions = Readonly<{
	readProjection: () => Promise<AutoDriveProjection>;
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
function isMechanical(projection: AutoDriveProjection): boolean {
	return projection.nextAction === "flow_run_start"
		? projection.status === "ready"
		: projection.nextAction === "flow_session_close" &&
				(projection.status === "completed" || projection.status === "closed");
}
function isCheckpoint(projection: AutoDriveProjection): boolean {
	return ["flow_plan_approve", "await-user-direction"].includes(
		projection.nextAction ?? "",
	);
}
function isPendingReviewer(projection: AutoDriveProjection): boolean {
	return (
		projection.status === "running" &&
		projection.nextAction === "dispatch-flow-reviewer"
	);
}
function isHandback(projection: AutoDriveProjection): boolean {
	return (
		projection.status === "blocked" ||
		projection.nextAction === "flow_feature_reset" ||
		projection.nextAction === "dispatch-flow-reviewer"
	);
}
export class AutoDriveCoordinator {
	#lease: Lease | null = null;
	#timing: Timing | null = null;
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
	}
	#warn(message: string): void {
		try {
			this.#options.onWarning?.(message);
		} catch {
			// Warning delivery is best-effort; a failed host sink must not stop the lease.
		}
	}
	#stop(lease: Lease, warning?: string): void {
		if (this.#lease !== lease) return;
		this.deactivate(lease.hostSessionId);
		if (warning) this.#warn(warning);
	}
	#rejectOrigin(lease: Lease, kind: "compaction" | "mutation"): void {
		this.#stop(
			lease,
			this.#hostParentage
				? `Flow: ${kind} origin was unavailable.`
				: "Flow: this host reports no assistant message parentage, so /flow-auto cannot continue automatically. Drive each feature with /flow-run.",
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
			this.#stop(lease, `Flow auto prompt failed: ${String(error)}`);
		}
	}
	async #read(lease: Lease): Promise<AutoDriveProjection | null> {
		try {
			return await this.#options.readProjection();
		} catch (error) {
			this.#stop(lease, `Flow auto status failed: ${String(error)}`);
			return null;
		}
	}
	async activate(hostSessionId: string): Promise<Record<string, unknown>> {
		const token = this.#options.createToken?.() ?? crypto.randomUUID();
		this.#timing = {
			state: "active",
			since: this.#now(),
			activeMs: 0,
			waitingForUserMs: 0,
		};
		this.#lease = {
			hostSessionId,
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
	deactivate(hostSessionId: string): boolean {
		if (this.#lease?.hostSessionId !== hostSessionId) return false;
		this.clear();
		return true;
	}
	clear(): void {
		if (this.#lease) this.#setTiming("inactive");
		this.#lease = null;
	}
	async observeMessage(
		hostSessionId: string,
		delivery: AutoDriveDelivery,
		parts: readonly AutoDriveMessagePart[],
		messageId: string,
	): Promise<"accepted" | "stale-continuation"> {
		const lease = this.#lease;
		const message = inspectMessage(parts);
		if (lease?.hostSessionId === hostSessionId && STOP.test(message.text)) {
			this.deactivate(hostSessionId);
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
			if (!lease.checkpoint && lease.lastPromptedRevision !== null)
				lease.checkpoint = {
					revision: lease.lastPromptedRevision,
					answered: false,
				};
			this.#setTiming("active");
			return "accepted";
		}
		if (lease?.hostSessionId !== hostSessionId || !message.user)
			return "accepted";
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
	}
	observeMutation(
		host: string,
		revision: number,
		created: string | undefined,
		assistantId: string,
		reviewerPending: boolean,
	): void {
		const lease = this.#lease;
		if (lease?.hostSessionId !== host || !lease.messageId) return;
		const origin = lease.assistantParents.get(assistantId);
		if (origin === undefined) return void this.#rejectOrigin(lease, "mutation");
		if (origin !== lease.messageId) return;
		const baseline = lease.baseline;
		if (baseline && baseline.sessionId === undefined && created)
			lease.baseline = { ...baseline, sessionId: created };
		const point = lease.checkpoint;
		if (!point) return;
		if (revision > point.revision)
			point.advance = revision + Number(reviewerPending);
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
			const anchored = lease.checkpoint !== null;
			if (projection.status === "idle") {
				if (
					baseline.status !== "idle" ||
					baseline.sessionId ||
					lease.lastPromptedRevision === 0 ||
					!lease.delivery
				)
					return void this.deactivate(hostSessionId);
				lease.lastPromptedRevision = 0;
				lease.inFlight = "prompt";
				await this.#options
					.prompt(
						hostSessionId,
						`${INITIAL_ROUTE}\n\n${FLOW_MANAGER_KERNEL}`,
						lease.delivery,
						{ [FLOW_AUTO_METADATA_KEY]: lease.token },
					)
					.catch((error) =>
						this.#stop(lease, `Flow auto prompt failed: ${String(error)}`),
					);
				return;
			}
			if (projection.nextAction === null)
				return void this.deactivate(hostSessionId);
			if (projection.sessionId !== baseline.sessionId)
				return this.#stop(lease, "Flow auto-drive stopped: unowned session.");
			const checkpoint = lease.checkpoint;
			const boundary = isCheckpoint(projection);
			const advance = checkpoint?.advance;
			const mutationAdvanced =
				advance !== undefined &&
				projection.revision === advance &&
				isMechanical(projection);
			if (lease.pendingReply) {
				lease.pendingReply = false;
				if (
					boundary &&
					(!checkpoint || projection.revision > checkpoint.revision)
				) {
					await this.#promptHandback(lease, projection);
					if (this.#lease !== lease) return;
					return void this.#waitAt(lease, projection.revision);
				}
				if (!checkpoint || (!boundary && !mutationAdvanced))
					return void this.deactivate(hostSessionId);
				checkpoint.answered = true;
				this.#setTiming("active");
				return;
			}
			if (boundary) {
				if (checkpoint && projection.revision < checkpoint.revision)
					return void this.deactivate(hostSessionId);
				await this.#promptHandback(lease, projection);
				if (this.#lease !== lease) return;
				return void this.#waitAt(lease, projection.revision);
			}
			if (!isMechanical(projection)) {
				const already = lease.handbackPromptedRevision === projection.revision;
				await this.#promptHandback(lease, projection);
				if (this.#lease !== lease) return;
				if (
					!already &&
					lease.handbackPromptedRevision === projection.revision
				) {
					this.#setTiming("paused");
					return;
				}
				return void this.deactivate(hostSessionId);
			}
			if (checkpoint) {
				if (projection.revision <= checkpoint.revision || !mutationAdvanced)
					return void this.deactivate(hostSessionId);
				lease.checkpoint = null;
			}
			if (lease.lastPromptedRevision === projection.revision) {
				this.#setTiming("paused");
				return this.#warn(
					`Flow auto-drive paused after revision ${projection.revision} made no lifecycle progress.`,
				);
			}
			if (
				baseline.sessionId
					? projection.revision <= baseline.revision ||
						(!anchored && !isPendingReviewer(baseline))
					: projection.sessionId === undefined
			)
				return this.#stop(lease, "Flow auto-drive stopped: no progress.");
			if (!lease.delivery)
				return this.#stop(lease, "Flow auto-drive stopped: no delivery.");
			lease.lastPromptedRevision = projection.revision;
			lease.messageId = null;
			this.#setTiming("active");
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
				this.#stop(lease, `Flow auto prompt failed: ${String(error)}`);
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
