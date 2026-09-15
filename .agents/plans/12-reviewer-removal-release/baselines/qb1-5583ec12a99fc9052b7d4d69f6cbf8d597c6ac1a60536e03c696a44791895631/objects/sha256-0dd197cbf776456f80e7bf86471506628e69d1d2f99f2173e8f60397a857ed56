import { z } from "zod";

export const ReportDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const ReportTextSchema = z
	.string()
	.min(1)
	.max(4096)
	.regex(/\S/)
	.refine((value) => value.isWellFormed());

export const ModelIdentitySchema = z
	.object({
		routeProvider: ReportTextSchema,
		gateway: ReportTextSchema.nullable(),
		family: ReportTextSchema,
		model: ReportTextSchema,
		revision: ReportTextSchema.nullable(),
		variant: ReportTextSchema.optional(),
	})
	.strict();

export const ArtifactIdentitySchema = z
	.object({
		packageVersion: ReportTextSchema,
		sourceCommit: ReportTextSchema,
		sourceTreeSha256: ReportDigestSchema,
		tarballSha256: ReportDigestSchema,
		unpackedManifestSha256: ReportDigestSchema,
	})
	.strict();

export const PackedArtifactIdentitySchema = ArtifactIdentitySchema.omit({
	sourceCommit: true,
	sourceTreeSha256: true,
});
