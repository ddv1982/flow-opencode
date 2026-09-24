import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { livePriorFindings } from "../../../../../../src/domain/review-findings.js";
import { createFileSourceIdentityProvider } from "../../../../../../src/infrastructure/fs/source-identity.js";

const privateRoot = process.argv[2];
const frozenSource = process.argv[3];
if (!privateRoot || !frozenSource)
	throw new Error(
		"Expected private source directory and frozen source checkout.",
	);
const read = async (name: string) =>
	JSON.parse(await readFile(join(privateRoot, name), "utf8"));
const session = await read("checkpoint-rev22.json");
const proposal = await read("manager-proposal-rev22.json");
const runtime = await read("runtime-shadow-rev22.json");
const sourceDigest =
	await createFileSourceIdentityProvider(frozenSource).computeSourceDigest();
const hash = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");
const findingFeatureIds = new Set<string>(
	proposal.candidates.map(
		(candidate: { featureId: string }) => candidate.featureId,
	),
);
const findings = [...findingFeatureIds].flatMap((featureId) =>
	livePriorFindings(session, featureId).map((finding) => ({
		id: finding.findingId,
		summary: finding.summary,
		evidence: finding.evidence ?? "",
	})),
);
const packet = {
	sessionId: session.id,
	revision: session.revision,
	sourceDigest,
	goal: session.goal,
	planDigest: hash({
		id: session.id,
		goal: session.goal,
		plan: session.plan,
		approval: session.approval,
	}),
	rubric: "recovery-v1",
	findings,
	candidates: proposal.candidates,
};
const packetDigest = hash(packet);
if (packetDigest !== runtime.recovery.packetDigest)
	throw new Error("Reconstructed packet differs from observed runtime digest.");
await writeFile(
	join(privateRoot, "decision-packet-rev22.json"),
	`${JSON.stringify(packet, null, 2)}\n`,
);
process.stdout.write(
	`${JSON.stringify({ packetDigest, sourceDigest, findings: findings.length })}\n`,
);
