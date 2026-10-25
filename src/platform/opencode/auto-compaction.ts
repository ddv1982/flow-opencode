import { isDeepStrictEqual as same } from "node:util";
import type { SessionInfo, SessionMessageInfo } from "@opencode/client";
import type {
	SessionCompaction,
	SessionContext,
} from "@opencode/plugin/promise/session";
import type { AutoDriveDelivery } from "./auto-drive.js";
import {
	type InputOrigin,
	modelInputIDs,
	nativeDelivery,
	nativeInputIDs,
	sameDelivery,
} from "./execution-attribution.js";
import type {
	InputAdmissions,
	ResolvedSource,
	SourceOperation,
} from "./input-admission.js";

const completedPrefix = Symbol();
export type CompletedPrefix = Readonly<{
	[completedPrefix]: true;
	sourceOrigin: InputOrigin;
	consumed: readonly string[];
	checkpoint: string;
}>;
type Native = readonly SessionMessageInfo[];
type ControlProof = Readonly<{
	id: string;
	reason: "auto" | "manual";
	consumed: readonly string[];
	delivery: AutoDriveDelivery;
}>;
type CheckedContinuation = ControlProof &
	Readonly<{
		kind: "continuation";
		source: string;
		sourceOrigin: InputOrigin;
		origin: InputOrigin;
	}>;
type CheckedSummary = ControlProof &
	Readonly<{ kind: "summary-only"; reason: "manual" }>;
type CompactionResult = CheckedContinuation | CheckedSummary;
function running(
	input: SessionCompaction,
	native: Native,
): Readonly<{ proof: ControlProof; prefix: Native }> {
	const position = native.findLastIndex(
		(message) => message.type === "compaction",
	);
	const control = native[position];
	const reason: unknown =
		control?.type === "compaction" ? control.reason : undefined;
	if (
		control?.type !== "compaction" ||
		control.status !== "running" ||
		(reason !== "auto" && reason !== "manual")
	)
		throw new Error(
			"Flow cannot retain authority through unverified or manual compaction.",
		);
	const consumed = modelInputIDs(input),
		prefix = native.slice(0, position);
	if (
		!same(nativeInputIDs(native), consumed) ||
		!same(nativeInputIDs(prefix), consumed)
	)
		throw new Error(
			"Flow compaction inputs differ from the native control prefix.",
		);
	return {
		proof: Object.freeze({
			id: control.id,
			reason,
			consumed: Object.freeze(consumed),
			delivery: nativeDelivery(input),
		}),
		prefix,
	};
}
type CompactionOptions = Readonly<{
	inputs: InputAdmissions;
	readNative(host: string): Promise<Native>;
	readSelected(host: string): Promise<SessionInfo>;
	captureReplacement(host: string): Readonly<{
		check(input: SessionCompaction, native: Native, changing: boolean): void;
		current(): boolean;
		supersede(): void;
	}>;
	failure(operation: SourceOperation, stillExpected: () => boolean): void;
	hasActivePrimary(host: string): boolean;
	guidance(host: string): string | null;
	observe(host: string, origin: InputOrigin, source: string, id: string): void;
}>;
export class CompactionBoundary {
	readonly #records = new Map<string, CompactionResult>();
	readonly #pending = new Map<string, SourceOperation>();
	readonly #options: CompactionOptions;
	constructor(options: CompactionOptions) {
		this.#options = options;
	}
	#key(host: string, id: string) {
		return JSON.stringify([host, id]);
	}
	async admit(value: SessionCompaction): Promise<CompactionResult> {
		const input = {
			...value,
			model: { ...value.model },
			messages: structuredClone(value.messages),
		};
		const effects = this.#options.captureReplacement(input.sessionID);
		const operation = this.#options.inputs.openSource(input);
		let scope = operation.scope;
		let resolved: ResolvedSource | undefined;
		const prior = this.#pending.get(scope.host);
		if (prior?.current()) {
			operation.release();
			throw new Error("Flow compaction callbacks overlap.");
		}
		this.#pending.set(scope.host, operation);
		try {
			const first = running(
				input,
				await scope.wait(this.#options.readNative(scope.host)),
			);
			await scope.ready();
			const second = running(
				input,
				await scope.wait(this.#options.readNative(scope.host)),
			);
			if (!same(first.proof, second.proof))
				throw new Error("Flow automatic compaction control identity changed.");
			const selected = await scope.wait(this.#options.readSelected(scope.host));
			const final = running(
				input,
				await scope.wait(this.#options.readNative(scope.host)),
			);
			if (!same(first.proof, final.proof))
				throw new Error("Flow automatic compaction control identity changed.");
			const existing = this.#records.get(this.#key(scope.host, final.proof.id));
			const transfer = existing
				? undefined
				: this.#options.inputs.assertCheckpointAvailable(
						scope.host,
						final.proof.id,
					);
			resolved = await operation.resolve(final.prefix, selected, {
				check: (changing, source) => {
					if (
						existing &&
						(!source ||
							!same(final.proof, {
								id: existing.id,
								reason: existing.reason,
								consumed: existing.consumed,
								delivery: existing.delivery,
							}) ||
							(existing.kind === "continuation" &&
								(source.kind !== "live" ||
									existing.sourceOrigin !== source.origin)))
					)
						throw new Error(
							"Flow automatic compaction control identity changed.",
						);
					const evidence =
						source?.kind === "unregistered" ? { kind: source.lineage } : source;
					if (
						evidence?.kind === "retired-automatic" ||
						evidence?.kind === "rejected"
					)
						throw new Error("Flow execution epoch was revoked.");
					if (evidence && evidence.kind !== "live") {
						if (final.proof.reason !== "manual")
							throw new Error(
								evidence.kind === "unknown-history"
									? "Flow compaction has no accepted input origin."
									: "Flow execution epoch was revoked.",
							);
						if (
							this.#options.guidance(scope.host) ||
							this.#options.hasActivePrimary(scope.host)
						)
							throw new Error(
								"Flow manual summary cannot overlap a live execution.",
							);
					}
					if (
						final.proof.reason === "manual" &&
						evidence?.kind === "live" &&
						evidence.origin.authority
					)
						throw new Error(
							"Flow cannot retain authority through unverified or manual compaction.",
						);
					effects.check(input, final.prefix, changing);
					if (
						final.proof.reason === "manual" &&
						changing &&
						this.#options.guidance(scope.host)
					)
						throw new Error(
							"Flow cannot retain authority through unverified or manual compaction.",
						);
				},
				supersede: effects.supersede,
			});
			scope = resolved.scope;
			const source = resolved.evidence;
			const evidence =
				source.kind === "unregistered" ? { kind: source.lineage } : source;
			let result: CompactionResult;
			if (evidence.kind === "live") {
				const origin = this.completed(input, final.prefix) ?? evidence.origin;
				this.#options.inputs.assertLive(origin);
				if (!sameDelivery(origin.delivery, final.proof.delivery))
					throw new Error(
						"Flow compaction delivery differs from its accepted input.",
					);
				if (final.proof.reason === "manual" && origin.authority)
					throw new Error(
						"Flow cannot retain authority through unverified or manual compaction.",
					);
				const existing = this.#records.get(
					this.#key(scope.host, final.proof.id),
				);
				if (existing) {
					if (
						existing.kind !== "continuation" ||
						existing.sourceOrigin !== origin ||
						!same(
							{ ...first.proof },
							{
								id: existing.id,
								reason: existing.reason,
								consumed: existing.consumed,
								delivery: existing.delivery,
							},
						)
					)
						throw new Error(
							"Flow automatic compaction control identity changed.",
						);
					return existing;
				}
				const identity = { ...origin, id: final.proof.id };
				const checkpoint: InputOrigin = origin.authority
					? Object.freeze({
							...identity,
							automatic: true,
							authority: origin.authority,
						})
					: Object.freeze({ ...identity, automatic: false, authority: null });
				result = Object.freeze({
					...final.proof,
					kind: "continuation",
					source: scope.source,
					sourceOrigin: origin,
					origin: checkpoint,
				});
			} else {
				if (
					evidence.kind === "retired-automatic" ||
					evidence.kind === "rejected"
				)
					throw new Error("Flow execution epoch was revoked.");
				if (final.proof.reason !== "manual")
					throw new Error(
						evidence.kind === "unknown-history"
							? "Flow compaction has no accepted input origin."
							: "Flow execution epoch was revoked.",
					);
				if (
					this.#options.guidance(scope.host) ||
					this.#options.hasActivePrimary(scope.host)
				)
					throw new Error(
						"Flow manual summary cannot overlap a live execution.",
					);
				result = Object.freeze({
					...final.proof,
					reason: "manual",
					kind: "summary-only",
				});
				const existing = this.#records.get(
					this.#key(scope.host, final.proof.id),
				);
				if (existing) {
					if (!same(existing, result))
						throw new Error(
							"Flow automatic compaction control identity changed.",
						);
					return existing;
				}
			}
			scope.assertCurrent();
			this.#options.inputs.checkpoint(
				scope,
				result.id,
				result.kind === "continuation" ? result.origin : null,
				transfer,
			);
			this.#records.set(this.#key(scope.host, result.id), result);
			return result;
		} catch (error) {
			this.#options.failure(operation, effects.current);
			throw error;
		} finally {
			if (this.#pending.get(scope.host) === operation)
				this.#pending.delete(scope.host);
			operation.release();
		}
	}
	prefixBridge(
		input: Pick<SessionContext, "sessionID" | "messages" | "agent" | "model">,
		native: Native,
		predecessor?: InputOrigin,
	): CompletedPrefix | undefined {
		const first = modelInputIDs(input)[0];
		if (!first || !predecessor) return;
		const record = this.#records.get(this.#key(input.sessionID, first));
		if (record?.kind !== "continuation") return;
		const control = native.findLast((message) => message.type === "compaction");
		if (
			control?.type !== "compaction" ||
			control.id !== record.id ||
			control.reason !== record.reason ||
			control.status !== "completed" ||
			nativeInputIDs(native)[0] !== record.id
		)
			throw new Error("Flow automatic compaction control identity changed.");
		this.#options.inputs.assertLive(record.origin);
		let prior = record;
		while (prior.sourceOrigin !== predecessor) {
			const checkpoint = prior.consumed[0];
			if (prior.consumed.length !== 1 || !checkpoint) return;
			const previous = this.#records.get(
				this.#key(input.sessionID, checkpoint),
			);
			if (
				previous?.kind !== "continuation" ||
				prior.sourceOrigin !== previous.origin
			)
				return;
			prior = previous;
		}
		return Object.freeze({
			[completedPrefix]: true as const,
			sourceOrigin: prior.sourceOrigin,
			consumed: prior.consumed,
			checkpoint: record.id,
		});
	}
	completed(
		input: Pick<SessionContext, "sessionID" | "messages" | "agent" | "model">,
		native: Native,
	): InputOrigin | undefined {
		const consumed = modelInputIDs(input),
			source = consumed.at(-1);
		if (!source) return;
		const record = this.#records.get(this.#key(input.sessionID, source));
		if (!record) return;
		if (record.kind === "summary-only")
			throw new Error(
				"Flow context has an unknown, synthetic, or stale real input.",
			);
		const control = native.findLast((message) => message.type === "compaction");
		if (
			control?.type !== "compaction" ||
			control.id !== record.id ||
			control.reason !== record.reason ||
			control.status !== "completed" ||
			!same(consumed, [record.id])
		)
			throw new Error("Flow automatic compaction control identity changed.");
		if (
			native
				.slice(native.indexOf(control) + 1)
				.some(
					(message) => message.type === "user" || message.type === "synthetic",
				)
		)
			throw new Error(
				"Flow automatic compaction was interrupted by new input.",
			);
		if (!sameDelivery(record.delivery, nativeDelivery(input)))
			throw new Error(
				"Flow admitted agent or model differs from its primary request.",
			);
		this.#options.inputs.assertLive(record.origin);
		this.#options.observe(
			input.sessionID,
			record.origin,
			record.source,
			record.id,
		);
		return record.origin;
	}
}
