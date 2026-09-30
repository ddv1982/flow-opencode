import { expect, test } from "bun:test";
import {
	type RetainedScenarioEvidence,
	RetainedScenarioEvidenceSchema,
} from "../evals/grader-input.js";
import { nativeActorBindingIssues } from "../evals/native-actors.js";
import { releaseGraderBundle } from "../evals/release-policy.js";
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";

function evidence(): RetainedScenarioEvidence {
	const gradeInput = autoQualifiedOutcome("two");
	const model = {
		routeProvider: "openai",
		gateway: null,
		family: "gpt-6-sol",
		model: "gpt-6-sol",
		revision: null,
	};
	return RetainedScenarioEvidenceSchema.parse({
		schemaVersion: 1,
		attempt: {
			attemptId: "attempt",
			cellId: "cell",
			caseId: "auto-two-features-evidence",
			repetition: 0,
			model,
		},
		actors: [
			{
				role: "manager",
				sessionIds: ["ses_root"],
				actualModel: {
					kind: "observed",
					value: { providerID: "openai", modelID: "gpt-6-sol" },
				},
				requestedModel: model,
				requestedModelId: "openai/gpt-6-sol",
			},
			{
				role: "reviewer",
				sessionIds: ["ses_reviewer0", "ses_reviewer1"],
				actualModel: {
					kind: "observed",
					value: { providerID: "openai", modelID: "gpt-6-sol" },
				},
				requestedModel: model,
				requestedModelId: "openai/gpt-6-sol",
			},
		],
		guidanceLoads: [],
		gradeInput: { schemaVersion: 1, ...gradeInput, providerErrors: [] },
		usage: { durationMs: 1, outputTokens: 1, costUsd: null },
	});
}

test("native actor binding accepts exact root and all used reviewer children", () => {
	expect(nativeActorBindingIssues(evidence())).toEqual([]);
});

test("native actor binding rejects relabeled manager evidence", () => {
	const fixture = evidence();
	fixture.actors = fixture.actors.map((actor) =>
		actor.role === "manager" ? { ...actor, sessionIds: ["ses_alias"] } : actor,
	);
	expect(nativeActorBindingIssues(fixture)).toContain(
		"Manager actor sessions differ from native runner roots.",
	);
});

test("native actor binding rejects a missing used reviewer child", () => {
	const fixture = evidence();
	fixture.actors = fixture.actors.map((actor) =>
		actor.role === "reviewer"
			? { ...actor, sessionIds: ["ses_reviewer0"] }
			: actor,
	);
	expect(nativeActorBindingIssues(fixture)).toContain(
		"Accepted reviewer session is absent from reviewer actor evidence.",
	);
});

test("trace-absent retained evidence keeps its historical actor behavior", () => {
	const fixture = evidence();
	delete fixture.gradeInput.hostTrace;
	fixture.actors = fixture.actors.map((actor) =>
		actor.role === "manager"
			? { ...actor, sessionIds: ["historical-manager"] }
			: actor,
	);
	expect(nativeActorBindingIssues(fixture)).toEqual([]);
});

function namespace(
	fixture: RetainedScenarioEvidence,
	name: string,
): RetainedScenarioEvidence {
	return JSON.parse(
		JSON.stringify(fixture)
			.replaceAll("ses_root", `ses_${name}_root`)
			.replaceAll("ses_reviewer", `ses_${name}_reviewer`),
	);
}

test("distinct native root and reviewer identities remain valid across attempts", () => {
	const first = namespace(evidence(), "first");
	const second = namespace(evidence(), "second");
	expect(nativeActorBindingIssues(first)).toEqual([]);
	expect(nativeActorBindingIssues(second)).toEqual([]);
	const firstRoots = first.actors.find(
		(actor) => actor.role === "manager",
	)?.sessionIds;
	const secondRoots = second.actors.find(
		(actor) => actor.role === "manager",
	)?.sessionIds;
	expect(firstRoots).toEqual(["ses_first_root"]);
	expect(secondRoots).toEqual(["ses_second_root"]);
	expect(secondRoots?.some((id) => firstRoots?.includes(id))).toBe(false);
});

test("unique actor aliases cannot hide a reused native root across attempts", () => {
	for (const alias of ["ses_first_alias", "ses_second_alias"]) {
		const fixture = evidence();
		fixture.actors = fixture.actors.map((actor) =>
			actor.role === "manager" ? { ...actor, sessionIds: [alias] } : actor,
		);
		expect(
			fixture.gradeInput.hostTrace?.kind === "observed" &&
				fixture.gradeInput.hostTrace.runnerRootSessionIds,
		).toEqual(["ses_root"]);
		expect(nativeActorBindingIssues(fixture)).toContain(
			"Manager actor sessions differ from native runner roots.",
		);
	}
});

test.each(["absent", "wrong-part", "wrong-agent"])(
	"accepted completion rejects %s native provenance",
	(mutant) => {
		const fixture = evidence();
		fixture.gradeInput.allCalls = fixture.gradeInput.allCalls.map((call) => {
			if (call.tool !== "flow_feature_complete") return call;
			if (mutant === "absent") return { ...call, native: undefined };
			if (mutant === "wrong-agent") return { ...call, agent: "general" };
			if (!call.native)
				throw new Error("Fixture native provenance is missing.");
			return { ...call, native: { ...call.native, partId: "prt_forged" } };
		});
		expect(nativeActorBindingIssues(fixture)).toContain(
			"Accepted review has no native reviewer-child witness.",
		);
	},
);

test("transitive grader bundle retains native actor binding source", () => {
	const files = releaseGraderBundle(
		new URL("..", import.meta.url).pathname,
	).files.map((file) => file.path);
	expect(files).toContain("evals/native-actors.ts");
});

test.each(["all", "one"])(
	"native trace rejects suppression of %s completion calls",
	(mutant) => {
		const fixture = evidence();
		const completions = fixture.gradeInput.allCalls.filter(
			(call) => call.tool === "flow_feature_complete",
		);
		expect(completions).toHaveLength(2);
		fixture.gradeInput.allCalls = fixture.gradeInput.allCalls.filter(
			(call) =>
				call.tool !== "flow_feature_complete" ||
				(mutant === "one" && call === completions[0]),
		);
		fixture.actors = fixture.actors.filter(
			(actor) => actor.role !== "reviewer",
		);
		expect(nativeActorBindingIssues(fixture)).toContain(
			"Native completion part lacks one exact retained call.",
		);
	},
);

test("native trace rejects duplicate retained completion witnesses", () => {
	const fixture = evidence();
	const completion = fixture.gradeInput.allCalls.find(
		(call) => call.tool === "flow_feature_complete",
	);
	if (!completion) throw new Error("Fixture completion is missing.");
	fixture.gradeInput.allCalls = [...fixture.gradeInput.allCalls, completion];
	expect(nativeActorBindingIssues(fixture)).toContain(
		"Native completion part lacks one exact retained call.",
	);
});
