import assert from "node:assert/strict";
import {
	LIFECYCLE_EXTERNAL_PROOF_REQUIREMENTS,
	type LifecycleExternalInvariantId,
	type LifecycleExternalProof,
	type LifecycleExternalProofRegistry,
} from "./lifecycle-invariant-registry.js";

export const PINNED_LIVE_OPENCODE_VERSION = "1.18.3";

export const LIFECYCLE_LIVE_PROOF_REGISTRY = {
	"S4-FINAL-REC-01": {
		statement:
			"The packed plugin completes a persisted final assignment after caller context is discarded.",
		proofs: {
			pinned_packed_live_host: {
				description:
					"Boot the current packed plugin in real pinned OpenCode and recover final completion from durable Flow state.",
				boundary: "packed-plugin-real-opencode",
				verificationCommand: "bun run smoke:live",
				hostPackage: "opencode-ai",
				pinnedHostVersion: PINNED_LIVE_OPENCODE_VERSION,
				pluginArtifact: "current-build-packed-tarball",
				requiredEvidence: [
					"current-build-packed-tarball",
					"real-opencode-host",
					"final-assignment-recovered",
					"manager-context-loss-recovered",
					"final-completion-from-persisted-assignment",
				],
			},
		},
	},
	"S4-HOST-01": {
		statement:
			"The packed plugin's advertised and executed contracts agree in the real pinned OpenCode host.",
		proofs: {
			pinned_packed_live_host: {
				description:
					"Boot the current packed plugin in real pinned OpenCode and execute schema, invalid-then-corrected, and close-retry paths.",
				boundary: "packed-plugin-real-opencode",
				verificationCommand: "bun run smoke:live",
				hostPackage: "opencode-ai",
				pinnedHostVersion: PINNED_LIVE_OPENCODE_VERSION,
				pluginArtifact: "current-build-packed-tarball",
				requiredEvidence: [
					"current-build-packed-tarball",
					"real-opencode-host",
					"host-emitted-request-schemas",
					"invalid-then-corrected-host-calls",
					"close-retry-handle-recovered",
					"close-retry-archive-published",
				],
			},
		},
	},
} satisfies LifecycleExternalProofRegistry;

export type LifecycleLiveProofObservation = {
	boundary: "packed-plugin-real-opencode";
	hostPackage: "opencode-ai";
	hostVersion: string;
	pluginArtifact: "current-build-packed-tarball";
	evidence: Partial<Record<LifecycleExternalInvariantId, readonly string[]>>;
};

export type MissingLifecycleLiveEvidence = {
	invariantId: LifecycleExternalInvariantId;
	proofClass: string;
	evidence: string;
};

export function missingLifecycleLiveEvidence(
	observation: LifecycleLiveProofObservation,
	registry: LifecycleExternalProofRegistry = LIFECYCLE_LIVE_PROOF_REGISTRY,
): MissingLifecycleLiveEvidence[] {
	const missing: MissingLifecycleLiveEvidence[] = [];
	for (const [invariantId, proofClasses] of Object.entries(
		LIFECYCLE_EXTERNAL_PROOF_REQUIREMENTS,
	) as Array<[LifecycleExternalInvariantId, readonly string[]]>) {
		const observed = new Set(observation.evidence[invariantId] ?? []);
		for (const proofClass of proofClasses) {
			const proof = (
				registry[invariantId].proofs as Record<string, LifecycleExternalProof>
			)[proofClass];
			if (!proof) {
				throw new Error(`Missing ${invariantId}/${proofClass}.`);
			}
			for (const evidence of proof.requiredEvidence) {
				if (!observed.has(evidence)) {
					missing.push({ invariantId, proofClass, evidence });
				}
			}
		}
	}
	return missing;
}

export function assertLifecycleLiveProofObservation(
	observation: LifecycleLiveProofObservation,
	registry: LifecycleExternalProofRegistry = LIFECYCLE_LIVE_PROOF_REGISTRY,
): void {
	for (const [invariantId, proofClasses] of Object.entries(
		LIFECYCLE_EXTERNAL_PROOF_REQUIREMENTS,
	) as Array<[LifecycleExternalInvariantId, readonly string[]]>) {
		for (const proofClass of proofClasses) {
			const proof = (
				registry[invariantId].proofs as Record<string, LifecycleExternalProof>
			)[proofClass];
			if (!proof) {
				throw new Error(`Missing ${invariantId}/${proofClass}.`);
			}
			assert.equal(observation.boundary, proof.boundary);
			assert.equal(observation.hostPackage, proof.hostPackage);
			assert.equal(observation.hostVersion, proof.pinnedHostVersion);
			assert.equal(observation.pluginArtifact, proof.pluginArtifact);
		}
	}
	assert.deepEqual(
		missingLifecycleLiveEvidence(observation, registry),
		[],
		"The pinned packed-host smoke omitted required external lifecycle evidence.",
	);
}
