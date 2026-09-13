import { lstat, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { canonicalSha256 } from "./canonical-json.js";
import { evidenceSha256, MAX_EVIDENCE_OBJECT_BYTES } from "./evidence-store.js";
import { requiredPairedPowerPairs } from "./experiment-power.js";
import {
	exactPackageVersion,
	packedPackageManifest,
	tarballSha256,
	unpackedManifestSha256,
} from "./provenance.js";
import {
	ArtifactIdentitySchema,
	ModelIdentitySchema,
	ReportTextSchema,
} from "./report-identities.js";
import {
	assertStudyBudget,
	PairedStudyPolicySchema,
	STUDY_PROTOCOL_VERSION_SHA256,
	StudyArmSchema,
	StudyBudgetSchema,
} from "./study-protocol.js";

const InputArmSchema = z
	.object({
		artifact: z.union([
			z.object({ kind: z.literal("ordinary-opencode") }).strict(),
			z
				.object({ path: ReportTextSchema, identity: ArtifactIdentitySchema })
				.strict(),
		]),
		manager: ModelIdentitySchema,
		reviewer: StudyArmSchema.shape.reviewer,
	})
	.strict();

export const StudyManifestSchema = z
	.object({
		schemaVersion: z.literal(1),
		purpose: PairedStudyPolicySchema.shape.purpose,
		comparison: PairedStudyPolicySchema.shape.comparison,
		method: PairedStudyPolicySchema.shape.method,
		opencodeVersion: ReportTextSchema,
		arms: z
			.object({ baseline: InputArmSchema, candidate: InputArmSchema })
			.strict(),
		cases: z
			.array(
				z
					.object({
						caseId: ReportTextSchema,
						caseVersion: z.number().int().safe().positive(),
					})
					.strict(),
			)
			.min(1)
			.max(1000),
		repetitions: z.number().int().safe().positive().max(10000),
		reservePairsPerBlock: z.number().int().safe().nonnegative().max(10),
		seed: ReportTextSchema,
		budget: StudyBudgetSchema.omit({ maxOutputTokens: true }),
		accounting: PairedStudyPolicySchema.shape.accounting,
		targetPower: PairedStudyPolicySchema.shape.targetPower,
		minimumDetectableEffect:
			PairedStudyPolicySchema.shape.minimumDetectableEffect,
	})
	.strict();

export type StudyManifest = z.infer<typeof StudyManifestSchema>;

export async function prepareStudyManifest(input: unknown, directory: string) {
	const manifest = StudyManifestSchema.parse(input);
	const readArm = async (arm: StudyManifest["arms"]["baseline"]) => {
		if ("kind" in arm.artifact) {
			return { specification: StudyArmSchema.parse(arm), bytes: null };
		}
		exactPackageVersion(arm.artifact.identity.packageVersion);
		const path = resolve(directory, arm.artifact.path);
		const stat = await lstat(path);
		if (!stat.isFile() || stat.size > MAX_EVIDENCE_OBJECT_BYTES)
			throw new Error("Study artifact must be a bounded regular tarball file.");
		const bytes = await readFile(path);
		const expected = arm.artifact.identity;
		if (
			evidenceSha256(bytes) !== expected.tarballSha256 ||
			(await packedPackageManifest(path)).version !== expected.packageVersion ||
			(await unpackedManifestSha256(path)) !==
				expected.unpackedManifestSha256 ||
			(await tarballSha256(path)) !== expected.tarballSha256
		) {
			throw new Error(
				"Study artifact bytes or package version differ from their declared identity.",
			);
		}
		return {
			specification: StudyArmSchema.parse({ ...arm, artifact: expected }),
			bytes,
		};
	};
	const [baseline, candidate] = await Promise.all([
		readArm(manifest.arms.baseline),
		readArm(manifest.arms.candidate),
	]);
	const policy = PairedStudyPolicySchema.parse({
		kind: "paired-study",
		schemaVersion: 1,
		purpose: manifest.purpose,
		comparison: manifest.comparison,
		method: manifest.method,
		opencodeVersion: manifest.opencodeVersion,
		arms: {
			baseline: baseline.specification,
			candidate: candidate.specification,
		},
		bootstrapSeed: canonicalSha256(
			"flow-study-bootstrap-seed-v1",
			manifest.seed,
		),
		alpha: 0.05,
		...(manifest.targetPower === undefined
			? {}
			: { targetPower: manifest.targetPower }),
		...(manifest.minimumDetectableEffect === undefined
			? {}
			: { minimumDetectableEffect: manifest.minimumDetectableEffect }),
		accounting: manifest.accounting,
		versionSha256: STUDY_PROTOCOL_VERSION_SHA256,
	});
	const caseIds = new Set(
		manifest.cases.map((item) => `${item.caseId}\u0000${item.caseVersion}`),
	);
	if (caseIds.size !== manifest.cases.length)
		throw new Error("Study cases must be unique.");
	const primaryPairs = manifest.cases.length * manifest.repetitions;
	const possibleAttempts =
		primaryPairs * (manifest.reservePairsPerBlock + 1) * 2;
	if (!Number.isSafeInteger(possibleAttempts) || possibleAttempts > 100000)
		throw new Error("Study schedule exceeds 100,000 bounded cells.");
	const budget = {
		...manifest.budget,
		maxOutputTokens: policy.accounting.maxGeneratedOutputTokens,
	};
	assertStudyBudget(policy, budget, primaryPairs * 2);
	if (policy.purpose === "confirmatory") {
		if (
			policy.targetPower === undefined ||
			policy.minimumDetectableEffect === undefined
		)
			throw new Error("Confirmatory power parameters are missing.");
		const required = requiredPairedPowerPairs({
			alpha: policy.alpha,
			targetPower: policy.targetPower,
			minimumDetectableEffect: policy.minimumDetectableEffect,
		});
		if (primaryPairs < required)
			throw new Error(
				`Fixed-task confirmatory method requires ${required} pairs; this study is underpowered.`,
			);
	}
	const preflight = policy.accounting.preflight;
	if (preflight.kind === "entitlement") {
		const profiles = new Set(
			Object.values(policy.arms)
				.flatMap((arm) => [
					arm.manager,
					...(arm.reviewer?.model ? [arm.reviewer.model] : []),
				])
				.map((model) => JSON.stringify(model)),
		);
		if (profiles.size > preflight.maxRequests)
			throw new Error(
				"Preflight request allowance cannot cover the declared profiles.",
			);
	}
	const prepared = {
		policy,
		budget,
		cases: manifest.cases,
		repetitions: manifest.repetitions,
		reservePairsPerBlock: manifest.reservePairsPerBlock,
		seed: manifest.seed,
	};
	return {
		...prepared,
		artifacts: { baseline: baseline.bytes, candidate: candidate.bytes },
		summary: {
			manifestSha256: canonicalSha256("flow-study-manifest-v1", prepared),
			purpose: manifest.purpose,
			comparison: manifest.comparison,
			comparisonScope:
				"whole-workflow outcomes; isolated reviewer quality requires frozen code, packet, and evidence",
			method: manifest.method,
			primaryPairs,
			primaryAttempts: primaryPairs * 2,
			reservePairs: primaryPairs * manifest.reservePairsPerBlock,
			possibleAttempts,
			arms: policy.arms,
			budget,
			accounting: manifest.accounting,
			admission:
				budget.maxUsd === 0
					? "blocked-by-zero-monetary-allowance"
					: "declared-primary-estimates-fit",
			preflightAdmission:
				preflight.kind === "none"
					? "not-requested"
					: preflight.maxUsd === 0
						? "blocked-by-zero-monetary-allowance"
						: "declared-allowance",
			budgetSemantics:
				"Observation-based stop thresholds, not a guaranteed invoice cap.",
			providerCalls: 0,
		},
	};
}

export async function readStudyManifest(path: string) {
	return prepareStudyManifest(
		JSON.parse(await readFile(path, "utf8")),
		dirname(resolve(path)),
	);
}

export type PreparedStudy = Awaited<ReturnType<typeof prepareStudyManifest>>;
