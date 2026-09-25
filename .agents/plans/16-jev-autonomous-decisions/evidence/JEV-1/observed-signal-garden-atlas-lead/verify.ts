import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RecoveryController } from "../../../../../../src/application/recovery-policy.js";
import { createFileSourceIdentityProvider } from "../../../../../../src/infrastructure/fs/source-identity.js";
import {
	DraftSchema,
	datasetDigest,
} from "../../../../../../evals/recovery-decisions/schema.js";

const directory = new URL(".", import.meta.url);
const bytes = (name: string) => readFile(new URL(name, directory));
const json = async (name: string) =>
	JSON.parse((await bytes(name)).toString("utf8"));
const sha = (value: Uint8Array) =>
	createHash("sha256").update(value).digest("hex");
const assert = (condition: unknown, label: string) => {
	if (!condition) throw new Error(`Atlas recovery lead invalid: ${label}`);
};

const draft = DraftSchema.parse(await json("draft.json"));
const provenanceBytes = await bytes("source-provenance.json");
assert(
	sha(provenanceBytes) ===
		"db480bf30866add218179bc30394e082ed817b1b718e2f00ef724bdb12776441",
	"reviewed provenance root",
);
const provenance = JSON.parse(provenanceBytes.toString("utf8"));
const normalization = await json("normalization.json");
const offline = await json("offline-packet.json");
const models = await json("model-observation.json");
const authorization = await json("authorization.json");
const dispatch = await json("dispatch.json");
for (const [name, field] of [
	["draft.json", "draftSha256"],
	["normalization.json", "normalizedProposalSha256"],
	["offline-packet.json", "offlinePacketSha256"],
	["manager-proposal.txt", "managerProposalSha256"],
	["model-observation.json", "observedModelSessionsSha256"],
	["task-baseline.json", "baselineSha256"],
	["authorization.json", "authorizationSha256"],
	["dispatch.json", "dispatchSha256"],
] as const)
	assert(sha(await bytes(name)) === provenance[field], `${name} digest`);

const session = draft.snapshot.session;
const failed = session.runs.flatMap((run) =>
	run.reviews.filter((review) => review.result?.verdict === "failed"),
);
assert(
	provenance.classification ===
		"observed-signal-garden-blocked-recovery-lead-unreviewed" &&
		provenance.checkpointRevision === 10 &&
		session.revision === 10 &&
		provenance.checkpointState === "blocked" &&
		session.runs.at(-1)?.state === "blocked" &&
		failed.length === 2 &&
		failed[1]?.sourceDigest === draft.snapshot.sourceDigest &&
		provenance.sourceDigest === draft.snapshot.sourceDigest &&
		provenance.sourceMatchesSecondReview === true &&
		provenance.sourceStable === true,
	"blocked checkpoint and review identity",
);
assert(
	provenance.typedProposalCapturedFromManager === false &&
		provenance.labelReviewed === false &&
		provenance.jevCalled === false &&
		normalization.status ===
			"author-normalized-from-manager-prose-unreviewed" &&
		normalization.managerProposalMessageId ===
			provenance.managerProposalMessageId &&
		normalization.managerProposalSha256 === provenance.managerProposalSha256 &&
		datasetDigest(normalization.proposal) ===
			datasetDigest(draft.snapshot.proposal) &&
		draft.status === "awaiting-label-review",
	"proposal and label limitations",
);
assert(
	models.filter(
		(row: { parent: boolean; models: string[]; messageCount: number }) =>
			!row.parent &&
			row.messageCount > 0 &&
			JSON.stringify(row.models) === JSON.stringify(["openai/gpt-5.6-terra"]),
	).length === 1 &&
		models.filter(
			(row: { parent: boolean; models: string[] }) =>
				row.parent &&
				JSON.stringify(row.models) === JSON.stringify(["openai/gpt-5.6-sol"]),
		).length === 2 &&
		authorization.schemaVersion === 1 &&
		authorization.purpose ===
			"One ordinary Flow implementation of per-theme runtime texture atlases in Signal Garden, observed for natural review-blocked recovery cases; not a Jev qualification campaign" &&
		authorization.maxDispatches === 1 &&
		authorization.expiresAt === "2026-09-27T07:00:00Z" &&
		JSON.stringify(authorization.models) ===
			JSON.stringify(["openai/gpt-5.6-terra", "openai/gpt-5.6-sol"]) &&
		dispatch.model === "openai/gpt-5.6-terra" &&
		dispatch.kind === "command" &&
		Date.parse(dispatch.at) < Date.parse(authorization.expiresAt) &&
		provenance.paidDispatchesConsumed === 1,
	"ordinary manager/reviewer model and dispatch scope",
);

let captured: unknown = null;
const controller = new RecoveryController({
	async assess(packet) {
		captured = structuredClone(packet);
		return { kind: "unavailable", reason: "offline-case-preparation" };
	},
});
controller.activate("offline-case-verification", {
	mode: "shadow",
	maxCalls: 1,
	maxUsd: 0.01,
});
controller.observeMessage("offline-case-verification", "user", false);
controller.observeAssistant("offline-case-verification", "manager", "user");
let replayOutcome: unknown;
try {
	replayOutcome = await controller
		.guard({
			hostSessionId: "offline-case-verification",
			messageId: "manager",
			agent: "build",
		})
		.propose(session, draft.snapshot.sourceDigest, draft.snapshot.proposal);
} finally {
	controller.revoke();
}
assert(
	captured !== null &&
		offline.packetDigestEncoding === "sha256-of-json-stringify-v1" &&
		sha(Buffer.from(JSON.stringify(captured))) === offline.packetDigest &&
		datasetDigest(captured) === offline.canonicalPacketDigest &&
		datasetDigest(captured) === datasetDigest(offline.packet) &&
		JSON.stringify(replayOutcome) === JSON.stringify(offline.outcome) &&
		offline.outcome.packetDigest === offline.packetDigest &&
		offline.error === null &&
		offline.outcome?.kind === "unavailable",
	"offline packet replay",
);

const privateRoot = process.env.FLOW_SIGNAL_ATLAS_PRIVATE_ROOT;
const productWorktree = process.env.FLOW_SIGNAL_ATLAS_WORKTREE;
if (privateRoot && productWorktree) {
	const raw = await readFile(
		join(privateRoot, "snapshots/revision-00010.json"),
	);
	const source = await readFile(
		join(privateRoot, "source-snapshots/revision-00010/manifest.json"),
	);
	const messages = await readFile(
		join(privateRoot, "opencode-messages-final.json"),
	);
	assert(
		sha(raw) === provenance.sessionSha256 &&
			sha(source) === provenance.sourceManifestSha256 &&
			sha(messages) === provenance.messagesSha256 &&
			JSON.stringify(JSON.parse(raw.toString("utf8"))) ===
				JSON.stringify(session),
		"private source and host observations",
	);
	const sourceState = JSON.parse(source.toString("utf8"));
	const head = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: productWorktree,
		encoding: "utf8",
	}).trim();
	const currentDigest =
		await createFileSourceIdentityProvider(
			productWorktree,
		).computeSourceDigest();
	assert(
		head === provenance.baseHead &&
			currentDigest === provenance.sourceDigest &&
			sourceState.sourceDigestBefore === currentDigest &&
			sourceState.sourceDigestAfter === currentDigest,
		"private current source identity",
	);
}
console.log(
	JSON.stringify({
		verdict:
			privateRoot && productWorktree
				? "verified-private-source-lead"
				: "verified-public-lead-bindings",
		revision: session.revision,
		failedReviews: failed.length,
		packetDigest: offline.packetDigest,
		qualification: "unreviewed-lead-only",
	}),
);
