import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	type ObservedValidation,
	persistObservedValidation,
	prepareValidation,
} from "../../application/prepare-validation.js";
import type { ValidationStartRequest } from "../../application/schema.js";
import { MAX_TEST_REPORT_BYTES } from "../../domain/limits.js";
import { normalizeEvidencePlatform } from "../../domain/validation.js";
import { createFileSessionRepository } from "./session-repository.js";

export function prepareWorkspaceValidation(
	workspace: string,
	input: ValidationStartRequest,
) {
	return prepareValidation(
		createFileSessionRepository(workspace),
		input,
		normalizeEvidencePlatform(process.platform),
	);
}

/**
 * Reads a test report the command wrote, or `null`.
 *
 * Every rejection is the same `null`, because no report and no readable report mean
 * the same thing downstream. Three are deliberate: a path escaping the workspace, a
 * non-file, and anything over the size cap.
 */
export async function readWorkspaceTestReport(
	workspace: string,
	relativePath: string,
): Promise<{ text: string; modifiedMs: number } | null> {
	const root = resolve(workspace);
	const target = resolve(join(root, relativePath));
	if (target !== root && !target.startsWith(`${root}/`)) return null;
	const info = await stat(target).catch(() => null);
	if (!info?.isFile() || info.size > MAX_TEST_REPORT_BYTES) return null;
	return { text: await readFile(target, "utf8"), modifiedMs: info.mtimeMs };
}

export function persistWorkspaceValidation(
	workspace: string,
	input: ObservedValidation,
) {
	return persistObservedValidation(
		createFileSessionRepository(workspace),
		input,
	);
}
