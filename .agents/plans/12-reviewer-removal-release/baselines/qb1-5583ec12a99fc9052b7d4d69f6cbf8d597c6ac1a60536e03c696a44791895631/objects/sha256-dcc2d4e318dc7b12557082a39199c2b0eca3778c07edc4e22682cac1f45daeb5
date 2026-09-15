import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseCaseCatalog } from "./catalog.js";
import { inspectArtifact, samePackedArtifact } from "./provenance.js";
import type { ArtifactIdentity } from "./report.js";
import { parseReport } from "./report.js";

export type ReportArtifact = {
	readonly reportPath: string;
	readonly catalogPath: string;
	readonly artifactPath: string;
	readonly artifact: ArtifactIdentity;
};

async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf8"));
}

export async function reportArtifactForCanary(input: {
	readonly repositoryRoot: string;
	readonly reportPath: string;
}): Promise<ReportArtifact> {
	const reportPath = resolve(input.reportPath);
	const campaignDirectory = dirname(reportPath);
	const catalogPath = join(campaignDirectory, "catalog.json");
	const artifactPath = join(campaignDirectory, "artifact.tgz");
	const catalog = parseCaseCatalog(await readJson(catalogPath));
	if (!catalog.ok) {
		throw new Error(
			`Canary report catalog is invalid: ${catalog.issues.join("; ")}`,
		);
	}
	const report = parseReport(await readJson(reportPath), catalog.value);
	if (!report.ok) {
		throw new Error(
			`Canary report is invalid: ${report.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`,
		);
	}
	if (report.value.attempts.length === 0) {
		throw new Error("Canary report has no measured attempts.");
	}
	const artifact = await inspectArtifact({
		repositoryRoot: input.repositoryRoot,
		tarballPath: artifactPath,
	});
	if (
		report.value.attempts.some(
			(attempt) =>
				!("packageVersion" in attempt.artifact) ||
				!samePackedArtifact(attempt.artifact, artifact),
		)
	) {
		throw new Error(
			"Canary report attempts do not match the campaign artifact.tgz.",
		);
	}
	return { reportPath, catalogPath, artifactPath, artifact };
}
