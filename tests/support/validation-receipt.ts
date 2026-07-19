import { createHash } from "node:crypto";
import type { SessionRepository } from "../../src/application/ports/session-repository.js";
import { createValidationReceiptStore } from "../../src/application/validation-receipts.js";
import { canonicalValidationCommandDigest } from "../../src/domain/transitions.js";
import { validationCommandClass } from "../../src/domain/validation-command.js";
import {
	parseValidationReceipt,
	type ValidationCoverageScope,
	type ValidationOutputCompleteness,
	type ValidationReceiptRef,
} from "../../src/domain/validation-receipt.js";
import { createFileSessionRepository } from "../../src/infrastructure/fs/session-repository.js";

type Sha256Digest = `sha256:${string}`;

export type ValidationReceiptTestInput = {
	startedAt: string;
	completedAt?: string;
	command?: string;
	coverageScope?: ValidationCoverageScope;
	exitCode?: number;
	outputCompleteness?: ValidationOutputCompleteness;
	outputDigest?: Sha256Digest;
	environmentKeys?: string[];
	featureRunId?: string;
	featureId?: string;
	sourceDigest?: Sha256Digest;
};

function digest(value: string): Sha256Digest {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** Publish one canonical runtime-shaped receipt for application contract tests. */
export async function publishValidationReceiptForRepository(
	repository: SessionRepository,
	input: ValidationReceiptTestInput,
): Promise<ValidationReceiptRef> {
	return repository.transact(async (transaction) => {
		const session = await transaction.load();
		if (!session?.activeFeatureId || !session.activeFeatureRunId) {
			throw new Error(
				"A validation receipt test requires an active feature run.",
			);
		}
		const source = await transaction.computeSourceIdentity();
		const command = input.command ?? "bun test tests/runtime-gates.test.ts";
		const receipt = parseValidationReceipt({
			schemaVersion: 1,
			kind: "validation_receipt_v1",
			featureRunId: input.featureRunId ?? session.activeFeatureRunId,
			featureId: input.featureId ?? session.activeFeatureId,
			sourceDigest: input.sourceDigest ?? source.digest,
			startedAt: input.startedAt,
			completedAt: input.completedAt ?? input.startedAt,
			command,
			commandDigest: canonicalValidationCommandDigest(command),
			commandClass: validationCommandClass(command),
			coverageScope: input.coverageScope ?? "focused",
			exitCode: input.exitCode ?? 0,
			outputDigest:
				input.outputDigest ?? digest(`validation-output:${command}`),
			outputCompleteness: input.outputCompleteness ?? "complete",
			environmentKeys: input.environmentKeys ?? [],
		});
		return createValidationReceiptStore(transaction).publishValidationReceipt(
			receipt,
		);
	});
}

export function publishValidationReceiptForWorkspace(
	workspace: string,
	input: ValidationReceiptTestInput,
): Promise<ValidationReceiptRef> {
	return publishValidationReceiptForRepository(
		createFileSessionRepository(workspace),
		input,
	);
}
