import { describe, expect, test } from "bun:test";
import {
	normalizeReviewerDecision,
	normalizeWorkerResult,
} from "../src/runtime/contract-normalization";

describe("contract normalization", () => {
	test("normalizes reviewer payload and injects active feature id", () => {
		const result = normalizeReviewerDecision(
			JSON.stringify({
				scope: "feature",
				featureId: "wrong-id",
				status: "approved",
				summary: "Looks good.",
				blockingFindings: [],
				followUps: [],
				suggestedValidation: ["bun test"],
			}),
			"feature",
			"actual-feature",
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.scope).toBe("feature");
		if (result.value.scope !== "feature") {
			throw new Error("Expected feature scope reviewer payload.");
		}
		expect(result.value.featureId).toBe("actual-feature");
	});

	test("rejects reviewer payload with trailing text", () => {
		const result = normalizeReviewerDecision(
			'{"status":"approved","summary":"ok"}\nextra',
			"final",
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.kind).toBe("trailing_text");
	});

	test("rejects reviewer payload with duplicate keys", () => {
		const result = normalizeReviewerDecision(
			'{"status":"approved","status":"blocked","summary":"ok"}',
			"final",
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.kind).toBe("duplicate_json_key");
	});

	test("rejects non-object payloads", () => {
		const result = normalizeReviewerDecision('["not","object"]', "final");

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.kind).toBe("non_object_payload");
	});

	test("normalizes worker payload and injects active feature id", () => {
		const result = normalizeWorkerResult(
			JSON.stringify({
				contractVersion: "1",
				status: "ok",
				summary: "Done.",
				artifactsChanged: [],
				validationRun: [
					{
						command: "bun test",
						status: "passed",
						summary: "Passed.",
					},
				],
				decisions: [],
				nextStep: "Continue.",
				featureResult: { featureId: "wrong-id", verificationStatus: "passed" },
				featureReview: {
					status: "passed",
					summary: "Looks good.",
					blockingFindings: [],
				},
			}),
			"actual-feature",
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.featureResult.featureId).toBe("actual-feature");
	});

	test("rejects worker payload with malformed shape", () => {
		const result = normalizeWorkerResult(
			JSON.stringify({
				contractVersion: "1",
				status: "ok",
				summary: "Done.",
				artifactsChanged: [],
				validationRun: [],
				decisions: [],
				nextStep: "Continue.",
				featureResult: { verificationStatus: "passed" },
				featureReview: {
					status: "passed",
					summary: "Looks good.",
					blockingFindings: [],
				},
			}),
			"actual-feature",
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.featureResult.featureId).toBe("actual-feature");
	});

	test("rejects worker payload with duplicate nested keys", () => {
		const result = normalizeWorkerResult(
			'{"contractVersion":"1","status":"ok","summary":"Done.","artifactsChanged":[],"validationRun":[],"decisions":[],"nextStep":"Continue.","featureResult":{"featureId":"a","featureId":"b"},"featureReview":{"status":"passed","summary":"Looks good.","blockingFindings":[]}}',
			"actual-feature",
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.kind).toBe("duplicate_json_key");
	});
});
