import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { datasetDigest } from "../../../../../../evals/recovery-decisions/schema.js";
import { createFileSourceIdentityProvider } from "../../../../../../src/infrastructure/fs/source-identity.js";
const evidence = process.argv[2];
const privateRoot = process.argv[3];
const frozenSource = process.argv[4];
if (!evidence || !privateRoot || !frozenSource)
	throw new Error("Expected evidence, private root, and frozen source paths");
const read = async (base: string, name: string) =>
	JSON.parse(await readFile(join(base, name), "utf8"));
const bytes = async (base: string, name: string) => readFile(join(base, name));
const sha = (value: string | Uint8Array) =>
	createHash("sha256").update(value).digest("hex");
const assert = (condition: unknown, label: string) => {
	if (!condition) throw new Error(`Source audit failed: ${label}`);
};
const [
	snapshot,
	provenance,
	packet,
	proposal,
	runtime,
	checkpointRaw,
	parentRaw,
	firstRaw,
	secondRaw,
	patchRaw,
] = await Promise.all([
	read(evidence, "snapshot.json"),
	read(evidence, "source-provenance.json"),
	read(evidence, "decision-packet.json"),
	read(evidence, "manager-proposal.json"),
	read(evidence, "runtime-shadow-outcome.json"),
	bytes(privateRoot, "checkpoint-rev22.json"),
	bytes(privateRoot, "parent-messages-rev22-private.json"),
	bytes(privateRoot, "reviewer-1-rev22-private.json"),
	bytes(privateRoot, "reviewer-2-rev22-private.json"),
	bytes(privateRoot, "source-rev22.patch"),
]);
const rawFiles = [
	["checkpoint", checkpointRaw, provenance.checkpointSha256],
	["parent", parentRaw, provenance.rawParentSessionSha256],
	["reviewer1", firstRaw, provenance.rawFirstReviewerSha256],
	["reviewer2", secondRaw, provenance.rawSecondReviewerSha256],
	["patch", patchRaw, provenance.sourcePatchSha256],
] as const;
for (const [name, value, expected] of rawFiles)
	assert(sha(value) === expected, `${name} digest`);
const session = JSON.parse(checkpointRaw.toString("utf8"));
assert(
	JSON.stringify(session) === JSON.stringify(snapshot.session),
	"parsed checkpoint bytes",
);
assert(
	session.revision === 22 && session.id === snapshot.session.id,
	"session binding",
);
assert(
	proposal.sessionId === session.id &&
		proposal.expectedRevision === session.revision &&
		datasetDigest(proposal) === datasetDigest(snapshot.proposal) &&
		packet.sessionId === proposal.sessionId &&
		packet.revision === proposal.expectedRevision &&
		datasetDigest(packet.candidates) === datasetDigest(proposal.candidates),
	"proposal, snapshot, and packet binding",
);
const baseline = execFileSync(
	"git",
	["-C", frozenSource, "rev-parse", "HEAD"],
	{ encoding: "utf8" },
).trim();
assert(baseline === provenance.signalGardenTaskBaseline, "source baseline");
const diff = execFileSync("git", ["-C", frozenSource, "diff", "--binary"]);
assert(sha(diff) === provenance.sourcePatchSha256, "replayed source patch");
const sourceDigest =
	await createFileSourceIdentityProvider(frozenSource).computeSourceDigest();
assert(
	sourceDigest === packet.sourceDigest &&
		sourceDigest === snapshot.sourceDigest,
	"replayed source identity",
);
const packetDigest = sha(JSON.stringify(packet));
assert(
	packetDigest === runtime.recovery.packetDigest &&
		packetDigest === provenance.packetDigest,
	"runtime packet digest",
);
const parent = JSON.parse(parentRaw.toString("utf8"));
const calls = parent
	.flatMap((m: any) => m.parts ?? [])
	.filter(
		(p: any) =>
			p.type === "tool" &&
			p.tool === "flow_status" &&
			p.state?.status === "completed" &&
			p.state?.input?.recoveryProposal?.id === proposal.id,
	);
assert(calls.length === 1, "exact observed manager proposal call");
const call = calls[0];
assert(
	JSON.stringify(call.state.input.recoveryProposal) ===
		JSON.stringify(proposal),
	"manager proposal bytes",
);
const observed = JSON.parse(call.state.output)?.workflowData?.recovery;
assert(
	JSON.stringify(observed) === JSON.stringify(runtime.recovery),
	"runtime shadow response",
);
const reviewerRows = [];
for (const [index, raw] of [
	[1, firstRaw],
	[2, secondRaw],
] as const) {
	const messages = JSON.parse(raw.toString("utf8"));
	const models = [
		...new Set(
			messages
				.filter((m: any) => m.info?.role === "assistant")
				.map((m: any) => `${m.info?.providerID}/${m.info?.modelID}`),
		),
	];
	assert(
		models.length === 1 && models[0] === "openai/gpt-5.6-sol",
		`reviewer ${index} model`,
	);
	const accepted = messages
		.flatMap((m: any) => m.parts ?? [])
		.filter(
			(p: any) =>
				p.type === "tool" &&
				p.tool === "flow_feature_complete" &&
				p.state?.status === "completed",
		)
		.filter((p: any) => {
			try {
				return JSON.parse(p.state.output)?.status === "ok";
			} catch {
				return false;
			}
		});
	assert(accepted.length === 1, `reviewer ${index} accepted submission count`);
	const request = accepted[0].state.input.request;
	const saved = session.runs
		.find((r: any) => r.attempt === index)
		?.reviews.find((v: any) => v.id === request.assignmentId)?.result;
	assert(
		saved?.verdict === request.result.verdict,
		`reviewer ${index} verdict`,
	);
	const submitted = request.result;
	const persisted = {
		verdict: saved.verdict,
		findings: saved.findings.map((finding: any, position: number) => {
			if (Object.hasOwn(submitted.findings[position] ?? {}, "findingId"))
				return finding;
			const { findingId, ...rest } = finding;
			return rest;
		}),
		terminalDisposition: saved.terminalDisposition,
	};
	assert(
		datasetDigest(persisted) === datasetDigest(submitted),
		`reviewer ${index} complete result binding`,
	);
	reviewerRows.push({
		attempt: index,
		model: models[0],
		reviewId: request.assignmentId,
		verdict: saved.verdict,
		findingIds: saved.findings.map((f: any) => f.findingId),
	});
}
const key = process.env.TYPESAFE_API_KEY;
if (key)
	for (const [name, value] of rawFiles)
		assert(!value.includes(key), `${name} contains TypeSafe key`);
const result = {
	schemaVersion: 1,
	verdict: "source-consistent",
	sessionId: session.id,
	revision: session.revision,
	baselineHead: baseline,
	sourceDigest,
	sourcePatchSha256: sha(diff),
	packetDigest,
	parentCallId: call.callID,
	parentMessageId: call.messageID,
	reviewers: reviewerRows,
	rawFileSha256: Object.fromEntries(
		rawFiles.map(([name, value]) => [name, sha(value)]),
	),
	limits: [
		"Private raw source files remain outside the repository; this audit can be rerun only where those retained bytes are available.",
		"Digest and structural consistency are source attestation evidence, not cryptographic proof that a remote provider executed.",
	],
};
await writeFile(
	join(evidence, "raw-source-audit.json"),
	JSON.stringify(result, null, 2) + "\n",
);
process.stdout.write(
	JSON.stringify({
		verdict: result.verdict,
		sourceDigest,
		packetDigest,
		reviewers: reviewerRows.length,
	}) + "\n",
);
