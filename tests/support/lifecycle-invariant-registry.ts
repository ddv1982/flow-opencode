import assert from "node:assert/strict";

export const LIFECYCLE_INVARIANT_REQUIREMENTS = {
	"S4-STATE-01": [
		"schema_corruption",
		"transition_table",
		"deterministic_state_machine",
		"persistence_reload",
	],
	"S4-TIME-01": [
		"boundary_examples",
		"timestamp_perturbation",
		"atomic_rejection",
		"persistence_parse",
	],
	"S4-FINAL-REC-01": [
		"domain_transition",
		"context_loss_restart",
		"registered_host_final_path",
	],
	"S4-CLOSE-REC-01": [
		"failure_injection_matrix",
		"status_contract",
		"fresh_service_retry",
		"no_clobber_archive",
	],
	"S4-HOST-01": [
		"shared_corpus",
		"actual_registration_differential",
		"emitted_json_schema",
		"registered_host_calls",
	],
	"S4-ATOMIC-01": [
		"transition_sequence",
		"repository_reload",
		"failpoint_replay",
	],
	"S4-V4-ONLY-01": [
		"exact_schema_rejection",
		"package_surface",
		"static_absence_audit",
	],
} as const;

export type LifecycleInvariantId =
	keyof typeof LIFECYCLE_INVARIANT_REQUIREMENTS;

export const LIFECYCLE_EXTERNAL_PROOF_REQUIREMENTS = {
	"S4-FINAL-REC-01": ["pinned_packed_live_host"],
	"S4-HOST-01": ["pinned_packed_live_host"],
} as const satisfies Partial<Record<LifecycleInvariantId, readonly string[]>>;

export type LifecycleExternalInvariantId =
	keyof typeof LIFECYCLE_EXTERNAL_PROOF_REQUIREMENTS;

type RequiredExternalProofClass<Id extends LifecycleExternalInvariantId> =
	(typeof LIFECYCLE_EXTERNAL_PROOF_REQUIREMENTS)[Id][number];

export type LifecycleExternalProof = {
	description: string;
	boundary: "packed-plugin-real-opencode";
	verificationCommand: "bun run smoke:live";
	hostPackage: "opencode-ai";
	pinnedHostVersion: string;
	pluginArtifact: "current-build-packed-tarball";
	requiredEvidence: readonly string[];
};

export type LifecycleExternalProofRegistry = {
	[Id in LifecycleExternalInvariantId]: {
		statement: string;
		proofs: Record<RequiredExternalProofClass<Id>, LifecycleExternalProof>;
	};
};

export type StructurallyIncompleteExternalRegistry = {
	[Id in LifecycleExternalInvariantId]?: {
		statement?: string;
		proofs?: Partial<Record<string, LifecycleExternalProof>>;
	};
};

type RequiredProofClass<Id extends LifecycleInvariantId> =
	(typeof LIFECYCLE_INVARIANT_REQUIREMENTS)[Id][number];

export type ProofAssertions = {
	cover(evidence: string): void;
	equal(actual: unknown, expected: unknown, message?: string): void;
	deepEqual(actual: unknown, expected: unknown, message?: string): void;
	match(actual: string, expected: RegExp, message?: string): void;
	ok(value: unknown, message?: string): asserts value;
	rejects(
		block: () => Promise<unknown>,
		expected?: RegExp | (new (...args: never[]) => Error),
		message?: string,
	): Promise<void>;
	throws(
		block: () => unknown,
		expected?: RegExp | (new (...args: never[]) => Error),
		message?: string,
	): void;
};

export type ProofExecution = {
	assertionCount: number;
	evidence: string[];
};

export type ExecutableProof = {
	description: string;
	requiredEvidence: readonly string[];
	run(): Promise<ProofExecution>;
};

type ProofImplementation = (
	assertions: ProofAssertions,
) => void | Promise<void>;

export function executableProof(
	description: string,
	implementation: ProofImplementation,
	requiredEvidence: readonly string[] = ["assertions"],
): ExecutableProof {
	return {
		description,
		requiredEvidence,
		async run() {
			let assertionCount = 0;
			const evidence = new Set<string>();
			const count = <T>(operation: () => T): T => {
				assertionCount += 1;
				return operation();
			};
			const assertions: ProofAssertions = {
				cover: (item) => evidence.add(item),
				equal: (actual, expected, message) =>
					count(() => assert.equal(actual, expected, message)),
				deepEqual: (actual, expected, message) =>
					count(() => assert.deepEqual(actual, expected, message)),
				match: (actual, expected, message) =>
					count(() => assert.match(actual, expected, message)),
				ok: (value, message): asserts value =>
					count(() => assert.ok(value, message)),
				rejects: async (block, expected, message) => {
					assertionCount += 1;
					if (expected === undefined) {
						await assert.rejects(block, message);
					} else {
						await assert.rejects(block, expected, message);
					}
				},
				throws: (block, expected, message) =>
					count(() =>
						expected === undefined
							? assert.throws(block, message)
							: assert.throws(block, expected, message),
					),
			};
			await implementation(assertions);
			if (assertionCount > 0) evidence.add("assertions");
			const missingEvidence = requiredEvidence.filter(
				(item) => !evidence.has(item),
			);
			assert.deepEqual(
				missingEvidence,
				[],
				`${description} omitted required evidence dimensions.`,
			);
			return { assertionCount, evidence: [...evidence].sort() };
		},
	};
}

export type LifecycleInvariantRegistry = {
	[Id in LifecycleInvariantId]: {
		statement: string;
		proofs: Record<RequiredProofClass<Id>, ExecutableProof>;
	};
};

export type StructurallyIncompleteRegistry = {
	[Id in LifecycleInvariantId]?: {
		statement?: string;
		proofs?: Partial<Record<string, ExecutableProof>>;
	};
};

export type MissingProof = {
	invariantId: LifecycleInvariantId;
	proofClass: string;
};

export function missingLifecycleProofs(
	registry: StructurallyIncompleteRegistry,
): MissingProof[] {
	const missing: MissingProof[] = [];
	for (const [invariantId, requiredProofs] of Object.entries(
		LIFECYCLE_INVARIANT_REQUIREMENTS,
	) as Array<[LifecycleInvariantId, readonly string[]]>) {
		const invariant = registry[invariantId];
		for (const proofClass of requiredProofs) {
			if (typeof invariant?.proofs?.[proofClass]?.run !== "function") {
				missing.push({ invariantId, proofClass });
			}
		}
	}
	return missing;
}

export function missingLifecycleExternalProofs(
	registry: StructurallyIncompleteExternalRegistry,
): MissingProof[] {
	const missing: MissingProof[] = [];
	for (const [invariantId, requiredProofs] of Object.entries(
		LIFECYCLE_EXTERNAL_PROOF_REQUIREMENTS,
	) as Array<[LifecycleExternalInvariantId, readonly string[]]>) {
		const invariant = registry[invariantId];
		for (const proofClass of requiredProofs) {
			const proof = invariant?.proofs?.[proofClass];
			if (
				proof?.boundary !== "packed-plugin-real-opencode" ||
				proof.verificationCommand !== "bun run smoke:live" ||
				proof.hostPackage !== "opencode-ai" ||
				proof.pluginArtifact !== "current-build-packed-tarball" ||
				proof.pinnedHostVersion.length === 0 ||
				proof.requiredEvidence.length === 0
			) {
				missing.push({ invariantId, proofClass });
			}
		}
	}
	return missing;
}

export function missingLifecycleCoverage(
	registry: StructurallyIncompleteRegistry,
	externalRegistry: StructurallyIncompleteExternalRegistry,
): MissingProof[] {
	return [
		...missingLifecycleProofs(registry),
		...missingLifecycleExternalProofs(externalRegistry),
	];
}

export async function executeLifecycleInvariantRegistry(
	registry: LifecycleInvariantRegistry,
): Promise<
	Array<{
		invariantId: LifecycleInvariantId;
		proofClass: string;
		assertionCount: number;
		evidence: string[];
	}>
> {
	const missing = missingLifecycleProofs(registry);
	assert.deepEqual(
		missing,
		[],
		"Every required proof class must be executable.",
	);
	const executions: Array<{
		invariantId: LifecycleInvariantId;
		proofClass: string;
		assertionCount: number;
		evidence: string[];
	}> = [];
	for (const [invariantId, requiredProofs] of Object.entries(
		LIFECYCLE_INVARIANT_REQUIREMENTS,
	) as Array<[LifecycleInvariantId, readonly string[]]>) {
		for (const proofClass of requiredProofs) {
			const proofs = registry[invariantId].proofs as Record<
				string,
				ExecutableProof
			>;
			const proof = proofs[proofClass];
			if (!proof) {
				throw new Error(`Missing ${invariantId}/${proofClass}.`);
			}
			const result = await proof.run();
			assert.ok(
				result.assertionCount > 0,
				`${invariantId}/${proofClass} executed no assertions.`,
			);
			assert.ok(
				result.evidence.length > 0,
				`${invariantId}/${proofClass} returned no structured evidence.`,
			);
			executions.push({
				invariantId,
				proofClass,
				assertionCount: result.assertionCount,
				evidence: result.evidence,
			});
		}
	}
	return executions;
}
