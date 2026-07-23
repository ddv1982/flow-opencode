export const FLOW_AUTO_METADATA_KEY = "opencode-plugin-flow/auto";

export type AutoDriveProjection = Readonly<{
	sessionId?: string | undefined;
	status: string;
	revision: number;
	nextAction: string | null;
}>;

export type AutoDriveMessagePart = Readonly<{
	type?: string;
	synthetic?: boolean;
	metadata?: Readonly<Record<string, unknown>>;
}>;

export type AutoDriveDelivery = Readonly<{
	agent: string;
	model: Readonly<{ providerID: string; modelID: string }>;
}>;

export type AutoTimingSnapshot = Readonly<{
	scope: "latest-flow-auto-in-current-plugin-process";
	authoritative: false;
	state: "active" | "waiting-for-user" | "paused" | "inactive";
	activeMs: number;
	waitingForUserMs: number;
	pausedTimeExcluded: true;
}>;

type Lease = {
	hostSessionId: string;
	token: string;
	baseline: AutoDriveProjection | null;
	flowSessionId: string | null;
	delivery: AutoDriveDelivery | null;
	lastPromptedRevision: number | null;
	checkpoint: { revision: number; answered: boolean } | null;
	pendingReply: AutoDriveDelivery | null;
	inFlight: "status" | "prompt" | null;
};

type Timing = {
	state: AutoTimingSnapshot["state"];
	since: number;
	activeMs: number;
	waitingForUserMs: number;
};

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

function continuationToken(
	parts: readonly AutoDriveMessagePart[],
): string | null {
	for (const part of parts) {
		const token = part.metadata?.[FLOW_AUTO_METADATA_KEY];
		if (part.synthetic === true && typeof token === "string") return token;
	}
	return null;
}

function isMechanical(projection: AutoDriveProjection): boolean {
	return (
		(projection.status === "ready" &&
			projection.nextAction === "flow_run_start") ||
		((projection.status === "completed" || projection.status === "closed") &&
			projection.nextAction === "flow_session_close")
	);
}

function isCheckpoint(projection: AutoDriveProjection): boolean {
	return ["flow_plan_approve", "await-user-direction"].includes(
		projection.nextAction ?? "",
	);
}

export class AutoDriveCoordinator {
	#lease: Lease | null = null;
	#timing: Timing | null = null;
	readonly #options: AutoDriveOptions;

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
			// Logging must not affect the continuation lease.
		}
	}

	#stop(lease: Lease, warning?: string): void {
		if (this.#lease !== lease) return;
		this.#lease = null;
		this.#setTiming("inactive");
		if (warning) this.#warn(warning);
	}

	async #read(lease: Lease): Promise<AutoDriveProjection | null> {
		try {
			return await this.#options.readProjection();
		} catch (error) {
			this.#stop(
				lease,
				`Flow auto-drive stopped because compact status failed: ${error instanceof Error ? error.message : String(error)}`,
			);
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
			flowSessionId: null,
			delivery: null,
			lastPromptedRevision: null,
			checkpoint: null,
			pendingReply: null,
			inFlight: null,
		};
		const lease = this.#lease;
		const baseline = await this.#read(lease);
		if (!baseline) throw new Error("Flow auto-drive compact status failed.");
		lease.baseline = baseline;
		if (this.#lease !== lease)
			throw new Error("Flow auto-drive activation superseded.");
		lease.flowSessionId = lease.baseline.sessionId ?? null;
		return { [FLOW_AUTO_METADATA_KEY]: token };
	}

	deactivate(hostSessionId: string): boolean {
		if (this.#lease?.hostSessionId !== hostSessionId) return false;
		this.#lease = null;
		this.#setTiming("inactive");
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
	): Promise<"accepted" | "stale-continuation"> {
		const lease = this.#lease;
		const token = continuationToken(parts);
		if (token !== null) {
			if (
				!lease ||
				lease.hostSessionId !== hostSessionId ||
				lease.token !== token
			) {
				return "stale-continuation";
			}
			lease.delivery = delivery;
			this.#setTiming("active");
		} else if (
			lease?.hostSessionId === hostSessionId &&
			!parts.every((part) => part.synthetic === true)
		) {
			if (lease.inFlight === "status") {
				lease.pendingReply = delivery;
			} else if (!lease.checkpoint) {
				this.deactivate(hostSessionId);
			} else {
				const projection = await this.#read(lease);
				if (!projection) return "accepted";
				if (
					this.#lease !== lease ||
					projection.sessionId !== lease.flowSessionId
				) {
					this.#stop(lease);
					return "accepted";
				}
				lease.checkpoint.revision = Math.max(
					lease.checkpoint.revision,
					projection.revision,
				);
				lease.checkpoint.answered = true;
				lease.delivery = delivery;
				this.#setTiming("active");
			}
		}
		return "accepted";
	}

	compactionContext(hostSessionId: string): string | null {
		return this.#lease?.hostSessionId === hostSessionId
			? "An in-memory /flow-auto continuation remains active. Follow authoritative compact Flow state after compaction without expanding the approved goal; stop for required user direction, a hard blocker, or confirmed closure."
			: null;
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

	async onIdle(hostSessionId: string): Promise<void> {
		const lease = this.#lease;
		if (!lease || lease.hostSessionId !== hostSessionId || lease.inFlight)
			return;
		lease.inFlight = "status";
		try {
			const projection = await this.#read(lease);
			if (!projection) return;
			if (this.#lease !== lease) return;
			const baseline = lease.baseline;
			if (!baseline) {
				this.#stop(lease);
				return;
			}
			if (projection.status === "idle" || projection.nextAction === null) {
				this.deactivate(hostSessionId);
				return;
			}
			if (lease.flowSessionId && projection.sessionId !== lease.flowSessionId) {
				this.#stop(lease, "Flow auto-drive stopped: Flow session changed.");
				return;
			}
			lease.flowSessionId = projection.sessionId ?? lease.flowSessionId;

			if (lease.pendingReply) {
				const delivery = lease.pendingReply;
				lease.pendingReply = null;
				if (!lease.checkpoint && !isCheckpoint(projection)) {
					this.deactivate(hostSessionId);
					return;
				}
				lease.checkpoint = {
					revision: projection.revision,
					answered: true,
				};
				lease.delivery = delivery;
				this.#setTiming("active");
				return;
			}
			if (lease.checkpoint && !lease.checkpoint.answered) return;
			if (lease.checkpoint) {
				if (projection.revision <= lease.checkpoint.revision) {
					this.deactivate(hostSessionId);
					return;
				}
				if (isCheckpoint(projection)) {
					lease.checkpoint = { revision: projection.revision, answered: false };
					this.#setTiming("waiting-for-user");
					return;
				}
				if (!isMechanical(projection)) {
					this.deactivate(hostSessionId);
					return;
				}
				lease.checkpoint = null;
			}
			if (!isMechanical(projection)) {
				if (isCheckpoint(projection)) {
					lease.checkpoint = { revision: projection.revision, answered: false };
					lease.lastPromptedRevision = null;
					this.#setTiming("waiting-for-user");
				} else {
					this.deactivate(hostSessionId);
				}
				return;
			}
			if (
				baseline.sessionId
					? projection.revision <= baseline.revision
					: projection.sessionId === undefined
			) {
				this.#stop(
					lease,
					"Flow auto-drive stopped: initiating turn made no progress.",
				);
				return;
			}
			if (lease.lastPromptedRevision === projection.revision) {
				this.#setTiming("paused");
				this.#warn(
					`Flow auto-drive paused after revision ${projection.revision} made no lifecycle progress.`,
				);
				return;
			}
			if (!lease.delivery) {
				this.#stop(
					lease,
					"Flow auto-drive stopped: originating delivery was unavailable.",
				);
				return;
			}

			lease.lastPromptedRevision = projection.revision;
			this.#setTiming("active");
			lease.inFlight = "prompt";
			try {
				await this.#options.prompt(
					hostSessionId,
					`Continue the same user-authorized /flow-auto lifecycle from compact revision ${projection.revision}. Call flow_status with the compact view first, then follow ${projection.nextAction} without expanding the approved goal.`,
					lease.delivery,
					{ [FLOW_AUTO_METADATA_KEY]: lease.token },
				);
			} catch (error) {
				if (this.#lease === lease) {
					this.#stop(
						lease,
						`Flow auto-drive stopped because continuation could not be enqueued: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
		} finally {
			if (this.#lease === lease) lease.inFlight = null;
		}
	}
}
