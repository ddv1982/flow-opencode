import { MAX_ARTIFACTS, MAX_PATH_BYTES } from "./limits.js";
import type { Artifact } from "./session.js";

export const ARTIFACT_PATH_MESSAGE =
	"Artifact paths must be normalized workspace-relative paths.";

export function isArtifactPath(value: string): boolean {
	if (!value || value !== value.trim() || value.includes("\0")) return false;
	if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
	if (value.includes("\\")) return false;
	return value
		.split("/")
		.every((part) => part !== "" && part !== "." && part !== "..");
}

export function artifactIssues(artifacts: readonly Artifact[]): string[] {
	const issues: string[] = [];
	if (artifacts.length > MAX_ARTIFACTS) {
		issues.push(`Artifact lists may contain at most ${MAX_ARTIFACTS} paths.`);
	}
	for (const artifact of artifacts) {
		if (!isArtifactPath(artifact.path)) {
			issues.push(ARTIFACT_PATH_MESSAGE);
		} else if (Buffer.byteLength(artifact.path, "utf8") > MAX_PATH_BYTES) {
			issues.push(
				`Artifact paths may contain at most ${MAX_PATH_BYTES} UTF-8 bytes.`,
			);
		}
	}
	return issues;
}
