import type {
	Artifact,
	ExistingWork,
	ReviewEvidenceReference,
	SourceDigest,
} from "../../domain/session.js";

type FileEvidence = Readonly<{
	kind: "missing" | "file" | "symlink";
	mode: number;
	digest: SourceDigest | null;
}>;

export type ReviewEvidencePacket = Readonly<{
	version: 1;
	sessionId: string;
	featureId: string;
	runId: string;
	baseline: ReviewEvidenceReference;
	sourceDigest: SourceDigest;
	provenance: "captured-before-run" | "declared-existing-work";
	complete: true;
	preservedPreexisting: Readonly<{
		count: number;
		digest: SourceDigest;
		entries: readonly Readonly<{ path: string; state: FileEvidence }>[];
	}>;
	changes: readonly Readonly<{
		path: string;
		before: FileEvidence;
		after: FileEvidence;
		binary: boolean;
		preexistingDirty: boolean;
		diff: string;
		acceptedBefore?: FileEvidence | undefined;
		acceptedDiff?: string | undefined;
		newDiff?: string | undefined;
	}>[];
}>;

export interface ReviewEvidencePort {
	captureBaseline(
		input: Readonly<{
			sessionId: string;
			featureId: string;
			originRunId: string;
			sourceDigest: SourceDigest;
			existingWork?: ExistingWork;
		}>,
	): Promise<ReviewEvidenceReference>;
	prepare(
		input: Readonly<{
			sessionId: string;
			featureId: string;
			runId: string;
			baseline: ReviewEvidenceReference;
			sourceDigest: SourceDigest;
			declaredArtifacts: readonly Artifact[];
			authorizedTargets: readonly string[];
		}>,
	): Promise<ReviewEvidenceReference>;
	read(
		input: Readonly<{
			reference: ReviewEvidenceReference;
			sessionId: string;
			featureId: string;
			runId: string;
			sourceDigest: SourceDigest;
		}>,
	): Promise<ReviewEvidencePacket>;
}
