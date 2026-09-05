import { SaxesParser } from "saxes";
import {
	MAX_DECLARED_ASSERTIONS,
	MAX_TEST_REPORT_BYTES,
} from "../domain/limits.js";
import type { ObservedAssertion } from "../domain/session.js";

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
		...suites.flatMap((suite) => [
			`${suite} ${name}`,
			`${suite}.${name}`,
			`${suite} > ${name}`,
		]),
	];
}

/** Read only declared cases from a complete JUnit document, never log text. */
export function observeAssertions(
	declared: readonly string[],
	report: string,
): ObservedAssertion[] {
	const names = declared.slice(0, MAX_DECLARED_ASSERTIONS);
	const absent = (): ObservedAssertion[] =>
		names.map((name) => ({ name, status: "absent" }));
	if (names.length === 0 || Buffer.byteLength(report) > MAX_TEST_REPORT_BYTES)
		return absent();
	const wanted = new Set(names);
	const outcomes = new Map<string, ObservedAssertion["status"]>();
	const stack: string[] = [];
	let nonSuiteAncestors = 0;
	let current:
		| {
				names: string[];
				depth: number;
				status: "passed" | "skipped" | "failed";
		  }
		| undefined;
	const parser = new SaxesParser();
	parser.on("doctype", () => {
		throw new Error("JUnit evidence must not contain a DTD.");
	});
	parser.on("opentag", (tag) => {
		if (
			stack.length === 0 &&
			tag.name !== "testsuite" &&
			tag.name !== "testsuites"
		)
			throw new Error("JUnit evidence requires a suite root.");
		if (
			tag.name === "testcase" &&
			stack.length > 0 &&
			nonSuiteAncestors === 0
		) {
			current = {
				names: labels(tag.attributes).filter((name) => wanted.has(name)),
				depth: stack.length,
				status: "passed",
			};
		} else if (current && stack.length === current.depth + 1) {
			if (tag.name === "failure" || tag.name === "error")
				current.status = "failed";
			else if (tag.name === "skipped" && current.status !== "failed")
				current.status = "skipped";
		}
		stack.push(tag.name);
		if (tag.name !== "testsuite" && tag.name !== "testsuites")
			nonSuiteAncestors += 1;
	});
	parser.on("closetag", () => {
		const name = stack.pop();
		if (name !== "testsuite" && name !== "testsuites") nonSuiteAncestors -= 1;
		if (!current || stack.length !== current.depth) return;
		for (const name of current.names) {
			const prior = outcomes.get(name);
			if (
				prior === undefined ||
				prior === "passed" ||
				current.status === "failed"
			)
				outcomes.set(name, current.status);
		}
		current = undefined;
	});
	try {
		// The parser throws on malformed XML. Discard even cases read before the error.
		parser.write(report).close();
	} catch {
		return absent();
	}
	return names.map((name) => ({
		name,
		status: outcomes.get(name) ?? "absent",
	}));
}
