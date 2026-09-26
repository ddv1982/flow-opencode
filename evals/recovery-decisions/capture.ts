import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { z } from "zod";
import { writeBytesExclusive } from "../../scripts/lib/exclusive-json.js";
import {
	RecoveryController,
	type RecoveryGuard,
	RecoveryProposalSchema,
} from "../../src/application/recovery-policy.js";
import { SessionSchema } from "../../src/application/schema.js";
import { datasetDigest } from "./schema.js";

const PayloadSchema = z
	.object({
		session: SessionSchema,
		sourceDigest: z.templateLiteral([
			"sha256:",
			z.string().regex(/^[a-f0-9]{64}$/),
		]),
		proposal: RecoveryProposalSchema,
	})
	.strict();
export const RawRecoveryCaptureSchema = z
	.object({
		format: z.literal("flow-raw-recovery-capture-v1"),
		reviewState: z.literal("raw-unreviewed"),
		origin: z.literal("unverified"),
		id: z.uuid(),
		capturedAt: z.iso.datetime(),
		context: z
			.object({
				hostSessionId: z.string(),
				messageId: z.string(),
				agent: z.string(),
			})
			.strict(),
		payload: PayloadSchema,
		payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
	})
	.strict()
	.superRefine((record, context) => {
		if (datasetDigest(record.payload) !== record.payloadDigest)
			context.addIssue({
				code: "custom",
				message: "Capture payload digest mismatch",
			});
	});
export type RawRecoveryCapture = z.infer<typeof RawRecoveryCaptureSchema>;

const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * MAX_RECORD_BYTES;
const MAX_RECORDS = 128;

async function requireTrustedParents(
	path: string,
	owner: number,
): Promise<void> {
	let current = path;
	for (;;) {
		const stat = await lstat(current);
		if (
			!stat.isDirectory() ||
			stat.isSymbolicLink() ||
			(stat.uid !== owner && stat.uid !== 0) ||
			((stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0)
		)
			throw new Error("Untrusted capture directory parent.");
		const next = dirname(current);
		if (next === current) return;
		current = next;
	}
}

export class CapturingRecoveryController extends RecoveryController {
	#records = 0;
	#bytes = 0;
	readonly #directory: string;
	readonly #identity: { dev: number; ino: number; uid: number };
	private constructor(
		directory: string,
		identity: { dev: number; ino: number; uid: number },
	) {
		super({
			async assess() {
				return { kind: "unavailable", reason: "capture-only" };
			},
		});
		this.#directory = directory;
		this.#identity = identity;
	}
	static async create(
		workspace: string,
		outputDirectory: string,
	): Promise<CapturingRecoveryController> {
		if (process.platform === "win32")
			throw new Error(
				"Recovery capture requires POSIX filesystem permissions; Windows is not supported.",
			);
		try {
			if (!isAbsolute(outputDirectory)) throw new Error();
			const root = await realpath(workspace);
			const destination = resolve(outputDirectory);
			const parent = await realpath(dirname(destination));
			const owner = process.geteuid?.();
			if (owner === undefined) throw new Error();
			await requireTrustedParents(parent, owner);
			const canonical = join(parent, basename(destination));
			const child = relative(root, canonical);
			if (
				child === "" ||
				(!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child))
			)
				throw new Error();
			await mkdir(canonical, { mode: 0o700 });
			const stat = await lstat(canonical);
			if (
				!stat.isDirectory() ||
				stat.isSymbolicLink() ||
				stat.uid !== owner ||
				(stat.mode & 0o777) !== 0o700
			)
				throw new Error();
			return new CapturingRecoveryController(canonical, {
				dev: stat.dev,
				ino: stat.ino,
				uid: stat.uid,
			});
		} catch {
			throw new Error(
				"Recovery capture requires a fresh private directory outside the workspace with an existing parent.",
			);
		}
	}
	override guard(
		context: Parameters<RecoveryController["guard"]>[0],
	): RecoveryGuard {
		const capturedContext = structuredClone(context);
		const guard = super.guard(capturedContext);
		return {
			...guard,
			propose: async (session, sourceDigest, proposal) => {
				let payload: RawRecoveryCapture["payload"];
				try {
					payload = structuredClone({ session, sourceDigest, proposal });
					const record: RawRecoveryCapture = {
						format: "flow-raw-recovery-capture-v1",
						reviewState: "raw-unreviewed",
						origin: "unverified",
						id: randomUUID(),
						capturedAt: new Date().toISOString(),
						context: capturedContext,
						payload,
						payloadDigest: datasetDigest(payload),
					};
					RawRecoveryCaptureSchema.parse(record);
					const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
					if (
						bytes.length > MAX_RECORD_BYTES ||
						this.#records >= MAX_RECORDS ||
						this.#bytes + bytes.length > MAX_TOTAL_BYTES
					)
						throw new Error();
					this.#records++;
					this.#bytes += bytes.length;
					await requireTrustedParents(
						dirname(this.#directory),
						this.#identity.uid,
					);
					const stat = await lstat(this.#directory);
					if (
						!stat.isDirectory() ||
						stat.isSymbolicLink() ||
						stat.dev !== this.#identity.dev ||
						stat.ino !== this.#identity.ino ||
						stat.uid !== this.#identity.uid ||
						(stat.mode & 0o777) !== 0o700
					)
						throw new Error();
					await writeBytesExclusive(
						join(this.#directory, `${record.id}.json`),
						bytes,
					);
				} catch {
					throw new Error(
						"Recovery capture failed; assessment was not attempted.",
					);
				}
				return guard.propose(
					payload.session,
					payload.sourceDigest,
					payload.proposal,
				);
			},
		};
	}
}
