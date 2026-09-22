import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { operationInputDigest } from "../domain/operation.js";
import {
	currentRun,
	type Session,
	type SourceDigest,
} from "../domain/session.js";
import { sessionStatus } from "../domain/session-queries.js";
import { dependentClosure } from "../domain/transitions.js";
import type {
	DecisionAdvice,
	DecisionPacket,
	DecisionProvider,
	RecoveryCandidate,
} from "./ports/decision-provider.js";
import { JEV_ATTEMPT_RESERVATION_USD } from "./ports/decision-provider.js";
import { compactProjection } from "./session-projection.js";

const Text = z.string().trim().min(1).max(2000);
export const RecoveryProposalSchema = z
	.object({
		id: z.string().min(1).max(128),
		sessionId: z.string().min(1).max(256),
		expectedRevision: z.number().int().safe().nonnegative(),
		candidates: z
			.array(
				z
					.object({
						id: z
							.string()
							.regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
							.refine((id) => id !== "abstain"),
						action: z.enum(["retry", "independent-feature"]),
						featureId: z.string().min(1).max(128),
						remedy: Text,
						changedFromPreviousAttempt: Text,
						findingIds: z.array(z.string().min(1).max(128)).min(1).max(10),
					})
					.strict(),
			)
			.min(1)
			.max(3),
	})
	.strict();
type RecoveryProposal = z.infer<typeof RecoveryProposalSchema>;
export type RecoverySettings = Readonly<{
	mode: "shadow" | "delegated";
	maxCalls: number;
	maxUsd: number;
}>;
type RecoveryContext = Readonly<{
	hostSessionId: string;
	messageId: string;
	agent: string;
}>;
export type RecoveryMutation = Readonly<{
	kind: "feature-reset" | "run-start";
	request: {
		operationId: string;
		expectedRevision: number;
		featureId?: string | undefined;
		nextFeatureId?: string | undefined;
	};
}>;
export type RecoveryProfile = Readonly<{
	id: string;
	model: "jev-1.13.0";
	rubric: "recovery-v1";
	policy: "bounded-recovery-v1";
	choice: number;
	goal: number;
	suitability: number;
}>;
const QUALIFIED_RECOVERY_PROFILES: readonly RecoveryProfile[] = Object.freeze(
	[],
);

const hash = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Grant = {
	mutation: RecoveryMutation;
	source: SourceDigest;
	binding: string;
	candidate: RecoveryCandidate;
};
type Lease = {
	host: string;
	settings: RecoverySettings;
	controller: AbortController;
	parent: string | null;
	direction: string | null;
	session: string | null;
	binding: string | null;
	deadline: number;
	calls: number;
	reservedUsd: number;
	packets: Set<string>;
	remedies: Set<string>;
	checkpointCalls: Map<string, number>;
	retries: Set<string>;
	automaticStarts: Map<string, number>;
	selections: Set<string>;
	pending: Grant | null;
	inFlight: boolean;
	last: Record<string, unknown> | null;
	proposalPrompt: string | null;
};
type Host = {
	parents: Map<string, string>;
	manual: string | null;
	fenced: boolean;
};
export type RecoveryGuard = Readonly<{
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
	#hosts = new Map<string, Host>();
	#protectedSessions = new Set<string>();
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
			if (this.#hosts.size >= 128)
				throw new Error(
					"Recovery host capacity reached. Restart with explicit user direction.",
				);
			host = { parents: new Map(), manual: null, fenced: false };
			this.#hosts.set(id, host);
		}
		return host;
	}
	activate(host: string, settings: RecoverySettings): void {
		if (
			!Number.isSafeInteger(settings.maxCalls) ||
			settings.maxCalls < 1 ||
			settings.maxCalls > 100 ||
			!Number.isFinite(settings.maxUsd) ||
			settings.maxUsd <= 0 ||
			settings.maxUsd > 10
		)
			throw new Error(
				"Recovery requires 1-100 calls and a positive budget at most $10.",
			);
		if (settings.mode === "delegated" && !this.#profile())
			throw new Error(
				"Delegated recovery is unavailable. No release-owned live qualification matches this model and policy. Use shadow.",
			);
		this.revoke();
		this.#host(host).fenced = true;
		this.#lease = {
			host,
			settings,
			controller: new AbortController(),
			parent: null,
			direction: null,
			session: null,
			binding: null,
			deadline: this.#now() + 60 * 60 * 1000,
			calls: 0,
			reservedUsd: 0,
			packets: new Set(),
			remedies: new Set(),
			checkpointCalls: new Map(),
			retries: new Set(),
			automaticStarts: new Map(),
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
	revoke(host?: string): void {
		if (this.#lease && (!host || this.#lease.host === host)) {
			this.#lease.controller.abort();
			const hostState = this.#hosts.get(this.#lease.host);
			if (hostState) hostState.manual = null;
			this.#lease = null;
		}
	}
	observeMessage(hostId: string, id: string, synthetic: boolean): void {
		const host =
			this.#hosts.get(hostId) ??
			(!synthetic && this.#protectedSessions.size
				? this.#host(hostId)
				: undefined);
		if (!host) return;
		const lease = this.#lease?.host === hostId ? this.#lease : null;
		if (!synthetic) host.manual = id;
		if (lease) {
			if (!synthetic && lease.parent !== null) lease.direction = id;
			lease.parent = id;
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
	#origin(context: RecoveryContext): Lease | null {
		const host = this.#hosts.get(context.hostSessionId);
		if (!host?.fenced) return null;
		if (
			["flow-worker", "flow-reviewer", "flow-planner"].includes(context.agent)
		)
			throw new Error("Only the observed manager may perform recovery.");
		const parent = host.parents.get(context.messageId);
		const lease =
			this.#lease?.host === context.hostSessionId ? this.#lease : null;
		if (lease) {
			if (
				!parent ||
				parent !== lease.parent ||
				lease.controller.signal.aborted ||
				this.#now() >= lease.deadline
			)
				throw new Error("Recovery lineage expired or cancelled.");
			return lease;
		}
		if (!parent || parent !== host.manual)
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
	#bind(lease: Lease, session: Session) {
		const binding = this.#binding(session);
		if (lease.session === null) {
			lease.session = session.id;
			lease.binding = binding;
			if (
				this.#protectedSessions.size >= 128 &&
				!this.#protectedSessions.has(session.id)
			)
				throw new Error("Recovery session capacity reached.");
			this.#protectedSessions.add(session.id);
		}
		if (lease.session !== session.id || lease.binding !== binding) {
			this.revoke(lease.host);
			throw new Error("Recovery session or approved plan changed.");
		}
	}
	snapshot() {
		const lease = this.#lease;
		return lease
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
				}
			: { mode: "off" };
	}
	proposalPrompt(
		host: string,
		session: string | undefined,
		revision: number,
		nextAction: string | null,
	): string | null {
		const lease = this.#lease;
		if (
			!lease ||
			lease.host !== host ||
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
		return {
			check: (s, source, m) => this.#check(context, s, source, m),
			accepted: (s, m, replayed) => this.#accepted(context, s, m, replayed),
			propose: (s, source, p) => this.#propose(context, s, source, p),
			requiresSource: () => this.#lease?.host === context.hostSessionId,
			snapshot: () => this.snapshot(),
			invalidate: () => {
				const lease = this.#lease;
				if (lease === identity && lease?.host === context.hostSessionId) {
					lease.pending = null;
					lease.last = { kind: "stale" };
				}
			},
		};
	}
	#check(
		context: RecoveryContext,
		session: Session,
		source: SourceDigest | null,
		mutation: RecoveryMutation,
	): void {
		const reserved = mutation.request.operationId.startsWith("flow-recovery-");
		if (
			reserved &&
			(!this.#lease ||
				this.#lease.host !== context.hostSessionId ||
				!this.#lease.pending ||
				hash(this.#lease.pending.mutation) !== hash(mutation))
		)
			throw new Error(
				"Recovery operation requires its original live host grant.",
			);
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
		const lease = this.#origin(context);
		if (!lease) return;
		this.#bind(lease, session);
		this.#discardStale(lease, session, source);
		const projection = compactProjection(session);
		const parent = this.#hosts
			.get(context.hostSessionId)
			?.parents.get(context.messageId);
		if (lease.direction !== null && parent === lease.direction) return;
		const target = mutation.request.nextFeatureId ?? mutation.request.featureId;
		const active = session.runs.find((run) => run.state === "active");
		const pending = active?.reviews.find((review) => review.result === null);
		const automaticStart =
			mutation.kind === "run-start" &&
			target !== undefined &&
			lease.automaticStarts.get(target) === session.revision;
		const freshStart =
			mutation.kind === "run-start" &&
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
		const grant = lease.pending;
		if (
			lease.settings.mode !== "delegated" ||
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
		const lease = this.#lease;
		if (!lease || lease.host !== context.hostSessionId) return;
		if (
			!replayed &&
			mutation.kind === "run-start" &&
			mutation.request.featureId
		)
			lease.automaticStarts.delete(mutation.request.featureId);
		if (
			!replayed &&
			mutation.kind === "feature-reset" &&
			mutation.request.nextFeatureId === undefined &&
			mutation.request.featureId
		) {
			const history = session.runs.filter(
				(run) => run.featureId === mutation.request.featureId,
			);
			if (
				history.filter((run) =>
					run.reviews.some((review) => review.result?.verdict === "failed"),
				).length === 1 &&
				!history.some((run) =>
					run.reviews.some((review) =>
						review.result?.findings.some((f) => f.scopeBlocker),
					),
				)
			)
				lease.automaticStarts.set(mutation.request.featureId, session.revision);
		}
		const grant = lease.pending;
		if (!grant || hash(grant.mutation) !== hash(mutation)) return;
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
		const lease = this.#origin(context);
		if (!lease)
			throw new Error(
				"Recovery advice requires an explicit active recovery command.",
			);
		this.#bind(lease, session);
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
		const findingEntries = session.runs.flatMap((run) =>
			run.reviews.flatMap((review) =>
				(review.result?.findings ?? []).map((f) => ({
					id: f.findingId ?? "",
					summary: f.summary,
					evidence: f.evidence ?? "",
					scope: f.scopeBlocker === true,
				})),
			),
		);
		const findings = findingEntries.filter((f) => f.id).slice(-30);
		const ids = new Set(findings.map((f) => f.id));
		if (
			new Set(proposal.candidates.map((c) => c.id)).size !==
			proposal.candidates.length
		)
			throw new Error("Duplicate recovery candidate ids.");
		const candidates = proposal.candidates.filter((candidate) => {
			const feature = session.plan?.features.find(
				(f) => f.id === candidate.featureId,
			);
			if (!feature || candidate.findingIds.some((id) => !ids.has(id)))
				return false;
			if (
				!feature.dependsOn.every(
					(id) => currentRun(session, id)?.state === "completed",
				)
			)
				return false;
			if (candidate.action === "retry")
				return (
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
		const packet: DecisionPacket = {
			sessionId: session.id,
			revision: session.revision,
			sourceDigest: source,
			goal: session.goal,
			planDigest: this.#binding(session),
			rubric: "recovery-v1",
			findings: findings.map(({ id, summary, evidence }) => ({
				id,
				summary,
				evidence,
			})),
			candidates,
		};
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
		lease.packets.add(packetDigest);
		lease.remedies.add(remedyDigest);
		lease.checkpointCalls.set(
			checkpoint,
			(lease.checkpointCalls.get(checkpoint) ?? 0) + 1,
		);
		lease.inFlight = true;
		let advice: DecisionAdvice;
		try {
			advice = await this.#provider.assess(packet, {
				signal: lease.controller.signal,
				reserveAttempt: () => {
					if (
						this.#lease !== lease ||
						lease.controller.signal.aborted ||
						this.#now() >= lease.deadline ||
						lease.calls >= lease.settings.maxCalls ||
						lease.reservedUsd + JEV_ATTEMPT_RESERVATION_USD >
							lease.settings.maxUsd
					)
						return false;
					lease.calls++;
					lease.reservedUsd += JEV_ATTEMPT_RESERVATION_USD;
					return true;
				},
			});
		} catch {
			advice = { kind: "unavailable", reason: "provider" };
		} finally {
			lease.inFlight = false;
		}
		if (this.#lease !== lease || lease.controller.signal.aborted)
			throw new Error("Recovery advice was cancelled.");
		this.#origin(context);
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
			model: advice.kind === "answered" ? advice.model : null,
			requestedModel: "jev-1.13.0",
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
