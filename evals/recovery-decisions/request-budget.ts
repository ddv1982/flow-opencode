import { mkdir, open, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { writeExclusive } from "../../scripts/lib/exclusive-json.js";
import { JEV_ATTEMPT_RESERVATION_USD } from "../../src/application/ports/decision-provider.js";
import { datasetDigest } from "./schema.js";

export const BudgetModel = z.enum([
	"openai/gpt-5.6-terra",
	"xai/grok-4.6",
	"typesafe/jev-1.13.0",
]);
const Money = z.number().int().safe().positive().max(1_000_000_000_000);
export const RequestAuthorizationSchema = z
	.object({
		schemaVersion: z.literal(1),
		origin: z.enum(["simulation", "live"]),
		purpose: z.string().trim().min(1).max(1000),
		maxRequests: z.number().int().positive().max(100000),
		maxMicroUsd: Money,
		expiresAt: z.iso.datetime(),
		models: z
			.array(
				z
					.object({
						model: BudgetModel,
						reservationMicroUsd: Money,
						basis: z.discriminatedUnion("kind", [
							z.object({ kind: z.literal("simulation") }).strict(),
							z
								.object({
									kind: z.literal("reviewed-upper-bound"),
									reviewedBy: z.string().trim().min(1).max(256),
									evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/),
								})
								.strict(),
						]),
					})
					.strict(),
			)
			.min(1)
			.max(3),
	})
	.strict()
	.superRefine((value, context) => {
		if (
			new Set(value.models.map((row) => row.model)).size !== value.models.length
		)
			context.addIssue({ code: "custom", message: "Duplicate budget model." });
		if (
			value.models.some(
				(row) =>
					row.model === "typesafe/jev-1.13.0" &&
					row.reservationMicroUsd <
						Math.ceil(JEV_ATTEMPT_RESERVATION_USD * 1_000_000),
			)
		)
			context.addIssue({
				code: "custom",
				message: "Jev reservation is below the runtime request bound.",
			});
		if (
			value.origin === "live" &&
			value.models.some((row) => row.basis.kind !== "reviewed-upper-bound")
		)
			context.addIssue({
				code: "custom",
				message:
					"Live reservations need reviewed request-cost upper bounds for the actual routes.",
			});
	});
export type RequestAuthorization = z.infer<typeof RequestAuthorizationSchema>;
export const EpisodeReservationScopeSchema = z
	.object({
		executionId: z.uuid(),
		registrationDigest: z.string().regex(/^[a-f0-9]{64}$/),
		episodeId: z.string().trim().min(1).max(1000),
		arm: z.enum(["manager-only", "manager-plus-jev"]),
		harnessDigest: z.string().regex(/^[a-f0-9]{64}$/),
	})
	.strict();
export type EpisodeReservationScope = Readonly<
	z.infer<typeof EpisodeReservationScopeSchema>
>;
const LegacyClaim = z
	.object({
		schemaVersion: z.literal(1),
		authorizationDigest: z.string().regex(/^[a-f0-9]{64}$/),
		sequence: z.number().int().nonnegative(),
		model: BudgetModel,
		reservationMicroUsd: Money,
		at: z.iso.datetime(),
	})
	.strict();

const ScopedClaim = LegacyClaim.extend({
	schemaVersion: z.literal(2),
	scope: EpisodeReservationScopeSchema,
});
const Claim = z.discriminatedUnion("schemaVersion", [LegacyClaim, ScopedClaim]);
export const ReservationReconciliationSchema = z
	.object({
		scope: EpisodeReservationScopeSchema,
		authorization: RequestAuthorizationSchema,
		authorizationDigest: z.string().regex(/^[a-f0-9]{64}$/),
		claims: z.array(ScopedClaim).max(100000),
		claimsDigest: z.string().regex(/^[a-f0-9]{64}$/),
		totalMicroUsd: z.number().int().safe().nonnegative().max(1_000_000_000_000),
	})
	.strict()
	.superRefine((value, context) => {
		let previous = -1,
			total = 0;
		const scopeDigest = datasetDigest(value.scope);
		if (
			datasetDigest(value.authorization) !== value.authorizationDigest ||
			value.claims.length > value.authorization.maxRequests
		)
			context.addIssue({
				code: "custom",
				message: "Reservation authorization mismatch.",
			});
		for (const claim of value.claims) {
			if (
				claim.reservationMicroUsd !==
					value.authorization.models.find((row) => row.model === claim.model)
						?.reservationMicroUsd ||
				claim.sequence >= value.authorization.maxRequests ||
				claim.sequence <= previous ||
				claim.authorizationDigest !== value.authorizationDigest ||
				datasetDigest(claim.scope) !== scopeDigest
			)
				context.addIssue({
					code: "custom",
					message:
						"Reservation reconciliation claim binding or sequence mismatch.",
				});
			previous = claim.sequence;
			total += claim.reservationMicroUsd;
		}
		if (
			total > value.authorization.maxMicroUsd ||
			!Number.isSafeInteger(total) ||
			total !== value.totalMicroUsd ||
			datasetDigest(value.claims) !== value.claimsDigest
		)
			context.addIssue({
				code: "custom",
				message: "Reservation reconciliation total or digest mismatch.",
			});
	});
export type ReservationReconciliation = z.infer<
	typeof ReservationReconciliationSchema
>;

export async function createRequestBudget(directory: string, input: unknown) {
	const authorization = RequestAuthorizationSchema.parse(input);
	if (Date.parse(authorization.expiresAt) <= Date.now())
		throw new Error("Request authorization expired.");
	await mkdir(directory, { mode: 0o700 });
	if (process.platform !== "win32") {
		const parent = await open(dirname(directory), "r");
		try {
			await parent.sync();
		} finally {
			await parent.close();
		}
	}
	await writeExclusive(join(directory, "authorization.json"), authorization);
	return authorization;
}

async function readRequestLedger(directory: string, signal?: AbortSignal) {
	const readText = (path: string) =>
		readFile(path, { encoding: "utf8", ...(signal ? { signal } : {}) });
	signal?.throwIfAborted();
	const authorization = RequestAuthorizationSchema.parse(
		JSON.parse(await readText(join(directory, "authorization.json"))),
	);
	signal?.throwIfAborted();
	const authorizationDigest = datasetDigest(authorization);
	const files = (await readdir(directory))
		.filter(
			(name) =>
				!name.startsWith(".pending-") &&
				name !== "authorization.json" &&
				name !== "cancelled.json",
		)
		.sort();
	let reservedMicroUsd = 0;
	const claims: z.infer<typeof Claim>[] = [];
	for (const [sequence, name] of files.entries()) {
		signal?.throwIfAborted();
		if (name !== `request-${String(sequence).padStart(6, "0")}.json`)
			throw new Error("Invalid request ledger sequence.");
		const claim = Claim.parse(
			JSON.parse(await readText(join(directory, name))),
		);
		signal?.throwIfAborted();
		const bound = authorization.models.find((row) => row.model === claim.model);
		if (
			claim.sequence !== sequence ||
			claim.authorizationDigest !== authorizationDigest ||
			claim.reservationMicroUsd !== bound?.reservationMicroUsd
		)
			throw new Error("Request ledger binding changed.");
		claims.push(claim);
		reservedMicroUsd += claim.reservationMicroUsd;
		if (
			!Number.isSafeInteger(reservedMicroUsd) ||
			reservedMicroUsd > authorization.maxMicroUsd ||
			sequence >= authorization.maxRequests
		)
			throw new Error("Request ledger exceeds authorization.");
	}
	let cancelled = false;
	try {
		const value = JSON.parse(await readText(join(directory, "cancelled.json")));
		if (value.authorizationDigest !== authorizationDigest)
			throw new Error("Cancellation binding changed.");
		cancelled = true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	return {
		claims,
		authorization,
		authorizationDigest,
		consumed: files.length,
		reservedMicroUsd,
		cancelled,
	};
}

export async function requestBudgetStatus(directory: string) {
	const { claims: _claims, ...status } = await readRequestLedger(directory);
	return status;
}
export async function reconcileRequestReservations(
	directory: string,
	expectedDigest: string,
	scopeInput: EpisodeReservationScope,
	signal?: AbortSignal,
): Promise<ReservationReconciliation> {
	const scope = Object.freeze(EpisodeReservationScopeSchema.parse(scopeInput));
	const ledger = await readRequestLedger(directory, signal);
	signal?.throwIfAborted();
	if (ledger.authorizationDigest !== expectedDigest)
		throw new Error("Request authorization changed.");
	const scopeDigest = datasetDigest(scope);
	const claims = ledger.claims.filter(
		(claim): claim is z.infer<typeof ScopedClaim> =>
			claim.schemaVersion === 2 && datasetDigest(claim.scope) === scopeDigest,
	);
	return ReservationReconciliationSchema.parse({
		scope,
		authorization: ledger.authorization,
		authorizationDigest: expectedDigest,
		claims,
		claimsDigest: datasetDigest(claims),
		totalMicroUsd: claims.reduce(
			(sum, claim) => sum + claim.reservationMicroUsd,
			0,
		),
	});
}

export async function cancelRequestBudget(directory: string) {
	const status = await requestBudgetStatus(directory);
	try {
		await writeExclusive(join(directory, "cancelled.json"), {
			authorizationDigest: status.authorizationDigest,
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
}

export async function reserveRequest(
	directory: string,
	modelInput: unknown,
	expectedDigest: string,
	signal?: AbortSignal,
	scopeInput?: EpisodeReservationScope,
) {
	const model = BudgetModel.parse(modelInput);
	const scope =
		scopeInput === undefined
			? undefined
			: Object.freeze(EpisodeReservationScopeSchema.parse(scopeInput));
	for (;;) {
		signal?.throwIfAborted();
		const status = await requestBudgetStatus(directory);
		if (status.authorizationDigest !== expectedDigest)
			throw new Error("Request authorization changed.");
		if (
			status.cancelled ||
			Date.parse(status.authorization.expiresAt) <= Date.now()
		)
			throw new Error("Request campaign ended.");
		const bound = status.authorization.models.find(
			(row) => row.model === model,
		);
		if (
			!bound ||
			status.consumed >= status.authorization.maxRequests ||
			status.reservedMicroUsd + bound.reservationMicroUsd >
				status.authorization.maxMicroUsd
		)
			throw new Error("Request budget exhausted or model not authorized.");
		signal?.throwIfAborted();
		const claim = Claim.parse({
			...(scope ? { schemaVersion: 2, scope } : { schemaVersion: 1 }),
			authorizationDigest: expectedDigest,
			sequence: status.consumed,
			model,
			reservationMicroUsd: bound.reservationMicroUsd,
			at: new Date().toISOString(),
		});
		try {
			await writeExclusive(
				join(
					directory,
					`request-${String(status.consumed).padStart(6, "0")}.json`,
				),
				claim,
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
			throw error;
		}
		signal?.throwIfAborted();
		const after = await requestBudgetStatus(directory);
		if (
			after.cancelled ||
			after.authorizationDigest !== expectedDigest ||
			Date.parse(after.authorization.expiresAt) <= Date.now()
		)
			throw new Error("Request campaign ended before dispatch.");
		return claim;
	}
}

export async function runRequestBudgetCommand(args: readonly string[]) {
	const [command, first, second, ...extra] = args;
	if (command === "request-budget-create" && first && second && !extra.length) {
		await createRequestBudget(
			second,
			JSON.parse(await readFile(first, "utf8")),
		);
		return 0;
	}
	if (first && !second && !extra.length) {
		if (command === "request-budget-status") {
			console.log(JSON.stringify(await requestBudgetStatus(first), null, 2));
			return 0;
		}
		if (command === "request-budget-cancel") {
			await cancelRequestBudget(first);
			return 0;
		}
	}
	throw new Error(
		"Expected request-budget-create <authorization> <new-directory>, request-budget-status <directory>, or request-budget-cancel <directory>.",
	);
}
