import {
	type ObservedValidation,
	persistObservedValidation,
	prepareValidation,
} from "../../application/prepare-validation.js";
import type { ValidationStartRequest } from "../../application/schema.js";
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

export function persistWorkspaceValidation(
	workspace: string,
	input: ObservedValidation,
) {
	return persistObservedValidation(
		createFileSessionRepository(workspace),
		input,
	);
}
