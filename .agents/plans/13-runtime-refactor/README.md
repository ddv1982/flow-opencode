# Flow Runtime Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the places where two copies of a rule can disagree, cut boilerplate in the application layer, split the two files that mix concerns, and turn the auto-drive routing into a pure decision function, all without changing any prompt text, tool contract, or the Session v5 document shape.

**Architecture:** The runtime is layered `domain` → `application` → `infrastructure` → `platform/opencode`, enforced by `tests/architecture-boundaries.test.ts`. Every task here is a behavior-preserving refactor: the existing 1220 tests are the safety net, and each task ends with the full suite green. New shared functions are introduced first with their own tests, then wired into both existing callers, so the callers cannot drift apart again.

**Tech Stack:** TypeScript 7 (strict, `exactOptionalPropertyTypes`, `noUnusedLocals`), Bun 1.3.14 test runner, Biome 2 lint/format, Zod 4.

**Spec:** This plan is derived from the review conversation of 2026-09-15. The recommendations it implements are restated in each phase header.

## Global Constraints

- No task changes any string under `skills/`, `src/prompt-surfaces.ts`, or `src/guidance/`. Prompt text is frozen so the scenario evals stay valid.
- No task changes the Session v5 document shape, any Zod input schema, any tool name, or any tool response field. Only internal structure moves.
- No task changes an error message string that an existing test asserts on. When in doubt, keep the message.
- Every task ends with `bun run typecheck && bun run lint && bun test tests` green. Phase ends additionally run `bun run check`.
- `tests/architecture-boundaries.test.ts` requires every `src` export to be imported by at least one other file in `src`, `tests`, `scripts`, or `evals`. A new export must have a consumer in the same task.
- Domain files may import only domain files. Application files may import domain and application. Infrastructure may import domain, application, infrastructure. `platform/opencode` is unconstrained except that only `src/platform/opencode/sdk.ts` may import `@opencode-ai/*`.
- Commit messages use the repository's Conventional Commits style: `refactor(<area>): <imperative summary>`. End every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Work on a branch off `main`, one branch per phase, one PR per phase. Do not commit to `main` directly.
- Format with `bunx biome format --write <files>` before each commit; the lint step fails on formatting.

---

## Phase 0: Unblock

Retire the byte budget in the architecture test so the later splits (which add import lines) do not fight a ceiling, and clear two trivial nits.

### Task 1: Retire the source byte budget

The budget has been raised six times with a paragraph each time and has not prevented growth. Keep the 1,000-line per-file limit, the layer rule, the export rule, and the SDK seam. Remove the byte constants, the raise log, and the picker/server byte partitions.

**Files:**
- Modify: `tests/architecture-boundaries.test.ts:9-75` (constants and comment block) and `:159-200` (the budget test)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing new. Deletes `FROZEN_TYPESCRIPT_SOURCE_BYTES`, `PROCESS_LOCAL_CONFIG_AND_STATUS_BYTES`, `MAX_TYPESCRIPT_SOURCE_BYTES`, `PLANNING_SPECIALIST_ADAPTER_BYTES`, `FROZEN_MODEL_PICKER_SOURCE_BYTES`, `SHARED_MODEL_MENU_BYTES`.

- [ ] **Step 1: Delete the byte constants and their comment log**

Remove lines 9 through 73 of `tests/architecture-boundaries.test.ts` (the block starting `/**` above `FROZEN_TYPESCRIPT_SOURCE_BYTES` down to and including `const SHARED_MODEL_MENU_BYTES = 1024;`). Keep `const MAX_TYPESCRIPT_FILE_LINES = 1_000;`.

- [ ] **Step 2: Replace the budget test with a line-limit-only test**

Replace the whole test `"keeps TypeScript source within its budget and each file within 1,000 lines"` with:

```ts
	test("keeps each TypeScript source file within 1,000 lines", async () => {
		const files = await sourceFiles();
		const oversized: string[] = [];
		for (const path of files) {
			const source = await readFile(path, "utf8");
			if (source.split("\n").length > MAX_TYPESCRIPT_FILE_LINES)
				oversized.push(relative(sourceRoot, path));
		}
		expect(oversized).toEqual([]);
	});
```

Also delete the two-line comment above the old test that begins `// The size is in the constant, not the title`.

- [ ] **Step 3: Run the test file**

Run: `bun test tests/architecture-boundaries.test.ts`
Expected: PASS, and the output no longer prints a `src TypeScript: ... bytes` line.

- [ ] **Step 4: Run lint and typecheck**

Run: `bun run typecheck && bun run lint`
Expected: both exit 0. If Biome reports an unused import (`join` or `stat` may become unused), remove it.

- [ ] **Step 5: Commit**

```bash
git add tests/architecture-boundaries.test.ts
git commit -m "refactor(tests): retire the source byte budget, keep the line limit

The budget was raised six times and did not hold. The per-file line limit,
layer rule, export rule, and SDK seam remain.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2: Renumber the duplicate ADR and drop the unused tool parameter

**Files:**
- Rename: `docs/adr/0014-terminal-capacity.md` → `docs/adr/0015-terminal-capacity.md`
- Modify: `src/platform/opencode/tools.ts:114` (`createTools` signature)
- Modify: `src/platform/opencode/plugin.ts:328` (the `createTools(ctx, {...})` call)
- Modify: `tests/opencode-schema-contract.test.ts:42` and `:482`, `tests/workspace-lifecycle-integration.test.ts:193`, `tests/distribution-and-surface.test.ts:47` (each calls `createTools(<ctx>, {...})`; drop the first argument)

**Interfaces:**
- Produces: `createTools(options: ToolOptions): FlowTools` (first parameter removed).

- [ ] **Step 1: Rename the ADR and fix its heading**

```bash
git mv docs/adr/0014-terminal-capacity.md docs/adr/0015-terminal-capacity.md
```

Change the first line of the renamed file from `# ADR 0014: Terminal capacity` to `# ADR 0015: Terminal capacity`.

- [ ] **Step 2: Confirm nothing links to the old path**

Run: `grep -rn "0014-terminal-capacity" docs CONTEXT.md README.md src skills`
Expected: no output. (If any appear, update them to `0015-terminal-capacity.md`.)

- [ ] **Step 3: Remove the unused parameter**

In `src/platform/opencode/tools.ts` change

```ts
export function createTools(_ctx: unknown, options: ToolOptions): FlowTools {
```

to

```ts
export function createTools(options: ToolOptions): FlowTools {
```

In `src/platform/opencode/plugin.ts` change `const tools = createTools(ctx, {` to `const tools = createTools({`.

In each of the four test call sites listed under Files, delete the first argument so the call reads `createTools({ ... })`. Run `grep -rn "createTools(" tests` afterwards; every hit must show an object literal or options variable as the sole argument.

- [ ] **Step 4: Run the documentation contract and the affected tests**

Run: `bun run typecheck && bun test tests/documentation-contract.test.ts tests/distribution-and-surface.test.ts tests/opencode-schema-contract.test.ts tests/workspace-lifecycle-integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/adr src/platform/opencode/tools.ts src/platform/opencode/plugin.ts tests
git commit -m "chore: renumber the duplicate ADR 0014 and drop an unused tool parameter

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 6: Phase gate**

Run: `bun run check`
Expected: exit 0. Open the Phase 0 PR.

---

## Phase 1: One source of truth in the domain

The guard in `startReview` and the `nextAction` projection each derive "is review possible now" independently. The evidence rules in `validation.ts` rescan observations three ways. Whole-document invariants exist but are only run at parse time. This phase gives each rule one home.

### Task 3: Move session queries out of `transitions.ts`

`activeRun`, `isFeatureComplete`, `sessionStatus`, and `nextRunnableFeature` are read-only queries that `session-invariants.ts`, `session-projection.ts`, `delivery.ts`, `session-close.ts`, `prepare-validation.ts`, and `flow-service.ts` all import from the mutation module. Task 6 needs `transitions.ts` to import the invariants, which would create a cycle. Moving the queries first breaks it.

**Files:**
- Create: `src/domain/session-queries.ts`
- Modify: `src/domain/transitions.ts` (remove the four functions and `requiresExplicitRetry`, `isFinalFeatureRun`; import them)
- Modify: `src/domain/session-invariants.ts:8`
- Modify: `src/application/session-projection.ts:24-29`
- Modify: `src/application/delivery.ts:8`
- Modify: `src/application/flow-service.ts:9-19`
- Modify: `src/application/prepare-validation.ts:12`
- Modify: `tests/domain-transitions.test.ts:24-36`
- Test: `tests/domain-transitions.test.ts` (existing tests cover behavior; only imports change)

**Interfaces:**
- Produces, in `src/domain/session-queries.ts`:
  - `activeRun(session: Session): FeatureRun | null`
  - `isFeatureComplete(session: Session, featureId: string): boolean`
  - `sessionStatus(session: Session): SessionStatus`
  - `nextRunnableFeature(session: Session): FeatureId | null`
  - `isFinalFeatureRun(session: Session, run: FeatureRun): boolean`
  - (`requiresExplicitRetry` moves too but stays module-private; the architecture test rejects an export nothing imports.)

- [ ] **Step 1: Create the queries module**

Create `src/domain/session-queries.ts`:

```ts
import type {
	FeatureId,
	FeatureRun,
	Session,
	SessionStatus,
} from "./session.js";
import { currentRun } from "./session.js";

export function activeRun(session: Session): FeatureRun | null {
	return session.runs.find((run) => run.state === "active") ?? null;
}

export function isFeatureComplete(
	session: Session,
	featureId: string,
): boolean {
	return currentRun(session, featureId)?.state === "completed";
}

export function sessionStatus(session: Session): SessionStatus {
	if (session.closure) return "closed";
	if (!session.plan || session.approval === "pending") return "planning";
	if (activeRun(session)) return "running";
	if (
		session.plan.features.some(
			(feature) => currentRun(session, feature.id)?.state === "blocked",
		)
	) {
		return "blocked";
	}
	if (
		session.plan.features.every((feature) =>
			isFeatureComplete(session, feature.id),
		)
	) {
		return "completed";
	}
	return "ready";
}

/** True when the feature's latest reviewed run failed, so it needs an explicit retry. */
function requiresExplicitRetry(
	session: Session,
	featureId: FeatureId,
): boolean {
	const reviewed = session.runs.findLast(
		(run) => run.featureId === featureId && run.reviews.at(-1)?.result,
	);
	return reviewed?.reviews.at(-1)?.result?.verdict === "failed";
}

export function nextRunnableFeature(session: Session): FeatureId | null {
	if (!session.plan) return null;
	for (const feature of session.plan.features) {
		const state = currentRun(session, feature.id)?.state;
		if (state === "completed") continue;
		if (state === "blocked") continue;
		if (requiresExplicitRetry(session, feature.id)) continue;
		if (feature.dependsOn.every((id) => isFeatureComplete(session, id))) {
			return feature.id;
		}
	}
	return null;
}

/** True when every other planned feature is already complete. */
export function isFinalFeatureRun(session: Session, run: FeatureRun): boolean {
	if (!session.plan) return false;
	return session.plan.features.every(
		(feature) =>
			feature.id === run.featureId || isFeatureComplete(session, feature.id),
	);
}
```

- [ ] **Step 2: Remove the same functions from `transitions.ts` and import them**

In `src/domain/transitions.ts` delete the function bodies of `activeRun`, `isFeatureComplete`, `sessionStatus`, `requiresExplicitRetry`, `nextRunnableFeature`, and `isFinalFeatureRun`. Add to the import block:

```ts
import {
	activeRun,
	isFeatureComplete,
	isFinalFeatureRun,
	nextRunnableFeature,
	sessionStatus,
} from "./session-queries.js";
```

`requiresExplicitRetry` is used only by `nextRunnableFeature`, so `transitions.ts` does not need to import it.

- [ ] **Step 3: Repoint every importer**

In each of these files, move the named imports `activeRun`, `isFeatureComplete`, `sessionStatus`, `nextRunnableFeature` from `transitions.js` to `session-queries.js`. Keep any other names (`FlowTransitionError`, `recordValidation`, `savePlan`, etc.) on `transitions.js`.

- `src/domain/session-invariants.ts`: `import { isFeatureComplete } from "./session-queries.js";`
- `src/application/session-projection.ts`: `import { activeRun, isFeatureComplete, nextRunnableFeature, sessionStatus } from "../domain/session-queries.js";`
- `src/application/delivery.ts`: `import { isFeatureComplete } from "../domain/session-queries.js";`
- `src/application/flow-service.ts`: `import { activeRun } from "../domain/session-queries.js";` and remove `activeRun` from the `transitions.js` import.
- `src/application/prepare-validation.ts`: `import { activeRun } from "../domain/session-queries.js";` and `import { recordValidation } from "../domain/transitions.js";`
- `tests/domain-transitions.test.ts`: `import { sessionStatus } from "../src/domain/session-queries.js";` and remove `sessionStatus` from the `transitions.js` import.

- [ ] **Step 4: Typecheck to find any importer the grep missed**

Run: `bun run typecheck`
Expected: exit 0. If it reports `has no exported member 'activeRun'` (or any of the other names) on some file, repoint that file's import as in Step 3.

- [ ] **Step 5: Run the domain and application tests**

Run: `bun test tests/domain-transitions.test.ts tests/runtime-gates.test.ts tests/status-report.test.ts tests/session-invariants.test.ts tests/architecture-boundaries.test.ts`
Expected: PASS. The architecture test confirms every new export has a consumer.

- [ ] **Step 6: Commit**

```bash
bunx biome format --write src tests
git add src/domain/session-queries.ts src/domain/transitions.ts src/domain/session-invariants.ts src/application tests/domain-transitions.test.ts
git commit -m "refactor(domain): move read-only session queries out of transitions

Breaks the transitions -> invariants -> transitions cycle that running the
invariants inside commit() would otherwise create.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 4: One `reviewReadiness` function for the guard and the projection

`startReview` (transitions.ts) and `nextAction` (session-projection.ts) each compute whether the active run has fresh passing validation of the right scope, whether vetoed commands are outstanding, and whether declared evidence is satisfied for a final run. Extract one function that returns a discriminated result and have both call it.

**Files:**
- Create: `src/domain/review-readiness.ts`
- Create: `tests/review-readiness.test.ts`
- Modify: `src/domain/transitions.ts` (`startReview`, the block from `const unresolved = unresolvedVetoedCommands(...)` through the final-evidence `fail(...)`)
- Modify: `src/application/session-projection.ts` (`nextAction`, the block from `const finalRun = ...` to the end of the function)

**Interfaces:**
- Produces, in `src/domain/review-readiness.ts`:

```ts
export type ReviewReadiness =
	| Readonly<{ kind: "ready"; reviewKind: "feature" | "final"; applicable: ValidationObservation[] }>
	| Readonly<{ kind: "vetoed"; commands: string[] }>
	| Readonly<{ kind: "needs-validation"; reviewKind: "feature" | "final" }>
	| Readonly<{ kind: "evidence-unsatisfied"; entries: EvidenceEntry[] }>;

export function reviewReadiness(
	session: Session,
	run: FeatureRun,
	sourceDigest?: SourceDigest,
): ReviewReadiness;
```

When `sourceDigest` is omitted (the projection has no current digest), eligibility is judged without a digest match, exactly as `nextAction` does today.

- [ ] **Step 1: Write the failing tests**

Create `tests/review-readiness.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { reviewReadiness } from "../src/domain/review-readiness.js";
import { activeRun } from "../src/domain/session-queries.js";
import type { Session } from "../src/domain/session.js";
import { recordValidation } from "../src/domain/transitions.js";
import {
	deterministicEnvironment,
	MemorySessionRepository,
	OUTPUT,
	SOURCE_A,
	SOURCE_B,
	startSession,
} from "./runtime-test-support.js";

/** An approved single-feature plan with its one run active, via the real service. */
async function runningSession(): Promise<Session> {
	const repository = new MemorySessionRepository();
	await startSession(repository, deterministicEnvironment());
	if (!repository.session) throw new Error("expected an active session");
	return repository.session;
}

function withValidation(
	session: Session,
	options: Readonly<{ exitCode: number; scope: "focused" | "broad"; digest?: typeof SOURCE_A }>,
): Session {
	const run = activeRun(session);
	if (!run) throw new Error("expected an active run");
	return recordValidation(session, {
		captureId: `capture-${session.revision}`,
		featureId: run.featureId,
		runId: run.id,
		scope: options.scope,
		command: "bun test",
		sourceDigest: options.digest ?? SOURCE_A,
		exitCode: options.exitCode,
		outputDigest: OUTPUT,
		outputComplete: true,
		hostPlatform: "linux",
	}).session;
}

describe("reviewReadiness", () => {
	test("needs validation when the run has none", async () => {
		const session = await runningSession();
		const run = activeRun(session);
		if (!run) throw new Error("expected an active run");
		expect(reviewReadiness(session, run, SOURCE_A)).toEqual({
			kind: "needs-validation",
			reviewKind: "final",
		});
	});

	test("is ready after a passing broad observation for the current source", async () => {
		const session = withValidation(await runningSession(), {
			exitCode: 0,
			scope: "broad",
		});
		const run = activeRun(session);
		if (!run) throw new Error("expected an active run");
		const readiness = reviewReadiness(session, run, SOURCE_A);
		expect(readiness.kind).toBe("ready");
		if (readiness.kind !== "ready") return;
		expect(readiness.reviewKind).toBe("final");
		expect(readiness.applicable.map((v) => v.scope)).toEqual(["broad"]);
	});

	test("reports the vetoed command after a failed gate run", async () => {
		const session = withValidation(await runningSession(), {
			exitCode: 1,
			scope: "broad",
		});
		const run = activeRun(session);
		if (!run) throw new Error("expected an active run");
		expect(reviewReadiness(session, run, SOURCE_A)).toEqual({
			kind: "vetoed",
			commands: ["bun test"],
		});
	});

	test("needs validation again when the source moved after the pass", async () => {
		const session = withValidation(await runningSession(), {
			exitCode: 0,
			scope: "broad",
		});
		const run = activeRun(session);
		if (!run) throw new Error("expected an active run");
		expect(reviewReadiness(session, run, SOURCE_B)).toEqual({
			kind: "needs-validation",
			reviewKind: "final",
		});
	});
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `bun test tests/review-readiness.test.ts`
Expected: FAIL with `Cannot find module '../src/domain/review-readiness.js'`.

- [ ] **Step 3: Implement `reviewReadiness`**

Create `src/domain/review-readiness.ts`:

```ts
import type {
	EvidenceEntry,
	FeatureRun,
	Session,
	SourceDigest,
	ValidationObservation,
} from "./session.js";
import { isFinalFeatureRun } from "./session-queries.js";
import {
	isValidationEligible,
	isValidationFresh,
	unresolvedVetoedCommands,
	unsatisfiedEvidence,
} from "./validation.js";

type ReviewKind = "feature" | "final";

/**
 * Whether the active run can open its review right now, and if not, why.
 *
 * `startReview` refuses on anything but `ready`, and the status projection
 * routes `nextAction` from the same result, so the two can never disagree.
 */
export type ReviewReadiness =
	| Readonly<{
			kind: "ready";
			reviewKind: ReviewKind;
			applicable: ValidationObservation[];
	  }>
	| Readonly<{ kind: "vetoed"; commands: string[] }>
	| Readonly<{ kind: "needs-validation"; reviewKind: ReviewKind }>
	| Readonly<{ kind: "evidence-unsatisfied"; entries: EvidenceEntry[] }>;

export function reviewReadiness(
	session: Session,
	run: FeatureRun,
	sourceDigest?: SourceDigest,
): ReviewReadiness {
	const reviewKind: ReviewKind = isFinalFeatureRun(session, run)
		? "final"
		: "feature";
	const vetoed = unresolvedVetoedCommands(session, run, sourceDigest);
	if (vetoed.length > 0) return { kind: "vetoed", commands: vetoed };
	const applicable = run.validations.filter(
		(validation) =>
			isValidationEligible(validation, sourceDigest) &&
			isValidationFresh(session, run, validation),
	);
	const hasRequired =
		reviewKind === "feature"
			? applicable.length > 0
			: applicable.some((validation) => validation.scope === "broad");
	if (!hasRequired) return { kind: "needs-validation", reviewKind };
	if (reviewKind === "final") {
		const entries = unsatisfiedEvidence(session, sourceDigest);
		if (entries.length > 0) return { kind: "evidence-unsatisfied", entries };
	}
	return { kind: "ready", reviewKind, applicable };
}
```

Note the order: `startReview` today checks vetoes before validation presence, while `nextAction` checks validation presence first. For the projection both cases map to the same `flow_validation_start`, so only the guard's order is observable, and it is the one kept here. Step 5 preserves `startReview`'s error messages by mapping each result kind to its existing `fail(...)` string.

- [ ] **Step 4: Run the new tests**

Run: `bun test tests/review-readiness.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Use it in `startReview`**

In `src/domain/transitions.ts`, inside `startReview`, replace the block that begins `const unresolved = unresolvedVetoedCommands(session, run, input.sourceDigest);` and ends with the closing `}` of `if (kind === "final") { ... }` with:

```ts
	const readiness = reviewReadiness(session, run, input.sourceDigest);
	if (readiness.kind === "vetoed") {
		fail(
			`Review requires passing these exact commands for the current workspace content: ${readiness.commands.map((command) => JSON.stringify(command)).join(", ")}. A different command cannot discharge one that failed.`,
		);
	}
	if (readiness.kind === "needs-validation") {
		fail(
			readiness.reviewKind === "final"
				? "Final review requires passing broad validation for the current workspace content."
				: "Review requires passing validation for the current workspace content.",
		);
	}
	if (readiness.kind === "evidence-unsatisfied") {
		fail(
			`Final review requires the plan's declared evidence to pass for the current workspace content: ${readiness.entries
				.map((entry) => evidenceRefusal(session, entry, input.sourceDigest))
				.join(
					", ",
				)}. A substitute observation cannot discharge it. If the environment is unavailable, ask the user to choose deferred or abandoned closure.`,
		);
	}
	const kind = readiness.reviewKind;
	const applicable = readiness.applicable;
```

Add `import { reviewReadiness } from "./review-readiness.js";` and remove `isValidationEligible`, `isValidationFresh`, `unresolvedVetoedCommands`, `unsatisfiedEvidence` from the `./validation.js` import if nothing else in the file uses them (`evidenceRefusal` and `unsatisfiedEvidence` are still used by `closeSession`; keep those). Remove the `isFinalFeatureRun` import if it is now unused.

- [ ] **Step 6: Run the transition tests**

Run: `bun test tests/domain-transitions.test.ts tests/runtime-gates.test.ts`
Expected: PASS with no message changes, because the guard's check order was preserved.

- [ ] **Step 7: Use it in `nextAction`**

In `src/application/session-projection.ts`, inside `nextAction`, replace the block that begins `const finalRun = session.plan?.features.every(` and ends `return "flow_review_start";` with:

```ts
	const readiness = reviewReadiness(session, run);
	switch (readiness.kind) {
		case "needs-validation":
		case "vetoed":
			return "flow_validation_start";
		case "evidence-unsatisfied":
			return "await-user-direction";
		case "ready":
			return "flow_review_start";
	}
```

Add `import { reviewReadiness } from "../domain/review-readiness.js";`. Remove `isValidationEligible`, `isValidationFresh`, `unresolvedVetoedCommands`, `unsatisfiedEvidence` from the `../domain/validation.js` import if now unused in this file.

- [ ] **Step 8: Run the full suite**

Run: `bun run typecheck && bun run lint && bun test tests`
Expected: PASS, 0 fail.

- [ ] **Step 9: Commit**

```bash
bunx biome format --write src tests
git add src/domain/review-readiness.ts src/domain/transitions.ts src/application/session-projection.ts tests/review-readiness.test.ts
git commit -m "refactor(domain): derive review readiness once for guard and projection

startReview and nextAction computed the same freshness, veto, and final
evidence rules independently. One function now answers both.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 5: One `evidenceStatus` behind `unsatisfiedEvidence` and `evidenceRefusal`

`unsatisfiedEvidence` decides whether an entry is satisfied; `evidenceRefusal` re-derives why it is not to build a message. Replace both bodies with one classifier so the boolean and the message cannot diverge. The two exported signatures stay the same.

**Files:**
- Modify: `src/domain/validation.ts` (`evidenceRefusal`, `unsatisfiedEvidence`, add `evidenceStatus`)
- Create: `tests/evidence-status.test.ts`

**Interfaces:**
- Produces, in `src/domain/validation.ts`:

```ts
export type EvidenceStatus =
	| Readonly<{ kind: "satisfied" }>
	| Readonly<{ kind: "wrong-host"; hosts: string[] }>
	| Readonly<{ kind: "unmet-cases"; cases: string[] }>
	| Readonly<{ kind: "missing" }>;

export function evidenceStatus(
	session: Session,
	entry: EvidenceEntry,
	sourceDigest?: SourceDigest,
): EvidenceStatus;
```

- [ ] **Step 1: Write the failing tests**

Create `tests/evidence-status.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type {
	EvidenceEntry,
	Session,
	ValidationObservation,
} from "../src/domain/session.js";
import {
	evidenceRefusal,
	evidenceStatus,
	unsatisfiedEvidence,
} from "../src/domain/validation.js";
import { OUTPUT, SOURCE_A } from "./runtime-test-support.js";

const GATE = "bun test --reporter=junit --reporter-outfile=.flow/results.xml";

const entry: EvidenceEntry = {
	requirement: "Repository suite",
	environment: "linux CI",
	command: GATE,
	scope: "gate",
	platform: "linux",
	assertions: ["suite > passes"],
};

function observation(
	overrides: Partial<ValidationObservation>,
): ValidationObservation {
	return {
		id: "capture-1",
		featureId: "feature",
		runId: "run-1",
		scope: "broad",
		command: GATE,
		sourceDigest: SOURCE_A,
		exitCode: 0,
		outputDigest: OUTPUT,
		outputComplete: true,
		recordedRevision: 3,
		hostPlatform: "linux",
		resultsPath: ".flow/results.xml",
		observedAssertions: [{ name: "suite > passes", status: "passed" }],
		...overrides,
	};
}

function session(observations: ValidationObservation[]): Session {
	return {
		version: 5,
		id: "session",
		revision: 4,
		goal: "goal",
		approval: "approved",
		plan: {
			summary: "s",
			overview: "o",
			requirements: [],
			decisions: [],
			features: [
				{
					id: "feature",
					title: "t",
					summary: "s",
					targets: [],
					validation: [],
					dependsOn: [],
				},
			],
			evidence: [entry],
		},
		runs: [
			{
				id: "run-1",
				featureId: "feature",
				attempt: 1,
				state: "active",
				startedRevision: 2,
				summary: null,
				artifactsChanged: [],
				validations: observations,
				reviews: [],
			},
		],
		operations: [],
		closure: null,
	};
}

describe("evidenceStatus", () => {
	test("is satisfied by a passing observation on the declared host with the declared cases", () => {
		const s = session([observation({})]);
		expect(evidenceStatus(s, entry, SOURCE_A)).toEqual({ kind: "satisfied" });
		expect(unsatisfiedEvidence(s, SOURCE_A)).toEqual([]);
	});

	test("is missing when nothing ran the command", () => {
		const s = session([]);
		expect(evidenceStatus(s, entry, SOURCE_A)).toEqual({ kind: "missing" });
		expect(unsatisfiedEvidence(s, SOURCE_A)).toEqual([entry]);
		expect(evidenceRefusal(s, entry, SOURCE_A)).toContain("needs linux CI on linux");
	});

	test("names the wrong host when the pass ran elsewhere", () => {
		const s = session([observation({ hostPlatform: "darwin" })]);
		expect(evidenceStatus(s, entry, SOURCE_A)).toEqual({
			kind: "wrong-host",
			hosts: ["darwin"],
		});
		expect(evidenceRefusal(s, entry, SOURCE_A)).toContain("passed on darwin");
	});

	test("names the unmet cases when the report skipped them", () => {
		const s = session([
			observation({
				observedAssertions: [{ name: "suite > passes", status: "skipped" }],
			}),
		]);
		// `unmetAssertions` reports the quoted name plus the status it saw.
		expect(evidenceStatus(s, entry, SOURCE_A)).toEqual({
			kind: "unmet-cases",
			cases: ['"suite > passes" skipped'],
		});
		expect(evidenceRefusal(s, entry, SOURCE_A)).toContain(
			'reported no passing result for "suite > passes" skipped',
		);
	});
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `bun test tests/evidence-status.test.ts`
Expected: FAIL with `evidenceStatus is not exported` (or `does not provide an export named 'evidenceStatus'`).

- [ ] **Step 3: Implement `evidenceStatus` and rewrite the two callers**

In `src/domain/validation.ts`, replace the existing `evidenceRefusal` and `unsatisfiedEvidence` functions with:

```ts
export type EvidenceStatus =
	| Readonly<{ kind: "satisfied" }>
	| Readonly<{ kind: "wrong-host"; hosts: string[] }>
	| Readonly<{ kind: "unmet-cases"; cases: string[] }>
	| Readonly<{ kind: "missing" }>;

/**
 * How one declared evidence entry stands against the recorded observations.
 * The boolean (`unsatisfiedEvidence`) and the message (`evidenceRefusal`) both
 * derive from this, so they cannot disagree about why an entry is unmet.
 */
export function evidenceStatus(
	session: Session,
	entry: EvidenceEntry,
	sourceDigest?: SourceDigest,
): EvidenceStatus {
	const eligible = session.runs
		.flatMap((run) => run.validations)
		.filter(
			(observation) =>
				observation.command === entry.command &&
				isObservedAtDeclaredPath(entry, observation) &&
				isValidationEligible(observation, sourceDigest),
		);
	const onHost = eligible.filter((observation) =>
		isObservedOnDeclaredPlatform(entry, observation),
	);
	if (
		onHost.some((observation) =>
			assertionsSatisfied(entry.assertions ?? [], observation.observedAssertions),
		)
	)
		return { kind: "satisfied" };
	// Latest right-host result determines which declared cases remain unmet.
	const unmet = onHost
		.toSorted((left, right) => left.recordedRevision - right.recordedRevision)
		.map((observation) =>
			unmetAssertions(entry.assertions ?? [], observation.observedAssertions),
		)
		.filter((names) => names.length > 0)
		.at(-1);
	const wrongHosts = [
		...new Set(
			eligible
				.filter(
					(observation) => !isObservedOnDeclaredPlatform(entry, observation),
				)
				.map((observation) => observation.hostPlatform ?? "an unrecorded host"),
		),
	];
	if (wrongHosts.length > 0) return { kind: "wrong-host", hosts: wrongHosts };
	if (unmet) return { kind: "unmet-cases", cases: unmet };
	return { kind: "missing" };
}

export function evidenceRefusal(
	session: Session,
	entry: EvidenceEntry,
	sourceDigest?: SourceDigest,
): string {
	const status = evidenceStatus(session, entry, sourceDigest);
	const needs =
		entry.platform === undefined || entry.platform === "other"
			? entry.environment
			: `${entry.environment} on ${entry.platform}`;
	const detail =
		status.kind === "wrong-host"
			? `passed on ${status.hosts.join(", ")} but this entry declares ${entry.platform}, so that run observed something else — a skipped case exits zero too`
			: status.kind === "unmet-cases"
				? `passed on ${entry.platform ?? "the declared host"} but reported no passing result for ${status.cases.join(", ")}; rerun the exact approved command so ${commandUsesManagedJUnitPath(entry.command) ? MANAGED_JUNIT_PATH : "a fresh resultsPath"} reports those cases passing`
				: `needs ${needs}`;
	return `${JSON.stringify(entry.command)} (${detail}, for ${entry.requirement})`;
}

export function unsatisfiedEvidence(
	session: Session,
	sourceDigest?: SourceDigest,
): EvidenceEntry[] {
	return planEvidence(session.plan).filter(
		(entry) => evidenceStatus(session, entry, sourceDigest).kind !== "satisfied",
	);
}
```

The previous `evidenceRefusal` preferred the wrong-host message over the unmet-cases message when both applied; the classifier above keeps that precedence.

- [ ] **Step 4: Run the new tests and the transition tests**

Run: `bun test tests/evidence-status.test.ts tests/domain-transitions.test.ts tests/runtime-close.test.ts tests/runtime-gates.test.ts`
Expected: PASS. `domain-transitions.test.ts` asserts on the exact refusal strings for wrong host and skipped cases; they must still pass unchanged.

- [ ] **Step 5: Run the full suite and commit**

Run: `bun run typecheck && bun run lint && bun test tests`
Expected: PASS.

```bash
bunx biome format --write src tests
git add src/domain/validation.ts tests/evidence-status.test.ts
git commit -m "refactor(domain): classify evidence status once for the check and the message

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 6: Run the whole-document invariants inside `commit`

`sessionInvariantIssues` runs only when a document is parsed from disk. Running it on every committed draft catches a transition bug at the moment it happens instead of on the next load. This adds a backstop; it does not delete any existing per-transition guard, because the guards own the user-facing messages that tests assert on.

**Files:**
- Modify: `src/domain/transitions.ts` (`commit`)
- Modify: `src/domain/validation.ts` (`recordValidation`, before `assertTerminalHeadroom(next)`)
- Test: `tests/domain-transitions.test.ts` (add one test)

**Interfaces:**
- Consumes: `sessionInvariantIssues(session: Session): string[]` from `src/domain/session-invariants.ts` (Task 3 removed the cycle).

- [ ] **Step 1: Write the failing test**

Append to `tests/domain-transitions.test.ts`, inside the top-level `describe`:

```ts
	test("commit refuses a draft that violates a whole-document invariant", () => {
		const environment: TransitionEnvironment = {
			newId: (kind) => `${kind}-invariant`,
		};
		const saved = savePlan(
			null,
			{
				operationId: "plan-save-invariant",
				expectedRevision: 0,
				goal: "Exercise the commit backstop",
				plan: {
					summary: "s",
					overview: "o",
					requirements: [],
					decisions: [],
					features: [
						{
							id: FOUNDATION,
							title: "t",
							summary: "s",
							targets: [],
							validation: [],
							dependsOn: [],
						},
					],
					evidence: repositoryEvidence(PLANNED_GATE),
				},
			},
			environment,
		).session;
		const approved = approvePlan(saved, {
			operationId: "plan-approve-invariant",
			expectedRevision: saved.revision,
		}).session;
		// Forge an active run so a second start would produce two. The existing
		// guard still owns this message; the backstop must not pre-empt it.
		const forged: Session = {
			...approved,
			runs: [
				{
					id: "run-forged",
					featureId: FOUNDATION,
					attempt: 1,
					state: "active",
					startedRevision: approved.revision,
					summary: null,
					artifactsChanged: [],
					validations: [],
					reviews: [],
				},
			],
		};
		expect(() =>
			startRun(
				forged,
				{ operationId: "run-start-invariant", expectedRevision: forged.revision },
				environment,
			),
		).toThrow("Only one feature run may be active.");
	});
```

This test documents that the existing guard message still wins over the invariant message when both apply. The backstop's own message is checked in Step 4.

- [ ] **Step 2: Add the backstop to `commit`**

In `src/domain/transitions.ts`, add `import { sessionInvariantIssues } from "./session-invariants.js";` and change the end of `commit` from

```ts
	if (kind !== "session-close") assertTerminalHeadroom(next);
	return next;
```

to

```ts
	if (kind !== "session-close") assertTerminalHeadroom(next);
	const issues = sessionInvariantIssues(next);
	if (issues.length > 0)
		fail(`Flow refused an inconsistent session: ${issues.join(" ")}`);
	return next;
```

- [ ] **Step 3: Add the same backstop to `recordValidation`**

In `src/domain/validation.ts`, `recordValidation`, after `assertTerminalHeadroom(next);` add:

```ts
	const issues = sessionInvariantIssues(next);
	if (issues.length > 0)
		throw new FlowTransitionError(
			`Flow refused an inconsistent session: ${issues.join(" ")}`,
		);
```

and add `import { sessionInvariantIssues } from "./session-invariants.js";`. Confirm no cycle: `session-invariants.ts` imports `isValidationEligible` from `validation.ts`, and `validation.ts` now imports from `session-invariants.ts`. ESM tolerates this because both imports are used only inside function bodies, but Biome's `noImportCycles` rule is not enabled here, so it will compile. If you prefer to avoid the cycle outright, move `isValidationEligible` into `session-queries.ts` in this step and repoint its importers (`validation.ts`, `session-invariants.ts`, `delivery.ts`, `review-readiness.ts`, `prepare-validation.ts`, `validation-capture.ts`).

- [ ] **Step 4: Add a direct test of the backstop message**

Append to `tests/domain-transitions.test.ts`:

```ts
	test("commit names the invariant it refused", () => {
		const environment: TransitionEnvironment = {
			newId: (kind) => `${kind}-backstop`,
		};
		const saved = savePlan(
			null,
			{
				operationId: "plan-save-backstop",
				expectedRevision: 0,
				goal: "Exercise the backstop message",
				plan: {
					summary: "s",
					overview: "o",
					requirements: [],
					decisions: [],
					features: [
						{
							id: FOUNDATION,
							title: "t",
							summary: "s",
							targets: [],
							validation: [],
							dependsOn: [],
						},
					],
					evidence: repositoryEvidence(PLANNED_GATE),
				},
			},
			environment,
		).session;
		// A revision that jumps backwards is something no guard checks but the
		// invariants do: operations must not claim a revision above the session's.
		const forged: Session = {
			...saved,
			operations: saved.operations.map((operation) => ({
				...operation,
				committedRevision: 99,
			})),
		};
		expect(() =>
			approvePlan(forged, {
				operationId: "plan-approve-backstop",
				expectedRevision: forged.revision,
			}),
		).toThrow("Flow refused an inconsistent session:");
	});
```

- [ ] **Step 5: Run the suite**

Run: `bun run typecheck && bun test tests`
Expected: PASS. The full suite is the real assertion here: if any existing transition produced a document the invariants reject, that test now fails and has found a latent bug. Fix the transition, not the invariant.

- [ ] **Step 6: Commit and phase gate**

```bash
bunx biome format --write src tests
git add src/domain/transitions.ts src/domain/validation.ts tests/domain-transitions.test.ts
git commit -m "refactor(domain): check whole-document invariants on every commit

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
bun run check
```

Expected: exit 0. Open the Phase 1 PR.

---

## Phase 2: Less ceremony in the application layer

### Task 7: A `mutate` helper in `flow-service.ts`

Every mutation method repeats: parse the schema, open a transaction, load, throw if absent, run a transition, save, wrap in `ok(...)` with `operationResult` and a projection, catch and wrap errors. Extract that spine once. `planSave` (session may be null), `reviewStart` (digest lookup), `featureComplete` (replay), and `sessionClose` (own transaction function) keep their special handling but reuse the helper where they can.

**Files:**
- Modify: `src/application/flow-service.ts`
- Test: existing `tests/runtime-gates.test.ts`, `tests/runtime-close.test.ts`, `tests/request-evidence.test.ts`

**Interfaces:**
- Internal only. Public `FlowService` type is unchanged.

- [ ] **Step 1: Add the helper above `createFlowService`**

```ts
type Loaded = Readonly<{ session: Session; transaction: SessionTransaction }>;

/**
 * The shared spine of every guarded mutation: parse, lock, load, transition,
 * save, project. Anything not on that path stays in the caller.
 */
async function mutate<Request, Value, Projection extends ActiveSessionProjection>(
	repository: SessionRepository,
	schema: { parse(input: unknown): { request: Request } },
	input: unknown,
	step: (
		loaded: Loaded,
		request: Request,
	) => Promise<Readonly<{ session: Session; value: Value; replayed: boolean }>>,
	respond: (
		result: Readonly<{ session: Session; value: Value; replayed: boolean }>,
		request: Request,
	) => Readonly<{ summary: string; projection: Projection }>,
	operationId: (request: Request) => string,
): Promise<FlowResponse<MutationWorkflowData<Projection>>> {
	try {
		const request = schema.parse(input).request;
		return await repository.transact(async (transaction) => {
			const session = await transaction.load();
			if (!session) throw new Error("No active Flow session exists.");
			const result = await step({ session, transaction }, request);
			await transaction.save(result.session);
			const shaped = respond(result, request);
			return ok(shaped.summary, {
				operation: operationResult(
					result.session,
					operationId(request),
					result.replayed,
					// `approvePlan` yields `null`; the old code passed nothing, and
					// `operationResult` only omits `entity` for `undefined`.
					result.value === null ? undefined : result.value,
				),
				projection: shaped.projection,
			});
		});
	} catch (error) {
		return errorResponse(error);
	}
}
```

Add `import type { SessionTransaction } from "./ports/session-repository.js";` alongside the existing `SessionRepository` import.

- [ ] **Step 2: Rewrite `planApprove`, `runStart`, `featureReset` with the helper**

Replace the three method bodies:

```ts
		planApprove(input, authority) {
			return mutate(
				repository,
				PlanApproveInputSchema,
				input,
				({ session }, request) =>
					Promise.resolve(approvePlan(session, request, authority)),
				(result) => ({
					summary: "Plan approved.",
					projection: compactProjection(result.session),
				}),
				(request) => request.operationId,
			);
		},

		runStart(input) {
			return mutate(
				repository,
				RunStartInputSchema,
				input,
				({ session }, request) =>
					Promise.resolve(startRun(session, request, environment)),
				(result) => ({
					summary: "Feature run ready.",
					projection: executionProjection(result.session),
				}),
				(request) => request.operationId,
			);
		},

		featureReset(input) {
			return mutate(
				repository,
				FeatureResetInputSchema,
				input,
				({ session }, request) =>
					Promise.resolve(resetFeature(session, request, environment)),
				(result) => ({
					summary: "Feature reset committed.",
					projection: compactProjection(result.session),
				}),
				(request) => request.operationId,
			);
		},
```

The null-to-undefined mapping in the helper keeps `planApprove`'s response byte-identical without touching `flow-response.ts`.

- [ ] **Step 3: Rewrite `reviewStart` with the helper**

```ts
		reviewStart(input) {
			return mutate(
				repository,
				ReviewStartInputSchema,
				input,
				async ({ session, transaction }, request) => {
					const priorOperation = session.operations.find(
						(operation) => operation.id === request.operationId,
					);
					const priorAssignment =
						priorOperation?.kind === "review-start"
							? session.runs
									.flatMap((run) => run.reviews)
									.find((review) => review.id === priorOperation.entityId)
							: undefined;
					return startReview(
						session,
						{
							...request,
							sourceDigest:
								priorAssignment?.sourceDigest ??
								(await transaction.computeSourceDigest()),
						},
						environment,
					);
				},
				(result) => {
					const actionable =
						activeRun(result.session)?.id === result.value.runId &&
						result.value.result === null;
					return {
						summary:
							result.replayed && !actionable
								? "Review assignment replayed; its current state is no longer actionable."
								: "Independent review assignment created.",
						projection: actionable
							? reviewerProjection(result.session, result.value.id)
							: compactProjection(result.session),
					};
				},
				(request) => request.operationId,
			);
		},
```

- [ ] **Step 4: Leave `planSave`, `featureComplete`, `featureCompleteReplay`, `sessionClose`, `status`, `requestAnchor` as they are**

`planSave` allows a null session. `featureComplete` has the reviewer replay path (Task 8 simplifies it). `sessionClose` already delegates to `closeSessionTransaction`. Do not force these through the helper.

- [ ] **Step 5: Run the suite**

Run: `bun run typecheck && bun run lint && bun test tests`
Expected: PASS. The application tests compare whole response objects, so any shape drift fails here.

- [ ] **Step 6: Commit**

```bash
bunx biome format --write src
git add src/application/flow-service.ts
git commit -m "refactor(application): share the parse-lock-transition-save spine across mutations

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 8: Drop the pre-lock replay read in `featureComplete`

`featureComplete` checks for an exact replay outside the lock, then again inside. The outer read exists as an optimization; the inner one is the correct one. Removing the outer read deletes a code path and the race test that only existed to exercise it.

**Files:**
- Modify: `src/application/flow-service.ts` (`featureComplete`)
- Modify: `tests/runtime-gates.test.ts:34-58` (delete `CompletionRaceRepository`) and `:1009-1082` (rewrite the race test)

- [ ] **Step 1: Rewrite the race test to not depend on the outer read**

In `tests/runtime-gates.test.ts`, replace the test `"replays an exact feature completion that loses the serialized transaction race"` so it uses `MemorySessionRepository` directly and stops asserting `completionOuterReadCount`:

```ts
	test("replays an exact feature completion that loses the serialized transaction race", async () => {
		const repository = new MemorySessionRepository();
		const flow = await startSession(repository, deterministicEnvironment());
		const prepared = await prepareValidation(
			repository,
			{
				expectedRevision: revision(repository),
				featureId: FEATURE,
				command: "bun test",
				scope: "broad",
			},
			"linux",
		);
		await persistObservedValidation(repository, {
			...prepared,
			captureId: "capture-completion-race",
			exitCode: 0,
			outputDigest: OUTPUT,
			outputComplete: true,
		});
		expectOk(
			await flow.reviewStart({
				request: {
					operationId: "review-start-completion-race",
					expectedRevision: revision(repository),
					featureId: FEATURE,
					artifactsChanged: [{ path: "src/application/flow-service.ts" }],
					packet: {
						summary: "Review concurrent completion replay.",
						riskLenses: ["transaction serialization"],
					},
				},
			}),
		);
		const assignment = activeReview(repository);
		const completeRequest = {
			request: {
				operationId: "complete-runtime-concurrently",
				expectedRevision: revision(repository),
				featureId: FEATURE,
				assignmentId: assignment.id,
				summary: "Runtime completed exactly once.",
				result: {
					verdict: "passed",
					findings: [],
					terminalDisposition: "submitted",
				},
			},
		} as const;
		const revisionBeforeCompletion = revision(repository);
		const setupSaveCount = repository.saveCount;

		const responses = await Promise.all([
			flow.featureComplete(completeRequest),
			flow.featureComplete(completeRequest),
		]);

		const replayFlags = responses
			.map((response) => {
				expectOk(response);
				return response.workflowData.operation.replayed;
			})
			.sort((left, right) => Number(left) - Number(right));
		expect(replayFlags).toEqual([false, true]);
		expect(revision(repository)).toBe(revisionBeforeCompletion + 1);
		expect(repository.saveCount).toBe(setupSaveCount + 1);
		expect(
			repository.session?.operations.filter(
				(operation) => operation.kind === "feature-complete",
			),
		).toEqual([
			expect.objectContaining({ id: "complete-runtime-concurrently" }),
		]);
	});
```

Delete the `CompletionRaceRepository` class (lines 34 through 58). Its serialized `transact` was the only thing standing in for the production lock, so move that serialization into the base `MemorySessionRepository` in `tests/runtime-test-support.ts`. Its current `transact` runs the task immediately, which lets two concurrent calls interleave. Replace it with:

```ts
	private transactionTail: Promise<void> = Promise.resolve();

	transact<T>(
		task: (transaction: SessionTransaction) => Promise<T>,
	): Promise<T> {
		this.transactionCount += 1;
		const result = this.transactionTail.then(() => task(this.transaction));
		this.transactionTail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
```

The file repository already serializes via `withSessionLock`, so this only makes the test double match production. Run the whole suite after this change, not just `runtime-gates`, since every application test uses this double.

- [ ] **Step 2: Run the suite to see it pass against current code**

Run: `bun test tests`
Expected: PASS (the outer read is still present; the test no longer depends on it, and the serialized double changes no other outcome).

- [ ] **Step 3: Remove the outer read**

In `src/application/flow-service.ts`, `featureComplete`, delete:

```ts
				const current = await repository.read();
				if (current) {
					const replay = exactFeatureCompleteReplay(current, request);
					if (replay) {
						return featureCompleteResponse(
							replay.session,
							request,
							replay.run,
							true,
						);
					}
				}
```

The transaction body's `racedReplay` check remains and is now the only replay check. Rename `racedReplay` to `replay`.

- [ ] **Step 4: Run the suite**

Run: `bun run typecheck && bun run lint && bun test tests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bunx biome format --write src tests
git add src/application/flow-service.ts tests/runtime-gates.test.ts tests/runtime-test-support.ts
git commit -m "refactor(application): check feature-complete replay only under the lock

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 9: Flatten the close-response variants

`session-close.ts` spends about 250 lines on five response types distinguished by `ManualRecoveryCloseState<true | false>` and `delivery?: never` markers. Collapse to one `closeState` shape with a `kind` field and one builder per outcome. The JSON emitted must be byte-identical, so the field names and values stay; only the TypeScript types and constructor functions shrink.

**Files:**
- Modify: `src/application/session-close.ts`
- Test: existing `tests/runtime-close.test.ts` (compares whole responses)

**Interfaces:**
- Keeps exported: `ArchiveCollisionStatusResponse`, `CloseSessionResponse`, `closedArchiveCollisionStatus`, `closeSessionTransaction`.

- [ ] **Step 1: Snapshot current close responses before changing anything**

Run: `bun test tests/runtime-close.test.ts`
Expected: PASS. Note the count of tests; this is the behavior lock for the whole task.

- [ ] **Step 2: Replace the type zoo with one state type**

Replace everything from `type ArchivePendingCloseState` through `type CloseRecoveryWorkflowData` with:

```ts
type CloseState = Readonly<
	| {
			durableAccepted: true;
			archiveConfirmed: false;
			retryExactRequest: true;
			retryRequest: SessionCloseRequest;
	  }
	| {
			durableAccepted: boolean;
			archiveConfirmed: false;
			retryExactRequest: false;
			manualRecoveryRequired: true;
	  }
>;

type CloseRecoveryWorkflowData = FailureWorkflowData &
	Readonly<{
		operation?: OperationResult;
		closeState: CloseState;
		projection:
			| CompactProjection
			| Readonly<
					CompactProjection & {
						nextAction: "await-user-direction";
						archiveRetry: null;
					}
			  >
			| Readonly<{
					view: "compact";
					sessionId: string;
					status: "unknown";
					nextAction: "await-user-direction";
					archiveRetry: null;
			  }>;
		delivery?: DeliveryProjection;
	}>;
```

Keep `SuccessfulCloseWorkflowData`, `StatusRecoveryWorkflowData`, `ArchiveCollisionStatusResponse`, and `CloseSessionResponse` as they are, but point `CloseSessionResponse`'s error arm at the single `CloseRecoveryWorkflowData`.

- [ ] **Step 3: Replace the five builders with one**

Replace `archivePendingResponse`, `manualRecoveryCloseState`, `manualRecoveryProjection`, the overloaded `archiveCollisionResponse`, `archiveLookupCollisionResponse`, and `archiveFailureResponse` with:

```ts
const MANUAL_RECOVERY =
	"Preserve both active and archived state, inspect the collision, and do not overwrite or delete either document automatically.";

function recoveryResponse(
	summary: string,
	data: CloseRecoveryWorkflowData,
): FlowErrorResponse<CloseRecoveryWorkflowData> {
	return {
		status: "error",
		summary,
		workflowData: { dataNote: dataNote(), ...data },
	};
}

function closeFailure(
	error: unknown,
	session: Session,
	request: SessionCloseRequest,
	replayed: boolean,
	durableAccepted = true,
): FlowErrorResponse<CloseRecoveryWorkflowData> {
	const operation = operationResult(
		session,
		request.operationId,
		replayed,
		session.closure,
	);
	const message = error instanceof Error ? error.message : String(error);
	if (!(error instanceof ArchiveCollisionError)) {
		return recoveryResponse(
			"Session close was durably accepted, but archive publication was not confirmed.",
			{
				operation,
				closeState: {
					durableAccepted: true,
					archiveConfirmed: false,
					retryExactRequest: true,
					retryRequest: request,
				},
				projection: compactProjection(session),
				delivery: deliveryProjection(session),
				failure: {
					summary: message,
					recovery:
						"Retry this exact flow_session_close request with the same operation ID and payload.",
				},
			},
		);
	}
	const projection = {
		...compactProjection(session),
		nextAction: "await-user-direction" as const,
		archiveRetry: null,
	};
	const closeState = {
		durableAccepted,
		archiveConfirmed: false as const,
		retryExactRequest: false as const,
		manualRecoveryRequired: true as const,
	};
	const failure = { summary: message, recovery: MANUAL_RECOVERY };
	return durableAccepted
		? recoveryResponse(
				"Session close was durably accepted, but conflicting Flow state requires manual recovery.",
				{
					operation,
					closeState,
					projection,
					delivery: deliveryProjection(session),
					failure,
				},
			)
		: recoveryResponse(
				"Session close replay could not confirm durable active state; manual recovery is required.",
				{ operation, closeState, projection, failure },
			);
}

function archiveLookupFailure(
	error: ArchiveCollisionError,
	request: SessionCloseRequest,
): FlowErrorResponse<CloseRecoveryWorkflowData> {
	return recoveryResponse(
		"Flow could not verify the archived close; manual recovery is required.",
		{
			closeState: {
				durableAccepted: false,
				archiveConfirmed: false,
				retryExactRequest: false,
				manualRecoveryRequired: true,
			},
			projection: {
				view: "compact",
				sessionId: request.sessionId,
				status: "unknown",
				nextAction: "await-user-direction",
				archiveRetry: null,
			},
			failure: {
				summary: error.message,
				recovery:
					"Preserve active and archived state, inspect the requested archive, and do not overwrite or delete either document automatically.",
			},
		},
	);
}
```

Keep `archiveCollisionStatusResponse` (the status-path variant) but have it use the `MANUAL_RECOVERY` constant.

- [ ] **Step 4: Update `closeSessionTransaction` call sites**

- `return archiveLookupCollisionResponse(error, request);` → `return archiveLookupFailure(error, request);`
- `return archiveFailureResponse(error, archived, request, true);` → `return closeFailure(error, archived, request, true);`
- `return archiveCollisionResponse(error, result.session, request, true, false);` → `return closeFailure(error, result.session, request, true, false);`
- `return archiveFailureResponse(error, result.session, request, result.replayed);` → `return closeFailure(error, result.session, request, result.replayed);`

Note the JSON key order inside `workflowData` must stay as before for tests that use `toEqual` (key order does not matter for `toEqual`) but does matter for any test that compares serialized strings. `tests/runtime-close.test.ts` uses object matchers, so key order is free; keep `dataNote` first anyway to match `ok()` and `errorResponse()`.

- [ ] **Step 5: Run the close tests and the full suite**

Run: `bun run typecheck && bun run lint && bun test tests/runtime-close.test.ts tests`
Expected: PASS with the same test count as Step 1.

- [ ] **Step 6: Commit**

```bash
bunx biome format --write src
git add src/application/session-close.ts
git commit -m "refactor(application): collapse close recovery responses to one state shape

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 10: One `sameSession` comparison

`archivedStateCollision` compares sessions with `JSON.stringify`, while the durability and archive checks in `workspace.ts` use `operationInputDigest`. Use one helper for both.

**Files:**
- Modify: `src/domain/operation.ts` (add `sameSession`)
- Modify: `src/application/session-close.ts` (`archivedStateCollision`)
- Modify: `src/infrastructure/fs/workspace.ts` (three `operationInputDigest(a) !== operationInputDigest(b)` sites)
- Modify: `tests/runtime-test-support.ts:99` (`confirmActiveDurability` in the memory repository)

- [ ] **Step 1: Add the helper**

In `src/domain/operation.ts`, after `operationInputDigest`:

```ts
/** Structural equality by canonical JSON, independent of key order. */
export function sameSession(left: Session, right: Session): boolean {
	return operationInputDigest(left) === operationInputDigest(right);
}
```

- [ ] **Step 2: Use it**

- `src/application/session-close.ts`: change `if (!archived || JSON.stringify(archived) === JSON.stringify(session))` to `if (!archived || sameSession(archived, session))` and import `sameSession` from `../domain/operation.js` (replace the `operationInputDigest` import if it becomes unused; `loadExactArchivedClose` still needs it for the request digest, so keep both).
- `src/infrastructure/fs/workspace.ts`: replace each `operationInputDigest(x) !== operationInputDigest(y)` with `!sameSession(x, y)` (three sites: `confirmActiveSessionDurability`, and two in `archiveAndClearSession`). Import `sameSession` and drop `operationInputDigest` if unused.
- `tests/runtime-test-support.ts`: change `if (JSON.stringify(this.session) !== JSON.stringify(session))` to `if (!this.session || !sameSession(this.session, session))` and import `sameSession` from `../src/domain/operation.js`.

- [ ] **Step 3: Run the suite and commit**

Run: `bun run typecheck && bun run lint && bun test tests`
Expected: PASS.

```bash
bunx biome format --write src tests
git add src/domain/operation.ts src/application/session-close.ts src/infrastructure/fs/workspace.ts tests/runtime-test-support.ts
git commit -m "refactor: compare sessions through one canonical equality helper

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
bun run check
```

Expected: exit 0. Open the Phase 2 PR.

---

## Phase 3: Split the two files that mix concerns

### Task 11: Split `infrastructure/fs/workspace.ts`

The file holds path validation, managed filesystem primitives, session file parsing and the archive protocol, and a cross-process lock. Split by responsibility. `workspace.ts` keeps the session file protocol and re-exports nothing; every importer is repointed.

**Files:**
- Create: `src/infrastructure/fs/workspace-paths.ts`
- Create: `src/infrastructure/fs/managed-fs.ts`
- Create: `src/infrastructure/fs/session-lock.ts`
- Modify: `src/infrastructure/fs/workspace.ts` (shrinks to session file load/save/archive/quarantine)
- Modify: `src/infrastructure/fs/session-repository.ts`
- Modify: `src/platform/opencode/tools.ts:24` (`resolveWorkspaceRoot` import)
- Modify: `tests/workspace-persistence.test.ts:29-41`, `tests/workspace-lifecycle-integration.test.ts:11-15`, `tests/session-capacity.test.ts:19-24`, `tests/runtime-validation-capacity.test.ts:20-22`

**Interfaces:**
- `workspace-paths.ts` exports: `assertMutableWorkspaceRoot`, `resolveWorkspaceRoot`, `flowDir`, `sessionPath`, `historyDir`, `archivedSessionPath`.
- `managed-fs.ts` exports: `UnsafeFlowWorkspaceLayoutError`, `pathKind`, `ensureFlowDirectory`, `ensureHistoryDirectory`, `readManaged`, `syncDirectory`, `writeAtomically`. (`ensureDirectory` and `renameReplacing` stay private; only this file calls them.)
- `session-lock.ts` exports: `withSessionLock`, `reclaimOrphanedLock`.
- `workspace.ts` keeps: `ArchiveCollisionError` re-export, `loadSession`, `loadArchivedSession`, `saveSession`, `confirmActiveSessionDurability`, `archiveAndClearSession`, `quarantineUnreadableSession`.

- [ ] **Step 1: Create `workspace-paths.ts`**

Move `InvalidFlowWorkspaceRootError`, `normalizeWorkspaceRoot`, `assertMutableWorkspaceRoot`, `resolveWorkspaceRoot`, `flowDir`, `sessionPath`, `historyDir`, `archivedSessionFilename`, `archivedSessionPath` verbatim into the new file. Its imports are:

```ts
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, parse, resolve } from "node:path";
import { MAX_SESSION_ID_LENGTH } from "../../domain/limits.js";
```

- [ ] **Step 2: Create `managed-fs.ts`**

Move `UnsafeFlowWorkspaceLayoutError`, `pathKind`, `ensureDirectory`, `ensureFlowDirectory`, `ensureHistoryDirectory`, `readManaged`, `syncDirectory`, `renameReplacing`, `writeAtomically` verbatim. Mark `pathKind`, `ensureFlowDirectory`, `ensureHistoryDirectory`, `readManaged`, `syncDirectory`, `writeAtomically` as `export`; leave `ensureDirectory` and `renameReplacing` unexported. Imports:

```ts
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { UnreadableFlowSessionError } from "../../application/errors.js";
import { MAX_SESSION_BYTES, SESSION_CLOSE_RESERVE_BYTES } from "../../domain/limits.js";
import { flowDir, historyDir } from "./workspace-paths.js";
```

- [ ] **Step 3: Create `session-lock.ts`**

Move `inProcessLocks`, `LOCK_TIMEOUT_MS`, `orphanOwnerToken`, `reclaimOrphanedLock`, `acquireLock`, `withSessionLock` verbatim. Imports:

```ts
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ensureFlowDirectory, pathKind } from "./managed-fs.js";
import { assertMutableWorkspaceRoot, flowDir } from "./workspace-paths.js";
```

- [ ] **Step 4: Shrink `workspace.ts`**

Delete everything moved in Steps 1 to 3. Replace the import block with:

```ts
import { randomUUID } from "node:crypto";
import { link, open, rename, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
	ArchiveCollisionError,
	UnreadableFlowSessionError,
	UnsupportedFlowSessionVersionError,
} from "../../application/errors.js";
import { SessionSchema } from "../../application/schema.js";
import {
	MAX_SESSION_BYTES,
	SESSION_CLOSE_RESERVE_BYTES,
} from "../../domain/limits.js";
import { sameSession } from "../../domain/operation.js";
import type { Session } from "../../domain/session.js";
import {
	ensureFlowDirectory,
	ensureHistoryDirectory,
	pathKind,
	readManaged,
	syncDirectory,
	UnsafeFlowWorkspaceLayoutError,
	writeAtomically,
} from "./managed-fs.js";
import { parseStrictJsonObject } from "./strict-json-object.js";
import {
	archivedSessionPath,
	assertMutableWorkspaceRoot,
	flowDir,
	historyDir,
	sessionPath,
} from "./workspace-paths.js";

export { ArchiveCollisionError } from "../../application/errors.js";
```

Run `bun run typecheck` and remove any import the compiler reports unused; add any it reports missing.

- [ ] **Step 5: Repoint importers**

- `src/infrastructure/fs/session-repository.ts`: import `assertMutableWorkspaceRoot` from `./workspace-paths.js` and `withSessionLock` from `./session-lock.js`; keep the rest on `./workspace.js`.
- `src/platform/opencode/tools.ts`: `import { resolveWorkspaceRoot } from "../../infrastructure/fs/workspace-paths.js";`
- `tests/workspace-persistence.test.ts`: split its import into `workspace.js` (`confirmActiveSessionDurability`, `loadArchivedSession`, `loadSession`, `quarantineUnreadableSession`, `saveSession`, `ArchiveCollisionError`), `workspace-paths.js` (`assertMutableWorkspaceRoot`, `flowDir`, `historyDir`, `sessionPath`), `managed-fs.js` (`UnsafeFlowWorkspaceLayoutError`), `session-lock.js` (`reclaimOrphanedLock`, `withSessionLock`).
- `tests/workspace-lifecycle-integration.test.ts`: `archivedSessionPath`, `sessionPath` from `workspace-paths.js`; `loadArchivedSession`, `loadSession` from `workspace.js`.
- `tests/session-capacity.test.ts` and `tests/runtime-validation-capacity.test.ts`: `sessionPath` from `workspace-paths.js`; the rest from `workspace.js`.

- [ ] **Step 6: Run the persistence tests, then the suite**

Run: `bun run typecheck && bun test tests/workspace-persistence.test.ts tests/workspace-lifecycle-integration.test.ts tests/session-capacity.test.ts tests/runtime-validation-capacity.test.ts tests/architecture-boundaries.test.ts && bun test tests`
Expected: PASS. The architecture test confirms each moved export still has a consumer and no file exceeds 1,000 lines.

- [ ] **Step 7: Commit**

```bash
bunx biome format --write src tests
git add src/infrastructure/fs src/platform/opencode/tools.ts tests
git commit -m "refactor(infrastructure): split workspace persistence into paths, managed fs, lock, and session file

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 12: Split `platform/opencode/plugin.ts` and unify workspace resolution

Extract the command hook and the tool guard into their own modules, build one `FlowService` for the plugin instead of four per-call constructions, and resolve the workspace root through `resolveWorkspaceRoot` everywhere.

**Files:**
- Create: `src/platform/opencode/command-hook.ts`
- Create: `src/platform/opencode/tool-guard.ts`
- Modify: `src/platform/opencode/plugin.ts`
- Test: existing `tests/distribution-and-surface.test.ts`, `tests/auto-drive.test.ts`, `tests/validation-capture.test.ts`, plus the live smoke (opt-in)

**Interfaces:**
- `command-hook.ts` exports `createCommandHook(options: Readonly<{ assertOperational: (action: string) => void; autoDrive: AutoDriveCoordinator; flow: FlowService }>): CommandHook` and the `textPart` helper (also used by `plugin.ts` for the auto-drive prompt).
- `tool-guard.ts` exports `guardTools(tools: FlowTools, runtimeGuard: FlowLeadershipHandle, autoDrive: AutoDriveCoordinator): FlowTools`.

- [ ] **Step 1: Create `command-hook.ts`**

Move `FlowCommandName`, `CommandHook`, `CommandOutput`, `Part`, `TextPart`, `DraftTextPart`, `AUTO_STOPPED`, `isFlowCommand`, `textPart`, `asHostTextPart`, `rewriteCommand`, and `createCommandHook` verbatim from `plugin.ts`. Export `textPart` and `createCommandHook`. Change `createCommandHook`'s signature to take one options object and use the passed `flow` instead of constructing one:

```ts
export function createCommandHook(
	options: Readonly<{
		assertOperational: (action: string) => void;
		autoDrive: AutoDriveCoordinator;
		flow: FlowService;
	}>,
): CommandHook {
	const { assertOperational, autoDrive, flow } = options;
	return async (input, output) => {
		// ...body unchanged, except:
		//   const flow = createWorkspaceFlowService(workspace);  <- delete
		//   await flow.status(...); await flow.requestAnchor(...); <- keep, using the outer `flow`
	};
}
```

Imports for the new file:

```ts
import type { FlowService } from "../../application/flow-service.js";
import { FLOW_CORE_COMMANDS } from "../../config-shared.js";
import { requestEvidenceAnchor } from "../../domain/request-evidence.js";
import type { AutoDriveCoordinator } from "./auto-drive.js";
import type { Hooks } from "./sdk.js";
```

- [ ] **Step 2: Create `tool-guard.ts`**

Move `MUTATION`, `acceptedMutation`, `MARKDOWN_TOOLS`, `guardRecovery`, `guardRejection`, `guardTools`, and the `FlowTools` type alias verbatim. Export `guardTools`. Imports:

```ts
import { dataNote } from "../../application/flow-response.js";
import type { AutoDriveCoordinator } from "./auto-drive.js";
import type {
	FlowLeadershipHandle,
	FlowLeadershipReason,
	FlowLeadershipStatus,
} from "./leadership.js";
import type { Hooks } from "./sdk.js";
```

- [ ] **Step 3: Rewrite `plugin.ts` to use them**

After the moves, `plugin.ts` should contain only the `FlowPlugin` function. Inside it:

- Replace `const workspace = ctx.worktree ?? ctx.directory;` and the `registerFlowPluginInstance(ctx.worktree ?? ctx.directory, ...)` argument with:

```ts
	const workspace = resolveWorkspaceRoot(ctx);
	const flow = createWorkspaceFlowService(workspace);
```

and pass `workspace` to `registerFlowPluginInstance`. Import `resolveWorkspaceRoot` from `../../infrastructure/fs/workspace-paths.js`.

This is a deliberate small behavior change: `resolveWorkspaceRoot` validates and realpaths the directory, so a plugin loaded in a filesystem root or the home directory now fails at load instead of on the first tool call. The tools already applied that rule per call, so no valid workspace is affected. `tests/distribution-and-surface.test.ts` constructs the plugin with a context; confirm its `directory` points at a real temporary directory (it does today for the tool tests) and adjust the fixture if it used a placeholder string.

- In the `AutoDriveCoordinator` options, `readProjection` becomes:

```ts
		readProjection: async () => {
			const response = await flow.status({ request: { view: "compact" } });
			// ...rest unchanged
		},
```

- `"command.execute.before": createCommandHook({ assertOperational: (action) => runtimeGuard.assertOperational(action), autoDrive, flow }),`
- `tool: guardTools(tools, runtimeGuard, autoDrive),` (import from `./tool-guard.js`).
- `textPart` is imported from `./command-hook.js` for the `prompt` callback.

- [ ] **Step 4: Fix the duplicated `session.deleted` handling in the event hook**

The event handler checks `event.type === "session.deleted"` at the top to clear the coding model, then again lower down. Merge them so the handler reads:

```ts
		event: async (input) => {
			const event = input.event;
			if (event.type === "message.updated")
				return autoDrive.observeHostMessage(
					event.properties.info.sessionID,
					event.properties.info,
				);
			if (event.type === "message.part.updated")
				return autoDrive.observeHostPart(
					event.properties.part.sessionID,
					event.properties.part,
				);
			if (event.type === "session.deleted" || event.type === "session.error") {
				const sessionID =
					event.type === "session.deleted"
						? event.properties.info.id
						: event.properties.sessionID;
				if (event.type === "session.deleted") codingModels.delete(sessionID);
				if (!sessionID) return autoDrive.clear();
				validation.cancel(sessionID);
				return void autoDrive.deactivate(sessionID);
			}
			// ...idle and compacted handling unchanged
		},
```

- [ ] **Step 5: Run the platform tests and the suite**

Run: `bun run typecheck && bun run lint && bun test tests`
Expected: PASS. `tests/distribution-and-surface.test.ts` builds the plugin and checks its exported hooks; if it imports a helper that moved (`textPart` or `acceptedMutation`), repoint the import.

- [ ] **Step 6: Run the live smoke if credentials are available**

Run: `bun run smoke:live`
Expected: PASS, or a clear skip because `FLOW_LIVE_SMOKE` prerequisites are missing. If the host is available, this is the one test that exercises the real command hook and tool guard end to end; do not skip it silently. Report which outcome occurred in the PR description.

- [ ] **Step 7: Commit and phase gate**

```bash
bunx biome format --write src tests
git add src/platform/opencode
git commit -m "refactor(platform): split the plugin into command hook, tool guard, and wiring

One FlowService per plugin instance, one workspace resolution path.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
bun run check
```

Expected: exit 0. Open the Phase 3 PR.

---

## Phase 4: Auto-drive as a decision table

`onIdle` in `auto-drive.ts` is one 120-line function with roughly fifteen exit paths that mutate the lease as they go. Separate the decision from its execution. The existing 48 tests in `tests/auto-drive.test.ts` are the behavior lock and must pass unchanged.

### Task 13: Extract `decideOnIdle`

**Files:**
- Create: `src/platform/opencode/auto-drive-decision.ts`
- Create: `tests/auto-drive-decision.test.ts`
- Modify: `src/platform/opencode/auto-drive.ts` (`onIdle`)

**Interfaces:**
- Produces, in `auto-drive-decision.ts`:

```ts
export type LeaseView = Readonly<{
	baseline: AutoDriveProjection;
	checkpoint: Readonly<{ revision: number; answered: boolean; advance?: number }> | null;
	pendingReply: boolean;
	lastPromptedRevision: number | null;
	hasDelivery: boolean;
}>;

export type IdleDecision =
	| Readonly<{ kind: "deactivate" }>
	| Readonly<{ kind: "stop"; warning?: string }>
	| Readonly<{ kind: "prompt-initial" }>
	| Readonly<{ kind: "handback-and-wait" }>
	| Readonly<{ kind: "answered" }>
	| Readonly<{ kind: "handback-or-deactivate" }>
	| Readonly<{ kind: "pause"; warning: string; clearCheckpoint: boolean }>
	| Readonly<{ kind: "continue"; clearCheckpoint: boolean }>;

export function decideOnIdle(lease: LeaseView, projection: AutoDriveProjection): IdleDecision;
```

Also exports the four predicates moved from `auto-drive.ts`: `isMechanical`, `isCheckpoint`, `isPendingReviewer`, `isHandback`.

- [ ] **Step 1: Write the failing decision tests**

Create `tests/auto-drive-decision.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { AutoDriveProjection } from "../src/platform/opencode/auto-drive.js";
import {
	decideOnIdle,
	type LeaseView,
} from "../src/platform/opencode/auto-drive-decision.js";

const running: AutoDriveProjection = {
	sessionId: "s1",
	status: "running",
	revision: 5,
	nextAction: "flow_validation_start",
};

function lease(overrides: Partial<LeaseView> = {}): LeaseView {
	return {
		baseline: { sessionId: "s1", status: "ready", revision: 3, nextAction: "flow_run_start" },
		checkpoint: null,
		pendingReply: false,
		lastPromptedRevision: null,
		hasDelivery: true,
		...overrides,
	};
}

describe("decideOnIdle", () => {
	test("prompts the initial route from an idle workspace once", () => {
		const idle: AutoDriveProjection = { status: "idle", revision: 0, nextAction: "flow_plan_save" };
		const fresh = lease({ baseline: { status: "idle", revision: 0, nextAction: "flow_plan_save" } });
		expect(decideOnIdle(fresh, idle)).toEqual({ kind: "prompt-initial" });
		expect(decideOnIdle({ ...fresh, lastPromptedRevision: 0 }, idle)).toEqual({ kind: "deactivate" });
	});

	test("deactivates when the projection has no next action", () => {
		expect(decideOnIdle(lease(), { ...running, nextAction: null })).toEqual({ kind: "deactivate" });
	});

	test("stops on an unowned session", () => {
		expect(decideOnIdle(lease(), { ...running, sessionId: "other" })).toEqual({
			kind: "stop",
			warning: "Flow auto-drive stopped: unowned session.",
		});
	});

	test("hands back and waits at a checkpoint boundary", () => {
		const approve: AutoDriveProjection = { ...running, status: "planning", nextAction: "flow_plan_approve" };
		expect(decideOnIdle(lease(), approve)).toEqual({ kind: "handback-and-wait" });
	});

	test("deactivates when a boundary appears below the recorded checkpoint", () => {
		const approve: AutoDriveProjection = { ...running, revision: 2, status: "planning", nextAction: "flow_plan_approve" };
		expect(decideOnIdle(lease({ checkpoint: { revision: 4, answered: false } }), approve)).toEqual({ kind: "deactivate" });
	});

	test("treats a non-mechanical projection as handback-or-deactivate", () => {
		expect(decideOnIdle(lease(), running)).toEqual({ kind: "handback-or-deactivate" });
	});

	test("continues on a mechanical advance past an answered checkpoint", () => {
		const ready: AutoDriveProjection = { sessionId: "s1", status: "ready", revision: 6, nextAction: "flow_run_start" };
		const view = lease({ checkpoint: { revision: 4, answered: true, advance: 6 } });
		expect(decideOnIdle(view, ready)).toEqual({ kind: "continue", clearCheckpoint: true });
	});

	test("pauses when the same revision was already prompted", () => {
		const ready: AutoDriveProjection = { sessionId: "s1", status: "ready", revision: 6, nextAction: "flow_run_start" };
		expect(decideOnIdle(lease({ lastPromptedRevision: 6 }), ready)).toEqual({
			kind: "pause",
			warning: "Flow auto-drive paused after revision 6 made no lifecycle progress.",
			clearCheckpoint: false,
		});
	});

	test("stops without delivery once a checkpoint has been passed", () => {
		// Needs an anchored checkpoint with a matching advance: without one the
		// "no progress" rule fires first, and without the advance the checkpoint
		// rule deactivates. Only then does the delivery check become reachable.
		const ready: AutoDriveProjection = { sessionId: "s1", status: "ready", revision: 6, nextAction: "flow_run_start" };
		const view = lease({
			hasDelivery: false,
			checkpoint: { revision: 3, answered: true, advance: 6 },
		});
		expect(decideOnIdle(view, ready)).toEqual({
			kind: "stop",
			warning: "Flow auto-drive stopped: no delivery.",
		});
	});

	test("stops on no progress when the lease was never anchored", () => {
		const ready: AutoDriveProjection = { sessionId: "s1", status: "ready", revision: 6, nextAction: "flow_run_start" };
		expect(decideOnIdle(lease(), ready)).toEqual({
			kind: "stop",
			warning: "Flow auto-drive stopped: no progress.",
		});
	});

	test("marks a pending reply as answered when nothing moved", () => {
		const ready: AutoDriveProjection = { sessionId: "s1", status: "ready", revision: 4, nextAction: "flow_run_start" };
		const view = lease({ pendingReply: true, checkpoint: { revision: 4, answered: false } });
		expect(decideOnIdle(view, ready)).toEqual({ kind: "deactivate" });
		const advanced = lease({ pendingReply: true, checkpoint: { revision: 3, answered: false, advance: 4 } });
		expect(decideOnIdle(advanced, ready)).toEqual({ kind: "answered" });
	});
});
```

Note on the last test: with `checkpoint.revision === 4` and no `advance`, `mutationAdvanced` is false and the projection is not a boundary, so today's code deactivates. With `advance: 4` and a mechanical projection at revision 4, today's code marks the checkpoint answered.

- [ ] **Step 2: Run to confirm failure**

Run: `bun test tests/auto-drive-decision.test.ts`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `decideOnIdle`**

Create `src/platform/opencode/auto-drive-decision.ts`:

```ts
import type { AutoDriveProjection } from "./auto-drive.js";

export function isMechanical(projection: AutoDriveProjection): boolean {
	return projection.nextAction === "flow_run_start"
		? projection.status === "ready"
		: projection.nextAction === "flow_session_close" &&
				(projection.status === "completed" || projection.status === "closed");
}
export function isCheckpoint(projection: AutoDriveProjection): boolean {
	return ["flow_plan_approve", "await-user-direction"].includes(
		projection.nextAction ?? "",
	);
}
export function isPendingReviewer(projection: AutoDriveProjection): boolean {
	return (
		projection.status === "running" &&
		projection.nextAction === "dispatch-flow-reviewer"
	);
}
export function isHandback(projection: AutoDriveProjection): boolean {
	return (
		projection.status === "blocked" ||
		projection.nextAction === "flow_feature_reset" ||
		projection.nextAction === "dispatch-flow-reviewer"
	);
}

export type LeaseView = Readonly<{
	baseline: AutoDriveProjection;
	checkpoint: Readonly<{
		revision: number;
		answered: boolean;
		advance?: number;
	}> | null;
	pendingReply: boolean;
	lastPromptedRevision: number | null;
	hasDelivery: boolean;
}>;

export type IdleDecision =
	| Readonly<{ kind: "deactivate" }>
	| Readonly<{ kind: "stop"; warning?: string }>
	| Readonly<{ kind: "prompt-initial" }>
	| Readonly<{ kind: "handback-and-wait" }>
	| Readonly<{ kind: "answered" }>
	| Readonly<{ kind: "handback-or-deactivate" }>
	| Readonly<{ kind: "pause"; warning: string; clearCheckpoint: boolean }>
	| Readonly<{ kind: "continue"; clearCheckpoint: boolean }>;

/**
 * Pure routing for one idle event. Mirrors the branch order of the previous
 * inline `onIdle` exactly; the executor applies side effects.
 */
export function decideOnIdle(
	lease: LeaseView,
	projection: AutoDriveProjection,
): IdleDecision {
	const { baseline, checkpoint } = lease;
	const anchored = checkpoint !== null;
	if (projection.status === "idle") {
		if (
			baseline.status !== "idle" ||
			baseline.sessionId ||
			lease.lastPromptedRevision === 0 ||
			!lease.hasDelivery
		)
			return { kind: "deactivate" };
		return { kind: "prompt-initial" };
	}
	if (projection.nextAction === null) return { kind: "deactivate" };
	if (projection.sessionId !== baseline.sessionId)
		return { kind: "stop", warning: "Flow auto-drive stopped: unowned session." };
	const boundary = isCheckpoint(projection);
	const advance = checkpoint?.advance;
	const mutationAdvanced =
		advance !== undefined &&
		projection.revision === advance &&
		isMechanical(projection);
	if (lease.pendingReply) {
		if (boundary && (!checkpoint || projection.revision > checkpoint.revision))
			return { kind: "handback-and-wait" };
		if (!checkpoint || (!boundary && !mutationAdvanced))
			return { kind: "deactivate" };
		return { kind: "answered" };
	}
	if (boundary) {
		if (checkpoint && projection.revision < checkpoint.revision)
			return { kind: "deactivate" };
		return { kind: "handback-and-wait" };
	}
	if (!isMechanical(projection)) return { kind: "handback-or-deactivate" };
	let clearCheckpoint = false;
	if (checkpoint) {
		if (projection.revision <= checkpoint.revision || !mutationAdvanced)
			return { kind: "deactivate" };
		clearCheckpoint = true;
	}
	if (lease.lastPromptedRevision === projection.revision)
		return {
			kind: "pause",
			warning: `Flow auto-drive paused after revision ${projection.revision} made no lifecycle progress.`,
			clearCheckpoint,
		};
	if (
		baseline.sessionId
			? projection.revision <= baseline.revision ||
				(!anchored && !isPendingReviewer(baseline))
			: projection.sessionId === undefined
	)
		return { kind: "stop", warning: "Flow auto-drive stopped: no progress." };
	if (!lease.hasDelivery)
		return { kind: "stop", warning: "Flow auto-drive stopped: no delivery." };
	return { kind: "continue", clearCheckpoint };
}
```

- [ ] **Step 4: Run the decision tests**

Run: `bun test tests/auto-drive-decision.test.ts`
Expected: PASS (11 tests). If one fails, compare its expectation with the corresponding branch in the current `onIdle`; the test encodes today's behavior, so fix the decision function, not the test, unless the test itself misread a branch.

- [ ] **Step 5: Rewrite `onIdle` as an executor**

In `src/platform/opencode/auto-drive.ts`, delete the local `isMechanical`, `isCheckpoint`, `isPendingReviewer`, `isHandback` and import them plus `decideOnIdle` from `./auto-drive-decision.js`. Replace the body of `onIdle` between `const baseline = lease.baseline; if (!baseline) return this.#stop(lease);` and the `finally` with:

```ts
			const decision = decideOnIdle(
				{
					baseline,
					checkpoint: lease.checkpoint,
					pendingReply: lease.pendingReply,
					lastPromptedRevision: lease.lastPromptedRevision,
					hasDelivery: lease.delivery !== null,
				},
				projection,
			);
			if (lease.pendingReply && projection.status !== "idle")
				lease.pendingReply = false;
			switch (decision.kind) {
				case "deactivate":
					return void this.deactivate(hostSessionId);
				case "stop":
					return this.#stop(lease, decision.warning);
				case "prompt-initial": {
					lease.lastPromptedRevision = 0;
					lease.inFlight = "prompt";
					if (!lease.delivery) return;
					await this.#options
						.prompt(
							hostSessionId,
							`${INITIAL_ROUTE}\n\n${FLOW_MANAGER_KERNEL}`,
							lease.delivery,
							{ [FLOW_AUTO_METADATA_KEY]: lease.token },
						)
						.catch((error) =>
							this.#stop(lease, `Flow auto prompt failed: ${String(error)}`),
						);
					return;
				}
				case "handback-and-wait":
					await this.#promptHandback(lease, projection);
					if (this.#lease !== lease) return;
					return void this.#waitAt(lease, projection.revision);
				case "answered":
					if (lease.checkpoint) lease.checkpoint.answered = true;
					this.#setTiming("active");
					return;
				case "handback-or-deactivate": {
					const already =
						lease.handbackPromptedRevision === projection.revision;
					await this.#promptHandback(lease, projection);
					if (this.#lease !== lease) return;
					if (
						!already &&
						lease.handbackPromptedRevision === projection.revision
					) {
						this.#setTiming("paused");
						return;
					}
					return void this.deactivate(hostSessionId);
				}
				case "pause":
					if (decision.clearCheckpoint) lease.checkpoint = null;
					this.#setTiming("paused");
					return this.#warn(decision.warning);
				case "continue": {
					if (decision.clearCheckpoint) lease.checkpoint = null;
					if (!lease.delivery) return;
					lease.lastPromptedRevision = projection.revision;
					lease.messageId = null;
					this.#setTiming("active");
					lease.inFlight = "prompt";
					try {
						const continuation = [
							`Continue the same user-authorized /flow-auto lifecycle from compact revision ${projection.revision}.`,
							"Call flow_status with the compact view first.",
							CONTINUATION_ROUTE,
							`Then follow ${projection.nextAction} without expanding the approved goal.`,
						].join(" ");
						await this.#options.prompt(
							hostSessionId,
							`${continuation}\n\n${FLOW_MANAGER_KERNEL}`,
							lease.delivery,
							{ [FLOW_AUTO_METADATA_KEY]: lease.token },
						);
					} catch (error) {
						this.#stop(lease, `Flow auto prompt failed: ${String(error)}`);
					}
					return;
				}
			}
```

Two subtleties to preserve from the old body: `pendingReply` was reset to `false` at the start of the pending-reply branch, which only ran after the idle, null-action, and unowned checks. The line above resets it under the same conditions (projection not idle; the other two early exits deactivate or stop the lease anyway, so the flag's value no longer matters). And `anchored` was read before the checkpoint was cleared; the decision function does the same.

- [ ] **Step 6: Run the auto-drive tests, then the suite**

Run: `bun test tests/auto-drive.test.ts tests/auto-drive-decision.test.ts && bun run typecheck && bun run lint && bun test tests`
Expected: all 48 existing auto-drive tests pass unchanged, plus the 11 new ones. If an existing test fails, the decision function or executor has drifted from the old branch order; diff against `git show HEAD:src/platform/opencode/auto-drive.ts` and correct the function, not the test.

- [ ] **Step 7: Commit and phase gate**

```bash
bunx biome format --write src tests
git add src/platform/opencode/auto-drive.ts src/platform/opencode/auto-drive-decision.ts tests/auto-drive-decision.test.ts
git commit -m "refactor(platform): separate auto-drive routing from its side effects

decideOnIdle is a pure function over the lease and projection; onIdle applies
the chosen action. Behavior is unchanged and the existing tests hold.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
bun run check
```

Expected: exit 0. Open the Phase 4 PR.

---

## Phase 5 (optional): One source for document types and schemas

`domain/session.ts` hand-writes the Session v5 types and `application/schema.ts` hand-writes matching Zod schemas. Every field lands in both. This phase infers the types from the schemas. It has the widest blast radius of any phase and nothing earlier depends on it, so it can be deferred or skipped.

### Task 14: Move the document schemas into the domain and infer the types

**Files:**
- Create: `src/domain/session-schema.ts`
- Modify: `src/domain/session.ts` (replace hand-written document types with inferred ones; keep primitives and helper functions)
- Modify: `src/application/schema.ts` (import `SessionSchema` and building blocks from the domain; keep the request schemas)
- Modify: `src/infrastructure/fs/workspace.ts`, `src/application/prepare-validation.ts`, tests importing `SessionSchema` (`tests/domain-transitions.test.ts`, `tests/session-invariants.test.ts`, `tests/workspace-persistence.test.ts`, others found by typecheck)

**Interfaces:**
- `session-schema.ts` exports every document schema (`PlanFeatureSchema`, `EvidenceEntrySchema`, `ObservedAssertionSchema`, `PlanSchema`, `ReviewFindingSchema`, `PublicReviewResultSchema`, `PersistedReviewResultSchema`, `ReviewPacketSchema`, `ValidationObservationSchema`, `ArtifactSchema`, `ReviewAssignmentSchema`, `FeatureRunSchema`, `OperationRecordSchema`, `ClosureSchema`, `SessionDocumentSchema`, `SessionSchema`) and the `Immutable<T>` utility.
- `session.ts` keeps: `SessionStatus`, `FeatureId`, `SourceDigest`, `FeatureKind`, `EvidencePlatform`, `ValidationScope`, `ValidationIneligibleReason`, `OperationKind`, and all functions. Its document types become `export type Session = Immutable<z.infer<typeof SessionDocumentSchema>>` and so on.

- [ ] **Step 1: Add the immutability utility and the un-refined document schema**

Create `src/domain/session-schema.ts` by moving every schema from `application/schema.ts` **except** the eight request schemas and their four inferred request types. Add at the top:

```ts
/**
 * Readonly at every object level, mutable arrays of readonly items. This
 * matches the hand-written convention the domain used before types were
 * inferred, so no call site changes.
 */
export type Immutable<T> = T extends readonly (infer Item)[]
	? Immutable<Item>[]
	: T extends object
		? Readonly<{ [Key in keyof T]: Immutable<T[Key]> }>
		: T;
```

Rename the un-refined session object to `SessionDocumentSchema` and define `SessionSchema` as its refinement, so the inferred type does not depend on functions that take the inferred type:

```ts
export const SessionDocumentSchema = z
	.object({
		version: z.literal(5),
		// ...fields exactly as today, without the trailing .superRefine
	})
	.strict();

export const SessionSchema = SessionDocumentSchema.superRefine(
	(session, context) => {
		for (const issue of persistedCapacityIssues(session)) {
			context.addIssue({ code: "custom", message: issue });
		}
		for (const issue of sessionInvariantIssues(session)) {
			context.addIssue({ code: "custom", message: issue });
		}
	},
);
```

Remove the `: z.ZodType<Session>` annotation. Keep the imports of `sessionInvariantIssues`, `persistedCapacityIssues`, `reviewResultSemanticIssues`, limits, and patterns; they are all domain modules, so the layer rule holds.

- [ ] **Step 2: Infer the document types in `session.ts`**

Replace each hand-written document type with an inference, keeping the doc comments:

```ts
import type { z } from "zod";
import type {
	ClosureSchema,
	EvidenceEntrySchema,
	FeatureRunSchema,
	Immutable,
	ObservedAssertionSchema,
	OperationRecordSchema,
	PlanFeatureSchema,
	PlanSchema,
	ReviewAssignmentSchema,
	ReviewFindingSchema,
	PersistedReviewResultSchema,
	SessionDocumentSchema,
	ValidationObservationSchema,
} from "./session-schema.js";

export type PlanFeature = Immutable<z.infer<typeof PlanFeatureSchema>>;
export type EvidenceEntry = Immutable<z.infer<typeof EvidenceEntrySchema>>;
export type ObservedAssertion = Immutable<z.infer<typeof ObservedAssertionSchema>>;
export type Plan = Immutable<z.infer<typeof PlanSchema>>;
export type ReviewFinding = Immutable<z.infer<typeof ReviewFindingSchema>>;
export type ReviewResult = Immutable<z.infer<typeof PersistedReviewResultSchema>>;
export type ValidationObservation = Immutable<z.infer<typeof ValidationObservationSchema>>;
export type ReviewAssignment = Immutable<z.infer<typeof ReviewAssignmentSchema>>;
export type FeatureRun = Immutable<z.infer<typeof FeatureRunSchema>>;
export type OperationRecord = Immutable<z.infer<typeof OperationRecordSchema>>;
export type SessionClosure = Immutable<z.infer<typeof ClosureSchema>>;
export type Session = Immutable<z.infer<typeof SessionDocumentSchema>>;
export type Artifact = Readonly<{ path: string }>;
```

`SourceDigest` stays hand-written as the template literal type and `SourceDigestSchema` keeps `z.custom<SourceDigest>`, so inference preserves it. `requestEvidence` inference must equal the existing `RequestEvidenceAnchor` type in `request-evidence.ts`; if `typecheck` complains, make `request-evidence.ts` import its type from the inferred `Session["requestEvidence"]` instead of defining it.

- [ ] **Step 3: Slim `application/schema.ts`**

It now contains only `boundedText`, the id/revision schemas it still needs for requests, the eight request schemas, and the four request types. Import `PlanSchema`, `ArtifactSchema`, `ReviewPacketSchema`, `PublicReviewResultSchema` from `../domain/session-schema.js`, and re-export `SessionSchema` from there for existing importers:

```ts
export { SessionSchema } from "../domain/session-schema.js";
```

- [ ] **Step 4: Typecheck and chase every mismatch**

Run: `bun run typecheck`
Expected: a list of errors, each of which is one of:
- a place that spread a `readonly` array into a mutable parameter (the `Immutable` mapping should prevent this; if it appears, the schema declared a `.readonly()` that the old type did not have; remove it),
- an optional field the old type declared as `?: T | undefined` that inference declares the same way (no error expected),
- a test that constructs a `Session` literal with a field the schema forbids (fix the test literal).

Fix each until the compiler is clean.

- [ ] **Step 5: Run the suite**

Run: `bun run lint && bun test tests`
Expected: PASS. `tests/opencode-schema-contract.test.ts` and `tests/distribution-and-surface.test.ts` check the published declaration surface; if the moved schemas change what `dist/index.d.ts` exports, update `scripts/lib/package-surface.ts` and `scripts/prune-dist-declarations.ts` so the public surface is unchanged (`SessionSchema` must remain reachable from the same import path consumers used before).

- [ ] **Step 6: Commit and phase gate**

```bash
bunx biome format --write src tests
git add src/domain/session-schema.ts src/domain/session.ts src/application/schema.ts src tests scripts
git commit -m "refactor(domain): infer Session v5 types from their schemas

One definition per field. Request schemas stay in the application layer.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
bun run check && bun run package:smoke
```

Expected: exit 0 for both. Open the Phase 5 PR.

---

## Completion checklist

- [ ] Every phase PR merged with `bun run check` green on CI.
- [ ] `bun run smoke:live` run at least once after Phase 3 and once after Phase 4 on a host with credentials, and its result recorded in the PR.
- [ ] No change to `skills/`, `src/prompt-surfaces.ts`, `src/guidance/`, or any request schema across all five PRs (verify with `git diff main...HEAD --stat -- skills src/prompt-surfaces.ts src/guidance src/application/schema.ts` on each branch; Phase 5 legitimately touches `schema.ts` but only to move, not to alter, request shapes).
- [ ] `docs/development.md` "Source layout" section updated in the Phase 3 PR to name the new `infrastructure/fs` modules and the `command-hook`, `tool-guard`, and `auto-drive-decision` files.
