import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { parseCaseCatalog } from "./catalog.js";
import { RetainedScenarioEvidenceSchema } from "./grader-input.js";
import { type AttemptRecordV2, parseReport } from "./report.js";

const Text = z.string().trim().min(1);
// Retained transcripts redact operation payloads, so live-session invariants
// cannot validate them. Validate only the observations used by this report.
const ReviewDocumentSchema = z.object({
	runs: z.array(
		z.object({
			reviews: z.array(
				z.object({
					id: Text,
					result: z
						.object({
							verdict: z.enum(["passed", "failed"]),
							terminalDisposition: Text.optional(),
							findings: z.array(
								z
									.object({
										findingId: Text.optional(),
										severity: z.enum(["blocking", "advisory"]),
										summary: Text,
										evidence: Text.optional(),
									})
									.refine(
										(finding) =>
											finding.severity !== "blocking" ||
											Boolean(finding.evidence),
										{
											message: "A blocking finding requires concrete evidence.",
											path: ["evidence"],
										},
									),
							),
						})
						.nullable(),
				}),
			),
		}),
	),
});
export const FindingAssessmentsSchema = z.array(
	z
		.object({
			attemptId: Text,
			transcriptSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
			assignmentId: Text,
			findingId: Text,
			category: z.enum(["code-defect", "evidence-gap"]),
			assessor: Text,
			rationale: Text,
		})
		.strict(),
);
type Assessments = z.infer<typeof FindingAssessmentsSchema>;

/** Descriptive observations only. Never supplies grades or calibration labels. */
export async function reviewEvidenceReport(
	records: readonly Pick<
		AttemptRecordV2,
		"attemptId" | "caseId" | "cellId" | "repetition" | "transcript"
	>[],
	load: (artifact: string) => Promise<Uint8Array | null>,
	assessmentInput: unknown = [],
) {
	if (
		new Set(records.map((record) => record.attemptId)).size !== records.length
	)
		throw new Error("Duplicate attempt.");
	const assessments = FindingAssessmentsSchema.parse(assessmentInput);
	const key = (
		value: Pick<
			Assessments[number],
			"attemptId" | "assignmentId" | "findingId"
		>,
	) => JSON.stringify([value.attemptId, value.assignmentId, value.findingId]);
	const labels = new Map(assessments.map((item) => [key(item), item]));
	if (labels.size !== assessments.length)
		throw new Error("Duplicate finding assessment.");
	const used = new Set<string>();
	const totals = {
		attempts: records.length,
		reviewObserved: 0,
		noReviewObserved: 0,
		unassessed: 0,
		passed: 0,
		failed: 0,
		pending: 0,
		codeDefects: 0,
		evidenceGaps: 0,
		unclassifiedFindings: 0,
	};
	const attempts = [];
	for (const attempt of records) {
		const base = { attemptId: attempt.attemptId, caseId: attempt.caseId };
		const bytes = attempt.transcript
			? await load(attempt.transcript.artifact)
			: null;
		if (!bytes || !attempt.transcript) {
			totals.unassessed++;
			attempts.push({
				...base,
				status: "unassessed",
				reason: "Transcript unavailable",
			});
			continue;
		}
		const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
		if (digest !== attempt.transcript.sha256)
			throw new Error("Transcript digest mismatch.");
		const input: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
		const parsed = RetainedScenarioEvidenceSchema.safeParse(input);
		if (!parsed.success) {
			totals.unassessed++;
			attempts.push({
				...base,
				status: "unassessed",
				reason: "Unsupported retained transcript shape",
			});
			continue;
		}
		const retained = parsed.data;
		if (
			retained.attempt.attemptId !== attempt.attemptId ||
			retained.attempt.cellId !== attempt.cellId ||
			retained.attempt.caseId !== attempt.caseId ||
			retained.attempt.repetition !== attempt.repetition
		) {
			throw new Error("Transcript attempt binding mismatch.");
		}
		const documents = [...retained.gradeInput.archives];
		if (retained.gradeInput.session)
			documents.push(retained.gradeInput.session);
		const sessions = documents.map((document) =>
			ReviewDocumentSchema.safeParse(document),
		);
		if (sessions.length === 0 || sessions.some((session) => !session.success)) {
			totals.unassessed++;
			attempts.push({
				...base,
				status: "unassessed",
				reason: "Session evidence unavailable or unsupported",
			});
			continue;
		}
		const reviews = sessions.flatMap((session) =>
			session.success ? session.data.runs.flatMap((run) => run.reviews) : [],
		);
		if (new Set(reviews.map((review) => review.id)).size !== reviews.length)
			throw new Error("Duplicate review assignment.");
		if (reviews.length) totals.reviewObserved++;
		else totals.noReviewObserved++;
		const observations = reviews.map((review) => {
			const ids = (review.result?.findings ?? []).flatMap((finding) =>
				finding.findingId ? [finding.findingId] : [],
			);
			if (new Set(ids).size !== ids.length)
				throw new Error("Duplicate finding identity.");
			if (review.result) totals[review.result.verdict]++;
			else totals.pending++;
			return {
				assignmentId: review.id,
				verdict: review.result?.verdict ?? "pending",
				terminalDisposition: review.result?.terminalDisposition ?? null,
				findings: (review.result?.findings ?? []).map((finding) => {
					const id = key({
						...base,
						assignmentId: review.id,
						findingId: finding.findingId ?? "",
					});
					const label = labels.get(id);
					if (label && label.transcriptSha256 !== digest)
						throw new Error("Stale finding assessment.");
					if (label) used.add(id);
					if (label?.category === "code-defect") totals.codeDefects++;
					else if (label?.category === "evidence-gap") totals.evidenceGaps++;
					else totals.unclassifiedFindings++;
					return {
						...finding,
						category: label?.category ?? "unclassified",
						assessment: label ?? null,
					};
				}),
			};
		});
		attempts.push({
			...base,
			transcriptSha256: digest,
			status: reviews.length ? "review-observed" : "no-review-observed",
			reviews: observations,
		});
	}
	if (used.size !== labels.size)
		throw new Error("Assessment does not match an observed finding.");
	return {
		kind: "descriptive-review-evidence",
		limitations: [
			"No review observed is not proof that no review activity occurred outside retained session evidence.",
			"Verdicts and finding occurrences include retries; they are not independent tasks or accuracy estimates.",
			"Categories are attributed assessments, not verified defects, human calibration, or release grades.",
		],
		totals,
		attempts,
	};
}

export async function readReviewEvidenceReport(
	directory: string,
	assessments: unknown = [],
) {
	const root = await realpath(directory);
	const catalog = parseCaseCatalog(
		JSON.parse(await readFile(resolve(root, "catalog.json"), "utf8")),
	);
	if (!catalog.ok) throw new Error("Invalid case catalog.");
	const report = parseReport(
		JSON.parse(await readFile(resolve(root, "report.json"), "utf8")),
		catalog.value,
	);
	if (!report.ok) throw new Error("Invalid campaign report.");
	return reviewEvidenceReport(
		report.value.attempts,
		async (artifact) => {
			let path: string;
			try {
				path = await realpath(resolve(root, artifact));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
				throw error;
			}
			const local = relative(root, path);
			if (
				isAbsolute(local) ||
				local === ".." ||
				local.startsWith("../") ||
				local.startsWith("..\\")
			)
				throw new Error("Transcript escapes campaign directory.");
			return readFile(path);
		},
		assessments,
	);
}

if (import.meta.main) {
	const [directory, assessmentsPath, ...extra] = process.argv.slice(2);
	if (!directory || extra.length)
		throw new Error(
			"Usage: bun evals/review-report.ts CAMPAIGN [ASSESSMENTS.json]",
		);
	const assessments: unknown = assessmentsPath
		? JSON.parse(await readFile(assessmentsPath, "utf8"))
		: [];
	console.log(
		JSON.stringify(
			await readReviewEvidenceReport(directory, assessments),
			null,
			2,
		),
	);
}
