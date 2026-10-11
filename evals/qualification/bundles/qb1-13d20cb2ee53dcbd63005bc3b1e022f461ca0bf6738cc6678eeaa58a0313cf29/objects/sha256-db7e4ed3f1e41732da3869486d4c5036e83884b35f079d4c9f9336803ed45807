import { createHash, randomUUID } from "node:crypto";
import type {
	RecoveryMutation,
	RecoveryProfile,
	RecoveryProposal,
	RecoverySettings,
} from "./recovery-contracts.js";

export {
	type RecoveryMutation,
	type RecoveryProfile,
	RecoveryProposalSchema,
	type RecoverySettings,
} from "./recovery-contracts.js";

import { operationInputDigest } from "../domain/operation.js";
import { livePriorFindings } from "../domain/review-findings.js";
import {
	currentRun,
	type Session,
	type SourceDigest,
} from "../domain/session.js";
import {
	nextRunnableFeature,
	sessionStatus,
} from "../domain/session-queries.js";
import { dependentClosure } from "../domain/transitions.js";
import type {
	DecisionAdvice,
	DecisionPacket,
	DecisionProvider,
	RecoveryCandidate,
} from "./ports/decision-provider.js";
import { JEV_ATTEMPT_RESERVATION_USD } from "./ports/decision-provider.js";
import {
	type LastRecoveryAssessment,
	type RecoveryActivation,
	recoveryActivationView,
	recoveryDecisionView,
} from "./recovery-status.js";
import type { SessionCloseRequest } from "./schema.js";
import { compactProjection } from "./session-projection.js";

type RecoveryContext = Readonly<{
	hostSessionId: string;
	messageId: string;
	agent: string;
}>;
const QUALIFIED_RECOVERY_PROFILES: readonly RecoveryProfile[] = Object.freeze(
	[],
);
const MAX_RECOVERY_PACKET_BYTES = 16_000;

const hash = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Grant = {
	mutation: RecoveryMutation;
	source: SourceDigest;
	binding: string;
	candidate: RecoveryCandidate;
};
type AutomaticAuthority = {
	host: string;
	parent: string | null;
	direction: string | null;
	session: string | null;
	binding: string | null;
	automaticStarts: Map<string, number>;
};
type Lease = {
	authority: AutomaticAuthority;
	settings: RecoverySettings;
	controller: AbortController;
	deadline: number;
	calls: number;
	reservedUsd: number;
	packets: Set<string>;
	remedies: Set<string>;
	checkpointCalls: Map<string, number>;
	retries: Set<string>;
	selections: Set<string>;
	pending: Grant | null;
	inFlight: boolean;
	last:
		| LastRecoveryAssessment
		| Readonly<{ kind: "stale" | "cancelled" }>
		| Readonly<{ kind: "executed"; operationId: string; featureId: string }>
		| null;
	proposalPrompt: string | null;
};
type Host = {
	parents: Map<string, string>;
	manual: string | null;
	ordinaryAutoMessage: string | null;
	fenced: boolean;
};
export type RecoveryGuard = Readonly<{
	checkClose(session: Session, request: SessionCloseRequest): void;
	retireClosedSession(sessionId: string): void;
	check(
		session: Session,
		source: SourceDigest | null,
		mutation: RecoveryMutation,
	): void;
	accepted(
		session: Session,
		mutation: RecoveryMutation,
		replayed: boolean,
	): void;
	propose(
		session: Session,
		source: SourceDigest,
		proposal: RecoveryProposal,
	): Promise<unknown>;
	requiresSource(): boolean;
	snapshot(): unknown;
	invalidate(): void;
}>;
export class RecoveryController {
	#lease: Lease | null = null;
	#authority: AutomaticAuthority | null = null;
	#activation: RecoveryActivation | null = null;
	#hosts = new Map<string, Host>();
	#protectedSessions = new Map<string, string>();
	readonly #provider: DecisionProvider;
	readonly #profiles: readonly RecoveryProfile[];
	readonly #now: () => number;
	readonly #qualification: "release-profile" | "experimental-evaluation";
	constructor(
		provider: DecisionProvider,
		options: { profiles?: readonly RecoveryProfile[]; now?: () => number } = {},
	) {
		this.#provider = provider;
		this.#qualification = options.profiles
			? "experimental-evaluation"
			: "release-profile";
		this.#profiles = options.profiles ?? QUALIFIED_RECOVERY_PROFILES;
		this.#now = options.now ?? (() => performance.now());
	}
	#host(id: string): Host {
		let host = this.#hosts.get(id);
		if (!host) {
			if (this.#hosts.size >= 128) {
				for (const candidate of this.#hosts.keys()) {
					if (candidate === this.#authority?.host) continue;
					this.#hosts.delete(candidate);
					break;
				}
			}
			if (this.#hosts.size >= 128)
				throw new Error(
					"Recovery host capacity reached. Restart with explicit user direction.",
				);
			host = {
				parents: new Map(),
				manual: null,
				ordinaryAutoMessage: null,
				fenced: false,
			};
			this.#hosts.set(id, host);
		}
		return host;
	}
	#unfenceIfUnprotected(hostId: string): void {
		if (
			this.#authority?.host === hostId ||
			[...this.#protectedSessions.values()].includes(hostId)
		)
			return;
		const host = this.#hosts.get(hostId);
		if (host) {
			host.fenced = false;
			host.manual = null;
			host.ordinaryAutoMessage = null;
			host.parents.clear();
		}
	}
	activate(
		host: string,
		settings: RecoverySettings | null = null,
		source: RecoveryActivation["source"] = "api",
	): void {
		if (
			settings &&
			(!Number.isSafeInteger(settings.maxCalls) ||
				settings.maxCalls < 1 ||
				settings.maxCalls > 100 ||
				!Number.isFinite(settings.maxUsd) ||
				settings.maxUsd <= 0 ||
				settings.maxUsd > 10)
		)
			throw new Error(
				"Recovery requires 1-100 calls and a positive budget at most $10.",
			);
		if (settings?.mode === "delegated" && !this.#profile())
			throw new Error(
				"Delegated recovery is unavailable. No release-owned live qualification matches this model and policy. Use shadow.",
			);
		this.revoke();
		this.#host(host).fenced = true;
		this.#authority = {
			host,
			parent: null,
			direction: null,
			session: null,
			binding: null,
			automaticStarts: new Map(),
		};
		this.#activation = {
			host,
			source,
			mode: settings?.mode ?? "off",
			attempts: 0,
			outcome: "not-attempted",
			inactiveReason: settings ? null : "not-configured",
		};
		if (!settings) return;
		this.#lease = {
			authority: this.#authority,
			settings,
			controller: new AbortController(),
			deadline: this.#now() + 60 * 60 * 1000,
			calls: 0,
			reservedUsd: 0,
			packets: new Set(),
			remedies: new Set(),
			checkpointCalls: new Map(),
			retries: new Set(),
			selections: new Set(),
			pending: null,
			inFlight: false,
			last: null,
			proposalPrompt: null,
		};
	}
	#profile() {
		return this.#profiles.find(
			(p) =>
				p.model === "jev-1.13.0" &&
				p.rubric === "recovery-v1" &&
				p.policy === "bounded-recovery-v1",
		);
	}
	disableAdvice(host?: string, reason = "disabled"): void {
		if (this.#lease && (!host || this.#lease.authority.host === host)) {
			if (this.#activation) {
				this.#activation.attempts = this.#lease.calls;
				this.#activation.outcome =
					typeof this.#lease.last?.kind === "string"
						? this.#lease.last.kind
						: this.#lease.calls > 0
							? "cancelled"
							: "not-attempted";
				this.#activation.inactiveReason = reason;
			}
			this.#lease.controller.abort();
			this.#lease = null;
		}
	}
	revoke(host?: string, reason = "cancelled"): void {
		if (this.#authority && (!host || this.#authority.host === host)) {
			const state = this.#hosts.get(this.#authority.host);
			if (state) {
				state.manual = null;
				state.ordinaryAutoMessage = null;
			}
			this.#authority = null;
			if (this.#activation) this.#activation.inactiveReason = reason;
		}
		this.disableAdvice(host, reason);
	}
	#expireLease(): void {
		if (this.#lease && this.#now() >= this.#lease.deadline)
			this.disableAdvice(undefined, "expired");
	}
	observeMessage(
		hostId: string,
		id: string,
		synthetic: boolean,
		trustedAutoContinuation = false,
	): void {
		this.#expireLease();
		const host =
			this.#hosts.get(hostId) ??
			(!synthetic && this.#protectedSessions.size
				? this.#host(hostId)
				: undefined);
		if (!host) return;
		if (!synthetic && host.fenced) this.#unfenceIfUnprotected(hostId);
		const authority = this.#authority?.host === hostId ? this.#authority : null;
		if (!synthetic) {
			host.manual = id;
			host.ordinaryAutoMessage = null;
		} else if (
			trustedAutoContinuation &&
			host.fenced &&
			!authority &&
			host.manual
		)
			host.ordinaryAutoMessage = id;
		if (authority && (!synthetic || trustedAutoContinuation)) {
			if (authority.parent !== null && authority.parent !== id) {
				const lease = this.#lease;
				if (
					lease?.authority === authority &&
					(lease.inFlight || lease.pending)
				) {
					lease.controller.abort();
					lease.controller = new AbortController();
					lease.pending = null;
					lease.last = { kind: "cancelled" };
				}
				if (!synthetic) authority.direction = id;
			}
			authority.parent = id;
		}
	}
	observeAssistant(hostId: string, id: string, parent: string): void {
		const host = this.#hosts.get(hostId);
		if (!host) return;
		host.parents.set(id, parent);
		if (host.parents.size > 512) {
			const oldest = host.parents.keys().next().value;
			if (oldest) host.parents.delete(oldest);
		}
	}
	#origin(context: RecoveryContext): AutomaticAuthority | null {
		this.#expireLease();
		const host = this.#hosts.get(context.hostSessionId);
		if (!host?.fenced) return null;
		if (
			["flow-worker", "flow-reviewer", "flow-planner"].includes(context.agent)
		)
			throw new Error("Only the observed manager may perform recovery.");
		const parent = host.parents.get(context.messageId);
		const authority =
			this.#authority?.host === context.hostSessionId ? this.#authority : null;
		if (authority) {
			if (!parent || parent !== authority.parent)
				throw new Error("Recovery lineage expired or cancelled.");
			return authority;
		}
		if (
			!parent ||
			(parent !== host.manual && parent !== host.ordinaryAutoMessage)
		)
			throw new Error(
				"Recovery was revoked. A fresh real user direction is required.",
			);
		return null;
	}
	#binding(session: Session) {
		return hash({
			id: session.id,
			goal: session.goal,
			plan: session.plan,
			approval: session.approval,
		});
	}
	#bind(authority: AutomaticAuthority, session: Session) {
		const binding = this.#binding(session);
		if (authority.session === null) {
			if (
				this.#protectedSessions.size >= 128 &&
				!this.#protectedSessions.has(session.id)
			)
				throw new Error("Recovery session capacity reached.");
			this.#protectedSessions.set(session.id, authority.host);
			authority.session = session.id;
			authority.binding = binding;
		}
		if (authority.session !== session.id || authority.binding !== binding) {
			this.revoke(authority.host);
			throw new Error("Recovery session or approved plan changed.");
		}
	}
	snapshot(host?: string) {
		this.#expireLease();
		const lease = this.#lease;
		const activation = this.#activation;
		const status =
			activation && (host === undefined || activation.host === host)
				? recoveryActivationView(
						activation,
						this.#authority !== null,
						this.#authority?.session !== null && this.#authority !== null,
						lease,
					)
				: {};
		return lease && (host === undefined || lease.authority.host === host)
			? {
					mode: lease.settings.mode,
					remainingCalls: lease.settings.maxCalls - lease.calls,
					reservedUsd: lease.reservedUsd,
					maxUsd: lease.settings.maxUsd,
					qualification:
						lease.settings.mode === "delegated"
							? this.#qualification
							: "shadow-only",
					last: lease.last,
					...status,
				}
			: { mode: "off", ...status };
	}
	proposalPrompt(
		host: string,
		session: string | undefined,
		revision: number,
		nextAction: string | null,
	): string | null {
		this.#expireLease();
		const lease = this.#lease;
		if (
			!lease ||
			lease.authority.host !== host ||
			!session ||
			nextAction !== "await-user-direction"
		)
			return null;
		const key = `${session}/${revision}`;
		if (
			lease.proposalPrompt === key ||
			lease.calls >= lease.settings.maxCalls ||
			lease.controller.signal.aborted
		)
			return null;
		lease.proposalPrompt = key;
		return "Recovery advice is enabled for this process. Call flow_status with a top-level recoveryProposal containing id, sessionId, expectedRevision and at most three candidates. Each candidate needs id, action retry or independent-feature, exact featureId, remedy, changedFromPreviousAttempt and actual findingIds. Advice cannot expand the approved plan or replace evidence. In shadow mode report the advice and stop. In delegated mode call only the exact recommended existing mutation, then repeat full validation and independent review.";
	}
	guard(context: RecoveryContext): RecoveryGuard {
		const identity = this.#lease;
		const controller = identity?.controller;
		return {
			checkClose: (session, request) =>
				this.#checkClose(context, session, request),
			retireClosedSession: (sessionId) => {
				const owner = this.#protectedSessions.get(sessionId);
				if (this.#authority?.session === sessionId)
					this.revoke(undefined, "closed");
				this.#protectedSessions.delete(sessionId);
				if (owner) {
					const host = this.#hosts.get(owner);
					if (host) {
						host.manual = null;
						host.ordinaryAutoMessage = null;
					}
				}
			},
			check: (s, source, m) => this.#check(context, s, source, m),
			accepted: (s, m, replayed) => this.#accepted(context, s, m, replayed),
			propose: (s, source, p) => this.#propose(context, s, source, p),
			requiresSource: () => this.#authority?.host === context.hostSessionId,
			snapshot: () => this.snapshot(context.hostSessionId),
			invalidate: () => {
				const lease = this.#lease;
				if (
					lease === identity &&
					lease?.controller === controller &&
					lease?.authority.host === context.hostSessionId
				) {
					lease.pending = null;
					lease.last = { kind: "stale" };
				}
			},
		};
	}
	#checkProtectedSession(context: RecoveryContext, session: Session): void {
		if (
			this.#protectedSessions.has(session.id) &&
			!this.#hosts.get(context.hostSessionId)?.fenced
		) {
			const host = this.#hosts.get(context.hostSessionId);
			if (
				!host?.manual ||
				host.parents.get(context.messageId) !== host.manual ||
				["flow-worker", "flow-reviewer", "flow-planner"].includes(context.agent)
			)
				throw new Error("Recovery belongs to a different host session.");
		}
	}
	#checkClose(
		context: RecoveryContext,
		session: Session,
		request: SessionCloseRequest,
	): void {
		this.#expireLease();
		this.#checkProtectedSession(context, session);
		const authority = this.#origin(context);
		if (!authority) return;
		this.#bind(authority, session);
		if (request.kind === "completed") return;
		const parent = this.#hosts
			.get(context.hostSessionId)
			?.parents.get(context.messageId);
		if (authority.direction === null || parent !== authority.direction)
			throw new Error("Session closure requires fresh real user direction.");
	}
	#check(
		context: RecoveryContext,
		session: Session,
		source: SourceDigest | null,
		mutation: RecoveryMutation,
	): void {
		this.#expireLease();
		const reserved = mutation.request.operationId.startsWith("flow-recovery-");
		if (
			reserved &&
			(!this.#lease ||
				this.#lease.authority.host !== context.hostSessionId ||
				!this.#lease.pending ||
				hash(this.#lease.pending.mutation) !== hash(mutation))
		)
			throw new Error(
				"Recovery operation requires its original live host grant.",
			);
		this.#checkProtectedSession(context, session);
		const authority = this.#origin(context);
		if (!authority) return;
		this.#bind(authority, session);
		const lease = this.#lease?.authority === authority ? this.#lease : null;
		if (lease) this.#discardStale(lease, session, source);
		const projection = compactProjection(session);
		const parent = this.#hosts
			.get(context.hostSessionId)
			?.parents.get(context.messageId);
		if (authority.direction !== null && parent === authority.direction) return;
		const target =
			mutation.request.nextFeatureId ??
			mutation.request.featureId ??
			(mutation.kind === "run-start"
				? nextRunnableFeature(session)
				: undefined);
		const active = session.runs.find((run) => run.state === "active");
		const pending = active?.reviews.find((review) => review.result === null);
		const automaticStart =
			mutation.kind === "run-start" &&
			target != null &&
			authority.automaticStarts.get(target) === session.revision;
		const freshStart =
			mutation.kind === "run-start" &&
			target != null &&
			sessionStatus(session) === "ready" &&
			!session.runs.some(
				(run) =>
					run.featureId === target &&
					run.reviews.some((review) => review.result?.verdict === "failed"),
			);
		const firstRetry =
			mutation.kind === "feature-reset" &&
			projection.blockedFeature?.failedReviewCount === 1 &&
			!projection.blockedFeature.scopeBlocker &&
			mutation.request.featureId === projection.blockedFeature.featureId &&
			(mutation.request.nextFeatureId === undefined ||
				mutation.request.nextFeatureId === projection.blockedFeature.featureId);
		const staleReview =
			mutation.kind === "feature-reset" &&
			active?.featureId === mutation.request.featureId &&
			pending !== undefined &&
			source !== null &&
			pending.sourceDigest !== source &&
			(mutation.request.nextFeatureId === undefined ||
				mutation.request.nextFeatureId === active?.featureId);
		if (
			!reserved &&
			(freshStart || firstRetry || staleReview || automaticStart)
		)
			return;
		const grant = lease?.pending;
		if (
			lease?.settings.mode !== "delegated" ||
			!grant ||
			grant.source !== source ||
			grant.binding !== this.#binding(session) ||
			hash(grant.mutation) !== hash(mutation)
		)
			throw new Error(
				"This checkpoint requires explicit user direction or exact host-authorized recovery.",
			);
		if (mutation.request.expectedRevision !== session.revision)
			throw new Error("Recovery revision changed.");
	}
	#discardStale(
		lease: Lease,
		session: Session,
		source: SourceDigest | null,
	): void {
		const pending = lease.pending;
		if (
			pending &&
			(pending.source !== source ||
				pending.mutation.request.expectedRevision !== session.revision ||
				pending.binding !== this.#binding(session))
		) {
			lease.pending = null;
			lease.last = { kind: "stale" };
		}
	}

	#accepted(
		context: RecoveryContext,
		session: Session,
		mutation: RecoveryMutation,
		replayed: boolean,
	): void {
		const authority = this.#authority;
		if (!authority || authority.host !== context.hostSessionId) return;
		if (
			!replayed &&
			mutation.kind === "run-start" &&
			mutation.request.featureId
		)
			authority.automaticStarts.delete(mutation.request.featureId);
		if (
			!replayed &&
			mutation.kind === "feature-reset" &&
			mutation.request.nextFeatureId === undefined &&
			mutation.request.featureId
		) {
			const history = session.runs.filter(
				(run) => run.featureId === mutation.request.featureId,
			);
			const directed =
				authority.direction !== null &&
				this.#hosts
					.get(context.hostSessionId)
					?.parents.get(context.messageId) === authority.direction;
			if (
				directed ||
				(history.filter((run) =>
					run.reviews.some((review) => review.result?.verdict === "failed"),
				).length === 1 &&
					!history.some((run) =>
						run.reviews.some((review) =>
							review.result?.findings.some((f) => f.scopeBlocker),
						),
					))
			)
				authority.automaticStarts.set(
					mutation.request.featureId,
					session.revision,
				);
		}
		if (!replayed) authority.direction = null;
		const lease = this.#lease?.authority === authority ? this.#lease : null;
		const grant = lease?.pending;
		if (!lease || !grant || hash(grant.mutation) !== hash(mutation)) return;
		if (grant.candidate.action === "retry")
			lease.retries.add(grant.candidate.featureId);
		else
			lease.selections.add(
				`${session.id}/${mutation.request.expectedRevision}`,
			);
		lease.pending = null;
		lease.last = {
			kind: "executed",
			operationId: mutation.request.operationId,
			featureId: grant.candidate.featureId,
		};
	}
	async #propose(
		context: RecoveryContext,
		session: Session,
		source: SourceDigest,
		proposal: RecoveryProposal,
	): Promise<unknown> {
		const authority = this.#origin(context);
		const lease = this.#lease;
		if (!authority || !lease || lease.authority !== authority)
			throw new Error(
				"Recovery advice requires an explicit active recovery command.",
			);
		this.#bind(authority, session);
		this.#discardStale(lease, session, source);
		if (
			proposal.sessionId !== session.id ||
			proposal.expectedRevision !== session.revision
		)
			throw new Error("Recovery proposal is stale.");
		const projection = compactProjection(session),
			status = sessionStatus(session);
		if (
			projection.nextAction !== "await-user-direction" ||
			(status !== "blocked" && status !== "ready")
		)
			throw new Error("This checkpoint is not eligible for recovery advice.");
		if (lease.inFlight) throw new Error("Recovery advice is already pending.");
		const checkpoint = `${session.id}/${session.revision}`;
		if (
			new Set(proposal.candidates.map((c) => c.id)).size !==
			proposal.candidates.length
		)
			throw new Error("Duplicate recovery candidate ids.");
		const candidates = proposal.candidates.filter((candidate) => {
			const feature = session.plan?.features.find(
				(f) => f.id === candidate.featureId,
			);
			const findingFeatureId =
				candidate.action === "retry"
					? candidate.featureId
					: projection.blockedFeature?.featureId;
			if (!feature || !findingFeatureId) return false;
			const liveFindings = livePriorFindings(session, findingFeatureId);
			const liveIds = new Set(liveFindings.map((finding) => finding.findingId));
			const proposedIds = new Set(candidate.findingIds);
			if (
				candidate.findingIds.some((id) => !liveIds.has(id)) ||
				liveFindings.some(
					(finding) =>
						finding.severity === "blocking" &&
						!proposedIds.has(finding.findingId),
				)
			)
				return false;
			if (
				!feature.dependsOn.every(
					(id) => currentRun(session, id)?.state === "completed",
				)
			)
				return false;
			if (candidate.action === "retry")
				return (
					currentRun(session, candidate.featureId)?.state !== "completed" &&
					!session.runs.some(
						(run) =>
							run.featureId === candidate.featureId &&
							run.reviews.some(
								(review) =>
									review.result?.verdict === "failed" &&
									review.result.findings.some(
										(finding) => finding.scopeBlocker,
									),
							),
					) &&
					!lease.retries.has(candidate.featureId) &&
					session.runs.filter(
						(r) =>
							r.featureId === candidate.featureId &&
							r.reviews.some((rv) => rv.result?.verdict === "failed"),
					).length < 3 &&
					(projection.blockedFeature?.featureId === candidate.featureId ||
						(status === "ready" &&
							session.runs.some(
								(r) =>
									r.featureId === candidate.featureId &&
									r.reviews.some((rv) => rv.result?.verdict === "failed"),
							)))
				);
			if (
				lease.selections.has(checkpoint) ||
				projection.blockedFeature?.featureId === candidate.featureId ||
				session.runs.some(
					(run) =>
						run.featureId === candidate.featureId &&
						run.reviews.some((review) => review.result?.verdict === "failed"),
				)
			)
				return false;
			const affected =
				session.plan && projection.blockedFeature
					? dependentClosure(session.plan, projection.blockedFeature.featureId)
					: new Set<string>();
			if (
				affected.has(candidate.featureId) ||
				feature.dependsOn.some((id) => affected.has(id))
			)
				return false;
			return !session.runs.some(
				(r) => r.featureId === candidate.featureId && r.state !== "superseded",
			);
		});
		if (!candidates.length)
			throw new Error(
				"No proposed recovery action is permitted by current history and dependencies.",
			);
		const findingFeatureIds = new Set(
			candidates.map((candidate) =>
				candidate.action === "retry"
					? candidate.featureId
					: projection.blockedFeature?.featureId,
			),
		);
		const findings = [...findingFeatureIds].flatMap((featureId) =>
			featureId
				? livePriorFindings(session, featureId).map((finding) => ({
						id: finding.findingId,
						summary: finding.summary,
						evidence: finding.evidence ?? "",
					}))
				: [],
		);
		if (findings.length > 30)
			throw new Error("Too many live findings for bounded recovery advice.");
		const packet: DecisionPacket = {
			sessionId: session.id,
			revision: session.revision,
			sourceDigest: source,
			goal: session.goal,
			planDigest: this.#binding(session),
			rubric: "recovery-v1",
			findings,
			candidates,
		};
		if (Buffer.byteLength(JSON.stringify(packet)) > MAX_RECOVERY_PACKET_BYTES)
			throw new Error("Recovery context exceeds the bounded request size.");
		if (this.#provider.fitsRequest?.(packet) === false)
			throw new Error("Recovery provider request exceeds the bounded size.");
		const packetDigest = hash(packet),
			remedyDigest = hash(
				candidates.map((c) => ({
					remedy: c.remedy,
					changed: c.changedFromPreviousAttempt,
					findings: c.findingIds,
				})),
			);
		if (lease.pending)
			return { kind: "pending", recommended: lease.pending.mutation };
		if (lease.packets.has(packetDigest) || lease.remedies.has(remedyDigest))
			throw new Error("Repeated recovery packet or remedy cannot spend again.");
		if (
			(lease.checkpointCalls.get(checkpoint) ?? 0) >= 2 ||
			lease.calls >= lease.settings.maxCalls
		)
			throw new Error("Recovery decision budget exhausted.");
		lease.inFlight = true;
		const controller = lease.controller;
		let attemptReserved = false;
		const assessmentStarted = this.#now();
		const initialCalls = lease.calls;
		const initialReservedUsd = lease.reservedUsd;
		let advice: DecisionAdvice;
		try {
			advice = await this.#provider.assess(packet, {
				signal: controller.signal,
				reserveAttempt: () => {
					if (
						this.#lease !== lease ||
						lease.controller !== controller ||
						controller.signal.aborted ||
						this.#now() >= lease.deadline ||
						lease.calls >= lease.settings.maxCalls ||
						lease.reservedUsd + JEV_ATTEMPT_RESERVATION_USD >
							lease.settings.maxUsd + Number.EPSILON
					)
						return false;
					lease.calls++;
					lease.reservedUsd += JEV_ATTEMPT_RESERVATION_USD;
					if (!attemptReserved) {
						attemptReserved = true;
						lease.packets.add(packetDigest);
						lease.remedies.add(remedyDigest);
						lease.checkpointCalls.set(
							checkpoint,
							(lease.checkpointCalls.get(checkpoint) ?? 0) + 1,
						);
					}
					return true;
				},
			});
		} catch {
			advice = { kind: "unavailable", reason: "provider" };
		} finally {
			lease.inFlight = false;
		}
		this.#expireLease();
		if (
			this.#lease !== lease ||
			lease.controller !== controller ||
			controller.signal.aborted
		)
			throw new Error("Recovery advice was cancelled.");
		this.#origin(context);
		if (!attemptReserved) {
			lease.packets.add(packetDigest);
			lease.remedies.add(remedyDigest);
		}
		const profile = this.#profile() ?? {
			choice: 0.9,
			goal: 0.95,
			suitability: 0.95,
		};
		const candidate =
			advice.kind === "answered"
				? candidates.find((c) => c.id === advice.choice)
				: undefined;
		const assessment =
			advice.kind === "answered" && candidate
				? advice.assessments[candidate.id]
				: undefined;
		const selected =
			attemptReserved &&
			advice.kind === "answered" &&
			advice.model === "jev-1.13.0" &&
			candidate &&
			assessment &&
			(advice.probabilities[candidate.id] ?? 0) >= profile.choice &&
			assessment.goal >= profile.goal &&
			assessment.suitability >= profile.suitability
				? candidate
				: undefined;
		lease.last = {
			kind: selected
				? "selected"
				: advice.kind === "unavailable"
					? "unavailable"
					: "abstain",
			mode: lease.settings.mode,
			packetDigest,
			model:
				advice.kind === "answered"
					? advice.model
					: (advice.resolvedModel ?? null),
			requestedModel: "jev-1.13.0",
			telemetry: {
				...(advice.telemetry ?? {
					transportLatencyMs:
						advice.kind === "answered" ? advice.latencyMs : null,
					transportAttempts: null,
					transportReservedUsd: null,
					responseUsage:
						advice.kind === "answered"
							? {
									inputTokens: advice.inputTokens,
									outputTokens: advice.outputTokens,
								}
							: null,
				}),
				assessmentElapsedMs: this.#now() - assessmentStarted,
				attemptsReserved: lease.calls - initialCalls,
				reservedUsd: lease.reservedUsd - initialReservedUsd,
			},
			decision: recoveryDecisionView(
				advice,
				candidate,
				attemptReserved,
				profile,
			),
			selectedCandidateId: selected?.id ?? null,
			action: selected?.action ?? null,
			featureId: selected?.featureId ?? null,
			reason:
				advice.kind === "unavailable" &&
				[
					"missing-key",
					"sensitive-packet",
					"budget",
					"cancelled",
					"timeout",
					"transport",
					"http",
					"oversize",
					"malformed",
					"invalid-response",
					"model-mismatch",
					"invalid-distribution",
				].includes(advice.reason)
					? advice.reason
					: advice.kind === "unavailable"
						? "provider"
						: null,
		};
		if (!selected || lease.settings.mode === "shadow") return lease.last;
		const mutation: RecoveryMutation = projection.blockedFeature
			? {
					kind: "feature-reset",
					request: {
						operationId: `flow-recovery-${randomUUID()}`,
						expectedRevision: session.revision,
						featureId: projection.blockedFeature.featureId,
						nextFeatureId: selected.featureId,
					},
				}
			: {
					kind: "run-start",
					request: {
						operationId: `flow-recovery-${randomUUID()}`,
						expectedRevision: session.revision,
						featureId: selected.featureId,
					},
				};
		lease.pending = {
			mutation,
			source,
			binding: this.#binding(session),
			candidate: selected,
		};
		return { ...lease.last, recommended: mutation };
	}
}
export function isExactRecoveryReplay(
	session: Session,
	mutation: RecoveryMutation,
): boolean {
	return session.operations.some(
		(op) =>
			op.id === mutation.request.operationId &&
			op.kind === mutation.kind &&
			op.inputDigest === operationInputDigest(mutation.request),
	);
}
