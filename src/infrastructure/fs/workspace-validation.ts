import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
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
	// `relative`, not a prefix test: `resolve` yields `C:\ws\report.xml` on Windows,
	// which never starts with `C:\ws/`, so a prefix test rejected every legitimate
	// report there. That failed *closed* into recording each declared case `absent`,
	// which is the wrong closed: it made the one platform this evidence rule exists
	// for the one platform where no report could ever satisfy it.
	const inside = relative(root, target);
	if (inside === "" || isAbsolute(inside) || inside.split(/[\\/]/)[0] === "..")
		return null;
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
