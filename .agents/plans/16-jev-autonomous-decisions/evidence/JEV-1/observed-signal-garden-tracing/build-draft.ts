import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { importSnapshot } from "../../../../../../evals/recovery-decisions/dataset.js";
import {
	datasetDigest,
	SnapshotSchema,
} from "../../../../../../evals/recovery-decisions/schema.js";

const source = process.argv[2] ?? "/tmp/flow-jev-signal-20260924";
const out = fileURLToPath(new URL(".", import.meta.url));
const read = async (name: string) =>
	JSON.parse(await readFile(join(source, name), "utf8"));
const sha = (value: string | Uint8Array) =>
	createHash("sha256").update(value).digest("hex");
const session = await read("checkpoint-rev22.json");
const proposal = await read("manager-proposal-rev22.json");
const packet = await read("decision-packet-rev22.json");
const runtime = await read("runtime-shadow-rev22.json");
const rawMessages = await read("parent-messages-rev22-private.json");
const call = rawMessages
	.flatMap((m: any) => m.parts ?? [])
	.find(
		(p: any) =>
			p.type === "tool" &&
			p.tool === "flow_status" &&
			p.state?.status === "completed" &&
			p.state?.input?.recoveryProposal?.id === proposal.id,
	);
if (!call) throw new Error("Missing observed manager proposal call");
const capturedAt = new Date(call.state.time.start).toISOString();
const packetDigest = sha(JSON.stringify(packet));
if (
	packetDigest !== runtime.recovery.packetDigest ||
	packet.revision !== session.revision ||
	proposal.expectedRevision !== session.revision
)
	throw new Error("Observed packet binding failed");
const payload = { session, sourceDigest: packet.sourceDigest, proposal };
const snapshot = SnapshotSchema.parse({
	id: "signal-garden-phase5-trace-lifecycle-20260925",
	...payload,
	provenance: {
		origin: "observed-recovery",
		sourceReference: "signal-garden-b5136c3-phase5-20260925",
		originatingTaskId: "signal-garden-phase5-eight-condition-qa-20260925",
		independenceGroupId: "signal-garden-phase5-eight-condition-qa-20260925",
		scenarioFamily: "review-playwright-trace-conflict",
		capturedAt,
		importedBy: "codex-case-importer",
		sanitization: {
			reviewedBy: "codex-local-source-audit",
			reviewedAt: "2026-09-24T22:10:00.000Z",
			notes:
				"Reviewed the exact parsed Signal Garden Session v5 checkpoint and manager proposal for credentials and unrelated private content. Payload bytes are unchanged; the reconstructed packet digest matches the live Jev shadow result. Independent label and source review remain pending.",
			payloadDigest: datasetDigest(payload),
		},
	},
});
const draft = importSnapshot(snapshot);
const findings = session.runs.flatMap((run: any) =>
	run.reviews.flatMap((review: any) => ({
		attempt: run.attempt,
		reviewId: review.id,
		verdict: review.result?.verdict ?? null,
		findings: (review.result?.findings ?? []).map((f: any) => ({
			findingId: f.findingId,
			severity: f.severity,
			summary: f.summary,
			evidence: f.evidence,
		})),
	})),
);
const parentBytes = await readFile(
	join(source, "parent-messages-rev22-private.json"),
);
const reviewerFirst = await readFile(
	join(source, "reviewer-1-rev22-private.json"),
);
const reviewerSecond = await readFile(
	join(source, "reviewer-2-rev22-private.json"),
);
const checkpointBytes = await readFile(join(source, "checkpoint-rev22.json"));
const patchBytes = await readFile(join(source, "source-rev22.patch"));
const provenance = {
	schemaVersion: 1,
	classification: "observed-source-audit",
	flowSourceHead: "787ebae1a6ae7588926cc3a58019afa85c9bd24f",
	flowTarballSha256:
		"e6023865b55cb629126e067d41c0c37a13eaf858db93245006631175889f62b0",
	installedDistSha256:
		"f7981550689e7d1d905d6175c2b2a4ea5ef3a2aaa9d5b3209d8b749ef923011d",
	opencodeHost: "1.18.31",
	managerModel: "openai/gpt-5.6-terra",
	reviewerConfiguredModel: "openai/gpt-5.6-sol",
	jevRequestedModel: "jev-1.13.0",
	jevResolvedModel: runtime.recovery.model,
	signalGardenMain: "01f6d22",
	signalGardenTaskBaseline: "b5136c3c591350baec5e7291824bc64f48791d20",
	flowSessionId: session.id,
	flowRevision: session.revision,
	hostSessionId: call.sessionID,
	messageId: call.messageID,
	sourceDigest: packet.sourceDigest,
	checkpointSha256: sha(checkpointBytes),
	sourcePatchSha256: sha(patchBytes),
	rawParentSessionSha256: sha(parentBytes),
	rawFirstReviewerSha256: sha(reviewerFirst),
	rawSecondReviewerSha256: sha(reviewerSecond),
	packetDigest,
	packetDigestMatchesRuntime: true,
	privateRawSessionsRetainedOutsideRepository: true,
	qualification: "unreviewed-case-only",
	checkpointRepresentation:
		"checkpoint.json is a pretty-printed copy of the exact parsed Session v5 value; checkpointSha256 hashes the retained private raw bytes.",
};
const write = async (name: string, value: unknown) =>
	writeFile(join(out, name), JSON.stringify(value, null, 2) + "\n");
await write("checkpoint.json", session);
await write("manager-proposal.json", proposal);
await write("decision-packet.json", packet);
await write("review-findings.json", { schemaVersion: 1, attempts: findings });
await write("runtime-shadow-outcome.json", {
	schemaVersion: 1,
	at: capturedAt,
	sourceRevision: session.revision,
	managerProposal: proposal,
	recovery: runtime.recovery,
	executionMutationObserved: false,
});
await write("source-provenance.json", provenance);
await write("snapshot.json", snapshot);
await write("draft.json", draft);
process.stdout.write(
	JSON.stringify({
		caseId: snapshot.id,
		revision: session.revision,
		reviewAttempts: findings.length,
		packetDigest,
		selection: runtime.recovery.kind,
		status: draft.status,
	}) + "\n",
);
