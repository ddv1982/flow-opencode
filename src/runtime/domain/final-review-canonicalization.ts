export type TestEvidenceRefsCompatInput = {
	testEvidenceRefs?: string[] | undefined;
	oracleRefs?: string[] | undefined;
};

export function canonicalTestEvidenceRefs(
	input: TestEvidenceRefsCompatInput,
): string[] {
	return input.testEvidenceRefs ?? input.oracleRefs ?? [];
}

export function canonicalizeTestEvidenceRefs<
	T extends TestEvidenceRefsCompatInput,
>(
	value: T,
): Omit<T, "oracleRefs" | "testEvidenceRefs"> & { testEvidenceRefs: string[] } {
	const { oracleRefs, testEvidenceRefs, ...rest } = value;
	return {
		...rest,
		testEvidenceRefs: testEvidenceRefs ?? oracleRefs ?? [],
	};
}

export function normalizeBehaviorRiskClassName<T extends string>(
	riskClass: T,
): T | "test_evidence_authenticity" {
	return riskClass === "test_oracle_authenticity"
		? "test_evidence_authenticity"
		: riskClass;
}
