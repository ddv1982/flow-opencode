import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { LEGACY_PROMPT_BASELINE } from "../src/prompt-baseline-fixtures.js";
import {
	buildPromptModelEvaluationPacket,
	gradeModelDecisions,
	type ModelDecision,
	parseModelDecisionResponse,
} from "../src/prompt-model-evaluation.js";
import {
	auditLifecycleFlatRequestExamples,
	evaluatePromptVariant,
	measureCompiledPrompt,
	PROMPT_EVALUATION_SCENARIOS,
	promptInventoryForVariant,
} from "../src/prompt-quality.js";
import {
	compiledFlowPromptSurfaces,
	FLOW_STATIC_PROMPT_SURFACES,
	type FlowPromptSurfaceName,
	type FlowWorkerHandoffKind,
	validateFlowWorkerHandoff,
} from "../src/prompt-surfaces.js";

const LIFECYCLE_DOCUMENTATION_ROOTS = ["docs", "droid-wiki"] as const;
const HISTORICAL_LIFECYCLE_EXAMPLE_FILES = new Set(["CHANGELOG.md"]);

async function textDocumentsBelow(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) return textDocumentsBelow(path);
			return entry.isFile() && /\.(?:md|vtt)$/.test(entry.name) ? [path] : [];
		}),
	);
	return nested.flat().map((path) => path.split(sep).join("/"));
}

type GrowthBaseline = {
	variant: string;
	justification: string;
	growthPolicy: {
		minimumWordAllowance: number;
		relativeWordAllowance: number;
	};
	surfaces: Record<
		FlowPromptSurfaceName,
		{ acceptedWords: number; maxExactDuplicateLines: number }
	>;
};

const WORKER_HANDOFF_KINDS = {
	"flow-reviewer": "review-slice",
	"flow-evidence-worker": "evidence",
	"flow-validation-worker": "validation",
	"flow-audit-worker": "audit",
	"flow-candidate-worker": "candidate",
	"flow-verifier-worker": "verifier",
} satisfies Partial<Record<FlowPromptSurfaceName, FlowWorkerHandoffKind>>;

async function growthBaseline(): Promise<GrowthBaseline> {
	return JSON.parse(
		await readFile("tests/fixtures/prompt-quality-baseline.json", "utf8"),
	) as GrowthBaseline;
}

function validHandoffFromSchema(schema: string): string {
	const headings = schema
		.split(/\r?\n/)
		.map((line) => /^## ([^—]+?)(?:\s+—.*)?$/.exec(line)?.[1]?.trim())
		.filter((heading): heading is string => Boolean(heading));
	return headings
		.map(
			(heading) =>
				`## ${heading}\n${heading === "Status" ? "success" : "covered"}`,
		)
		.join("\n");
}

function emptyBodyHandoffFromSchema(schema: string): string {
	const headings = schema
		.split(/\r?\n/)
		.map((line) => /^## (.+)$/.exec(line)?.[1]?.trim())
		.filter((heading): heading is string => Boolean(heading));
	return headings
		.map((heading) => `## ${heading}${heading === "Status" ? "\nsuccess" : ""}`)
		.join("\n");
}

function passingModelDecisions(): ModelDecision[] {
	const overrides: Record<string, Partial<ModelDecision>> = {
		"small-serial-bug-fix": {
			validation: ["focused"],
			validationUsesRuntimeReceipts: true,
			independentReview: true,
			workers: ["flow-reviewer"],
		},
		"broad-planning-request": { planOnly: true },
		"flow-auto-plan-only": { planOnly: true },
		"review-first-maintainability": { planOnly: true, reviewFirst: true },
		"ambiguous-review-intent": {
			planOnly: true,
			reviewFirst: true,
			deliveryIntent: "review_and_plan",
			assuranceProfile: "standard",
		},
		"standard-assurance-profile": {
			executionMode: "readonly_parallel",
			workers: ["flow-verifier-worker"],
			assuranceProfile: "standard",
			runtimeProfile: "standard",
			challengeScope: "claim_targeted",
			manifestComplete: true,
			admissionBeforeDispatch: true,
		},
		"assurance-profile": {
			executionMode: "readonly_parallel",
			workers: ["flow-verifier-worker"],
			assuranceProfile: "assurance",
			runtimeProfile: "assurance",
			challengeScope: "every_actionable_candidate_claim_scoped",
			manifestComplete: true,
			admissionBeforeDispatch: true,
		},
		"targeted-refutation": {
			executionMode: "readonly_parallel",
			workers: ["flow-verifier-worker"],
			assuranceProfile: "standard",
			runtimeProfile: "standard",
			challengeScope: "claim_targeted",
			admissionBeforeDispatch: true,
		},
		"p0-guarded-candidate": {
			handoffHasRequiredSections: true,
			auditLedgerRendered: true,
		},
		"p0-demonstrated-ship-blocker": {
			handoffHasRequiredSections: true,
			p0Justified: true,
			auditLedgerRendered: true,
		},
		"correction-review-packet": {
			independentReview: true,
			reviewDepth: "detailed",
			correctionLinkedToPredecessor: true,
		},
		"record-review-before-edit": {
			reviewResultRecordedBeforeEdit: true,
		},
		"validation-schedule": {
			validation: ["focused", "broad"],
			validationUsesRuntimeReceipts: true,
			validationSchedule: [
				"diagnostic_advisory",
				"focused_after_changes",
				"artifact_applicable",
				"broad_final_after_feature_review",
			],
			independentReview: true,
		},
		"validation-receipt-capture": {
			validation: ["focused"],
			validationUsesRuntimeReceipts: true,
		},
		"runtime-persistence-change": {
			validation: ["behavioral"],
			validationUsesRuntimeReceipts: true,
			independentReview: true,
		},
		"ui-special-validation": {
			validation: ["ui", "browser"],
			validationUsesRuntimeReceipts: true,
			independentReview: true,
		},
		"parallel-discovery": {
			executionMode: "readonly_parallel",
			workers: ["flow-evidence-worker"],
			manifestComplete: true,
			runtimeProfile: "standard",
			admissionBeforeDispatch: true,
		},
		"runtime-profile-control": {
			executionMode: "readonly_parallel",
			workers: ["flow-evidence-worker"],
			manifestComplete: true,
			runtimeProfile: "control",
			validationUsesRuntimeReceipts: true,
		},
		"orchestration-admission": {
			executionMode: "readonly_parallel",
			workers: ["flow-evidence-worker"],
			manifestComplete: true,
			runtimeProfile: "standard",
			admissionBeforeDispatch: true,
		},
		"partial-handoff": {
			coverage: "partial",
			handoffStatus: "partial",
			handoffHasRequiredSections: true,
		},
		"malformed-handoff": {
			coverage: "missing",
			handoffStatus: "blocked",
			handoffHasRequiredSections: true,
		},
		"failed-review-repair": {
			retryReviews: 1,
			stopsAfterRetryFailure: true,
			validationUsesRuntimeReceipts: true,
		},
		"archive-pending": { executionMode: "blocked" },
		"candidate-safe": {
			executionMode: "candidate_worker",
			workers: ["flow-candidate-worker"],
			manifestComplete: true,
			runtimeProfile: "standard",
			admissionBeforeDispatch: true,
			candidateDecision: "used",
		},
		"candidate-serial": { candidateDecision: "serial_required" },
		"planning-runtime-unavailable": { executionMode: "blocked" },
		"execution-runtime-unavailable": { executionMode: "blocked" },
		"detailed-feature-review": {
			independentReview: true,
			reviewDepth: "detailed",
		},
		"cleanup-review-missing-helper": { coverage: "partial" },
		"ui-review-missing-visual-evidence": { coverage: "partial" },
		"review-retry-exhausted": {
			executionMode: "blocked",
			stopsAfterRetryFailure: true,
		},
	};
	return PROMPT_EVALUATION_SCENARIOS.map((scenario) => ({
		id: scenario.id,
		route: scenario.expectedRoute,
		executionMode: "serial",
		workers: [],
		stateOwner: "root-manager",
		callsStatusFirst: true,
		planOnly: false,
		reviewFirst: false,
		deliveryIntent: "not_applicable",
		assuranceProfile: "not_applicable",
		runtimeProfile: "not_applicable",
		challengeScope: "not_applicable",
		validation: [],
		validationSchedule: [],
		validationUsesRuntimeReceipts: false,
		admissionBeforeDispatch: false,
		independentReview: false,
		reviewResultRecordedBeforeEdit: false,
		correctionLinkedToPredecessor: false,
		reviewDepth: "not_applicable",
		manifestComplete: false,
		coverage: "not_applicable",
		handoffStatus: "not_applicable",
		handoffHasRequiredSections: false,
		retryReviews: 0,
		stopsAfterRetryFailure: false,
		candidateDecision: "not_applicable",
		p0Justified: false,
		auditLedgerRendered: false,
		refutedInRemediation: false,
		completionClaimed: false,
		reason: "Grounded in the rendered Flow contract.",
		...overrides[scenario.id],
	}));
}

describe("Flow prompt quality", () => {
	test("inventories every static prompt surface and the requested scenarios", () => {
		expect(Object.isFrozen(LEGACY_PROMPT_BASELINE)).toBe(true);
		expect(Object.isFrozen(LEGACY_PROMPT_BASELINE.workerPrompts)).toBe(true);
		expect(Object.isFrozen(LEGACY_PROMPT_BASELINE.reviewerSections)).toBe(true);
		expect(FLOW_STATIC_PROMPT_SURFACES).toHaveLength(11);
		expect(new Set(FLOW_STATIC_PROMPT_SURFACES).size).toBe(11);
		expect(PROMPT_EVALUATION_SCENARIOS).toHaveLength(31);
		expect(new Set(PROMPT_EVALUATION_SCENARIOS.map(({ id }) => id)).size).toBe(
			31,
		);
		for (const fixture of PROMPT_EVALUATION_SCENARIOS) {
			expect(fixture.input.length).toBeGreaterThan(20);
			expect(fixture.expectedRoute).toBe(fixture.surface);
		}
		const candidateSafe = PROMPT_EVALUATION_SCENARIOS.find(
			({ id }) => id === "candidate-safe",
		);
		expect(candidateSafe?.input).toContain(
			"root Flow manager executing an approved feature",
		);
		expect(candidateSafe?.expectedRoute).toBe("flow-run");
	});

	test("builds and deterministically grades opt-in model evaluation packets", () => {
		const packet = buildPromptModelEvaluationPacket(
			"surface-specific-bookended",
		);
		for (const surface of FLOW_STATIC_PROMPT_SURFACES) {
			expect(packet).toContain(`<surface name="${surface}">`);
		}
		for (const scenario of PROMPT_EVALUATION_SCENARIOS) {
			expect(packet).toContain(`<scenario id="${scenario.id}">`);
		}
		expect(packet).toContain("Use [] for non-applicable array fields");
		expect(packet).toContain("never inside an array");
		expect(packet).toContain('"deliveryIntent"');
		expect(packet).toContain('"assuranceProfile"');
		expect(packet).toContain('"runtimeProfile"');
		expect(packet).toContain('"validationSchedule"');
		expect(packet).toContain('"validationUsesRuntimeReceipts"');
		expect(packet).toContain('"admissionBeforeDispatch"');
		expect(packet).toContain('"auditLedgerRendered"');
		expect(packet).toContain('"correctionLinkedToPredecessor"');
		const passing = passingModelDecisions();
		const grade = gradeModelDecisions(passing);
		expect(grade.passedScenarios).toBe(grade.totalScenarios);
		expect(grade.passedCriteria).toBe(grade.totalCriteria);

		const unsafeCandidate = passing.map((decision) =>
			decision.id === "candidate-serial"
				? {
						...decision,
						executionMode: "candidate_worker" as const,
						workers: ["flow-candidate-worker"],
						candidateDecision: "used" as const,
					}
				: decision,
		);
		expect(gradeModelDecisions(unsafeCandidate).passedScenarios).toBeLessThan(
			grade.totalScenarios,
		);
		for (const [id, override] of [
			["validation-receipt-capture", { validationUsesRuntimeReceipts: false }],
			["orchestration-admission", { admissionBeforeDispatch: false }],
			["runtime-profile-control", { admissionBeforeDispatch: true }],
			["p0-demonstrated-ship-blocker", { auditLedgerRendered: false }],
			["correction-review-packet", { correctionLinkedToPredecessor: false }],
			["review-retry-exhausted", { retryReviews: 1 }],
		] as const) {
			const mutated = passing.map((decision) =>
				decision.id === id ? { ...decision, ...override } : decision,
			);
			expect(
				gradeModelDecisions(mutated).passedScenarios,
				`${id} must enforce its concrete runtime field`,
			).toBeLessThan(grade.totalScenarios);
		}
		expect(
			parseModelDecisionResponse(
				`The requested result follows.\n\`\`\`json\n${JSON.stringify({ decisions: passing })}\n\`\`\``,
			),
		).toEqual(passing);
		expect(() =>
			parseModelDecisionResponse('{"decisions":[{"id":"missing-fields"}]}'),
		).toThrow();
		expect(() =>
			parseModelDecisionResponse(
				JSON.stringify({
					decisions: [...passing, { ...passing[0], id: "unknown-scenario" }],
				}),
			),
		).toThrow("unknown scenario decision");
		expect(() =>
			gradeModelDecisions([...passing, passing[0] as ModelDecision]),
		).toThrow("duplicate scenario decision");
	});

	test("rejects unbounded model evaluation timeout values before launch", () => {
		const result = Bun.spawnSync({
			cmd: [
				"bun",
				"run",
				"scripts/prompt-model-eval.ts",
				"--model",
				"provider/model",
				"--timeout-ms",
				"0",
			],
			cwd: process.cwd(),
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(result.exitCode).toBe(2);
		expect(result.stderr.toString()).toContain("--timeout-ms 300000");
	});

	test("bookended surface compilation preserves every deterministic contract", () => {
		const baseline = evaluatePromptVariant("baseline");
		const lexical = evaluatePromptVariant("lexically-deduplicated");
		const surfaceSpecific = evaluatePromptVariant("surface-specific");
		const bookended = evaluatePromptVariant("surface-specific-bookended");

		expect(lexical.scenariosPassed).toBe(baseline.scenariosPassed);
		expect(surfaceSpecific.scenariosPassed).toBeGreaterThan(
			baseline.scenariosPassed,
		);
		expect(bookended.scenariosPassed).toBe(bookended.scenariosTotal);
		expect(bookended.criteriaPassed).toBe(bookended.criteriaTotal);
		expect(bookended.staticApproximateTokens).toBeLessThan(
			baseline.staticApproximateTokens,
		);
		expect(bookended.roleInapplicableLines).toBe(0);
	});

	test("guards accepted surface sizes and exact duplicate lines", async () => {
		const accepted = await growthBaseline();
		expect(accepted.justification.length).toBeGreaterThan(40);
		for (const metric of promptInventoryForVariant(
			"surface-specific-bookended",
		)) {
			const expected =
				accepted.surfaces[metric.surface as FlowPromptSurfaceName];
			expect(
				expected,
				`${metric.surface} needs a growth baseline`,
			).toBeDefined();
			if (!expected) continue;
			const wordAllowance = Math.max(
				accepted.growthPolicy.minimumWordAllowance,
				Math.ceil(
					expected.acceptedWords * accepted.growthPolicy.relativeWordAllowance,
				),
			);
			expect(
				metric.words,
				`${metric.surface} grew materially; update the accepted baseline with a justification`,
			).toBeLessThanOrEqual(expected.acceptedWords + wordAllowance);
			expect(
				metric.exactDuplicateLines,
				`${metric.surface} gained exact duplicate instruction lines`,
			).toBeLessThanOrEqual(expected.maxExactDuplicateLines);
			expect(metric.terminologyWarnings).toEqual([]);
		}
	});

	test("keeps canonical ids unique and role fragments applicable", () => {
		const surfaces = compiledFlowPromptSurfaces();
		for (const [surface, compiled] of Object.entries(surfaces)) {
			const ids = compiled.fragments.map(({ id }) => id);
			expect(new Set(ids).size, `${surface} has duplicate canonical ids`).toBe(
				ids.length,
			);
			for (const fragment of compiled.fragments) {
				expect(
					fragment.roles,
					`${surface} includes role-inapplicable fragment ${fragment.id}`,
				).toContain(compiled.role);
				if (fragment.source.startsWith("skills/")) {
					expect(
						fragment.origin,
						`${surface} claims a skill source for compiler-owned text`,
					).toBe("skill-source");
				}
			}
			expect(
				measureCompiledPrompt(compiled).roleInapplicableLines,
				`${surface} contains text that grants a role-inapplicable capability`,
			).toBe(0);
		}
		for (const surface of [
			"flow-evidence-worker",
			"flow-validation-worker",
			"flow-audit-worker",
			"flow-candidate-worker",
			"flow-verifier-worker",
		] as const) {
			const purpose = surfaces[surface].fragments.filter(
				(fragment) => fragment.kind === "purpose",
			);
			expect(
				purpose,
				`${surface} has one canonical role contract`,
			).toHaveLength(1);
			expect(purpose[0]?.origin).toBe("skill-source");
			expect(purpose[0]?.source).toContain(
				"skills/flow/references/parallel-execution.md#flow-prompt:worker-role-",
			);
		}

		for (const [surface, compiled] of Object.entries(
			compiledFlowPromptSurfaces("baseline"),
		)) {
			for (const fragment of compiled.fragments) {
				expect(
					fragment.roles,
					`${surface} baseline includes role-inapplicable fragment ${fragment.id}`,
				).toContain(compiled.role);
			}
		}
	});

	test("bookends manager prompts without repeating the complete contract", () => {
		const surfaces = compiledFlowPromptSurfaces();
		for (const surface of ["flow-auto", "flow-plan", "flow-run"] as const) {
			const compiled = surfaces[surface];
			expect(compiled.fragments[0]?.kind).toBe("invariant");
			expect(compiled.fragments.at(-1)?.kind).toBe("checkpoint");
			expect(compiled.text).toContain(
				'Call `flow_status { request: { view: "compact" } }` first',
			);
			expect(compiled.text).toContain("`workflowData.projection`");
			expect(compiled.text).toContain(
				"Only the root manager may call state-changing `flow_*` tools",
			);
			expect(compiled.text).not.toContain(
				"## Bundled flow-plan/references/planning-examples.md",
			);
			expect(compiled.text).not.toContain(
				"## Bundled flow/references/handoff-format.md",
			);
		}
		for (const surface of ["flow-auto", "flow-run"] as const) {
			expect(surfaces[surface].text).toContain("Public reviewer routing");
			expect(surfaces[surface].text).toContain("reserved `flow-reviewer`");
			expect(surfaces[surface].text).toContain("flow_review_start");
			expect(surfaces[surface].text).toContain(
				"`flow-run` remains the candidate-implementation manager entry route",
			);
			expect(surfaces[surface].text).toMatch(
				/never route the user's feature request directly to\s+it/,
			);
		}
	});

	test("compiles concrete harness runtime contracts without model-authored evidence", () => {
		const surfaces = compiledFlowPromptSurfaces();
		const compact = (text: string) => text.replace(/\s+/g, " ");
		const plan = compact(surfaces["flow-plan"].text);
		const run = compact(surfaces["flow-run"].text);
		const validationWorker = compact(surfaces["flow-validation-worker"].text);
		const auditWorker = compact(surfaces["flow-audit-worker"].text);
		const reviewer = compact(surfaces["flow-reviewer"].text);

		expect(run).toContain("flow_validation_start");
		expect(run).toContain("Run that exact Bash command next");
		expect(run).toContain("[flow-validation-receipt]");
		expect(run).toContain("validationRefs");
		expect(run).not.toContain('"validations"');
		expect(run).not.toContain('"startedAt"');
		expect(run).not.toContain('"outputDigest"');
		expect(validationWorker).toContain("flow_validation_start");
		expect(validationWorker).toContain("immutable receipt ref");
		expect(validationWorker).toContain(
			"Never author validation times, exit status, output digests",
		);

		expect(plan).toContain("trusted active runtime-profile footer");
		expect(plan).toContain("default to `standard` only when it is absent");
		expect(plan).toContain(
			"`control` preserves legacy optional-worker behavior without admission ceremony",
		);
		expect(plan).toContain(
			"Runtime validation receipts remain mandatory in every profile",
		);
		expect(plan).toContain("flow_orchestration_admit");
		for (const mapping of [
			"`discovery` -> `flow-evidence-worker`",
			"`audit` -> `flow-audit-worker`",
			"`verification` -> `flow-verifier-worker`",
			"`candidate-implementation` -> `flow-candidate-worker`",
		]) {
			expect(plan).toContain(mapping);
		}
		expect(plan).toContain(
			"Mandatory `flow-reviewer` assignments are assignment-gated",
		);
		expect(plan).toContain("`flow-validation-worker` checks are receipt-gated");

		expect(auditWorker).toContain('version: "audit-ledger/v1"');
		for (const enumValue of [
			"source_proven",
			"invariant_only",
			"adversarial_local",
			"not_deployed",
			"measure_first",
			"fix_now",
			"informational",
		]) {
			expect(auditWorker).toContain(enumValue);
		}
		expect(auditWorker).toContain("flow_audit_render");
		expect(auditWorker).toContain("canonical Markdown");
		expect(reviewer).toContain("correctionOfAssignmentId");
		expect(reviewer).toContain("runtime-returned predecessor id");
		expect(reviewer).toContain("correctionScopeHint");
		expect(run).toContain("correctionScopeHint");
		expect(run).toContain("public-contract");
		expect(run).toContain("cross-layer");
		expect(run).toContain("cannot request narrow mode");
		expect(run).toContain("more specific runtime fallback reason wins");
		expect(run).toContain("never start a third review");
	});

	test("keeps lifecycle examples on strict nested request contracts", () => {
		const surfaces = compiledFlowPromptSurfaces();
		const current = [
			surfaces["flow-auto"].text,
			surfaces["flow-plan"].text,
			surfaces["flow-run"].text,
			surfaces["flow-reviewer"].text,
		].join("\n");

		expect(current).toContain('flow_status { request: { view: "compact" } }');
		expect(current).toMatch(
			/flow_status \{ (?:"request"|request): \{ (?:"view"|view): "reviewer", (?:"assignmentId"|assignmentId):/,
		);
		expect(current).toContain('mode: "retry"');
		expect(current).toContain("closure.retryOperationId");
		for (const surface of ["flow-auto", "flow-run"] as const) {
			expect(surfaces[surface].text).toContain(
				"finalReviewRetry.prerequisite.result",
			);
		}
		expect(surfaces["flow-reviewer"].text).not.toContain(
			"finalReviewRetry.prerequisite",
		);
		for (const surface of ["flow-auto", "flow-plan"] as const) {
			expect(surfaces[surface].text).toContain("same-goal draft");
			expect(surfaces[surface].text).toContain("deferred");
			expect(surfaces[surface].text).toContain("abandoned");
		}
		expect(current).not.toMatch(/flow_status\s*\{\s*(?:["']?view["']?\s*:)/i);
		expect(current).not.toMatch(/original close envelope/i);
		expect(current).not.toMatch(/carrying that same feature result/i);
	});

	test("detects reordered flat lifecycle examples with one shared audit", () => {
		const flatExamples = [
			{
				tool: "flow_status",
				topLevelField: "sinceRevision",
				text: 'Call flow_status {\n  sinceRevision: 4, view: "detail"\n}',
			},
			{
				tool: "flow_review_start",
				topLevelField: "featureId",
				text: 'Call flow_review_start({\n  featureId: "changed-feature"\n})',
			},
			{
				tool: "flow_feature_complete",
				topLevelField: "expectedSnapshotId",
				text: 'Call flow_feature_complete {\n  expectedSnapshotId: "sha256:...", result: {}\n}',
			},
			{
				tool: "flow_session_close",
				topLevelField: "expectedRevision",
				text: 'Call flow_session_close {\n  expectedRevision: 8, mode: "start"\n}',
			},
		] as const;

		for (const example of flatExamples) {
			expect(auditLifecycleFlatRequestExamples(example.text)).toEqual([
				{
					tool: example.tool,
					line: 1,
					topLevelField: example.topLevelField,
				},
			]);
			expect(
				auditLifecycleFlatRequestExamples(
					`${example.tool} { request: {}, ${example.topLevelField}: "legacy" }`,
				),
			).toEqual([
				{
					tool: example.tool,
					line: 1,
					topLevelField: example.topLevelField,
				},
			]);
			expect(
				auditLifecycleFlatRequestExamples(
					`Call \`${example.tool}\` with \`{ ${example.topLevelField}: "legacy" }\``,
				),
			).toEqual([
				{
					tool: example.tool,
					line: 1,
					topLevelField: example.topLevelField,
				},
			]);
		}

		expect(
			auditLifecycleFlatRequestExamples(
				[
					'flow_status { request: { view: "compact" } }',
					'flow_review_start({ "request": { "reviewKind": "feature" } })',
					"flow_feature_complete { request: { ...guards, result } }",
					'flow_session_close { request: { mode: "retry", operationId } }',
					'Call `flow_status` with `{ request: { view: "compact" } }`',
					'Call `flow_review_start` with `{ request: { reviewKind: "feature" } }`',
					"Call `flow_feature_complete` with `{ request: { ...guards, result } }`",
					'Call `flow_session_close` with `{ request: { mode: "retry", operationId } }`',
				].join("\n"),
			),
		).toEqual([]);
	});

	test("keeps active documentation and plans on nested lifecycle examples", async () => {
		const documentationFiles = [
			"README.md",
			"CONTEXT.md",
			"CHANGELOG.md",
			...(
				await Promise.all(LIFECYCLE_DOCUMENTATION_ROOTS.map(textDocumentsBelow))
			).flat(),
		].sort();
		expect(documentationFiles).toContain(
			"docs/plan/session-v4-lifecycle-hardening-plan.md",
		);
		expect([...HISTORICAL_LIFECYCLE_EXAMPLE_FILES]).toEqual(["CHANGELOG.md"]);

		const violations: string[] = [];
		for (const path of documentationFiles) {
			if (HISTORICAL_LIFECYCLE_EXAMPLE_FILES.has(path)) continue;
			const content = await readFile(path, "utf8");
			for (const violation of auditLifecycleFlatRequestExamples(content)) {
				violations.push(
					`${path}:${violation.line} ${violation.tool} exposes ${violation.topLevelField ?? "an empty object"} outside request`,
				);
			}
		}
		expect(violations).toEqual([]);
	});

	test("compiles one compact to execution continuation contract", () => {
		const surfaces = compiledFlowPromptSurfaces();
		for (const surface of ["flow-auto", "flow-run"] as const) {
			const text = surfaces[surface].text.replace(/\s+/g, " ");
			expect(text).not.toContain("workflowData.session");
			expect(text).toContain("`projection.closure.retryOperationId`");
			expect(text).toMatch(/receipt only acknowledges/i);

			const compact = text.indexOf(
				'Call `flow_status { request: { view: "compact" } }`',
			);
			const start = text.indexOf("When ready, call `flow_run_start`", compact);
			const execution = text.indexOf(
				'call `flow_status { request: { view: "execution" } }`',
				start,
			);
			const refresh = text.indexOf(
				'Immediately call `flow_status { request: { view: "compact" } }` after the feature outcome',
				execution,
			);
			for (const [label, index] of [
				["compact", compact],
				["conditional start", start],
				["execution", execution],
				["compact refresh", refresh],
			] as const) {
				expect(index, `${surface} includes ${label}`).toBeGreaterThanOrEqual(0);
			}
			expect(compact).toBeLessThan(start);
			expect(start).toBeLessThan(execution);
			expect(execution).toBeLessThan(refresh);
		}

		expect(surfaces["flow-auto"].text.replace(/\s+/g, " ")).toContain(
			"start the next ready feature and load execution",
		);
		expect(surfaces["flow-run"].text.replace(/\s+/g, " ")).toContain(
			"without starting another feature",
		);
	});

	test("keeps economy review ordering and lifecycle terminology deterministic", () => {
		const surfaces = compiledFlowPromptSurfaces();
		const economySequence =
			"targeted validation -> feature assignment/review -> one authorized bounded repair/retry if needed -> broad validation after the last functional edit -> final assignment created with the exact passing feature-assignment result -> final review -> one atomic flow_feature_complete carrying only the final-assignment result";
		for (const surface of ["flow-auto", "flow-run"] as const) {
			const text = surfaces[surface].text.replace(/\s+/g, " ");
			expect(text).toContain(economySequence);
			let cursor = text.indexOf(economySequence);
			for (const stage of [
				"targeted validation",
				"feature assignment/review",
				"one authorized bounded repair/retry if needed",
				"broad validation after the last functional edit",
				"final assignment created with the exact passing feature-assignment result",
				"final review",
				"one atomic flow_feature_complete carrying only the final-assignment result",
			]) {
				const next = text.indexOf(stage, cursor);
				expect(next, `${surface} orders ${stage}`).toBeGreaterThanOrEqual(
					cursor,
				);
				cursor = next + stage.length;
			}
			expect(text).toContain(
				"The final feature's active execution may remain `in_progress` while awaiting review; this is not a blocker.",
			);
			expect(text).toContain(
				"Never start final review before the feature review has passed in economy order.",
			);
			expect(text).toContain(
				"call `flow_review_start` before dispatching review",
			);
			expect(text).toMatch(
				/The runtime[\s\S]{0,100}records current source identity/i,
			);
		}

		const manager = surfaces["flow-run"].text.replace(/\s+/g, " ");
		const reviewer = surfaces["flow-reviewer"].text.replace(/\s+/g, " ");
		for (const field of [
			"assignmentId",
			"verdict",
			"findings",
			"completedAt",
			"terminalDisposition",
		]) {
			expect(manager, `manager guidance includes ${field}`).toContain(field);
			expect(reviewer, `reviewer guidance includes ${field}`).toContain(field);
		}
		for (const taxonomy of [
			"implementation_defect",
			"regression_coverage_gap",
			"evidence_gap",
			"advisory",
		]) {
			expect(manager).toContain(taxonomy);
			expect(reviewer).toContain(taxonomy);
		}
		expect(manager).toContain("observed_unsubmitted");
		expect(reviewer).toContain("observed_unsubmitted");
		expect(manager).toContain("Neither manager nor reviewer invents attempt");
		expect(reviewer).toContain("Do not return attempt");
	});

	test("gives each hidden worker one applicable schema with deterministic validation", () => {
		const surfaces = compiledFlowPromptSurfaces();
		for (const [surface, kind] of Object.entries(WORKER_HANDOFF_KINDS)) {
			const compiled = surfaces[surface as keyof typeof surfaces];
			const schemas = compiled.fragments.filter(
				(fragment) => fragment.kind === "schema",
			);
			expect(
				schemas,
				`${surface} must have exactly one handoff schema`,
			).toHaveLength(1);
			const schema = schemas[0];
			if (!schema || !kind) continue;
			expect(schema.roles).toEqual([compiled.role]);
			const valid = validHandoffFromSchema(schema.text);
			expect(validateFlowWorkerHandoff(kind, valid)).toEqual({
				ok: true,
				errors: [],
			});
			expect(validateFlowWorkerHandoff(kind, "").ok).toBe(false);
			expect(validateFlowWorkerHandoff(kind, "free-form success").ok).toBe(
				false,
			);
			expect(
				validateFlowWorkerHandoff(
					kind,
					valid.replace(
						"## Status\nsuccess",
						"## Status\nsuccess | partial | blocked",
					),
				).ok,
			).toBe(false);
			expect(
				validateFlowWorkerHandoff(kind, `${valid}\n## Status\nsuccess`).errors,
			).toContain("duplicate heading: Status");
			const emptyBodies = validateFlowWorkerHandoff(
				kind,
				emptyBodyHandoffFromSchema(schema.text),
			);
			expect(emptyBodies.ok).toBe(false);
			expect(
				emptyBodies.errors.some((error) => error.startsWith("empty section:")),
			).toBe(true);
			const unresolvedPlaceholder = validateFlowWorkerHandoff(
				kind,
				valid.replace("covered", "<missing>"),
			);
			expect(unresolvedPlaceholder.ok).toBe(false);
			expect(
				unresolvedPlaceholder.errors.some((error) =>
					error.startsWith("unresolved placeholder"),
				),
			).toBe(true);
			for (const suffix of [":", ";"]) {
				const punctuatedPlaceholder = validateFlowWorkerHandoff(
					kind,
					valid.replace("covered", `<missing>${suffix}`),
				);
				expect(punctuatedPlaceholder.ok).toBe(false);
				expect(
					punctuatedPlaceholder.errors.some((error) =>
						error.startsWith("unresolved placeholder"),
					),
				).toBe(true);
			}
			const genericType = validateFlowWorkerHandoff(
				kind,
				valid.replace("covered", "Map<string, number>"),
			);
			expect(genericType.ok).toBe(true);
		}
	});

	test("keeps parallel guidance progressively disclosed", async () => {
		const [index, decision, manifest, execution, synthesis, flowSkill] =
			await Promise.all([
				readFile("skills/flow/references/parallel-orchestration.md", "utf8"),
				readFile("skills/flow/references/parallel-decision.md", "utf8"),
				readFile("skills/flow/references/parallel-manifest.md", "utf8"),
				readFile("skills/flow/references/parallel-execution.md", "utf8"),
				readFile("skills/flow/references/parallel-synthesis.md", "utf8"),
				readFile("skills/flow/SKILL.md", "utf8"),
			]);

		expect(index.split(/\r?\n/).length).toBeLessThan(80);
		expect(index).toContain("## Load only the selected branch");
		expect(index).toContain("The decision reference is enough");
		expect(index).not.toContain("## Permission contract");
		expect(index).not.toContain("## Synthesize");
		expect(decision.split(/\r?\n/).length).toBeLessThan(150);
		expect(manifest.split(/\r?\n/).length).toBeLessThan(100);
		expect(execution.split(/\r?\n/).length).toBeLessThan(150);
		expect(synthesis.split(/\r?\n/).length).toBeLessThan(150);
		expect(decision).toContain("## Implementation pass decision");
		expect(manifest).toContain("## Write the manifest");
		expect(execution).toContain("## Permission contract");
		expect(synthesis).toContain("## Extend or stop");
		for (const reference of [
			"parallel-decision.md",
			"parallel-manifest.md",
			"parallel-execution.md",
			"parallel-synthesis.md",
		]) {
			expect(flowSkill).toContain(`references/${reference}`);
		}
	});
});
