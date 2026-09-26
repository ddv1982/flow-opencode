import { z } from "zod";
import type {
	DecisionAdvice,
	DecisionPacket,
	DecisionProvider,
} from "../../src/application/ports/decision-provider.js";
import { RecoveryController } from "../../src/application/recovery-policy.js";
import { digest, type RecoveryCorpus } from "./schema.js";

export { CorpusSchema, digest, type RecoveryCorpus } from "./schema.js";

export async function evaluateRecoveryCorpus(
	corpus: {
		purpose: RecoveryCorpus["purpose"];
		labelStatus: RecoveryCorpus["labelStatus"];
		cases: RecoveryCorpus["cases"][number][];
		schemaVersion: 1;
	},
	provider?: DecisionProvider,
) {
	const rows = [];
	for (const entry of corpus.cases) {
		const session = structuredClone(entry.session);
		const before = digest(session);
		const captured: {
			packet: DecisionPacket | null;
			advice: DecisionAdvice | null;
		} = { packet: null, advice: null };
		const controller = new RecoveryController({
			async assess(packet, options) {
				captured.packet = structuredClone(packet);
				captured.advice = provider
					? await provider.assess(packet, options)
					: { kind: "unavailable", reason: "offline-preparation" };
				return captured.advice;
			},
		});
		controller.activate("evaluation", {
			mode: "shadow",
			maxCalls: 3,
			maxUsd: 0.01,
		});
		controller.observeMessage("evaluation", "user", false);
		controller.observeAssistant("evaluation", "manager", "user");
		let decision: unknown = null;
		let rejection: string | null = null;
		try {
			decision = await controller
				.guard({
					hostSessionId: "evaluation",
					messageId: "manager",
					agent: "build",
				})
				.propose(session, entry.sourceDigest, entry.proposal);
		} catch (error) {
			rejection = error instanceof Error ? error.message : "evaluation-error";
		} finally {
			controller.revoke();
		}
		if (before !== digest(session))
			throw new Error("Shadow evaluation mutated its session");
		const eligible =
			captured.packet?.candidates.map((candidate) => candidate.id) ?? [];
		const selected = z
			.object({ selectedCandidateId: z.string().nullable() })
			.safeParse(decision);
		const selection = selected.success
			? (selected.data.selectedCandidateId ?? "abstain")
			: null;
		rows.push({
			id: entry.id,
			packet: captured.packet,
			packetDigest: captured.packet ? digest(captured.packet) : null,
			advice: captured.advice,
			decision,
			rejection,
			eligibilityMatches:
				(captured.packet !== null ||
					rejection ===
						"No proposed recovery action is permitted by current history and dependencies.") &&
				digest([...eligible].sort()) ===
					digest([...entry.expected.eligibleCandidateIds].sort()),
			labelMatches:
				provider && captured.advice?.kind === "answered" && selection !== null
					? entry.expected.acceptableSelections.includes(selection)
					: null,
		});
	}
	return {
		schemaVersion: 1,
		purpose: corpus.purpose,
		labelStatus: corpus.labelStatus,
		corpusDigest: digest(corpus),
		mode: provider ? "provider-evaluation" : "offline-preparation",
		qualification: "inconclusive",
		rows,
	};
}
