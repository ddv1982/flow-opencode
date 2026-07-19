import { describe, expect, test } from "bun:test";
import {
	actualRegistrationDifferentialProof,
	emittedJsonSchemaProof,
	registeredHostCallProof,
	sharedContractCorpusProof,
} from "./support/lifecycle-contract-proofs.js";

describe("S4-HOST-01 executable contract proofs", () => {
	for (const [name, proof] of Object.entries({
		actualRegistrationDifferentialProof,
		emittedJsonSchemaProof,
		registeredHostCallProof,
		sharedContractCorpusProof,
	})) {
		test(name, async () => {
			const result = await proof.run();
			expect(result.assertionCount).toBeGreaterThan(0);
		});
	}
});
