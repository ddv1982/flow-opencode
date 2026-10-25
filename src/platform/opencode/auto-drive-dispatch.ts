import type { PreparedRecoveryProposal } from "../../application/recovery-proposal.js";
import type {
	AutoDriveAuthority,
	AutoDriveDelivery,
	AutoDriveProjection,
} from "./auto-drive.js";

const dispatchBrand = Symbol();
export type DispatchIntent = Readonly<{ [dispatchBrand]: true }>;
export type DispatchResult =
	| Readonly<{ kind: "sent"; source: string }>
	| Readonly<{ kind: "withheld"; reason: "pending-user" | "input-settlement" }>;
export type IdleOwner = Readonly<{
	current(): boolean;
	recheck(): Promise<boolean>;
}>;
export type DispatchCapture = Readonly<{
	authority: AutoDriveAuthority;
	source: string | null;
	current(): boolean;
}>;
type Checkpoint = { revision: number; answered: boolean; advance?: number };
type Draft = { sessionId: string; revision: number; prompted: boolean };
export type SendEffect =
	| Readonly<{ kind: "initial" }>
	| Readonly<{
			kind: "continuation";
			revision: number;
			clearCheckpoint: boolean;
			repairKey: string | null;
	  }>
	| Readonly<{ kind: "draft"; draft: Draft }>
	| Readonly<{
			kind: "recovery";
			revision: number;
			proposal: PreparedRecoveryProposal;
	  }>
	| Readonly<{
			kind: "handback-and-wait" | "handback-or-deactivate";
			projection: AutoDriveProjection;
	  }>;
export type AutomaticPrompt = (
	host: string,
	text: string,
	delivery: AutoDriveDelivery,
	metadata: Readonly<Record<string, unknown>>,
	intent: DispatchIntent,
) => Promise<DispatchResult>;
type PendingDispatch = {
	readonly intent: DispatchIntent;
	readonly capture: DispatchCapture;
	readonly checkpoint: Checkpoint | null;
	readonly draft: Draft | null;
	readonly draftSession: string | null;
	readonly draftRevision: number | null;
	readonly owner: IdleOwner | undefined;
	readonly effect: SendEffect;
	readonly clearPendingReply: boolean;
	state: "prepared" | "accepted" | "withheld";
	source: string | null;
};
type SendActivation = Readonly<{
	timing: "active" | "waiting-for-user" | "paused";
	disposition?:
		| "continuation"
		| "plan-approval"
		| "user-direction"
		| "handback";
}>;
export class AutoDriveDispatch {
	delivery: AutoDriveDelivery | null = null;
	lastPromptedRevision: number | null = null;
	handbackPromptedRevision: number | null = null;
	checkpoint: Checkpoint | null = null;
	pendingReply = false;
	messageId: string | null = null;
	manualContinuation: { revision: number } | null = null;
	ownInspectDraft: Draft | null = null;
	#pending: PendingDispatch | null = null;
	#deferred: Readonly<{ owner: IdleOwner; capture: DispatchCapture }> | null =
		null;
	#invalidated = false;
	#cancelled = Promise.withResolvers<never>();
	readonly #repairs: Set<string>;
	constructor(repairs: Set<string>) {
		this.#repairs = repairs;
		void this.#cancelled.promise.catch(() => {});
	}
	invalidate(): void {
		this.#invalidated = true;
		this.#cancelled.reject(new Error("Flow automatic lease was revoked."));
		this.#pending = null;
		this.#deferred = null;
	}
	renew(): void {
		this.invalidate();
		this.#cancelled = Promise.withResolvers<never>();
		void this.#cancelled.promise.catch(() => {});
		this.#invalidated = false;
	}
	get cancelled(): Promise<never> {
		return this.#cancelled.promise;
	}
	get replacesCheckpoint(): boolean {
		return (
			this.#pending?.state === "prepared" &&
			this.#pending.effect.kind === "continuation" &&
			this.#pending.effect.clearCheckpoint
		);
	}
	get deferred(): boolean {
		return this.#deferred !== null;
	}
	waitAt(revision: number, sent = false): void {
		this.checkpoint =
			this.checkpoint?.revision === revision
				? this.checkpoint
				: { revision, answered: false };
		this.checkpoint.answered = false;
		if (!sent) this.messageId = null;
		this.lastPromptedRevision = null;
	}
	isPrepared(intent: DispatchIntent): boolean {
		const record = this.#pending;
		return (
			!this.#invalidated &&
			record?.intent === intent &&
			record.state === "prepared" &&
			record.capture.current() &&
			(!record.owner || record.owner.current()) &&
			this.checkpoint === record.checkpoint &&
			this.ownInspectDraft === record.draft &&
			(record.effect.kind !== "draft" ||
				(record.draft?.sessionId === record.draftSession &&
					record.draft?.revision === record.draftRevision &&
					!record.draft?.prompted))
		);
	}
	activate(
		intent: DispatchIntent | undefined,
		source: string,
		delivery: AutoDriveDelivery,
	): SendActivation {
		const record = this.#pending;
		if (
			intent &&
			(!record ||
				record.intent !== intent ||
				record.state !== "prepared" ||
				this.#invalidated ||
				!record.capture.current() ||
				this.checkpoint !== record.checkpoint ||
				this.ownInspectDraft !== record.draft)
		)
			throw new Error("Flow automatic dispatch intent was superseded.");
		const effect = intent ? record?.effect : undefined;
		if (
			effect?.kind === "draft" &&
			(this.ownInspectDraft !== effect.draft ||
				effect.draft.prompted ||
				effect.draft.sessionId !== record?.draftSession ||
				effect.draft.revision !== record?.draftRevision)
		)
			throw new Error("Flow inspection draft changed before admission.");
		if (effect?.kind === "recovery") {
			effect.proposal.assertCurrent();
			effect.proposal.commit();
		}
		if (effect?.kind === "initial") this.lastPromptedRevision = 0;
		if (effect?.kind === "continuation") {
			if (effect.clearCheckpoint) this.checkpoint = null;
			this.lastPromptedRevision = effect.revision;
		}
		if (effect?.kind === "recovery") this.waitAt(effect.revision, true);
		this.delivery = delivery;
		this.messageId = source;
		if (
			!this.manualContinuation &&
			!this.checkpoint &&
			this.lastPromptedRevision !== null
		)
			this.checkpoint = {
				revision: this.lastPromptedRevision,
				answered: false,
			};
		let activation: SendActivation = { timing: "active" };
		if (effect && record) {
			if (record.clearPendingReply) this.pendingReply = false;
			if (effect.kind === "draft") effect.draft.prompted = true;
			if (effect.kind === "continuation") {
				if (effect.repairKey) this.#repairs.add(effect.repairKey);
				activation = { timing: "active", disposition: "continuation" };
			}
			if (effect.kind === "recovery") {
				this.handbackPromptedRevision = effect.revision;
			}
			if (
				effect.kind === "handback-and-wait" ||
				effect.kind === "handback-or-deactivate"
			) {
				this.handbackPromptedRevision = effect.projection.revision;
				if (effect.kind === "handback-and-wait") {
					this.waitAt(effect.projection.revision, true);
					activation = {
						timing: "waiting-for-user",
						disposition:
							effect.projection.nextAction === "flow_plan_approve"
								? "plan-approval"
								: "user-direction",
					};
				} else activation = { timing: "paused", disposition: "handback" };
			}
			record.source = source;
			record.state = "accepted";
		}
		return activation;
	}
	async send(
		prompt: AutomaticPrompt,
		host: string,
		text: string,
		metadata: Readonly<Record<string, unknown>>,
		effect: SendEffect,
		clearPendingReply: boolean,
		capture: DispatchCapture,
		owner?: IdleOwner,
	): Promise<DispatchResult> {
		if (
			this.#invalidated ||
			!capture.current() ||
			!this.delivery ||
			(owner && !owner.current())
		)
			throw new Error("Flow automatic dispatch was superseded.");
		if (this.#pending) throw new Error("Flow automatic dispatches overlap.");
		const record: PendingDispatch = {
			intent: Object.freeze({ [dispatchBrand]: true }),
			capture,
			checkpoint: this.checkpoint,
			draft: this.ownInspectDraft,
			draftSession: this.ownInspectDraft?.sessionId ?? null,
			draftRevision: this.ownInspectDraft?.revision ?? null,
			owner,
			effect,
			clearPendingReply,
			state: "prepared",
			source: null,
		};
		this.#pending = record;
		try {
			const result = await prompt(
				host,
				text,
				this.delivery,
				metadata,
				record.intent,
			);
			if (result.kind === "withheld") {
				if (record.state !== "prepared")
					throw new Error("Flow admitted dispatch cannot be withheld.");
				record.state = "withheld";
				if (!this.#invalidated && capture.current() && owner?.current())
					this.#deferred = { owner, capture };
			} else if (record.state !== "accepted" || record.source !== result.source)
				throw new Error(
					"Flow send completed without authenticated intent activation.",
				);
			return result;
		} finally {
			if (this.#pending === record) this.#pending = null;
		}
	}
	async takeDeferred(): Promise<IdleOwner | null> {
		const ticket = this.#deferred;
		this.#deferred = null;
		if (
			!this.#invalidated &&
			ticket?.capture.current() &&
			ticket.owner.current() &&
			(await ticket.owner.recheck()) &&
			ticket.capture.current()
		)
			return ticket.owner;
		return null;
	}
}
