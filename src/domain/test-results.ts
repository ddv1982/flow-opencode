import { MAX_DECLARED_ASSERTIONS } from "./limits.js";
import type { ObservedAssertion } from "./session.js";

/**
 * Named test outcomes, read from a JUnit report the command wrote.
 *
 * An exit code says a process succeeded, never which cases ran, and `test.skip` exits
 * zero. So a declared name is satisfied only by a case a report says passed: skipped
 * is `skipped`, unmentioned is `absent`, and neither discharges anything
 * (`docs/adr/0012-named-results-over-exit-codes.md`).
 *
 * Regex over XML, which is normally the wrong tool. It is right here: the shape is one
 * bounded, well-specified element, and a parser dependency to read four attributes is
 * a worse trade than a pattern with a test suite pinning it.
 */
const TESTCASE = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase\s*>)/g;
const ATTRIBUTE = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
const NEGATIVE = /<(failure|error|skipped)\b/;

function attributes(source: string): Record<string, string> {
	const found: Record<string, string> = {};
	for (const match of source.matchAll(ATTRIBUTE)) {
		if (match[1]) found[match[1]] = decodeEntities(match[2] ?? "");
	}
	return found;
}

/** The five predefined XML entities, which is all a JUnit writer emits. */
function decodeEntities(value: string): string {
	return value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}

/**
 * Every label a declared assertion may name this case by.
 *
 * Runners disagree about where the suite name goes, so the bare name and the three
 * common joins are all accepted rather than guessing at one runner's shape.
 *
 * `file` is read as a suite too, because Bun — the runner Flow itself is built on —
 * emits `classname=""` and puts the path in `file`. Measured against real
 * `bun test --reporter=junit` output: without this, the bare name matched and
 * `src/platform.test.ts > creates the replacement on Windows` read `absent`, which is
 * a refusal of a case that passed. The most natural way to write a qualified name was
 * the one way it did not work.
 */
function labels(attributes: Record<string, string>): string[] {
	const name = attributes.name ?? "";
	if (name === "") return [];
	const suites = [
		attributes.classname,
		attributes.class,
		attributes.file,
		attributes.filepath,
	].filter((suite): suite is string => suite !== undefined && suite !== "");
	return [
		name,
		...new Set(
			suites.flatMap((suite) => [
				`${suite} ${name}`,
				`${suite}.${name}`,
				`${suite} > ${name}`,
			]),
		),
	];
}

/**
 * Outcomes for the declared names, and nothing else: a full case inventory would put
 * an unbounded copy of someone's suite into durable state to answer a question about
 * a handful of names.
 */
export function observeAssertions(
	declared: readonly string[],
	report: string,
): ObservedAssertion[] {
	const outcomes = new Map<string, "passed" | "failed" | "skipped">();
	for (const match of report.matchAll(TESTCASE)) {
		const body = match[3] ?? "";
		const status = NEGATIVE.test(body)
			? /<skipped\b/.test(body)
				? ("skipped" as const)
				: ("failed" as const)
			: ("passed" as const);
		for (const label of labels(attributes(match[1] ?? ""))) {
			// First writing wins, so a name reported twice cannot be upgraded to passed
			// by a later duplicate: a retried case that failed once stays failed.
			const prior = outcomes.get(label);
			if (prior === undefined || (prior === "passed" && status !== "passed")) {
				outcomes.set(label, status);
			}
		}
	}
	return declared.slice(0, MAX_DECLARED_ASSERTIONS).map((name) => ({
		name,
		status: outcomes.get(name) ?? ("absent" as const),
	}));
}

/** Whether every declared name was reported as a passing case. */
export function assertionsSatisfied(
	declared: readonly string[],
	observed: readonly ObservedAssertion[] | undefined,
): boolean {
	return declared.every((name) =>
		(observed ?? []).some(
			(assertion) => assertion.name === name && assertion.status === "passed",
		),
	);
}

/** The declared names an observation did not report as passing, with why. */
export function unmetAssertions(
	declared: readonly string[],
	observed: readonly ObservedAssertion[] | undefined,
): string[] {
	return declared.flatMap((name) => {
		const found = (observed ?? []).find((assertion) => assertion.name === name);
		if (found?.status === "passed") return [];
		return [`${JSON.stringify(name)} ${found?.status ?? "absent"}`];
	});
}
