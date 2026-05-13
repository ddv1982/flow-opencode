import {
	type BehaviorValidationLedgerTarget,
	behaviorValidationLedgerFailureReasons,
} from "./final-review-behavior-ledger-validation";
import type { FinalReviewBehaviorCoverageTarget } from "./final-review-behavior-risks";
import {
	artifactPathsForWorker,
	type FinalReviewWorkerEvidence,
	validationCommandsForWorker,
} from "./final-review-coverage-evidence";
import {
	isSafeReviewArtifactRef,
	normalizeArtifactPath,
	pathForReviewArtifactRef,
} from "./final-review-coverage-paths";
import type { ReviewContextPack } from "./review-content-discovery";

export type { BehaviorValidationLedgerTarget };
export { behaviorValidationLedgerFailureReasons };

const FLOW_INFRASTRUCTURE_SRC_DOMAINS = new Set([
	"runtime",
	"prompts",
	"audit",
	"adapters",
	"core",
	"persistence",
	"workflow",
	"types",
]);

const ASYNC_EVENT_TEXT_PATTERN =
	/\b(async|await|promise|deferred?|race|event|listener|handler|callback|queue|timer|timeout|interval|concurrent|interleav(?:e|ing)|click)\b/i;
const REVIEW_SCOPE_WILDCARD_PATTERN = /[*?[\]{}]/;

export function genericAppDomainForPath(path: string): string | null {
	const match = /^src\/([^/]+)\//.exec(path);
	if (!match) {
		return null;
	}
	const domain = match[1];
	if (!domain) {
		return null;
	}
	return FLOW_INFRASTRUCTURE_SRC_DOMAINS.has(domain) ? null : domain;
}

export function reviewContextPackHasAsyncEventSignal(
	pack: ReviewContextPack,
): boolean {
	for (const context of pack.includedContext) {
		if (
			ASYNC_EVENT_TEXT_PATTERN.test(
				[
					context.path,
					context.reason,
					context.surface ?? "",
					context.summary ?? "",
				].join(" "),
			)
		) {
			return true;
		}
	}
	for (const relationship of pack.relationships) {
		if (
			ASYNC_EVENT_TEXT_PATTERN.test(
				[
					relationship.from,
					relationship.to,
					relationship.kind,
					relationship.summary,
				].join(" "),
			)
		) {
			return true;
		}
	}
	return false;
}

function concreteDeclaredReviewScopePath(
	scope: NonNullable<
		FinalReviewBehaviorCoverageTarget["declaredReviewScope"]
	>[number],
): string | null {
	const target = normalizeArtifactPath(scope.target);
	if (
		!target.includes("/") ||
		REVIEW_SCOPE_WILDCARD_PATTERN.test(target) ||
		!isSafeReviewArtifactRef(target)
	) {
		return null;
	}
	return target;
}

export function declaredReviewScopePaths(
	review: Pick<FinalReviewBehaviorCoverageTarget, "declaredReviewScope">,
): string[] {
	return (review.declaredReviewScope ?? [])
		.map(concreteDeclaredReviewScopePath)
		.filter((target): target is string => target !== null);
}

function normalizedStringSet(
	values: readonly string[] | undefined,
): Set<string> {
	return new Set(
		(values ?? [])
			.map((value) => value.trim())
			.filter((value) => value.length > 0),
	);
}

type BehaviorRefField =
	| "entrypointRefs"
	| "stateOwnerRefs"
	| "lifecycleOwnerRefs"
	| "testEvidenceRefs";

function reviewContextGroundingPaths(
	review: FinalReviewBehaviorCoverageTarget,
): Set<string> {
	const pack = review.reviewContextPack;
	return new Set([
		...declaredReviewScopePaths(review),
		...(pack?.changedFiles ?? []),
		...(pack?.includedContext.map((context) => context.path) ?? []),
		...(pack?.relationships.flatMap((relationship) => [
			relationship.from,
			relationship.to,
		]) ?? []),
	]);
}

function pathIsMentionedByValidationCommand(
	path: string,
	commands: ReadonlySet<string>,
): boolean {
	return [...commands].some((command) => command.includes(path));
}

export function behaviorRefGroundingFailureReasons(
	worker: FinalReviewWorkerEvidence,
	review: FinalReviewBehaviorCoverageTarget,
): string[] {
	const reasons: string[] = [];
	const artifactPathSet = new Set(artifactPathsForWorker(worker));
	const contextPathSet = reviewContextGroundingPaths(review);
	const validationCommandSet = normalizedStringSet([
		...validationCommandsForWorker(worker),
		...(review.evidenceRefs?.validationCommands ?? []),
		...(review.reviewContextPack?.validationEvidence.map(
			(evidence) => evidence.command,
		) ?? []),
	]);
	const isGrounded = (ref: string) => {
		const path = pathForReviewArtifactRef(ref);
		return (
			artifactPathSet.has(path) ||
			contextPathSet.has(path) ||
			pathIsMentionedByValidationCommand(path, validationCommandSet)
		);
	};
	const checkRefList = (
		label: string,
		field: BehaviorRefField,
		refs: readonly string[],
	) => {
		for (const ref of refs) {
			if (!isSafeReviewArtifactRef(ref)) {
				reasons.push(
					`${label}.${field} includes '${ref}', which is not a safe relative path reference`,
				);
				continue;
			}
			if (!isGrounded(ref)) {
				reasons.push(
					`${label}.${field} includes '${ref}', which is not grounded by changed artifacts, reviewContextPack paths, or test evidence`,
				);
			}
		}
	};

	for (const [index, check] of (review.behaviorChecks ?? []).entries()) {
		const label = `behaviorChecks[${index}]`;
		checkRefList(label, "entrypointRefs", check.entrypointRefs);
		checkRefList(label, "stateOwnerRefs", check.stateOwnerRefs);
		checkRefList(label, "lifecycleOwnerRefs", check.lifecycleOwnerRefs);
		checkRefList(label, "testEvidenceRefs", check.testEvidenceRefs);
	}
	for (const [index, item] of (review.validationCoverage ?? []).entries()) {
		checkRefList(
			`validationCoverage[${index}]`,
			"testEvidenceRefs",
			item.testEvidenceRefs,
		);
	}

	return reasons;
}
