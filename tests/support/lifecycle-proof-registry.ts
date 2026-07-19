import {
	actualRegistrationDifferentialProof,
	emittedJsonSchemaProof,
	registeredHostCallProof,
	sharedContractCorpusProof,
} from "./lifecycle-contract-proofs.js";
import {
	exactV4SchemaProof,
	packageSurfaceProof,
	persistenceReloadProof,
	stateMachineProof,
	stateSchemaCorruptionProof,
	stateTransitionTableProof,
	staticV4AbsenceProof,
	timePersistenceParseProof,
} from "./lifecycle-core-proofs.js";
import type { LifecycleInvariantRegistry } from "./lifecycle-invariant-registry.js";
import {
	atomicFailpointReplayProof,
	closeArchiveSafetyProof,
	closeFailureInjectionMatrixProof,
	closeFreshServiceRetryProof,
	closeStatusContractProof,
	finalContextLossProof,
	finalDomainTransitionProof,
	finalRegisteredHostPathProof,
	timeLifecycleBoundaryProof,
	timeReviewAtomicRejectionProof,
	timeValidationPerturbationProof,
} from "./lifecycle-recovery-proofs.js";

export const LIFECYCLE_PROOF_REGISTRY = {
	"S4-STATE-01": {
		statement:
			"Active feature, run, plan, closure, and pending-assignment state is coherent.",
		proofs: {
			schema_corruption: stateSchemaCorruptionProof,
			transition_table: stateTransitionTableProof,
			deterministic_state_machine: stateMachineProof,
			persistence_reload: persistenceReloadProof,
		},
	},
	"S4-TIME-01": {
		statement:
			"Run, validation, assignment, result, and acceptance chronology is ordered.",
		proofs: {
			boundary_examples: timeLifecycleBoundaryProof,
			timestamp_perturbation: timeValidationPerturbationProof,
			atomic_rejection: timeReviewAtomicRejectionProof,
			persistence_parse: timePersistenceParseProof,
		},
	},
	"S4-FINAL-REC-01": {
		statement:
			"A persisted final assignment completes without caller-only prerequisite data.",
		proofs: {
			domain_transition: finalDomainTransitionProof,
			context_loss_restart: finalContextLossProof,
			registered_host_final_path: finalRegisteredHostPathProof,
		},
	},
	"S4-CLOSE-REC-01": {
		statement: "Interrupted close converges from durable Flow state alone.",
		proofs: {
			failure_injection_matrix: closeFailureInjectionMatrixProof,
			status_contract: closeStatusContractProof,
			fresh_service_retry: closeFreshServiceRetryProof,
			no_clobber_archive: closeArchiveSafetyProof,
		},
	},
	"S4-HOST-01": {
		statement:
			"Application, registered-handler, emitted host-expressible structure, and executed contracts agree; outer strictness is enforced at handler entry.",
		proofs: {
			shared_corpus: sharedContractCorpusProof,
			actual_registration_differential: actualRegistrationDifferentialProof,
			emitted_json_schema: emittedJsonSchemaProof,
			registered_host_calls: registeredHostCallProof,
		},
	},
	"S4-ATOMIC-01": {
		statement:
			"Rejection preserves state and operation identity; acceptance advances once.",
		proofs: {
			transition_sequence: stateMachineProof,
			repository_reload: persistenceReloadProof,
			failpoint_replay: atomicFailpointReplayProof,
		},
	},
	"S4-V4-ONLY-01": {
		statement:
			"Session v4 is the sole recognized session format and active contract.",
		proofs: {
			exact_schema_rejection: exactV4SchemaProof,
			package_surface: packageSurfaceProof,
			static_absence_audit: staticV4AbsenceProof,
		},
	},
} satisfies LifecycleInvariantRegistry;
